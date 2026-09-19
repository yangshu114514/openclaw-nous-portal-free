#!/usr/bin/env node
/**
 * Local inference proxy for Nous Portal free-tier credentials.
 *
 * Runs on loopback only. OpenClaw treats it as an ordinary local
 * OpenAI-compatible endpoint (like Ollama); this process owns the
 * credential lifecycle — invoking JWT access tokens are refreshed from the
 * stored device-code refresh token and presented to the upstream
 * inference API. Client credentials are never forwarded upstream.
 *
 * Standalone: `node dist/proxy.js` (no runtime dependencies beyond Node >=22).
 *
 * Upstream transport and token-manager logic:
 * jiesou/dsh-nous-portal-free-provider (MIT).
 *
 * @module openclaw-nous-portal-free/proxy
 */
import * as http from 'node:http'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { Readable } from 'node:stream'
import type { ReadableStream } from 'node:stream/web'
import {
	DEFAULT_CLIENT_ID,
	DEFAULT_INFERENCE_URL,
	NousTokenManager,
	refreshAccessToken,
	type NousPortalGrant,
} from './oauth.js'
import { fetchFreeModels, type NousPortalModel } from './models.js'

const DEFAULT_PORT = Number(process.env.NOUS_PORTAL_FREE_PORT ?? 18791)
const credDir =
	process.env.NOUS_PORTAL_FREE_CRED_DIR ??
	path.join(os.homedir(), '.openclaw', 'nous-portal-free')
const CRED_FILE = process.env.NOUS_PORTAL_FREE_CRED_FILE ?? path.join(credDir, 'credentials.json')
const PID_FILE = path.join(credDir, 'proxy.pid')

interface StoredCredentials {
	grant?: NousPortalGrant
	access?: { token: string, expiresAt: number }
}

function log(...args: unknown[]): void {
	console.error(`[nous-portal-free-proxy] ${new Date().toISOString()}`, ...args)
}

/** Read the stored grant (refresh token). Undefined when not signed in. */
function readCredFile(): StoredCredentials | undefined {
	try {
		const raw = fs.readFileSync(CRED_FILE, 'utf8')
		const parsed: unknown = JSON.parse(raw)
		if (parsed && typeof parsed === 'object') return parsed as StoredCredentials
	} catch {
		// missing or corrupt file: treat as not configured
	}
	return undefined
}
/** Atomic write (tmp + rename) so a crashed writer never leaves a half file. */
function writeCredFile(data: StoredCredentials): void {
	fs.mkdirSync(credDir, { recursive: true })
	const tmp = `${CRED_FILE}.tmp-${process.pid}`
	fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
	fs.renameSync(tmp, CRED_FILE)
	try {
		fs.chmodSync(CRED_FILE, 0o600)
	} catch {
		// best effort (Windows ignores chmod)
	}
}

/**
 * Token manager wired to the durable credential file. The proxy is the only
 * process that refreshes/writes after login (documented), so a per-process
 * lock plus atomic replace is enough to keep the refresh token single-use
 * safe across the gateway + this proxy.
 */
const credentials = readCredFile()
const tokenManager = new NousTokenManager({
	resolveGrant: async () => {
		const fresh = readCredFile()
		return fresh?.grant
	},
	refreshGrant: async (grant, signal) => {
		const response = await refreshAccessToken(grant, signal)
		const expiresAt =
			typeof response.expires_in === 'number'
				? Date.now() + response.expires_in * 1_000
				: Date.now() + 30 * 60 * 1_000
		const rotated = typeof response.refresh_token === 'string' && response.refresh_token.length > 0
			? response.refresh_token
			: grant.refreshToken
		const nextGrant: NousPortalGrant = {
			...grant,
			refreshToken: rotated,
			...(typeof response.inference_base_url === 'string' && response.inference_base_url.length > 0
				? { inferenceBaseUrl: response.inference_base_url.replace(/\/+$/, '') }
				: {}),
		}
		const stored = readCredFile() ?? {}
		writeCredFile({
			grant: nextGrant,
			access: {
				token: response.access_token,
				expiresAt,
			},
		})
		return {
			accessToken: response.access_token,
			accessTokenExpiresAt: expiresAt,
			...(response.inference_base_url ? { inferenceBaseUrl: response.inference_base_url.replace(/\/+$/, '') } : {}),
			rotatedRefreshToken: rotated,
		}
	},
})
void credentials // initial read is informational; resolution always re-reads

function upstreamBase(): string {
	const stored = readCredFile()
	return stored?.grant?.inferenceBaseUrl ?? DEFAULT_INFERENCE_URL
}

/** Copy incoming headers, dropping anything that could leak local identity. */
function forwardHeaders(request: http.IncomingMessage): Record<string, string> {
	const out: Record<string, string> = {}
	for (const [key, value] of Object.entries(request.headers)) {
		if (value === undefined) continue
		const lower = key.toLowerCase()
		if (
			lower === 'host' ||
			lower === 'authorization' ||
			lower === 'proxy-authorization' ||
			lower === 'connection'
		) {
			continue
		}
		out[lower] = Array.isArray(value) ? value.join(', ') : value
	}
	return out
}

async function handleChat(request: http.IncomingMessage, response: http.ServerResponse, attempt = 1): Promise<void> {
	// Collect the request body (chat completions payloads are small; stream
	// request bodies are not a thing on the client side of this endpoint).
	const chunks: Buffer[] = []
	for await (const chunk of request) chunks.push(chunk as Buffer)
	const body = Buffer.concat(chunks)

	let credential
	try {
		credential = await tokenManager.getInferenceCredential()
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		log('credential resolution failed:', message)
		response.writeHead(503, { 'content-type': 'application/json' })
		response.end(JSON.stringify({ error: { message, type: 'server_error' } }))
		return
	}

	const url = `${credential.inferenceBaseUrl}/chat/completions`
	const headers = forwardHeaders(request)
	headers['authorization'] = `Bearer ${credential.apiKey}`

	let upstream: Response
	try {
		upstream = await fetch(url, {
			method: request.method ?? 'POST',
			headers,
			body: body.length > 0 ? body : undefined,
		} as RequestInit)
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		log('upstream fetch failed:', message)
		response.writeHead(502, { 'content-type': 'application/json' })
		response.end(JSON.stringify({ error: { message: `inference upstream unreachable: ${message}`, type: 'server_error' } }))
		return
	}

	// One retry on auth failure: the JWT may have been rotated under us.
	if (upstream.status === 401 && attempt === 1) {
		log('upstream 401; forcing token refresh and retrying once')
		response.statusMessage
		void handleChat(request, response, attempt + 1)
		// The token manager caches until expiry; nudge by re-reading and
		// letting the next resolution refresh. Simpler path: fail this pass,
		// let the caller's next request refresh. But one in-place retry with
		// a fresh credential is strictly better:
		// (re-entry is safe because getInferenceCredential single-flights)
		return
	}

	const resHeaders: Record<string, string> = {}
	upstream.headers.forEach((value, key) => {
		const lower = key.toLowerCase()
		if (lower === 'transfer-encoding' || lower === 'content-encoding' || lower === 'connection' || lower === 'content-length') return
		resHeaders[lower] = value
	})
	response.writeHead(upstream.status, resHeaders)

	if (upstream.body) {
		const nodeStream = Readable.fromWeb(upstream.body as unknown as ReadableStream)
		nodeStream.pipe(response)
	} else {
		response.end()
	}
}

async function handleModels(_request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
	// Serve the FREE-filtered catalog from the public upstream listing so
	// OpenClaw's live discovery sees only zero-priced, text-output models.
	try {
		const models: NousPortalModel[] = await fetchFreeModels(`${upstreamBase()}/models`)
		const payload = {
			object: 'list',
			data: models.map((model) => ({
				id: model.id,
				object: 'model',
				name: model.name ?? model.id,
				context_length: model.contextWindow,
				max_completion_tokens: model.maxTokens,
				pricing: { prompt: '0', completion: '0' },
				architecture: {
					input_modalities: model.input ?? ['text'],
					output_modalities: ['text'],
				},
				...(model.reasoning
					? {
						reasoning: {
							mandatory: model.reasoning.mandatory === true,
							default_enabled: model.reasoning.defaultEnabled === true,
							...(model.reasoning.supportedEfforts ? { supported_efforts: model.reasoning.supportedEfforts } : {}),
							...(model.reasoning.defaultEffort ? { default_effort: model.reasoning.defaultEffort } : {}),
						},
						supported_parameters: ['tools', 'tool_choice', 'max_tokens', 'temperature', ...(model.reasoning?.controllable ? ['reasoning', 'reasoning_effort'] : [])],
					}
					: { supported_parameters: ['tools', 'tool_choice', 'max_tokens', 'temperature'] }),
			})),
		}
		response.writeHead(200, { 'content-type': 'application/json' })
		response.end(JSON.stringify(payload))
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		log('catalog fetch failed:', message)
		response.writeHead(502, { 'content-type': 'application/json' })
		response.end(JSON.stringify({ error: { message: `catalog upstream unreachable: ${message}`, type: 'server_error' } }))
	}
}

function handleHealth(_request: http.IncomingMessage, response: http.ServerResponse): void {
	const stored = readCredFile()
	const grantOk = Boolean(stored?.grant?.refreshToken)
	response.writeHead(200, { 'content-type': 'application/json' })
	response.end(
		JSON.stringify({
			ok: true,
			signedIn: grantOk,
			clientId: stored?.grant?.clientId ?? DEFAULT_CLIENT_ID,
			upstream: stored?.grant?.inferenceBaseUrl ?? DEFAULT_INFERENCE_URL,
			credFile: CRED_FILE,
		}),
	)
}

const server = http.createServer((request, response) => {
	const url = new URL(request.url ?? '/', 'http://127.0.0.1')
	const pathname = url.pathname.replace(/\/+$/, '')
	if (request.method === 'GET' && pathname === '/healthz') {
		void handleHealth(request, response)
		return
	}
	if (request.method === 'GET' && (pathname === '/v1/models' || pathname === '/models')) {
		void handleModels(request, response)
		return
	}
	if (pathname === '/v1/chat/completions' || pathname === '/chat/completions') {
		void handleChat(request, response).catch((error) => {
			log('unhandled proxy error:', error instanceof Error ? error.stack : error)
			if (!response.headersSent) {
				response.writeHead(500, { 'content-type': 'application/json' })
			}
			response.end(JSON.stringify({ error: { message: 'proxy internal error', type: 'server_error' } }))
		})
		return
	}
	response.writeHead(404, { 'content-type': 'application/json' })
	response.end(JSON.stringify({ error: { message: `unknown path: ${pathname}`, type: 'not_found' } }))
})

server.listen(DEFAULT_PORT, '127.0.0.1', () => {
	log(`listening on 127.0.0.1:${DEFAULT_PORT} (loopback only)`)
	try {
		fs.mkdirSync(credDir, { recursive: true })
		fs.writeFileSync(PID_FILE, String(process.pid))
	} catch {
		// pid file is advisory
	}
})

process.on('SIGTERM', () => {
	log('SIGTERM; shutting down')
	server.close(() => process.exit(0))
	setTimeout(() => process.exit(0), 3_000).unref()
})
