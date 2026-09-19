/**
 * OpenClaw provider entry for the Nous Portal free tier.
 *
 * Unlike the funded-API-key variant (jason-allen-oneal/openclaw-nous-portal),
 * this provider is keyless from OpenClaw's point of view: a loopback proxy
 * (`nous-portal-free daemon`) owns the OAuth device-code grant and mints the
 * invoke JWTs, and OpenClaw simply talks to `http://127.0.0.1:<port>/v1`
 * the same way it would talk to Ollama.
 *
 * Model discovery points at the proxy's `/models` endpoint, which serves the
 * live free-filtered catalog; when discovery is unavailable the checked-in
 * snapshot catalog is used.
 *
 * @module openclaw-nous-portal-free/index
 */
import { defineSingleProviderPluginEntry } from 'openclaw/plugin-sdk/provider-entry'
import { createModelCatalogPresetAppliers } from 'openclaw/plugin-sdk/provider-onboard'
import manifest from '../openclaw.plugin.json' with { type: 'json' }
import { buildFallbackModels, DEFAULT_MODEL_REF } from './fallback-catalog.js'
import type { OpenAICompatibleModelDiscoveryOptions } from 'openclaw/plugin-sdk/provider-catalog-live-runtime'
import type { ModelDefinitionConfig } from 'openclaw/plugin-sdk/provider-model-shared'

const PROVIDER_ID = 'nous-portal-free'

function proxyBaseUrl(): string {
	const override = process.env.NOUS_PORTAL_FREE_PROXY_URL
	if (override && override.length > 0) return override.replace(/\/+$/, '')
	const port = process.env.NOUS_PORTAL_FREE_PORT ?? '18791'
	return `http://127.0.0.1:${port}/v1`
}

/**
 * Map one row of the proxy's `/models` response (OpenRouter-shaped,
 * free-filtered) onto an OpenClaw model definition.
 */
function projectDiscoveredModel(raw: unknown): ModelDefinitionConfig | undefined {
	if (typeof raw !== 'object' || raw === null) return undefined
	const row = raw as Record<string, unknown>
	const id = typeof row.id === 'string' && row.id.length > 0 ? row.id : undefined
	if (id === undefined) return undefined
	const contextWindow =
		typeof row.context_length === 'number' && Number.isFinite(row.context_length) && row.context_length > 0
			? row.context_length
			: undefined
	const maxTokens =
		typeof row.max_completion_tokens === 'number' && Number.isFinite(row.max_completion_tokens)
			? row.max_completion_tokens
			: undefined
	const architecture = (row.architecture ?? {}) as Record<string, unknown>
	const inputModalities = Array.isArray(architecture.input_modalities)
		? architecture.input_modalities.filter((value): value is string => typeof value === 'string')
		: []
	const reasoningMeta = (row.reasoning ?? undefined) as Record<string, unknown> | undefined
	const params = Array.isArray(row.supported_parameters)
		? (row.supported_parameters as unknown[]).filter((value): value is string => typeof value === 'string')
		: []
	const effortParamsHasReasoningEffort = params.includes('reasoning_effort')
	const reasoning: ModelDefinitionConfig['reasoning'] =
		reasoningMeta !== undefined
			? {
				controllable: effortParamsHasReasoningEffort,
				...(reasoningMeta.mandatory === true ? { mandatory: true } : {}),
				...(reasoningMeta.default_enabled === true ? { defaultEnabled: true } : {}),
				...(Array.isArray(reasoningMeta.supported_efforts)
					? { supportedEfforts: reasoningMeta.supported_efforts.filter((v): v is string => typeof v === 'string') }
					: {}),
				...(typeof reasoningMeta.default_effort === 'string' ? { defaultEffort: reasoningMeta.default_effort } : {}),
			}
			: undefined
	return {
		id,
		...(typeof row.name === 'string' && row.name.length > 0 ? { name: row.name } : {}),
		...(contextWindow !== undefined ? { contextWindow } : {}),
		...(maxTokens !== undefined ? { maxTokens } : {}),
		...(inputModalities.includes('image') ? { input: ['text', 'image'] as Array<'text' | 'image'> } : { input: ['text'] }),
		...(reasoning !== undefined ? { reasoning } : {}),
		compat: { supportsTools: params.includes('tools') },
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	}
}

export const DISCOVERY: OpenAICompatibleModelDiscoveryOptions = {
	endpointUrl: {
		url: () => `${proxyBaseUrl()}/models`,
	},
	projectRows: (rows: unknown[]) =>
		(rows
			.map(projectDiscoveredModel)
			.filter((model): model is ModelDefinitionConfig => model !== undefined) as ModelDefinitionConfig[]),
	ttlMs: 300_000,
}

const { applyConfig } = createModelCatalogPresetAppliers<unknown[]>({
	primaryModelRef: DEFAULT_MODEL_REF,
	resolveParams: () => ({
		providerId: PROVIDER_ID,
		api: 'openai-completions',
		baseUrl: proxyBaseUrl(),
		catalogModels: buildFallbackModels(),
		aliases: [{ modelRef: DEFAULT_MODEL_REF, alias: 'Nous Portal Free' }],
	}),
})

export default defineSingleProviderPluginEntry({
	id: PROVIDER_ID,
	name: 'Nous Portal Free',
	description: 'Nous Portal free-tier inference via a loopback JWT proxy; no funded API key required',
	manifest,
	provider: {
		label: 'Nous Portal Free',
		docsPath: 'https://portal.nousresearch.com/',
		manifestAuth: { defaultModel: DEFAULT_MODEL_REF, applyConfig },
		catalog: {
			buildProvider: buildFallbackModels,
			buildStaticProvider: buildFallbackModels,
			allowExplicitBaseUrl: true,
			liveModelDiscovery: DISCOVERY,
		},
	},
})
