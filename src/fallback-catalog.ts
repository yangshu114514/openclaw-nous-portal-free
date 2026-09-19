/**
 * Static fallback catalog: a snapshot of the free-tier listing taken
 * 2026-09-19. Used only when live discovery from the local proxy is
 * unavailable; the free pool rotates, so treat these as advisory.
 *
 * Wire shape matches what the proxy's `/models` endpoint emits, and maps
 * 1:1 onto OpenClaw model definitions.
 *
 * @module openclaw-nous-portal-free/fallback-catalog
 */
import type { ModelDefinitionConfig } from 'openclaw/plugin-sdk/provider-model-shared'

type ModelRow = {
	id: string
	name: string
	contextWindow: number
	maxTokens: number
	reasoning?: {
		controllable: boolean
		mandatory?: boolean
		defaultEnabled?: boolean
		supportedEfforts?: string[]
		defaultEffort?: string
	}
	input: string[]
	supportsTools: boolean
}

const SNAPSHOT: ModelRow[] = [
	{
		id: 'inclusionai/ling-3.0-flash-sante:free',
		name: 'inclusionAI: Ling 3.0 Flash Sante (free)',
		contextWindow: 262144,
		maxTokens: 32768,
		input: ['text'],
		supportsTools: true,
	},
	{
		id: 'inclusionai/ling-3.0-flash-fin:free',
		name: 'inclusionAI: Ling 3.0 Flash Fin',
		contextWindow: 262144,
		maxTokens: 235929,
		input: ['text'],
		supportsTools: true,
	},
	{
		id: 'poolside/laguna-s-2.1:free',
		name: 'Poolside: Laguna S 2.1',
		contextWindow: 262144,
		maxTokens: 131072,
		input: ['text'],
		supportsTools: true,
	},
	{
		id: 'poolside/laguna-xs-2.1:free',
		name: 'Poolside: Laguna XS 2.1',
		contextWindow: 262144,
		maxTokens: 32768,
		input: ['text'],
		supportsTools: true,
	},
	{
		id: 'stepfun/step-3.7-flash:free',
		name: 'StepFun: Step 3.7 Flash',
		contextWindow: 262144,
		maxTokens: 32768,
		reasoning: {
			controllable: true,
			mandatory: true,
			supportedEfforts: ['high', 'medium', 'low'],
			defaultEffort: 'medium',
		},
		input: ['text', 'image'],
		supportsTools: true,
	},
	{
		id: 'upstage/solar-pro4:free',
		name: 'Upstage: Solar Pro 4',
		contextWindow: 524288,
		maxTokens: 131072,
		reasoning: {
			controllable: true,
			defaultEnabled: true,
			supportedEfforts: ['max', 'xhigh', 'high', 'medium', 'low', 'minimal', 'none'],
			defaultEffort: 'medium',
		},
		input: ['text'],
		supportsTools: true,
	},
	{
		id: 'meituan/longcat-2.0:free',
		name: 'Meituan: LongCat 2.0 (1M context, fast)',
		contextWindow: 1048576,
		maxTokens: 131072,
		input: ['text'],
		supportsTools: true,
	},
]

/** The model the plugin offers by default ("Nous Portal Free" alias). */
export const DEFAULT_MODEL_REF = 'nous-portal-free/meituan/longcat-2.0:free'

export function buildFallbackModels(): ModelDefinitionConfig[] {
	return SNAPSHOT.map((row) => ({
		id: row.id,
		name: row.name,
		contextWindow: row.contextWindow,
		maxTokens: row.maxTokens,
		input: row.input as Array<'text' | 'image'>,
		...(row.reasoning ? { reasoning: row.reasoning } : {}),
		compat: { supportsTools: row.supportsTools },
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	}))
}
