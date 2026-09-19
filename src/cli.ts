#!/usr/bin/env node
/**
 * Command-line tool for openclaw-nous-portal-free.
 *
 * Subcommands:
 *   login            device-code sign-in (interactive), stores the grant
 *   status           show credential state and proxy health
 *   refresh-models   fetch the live free catalog and print it (JSON)
 *   daemon           run the loopback inference proxy in the foreground
 *
 * @module openclaw-nous-portal-free/cli
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { deviceCodeLogin, DEFAULT_CLIENT_ID, DEFAULT_PORTAL_URL } from './oauth.js'
import { fetchFreeModels } from './models.js'

const credDir =
	process.env.NOUS_PORTAL_FREE_CRED_DIR ??
	path.join(os.homedir(), '.openclaw', 'nous-portal-free')
const CRED_FILE = process.env.NOUS_PORTAL_FREE_CRED_FILE ?? path.join(credDir, 'credentials.json')
const HEALTH_URL = process.env.NOUS_PORTAL_FREE_HEALTH_URL ?? `http://127.0.0.1:${process.env.NOUS_PORTAL_FREE_PORT ?? 18791}/healthz`

function fail(message: string): never {
	console.error(`nous-portal-free: ${message}`)
	process.exit(1)
}

function readStored(): { grant?: unknown, access?: unknown } | undefined {
	try {
		return JSON.parse(fs.readFileSync(CRED_FILE, 'utf8')) as { grant?: unknown, access?: unknown }
	} catch {
		return undefined
	}
}

async function cmdLogin(): Promise<void> {
	console.error('nous-portal-free: requesting device code from the Portal...')
	const grant = await deviceCodeLogin({
		portalUrl: DEFAULT_PORTAL_URL,
		clientId: DEFAULT_CLIENT_ID,
		onChallenge: (challenge) => {
			console.error('')
			console.error('Open this URL in a browser (the free tier requires no funded account):')
			console.error('')
			console.error(`  ${challenge.verificationUrl}`)
			if (challenge.userCode.length > 0) {
				console.error(`  and enter code: ${challenge.userCode}`)
			}
			console.error('')
			console.error(
				`Waiting for approval (expires in ~${Math.round(challenge.expiresInSeconds / 60)} min)...`,
			)
		},
	})
	fs.mkdirSync(credDir, { recursive: true })
	const tmp = `${CRED_FILE}.tmp-${process.pid}`
	fs.writeFileSync(tmp, JSON.stringify({ grant }, null, 2))
	fs.renameSync(tmp, CRED_FILE)
	try {
		fs.chmodSync(CRED_FILE, 0o600)
	} catch {
		// best effort
	}
	console.error(`nous-portal-free: signed in (grant stored at ${CRED_FILE})`)
	console.error('Next: start the proxy (nous-portal-free daemon or your service manager), then point OpenClaw at http://127.0.0.1:<port>/v1')
}

async function cmdStatus(): Promise<void> {
	const stored = readStored()
	const signedIn = Boolean((stored?.grant as { refreshToken?: string } | undefined)?.refreshToken)
	console.log(JSON.stringify({ credFile: CRED_FILE, signedIn }, null, 2))
	try {
		const response = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(3_000) })
		const body: unknown = await response.json()
		console.log(`proxy ${HEALTH_URL} -> ${JSON.stringify(body)}`)
	} catch (error) {
		console.log(`proxy ${HEALTH_URL} -> unreachable (${error instanceof Error ? error.message : String(error)})`)
	}
}

async function cmdRefreshModels(): Promise<void> {
	const models = await fetchFreeModels()
	console.log(JSON.stringify(models, null, 2))
}

function cmdDaemon(): void {
	// Import dynamically so that a plain `login`/`status` run never binds a port.
	void import('./proxy.js').catch((error) => fail(`proxy failed to start: ${String(error)}`))
}

const command = process.argv[2]
switch (command) {
	case 'login':
		void cmdLogin().catch((error) => fail(error instanceof Error ? error.message : String(error)))
		break
	case 'status':
		void cmdStatus().catch((error) => fail(error instanceof Error ? error.message : String(error)))
		break
	case 'refresh-models':
		void cmdRefreshModels().catch((error) => fail(error instanceof Error ? error.message : String(error)))
		break
	case 'daemon':
		cmdDaemon()
		break
	default:
		console.error('usage: nous-portal-free <login|status|refresh-models|daemon>')
		process.exit(command === undefined ? 0 : 1)
}
