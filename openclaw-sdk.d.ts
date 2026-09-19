/**
 * Ambient type stubs for the OpenClaw plugin SDK surface used by this plugin.
 *
 * The real modules are provided at runtime by the host OpenClaw
 * installation (peer dependency); these declarations are only so the plugin
 * type-checks standalone without pulling the full SDK into devDependencies.
 * Shapes follow the published `openclaw-nous-portal` plugin, which builds
 * against OpenClaw 2026.9.x.
 */
declare module 'openclaw/plugin-sdk/provider-entry' {
	export function defineSingleProviderPluginEntry(entry: Record<string, unknown>): unknown
}
declare module 'openclaw/plugin-sdk/provider-onboard' {
	export function createModelCatalogPresetAppliers<T>(
		opts: Record<string, unknown>,
	): { applyConfig: (...args: T[]) => void }
}
declare module 'openclaw/plugin-sdk/provider-model-shared' {
	export interface ModelDefinitionConfig {
		id: string
		name?: string
		contextWindow?: number
		maxTokens?: number
		input?: Array<'text' | 'image'>
		reasoning?: {
			controllable: boolean
			mandatory?: boolean
			defaultEnabled?: boolean
			supportedEfforts?: string[]
			defaultEffort?: string
		}
		compat?: { supportsTools?: boolean }
		cost?: { input: number, output: number, cacheRead: number, cacheWrite: number }
		[key: string]: unknown
	}
}
declare module 'openclaw/plugin-sdk/provider-catalog-live-runtime' {
	import type { ModelDefinitionConfig } from 'openclaw/plugin-sdk/provider-model-shared'
	export interface OpenAICompatibleModelDiscoveryOptions {
		endpointUrl: {
			url: string | (() => string)
			/** When set, discovery only runs against this exact base URL. */
			requireBaseUrl?: string
		}
		projectRows?: (rows: unknown[]) => ModelDefinitionConfig[]
		/** Cache lifetime for discovery results, in milliseconds. */
		ttlMs?: number
	}
}
