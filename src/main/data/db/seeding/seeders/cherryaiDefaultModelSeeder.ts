import { and, eq } from 'drizzle-orm'

import { ENDPOINT_TYPE } from '@cherrystudio/provider-registry'
import { agentTable } from '@data/db/schemas/agent'
import { assistantTable } from '@data/db/schemas/assistant'
import { preferenceTable } from '@data/db/schemas/preference'
import type { InsertUserModelRow } from '@data/db/schemas/userModel'
import { userModelTable } from '@data/db/schemas/userModel'
import type { InsertUserProviderRow } from '@data/db/schemas/userProvider'
import { providerService } from '@data/services/ProviderService'
import { insertManyWithOrderKey } from '@data/services/utils/orderKey'
import { loggerService } from '@logger'
import { isCherryAiConfigured } from '@main/ai/provider/cherryai'
import {
  CHERRY_CLOUD_PROVIDER_ID,
  CHERRYAI_API_BASE_URL,
  CHERRYAI_DEFAULT_MODEL_GROUP,
  CHERRYAI_DEFAULT_MODEL_ID,
  CHERRYAI_DEFAULT_MODEL_NAME,
  CHERRYAI_DEFAULT_UNIQUE_MODEL_ID,
  CHERRYAI_PROVIDER_ID,
  CHERRYAI_PROVIDER_NAME
} from '@shared/data/presets/cherryai'
import type { ModelCapability } from '@shared/data/types/model'

import type { DbType, ISeeder } from '../../types'
import { hashObject } from '../hashObject'

const logger = loggerService.withContext('CherryAiDefaultModelSeeder')

const DEFAULT_MODEL_PREFERENCE_SCOPE = 'default' as const
export const DEFAULT_MODEL_PREFERENCE_KEYS = [
  'chat.default_model_id',
  'feature.quick_assistant.model_id',
  'feature.translate.model_id'
] as const

type TxLike = Pick<DbType, 'select' | 'insert' | 'update' | 'delete'>
type ManagedCherryProviderRow = Omit<InsertUserProviderRow, 'orderKey'>
type CherryAiDefaultModelRow = Omit<InsertUserModelRow, 'orderKey'>
type DefaultModelPreferenceRow = {
  scope: typeof DEFAULT_MODEL_PREFERENCE_SCOPE
  key: (typeof DEFAULT_MODEL_PREFERENCE_KEYS)[number]
  value: typeof CHERRYAI_DEFAULT_UNIQUE_MODEL_ID
}

function createCherryAiProviderRow(): ManagedCherryProviderRow {
  return {
    providerId: CHERRYAI_PROVIDER_ID,
    presetProviderId: CHERRYAI_PROVIDER_ID,
    name: CHERRYAI_PROVIDER_NAME,
    endpointConfigs: {
      [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
        baseUrl: CHERRYAI_API_BASE_URL
      }
    },
    defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
    authConfig: null,
    providerSettings: null,
    isEnabled: true
  }
}

function createCherryCloudProviderRow(): ManagedCherryProviderRow {
  return {
    providerId: CHERRY_CLOUD_PROVIDER_ID,
    presetProviderId: CHERRYAI_PROVIDER_ID,
    name: CHERRYAI_PROVIDER_NAME,
    endpointConfigs: null,
    defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
    authConfig: null,
    providerSettings: null,
    isEnabled: true
  }
}

function createCherryAiDefaultModelRow(): CherryAiDefaultModelRow {
  const configured = isCherryAiConfigured()
  return {
    id: CHERRYAI_DEFAULT_UNIQUE_MODEL_ID,
    providerId: CHERRYAI_PROVIDER_ID,
    modelId: CHERRYAI_DEFAULT_MODEL_ID,
    presetModelId: null,
    name: CHERRYAI_DEFAULT_MODEL_NAME,
    description: null,
    group: CHERRYAI_DEFAULT_MODEL_GROUP,
    capabilities: [] as ModelCapability[],
    inputModalities: null,
    outputModalities: null,
    endpointTypes: null,
    contextWindow: null,
    maxInputTokens: null,
    maxOutputTokens: null,
    supportsStreaming: true,
    reasoning: null,
    parameters: null,
    pricing: null,
    // 内网/自构建包没有 CherryAI secret：保留行供旧数据引用，但不出现在模型选择器里。
    isEnabled: configured,
    isHidden: !configured,
    isDeprecated: false,
    notes: null
  }
}

// Exported solely for v1->v2 migration reuse; make private when migration support is dropped.
export function ensureCherryAiDefaultProviderAndModelTx(tx: TxLike): void {
  const insertedProviderCount = providerService.batchUpsertTx(tx, [createCherryAiProviderRow()])
  if (insertedProviderCount > 0) {
    logger.warn('Self-healed missing CherryAI default provider', { providerId: CHERRYAI_PROVIDER_ID })
  }

  const insertedCloudProviderCount = providerService.batchUpsertTx(tx, [createCherryCloudProviderRow()])
  if (insertedCloudProviderCount > 0) {
    logger.warn('Self-healed missing Cherry Cloud provider', { providerId: CHERRY_CLOUD_PROVIDER_ID })
  }

  const [existing] = tx
    .select({ id: userModelTable.id })
    .from(userModelTable)
    .where(eq(userModelTable.id, CHERRYAI_DEFAULT_UNIQUE_MODEL_ID))
    .limit(1)
    .all()

  if (existing) {
    const configured = isCherryAiConfigured()
    // 保持与当前构建能力一致；用户手动禁用会在下次 seeder 版本变化时被重新启用。
    tx.update(userModelTable)
      .set({ isEnabled: configured, isHidden: !configured })
      .where(eq(userModelTable.id, CHERRYAI_DEFAULT_UNIQUE_MODEL_ID))
      .run()
    return
  }

  logger.warn('Self-healed missing CherryAI default model', { modelId: CHERRYAI_DEFAULT_UNIQUE_MODEL_ID })
  insertManyWithOrderKey(tx, userModelTable, [createCherryAiDefaultModelRow()], {
    pkColumn: userModelTable.id,
    scope: eq(userModelTable.providerId, CHERRYAI_PROVIDER_ID)
  })
}

function createDefaultModelPreferenceRows(): DefaultModelPreferenceRow[] {
  if (!isCherryAiConfigured()) return []
  return DEFAULT_MODEL_PREFERENCE_KEYS.map((key) => ({
    scope: DEFAULT_MODEL_PREFERENCE_SCOPE,
    key,
    value: CHERRYAI_DEFAULT_UNIQUE_MODEL_ID
  }))
}

function ensureDefaultModelPreferencesTx(tx: TxLike): void {
  if (!isCherryAiConfigured()) {
    // 旧版本可能已写入 cherryai::qwen；内网无法访问，清掉后让用户首次选择本地模型。
    for (const key of DEFAULT_MODEL_PREFERENCE_KEYS) {
      tx.delete(preferenceTable)
        .where(
          and(
            eq(preferenceTable.scope, DEFAULT_MODEL_PREFERENCE_SCOPE),
            eq(preferenceTable.key, key),
            eq(preferenceTable.value, CHERRYAI_DEFAULT_UNIQUE_MODEL_ID)
          )
        )
        .run()
    }
    // 旧数据里仍指向 CherryAI 的助手/智能体会一直命中不可达端点，清空让用户重新选择。
    tx.update(assistantTable)
      .set({ modelId: null })
      .where(eq(assistantTable.modelId, CHERRYAI_DEFAULT_UNIQUE_MODEL_ID))
      .run()
    tx.update(agentTable).set({ model: null }).where(eq(agentTable.model, CHERRYAI_DEFAULT_UNIQUE_MODEL_ID)).run()
    logger.info('Skipped CherryAI default model preferences: client secret is not configured')
    return
  }

  for (const { scope, key, value } of createDefaultModelPreferenceRows()) {
    const [existing] = tx
      .select({ value: preferenceTable.value })
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, scope), eq(preferenceTable.key, key)))
      .limit(1)
      .all()

    if (!existing) {
      logger.warn('Self-healed missing default model preference', { key, value })
      tx.insert(preferenceTable)
        .values({
          scope,
          key,
          value
        })
        .run()
    }
  }
}

function ensureCherryAiDefaultModelSetupTx(tx: TxLike): void {
  ensureCherryAiDefaultProviderAndModelTx(tx)
  ensureDefaultModelPreferencesTx(tx)
}

export class CherryAiDefaultModelSeeder implements ISeeder {
  readonly name = 'cherryaiDefaultModel'
  readonly description = 'Ensure CherryAI providers, default model, and default model preferences'
  readonly version: string

  constructor() {
    this.version = hashObject({
      provider: createCherryAiProviderRow(),
      cloudProvider: createCherryCloudProviderRow(),
      model: createCherryAiDefaultModelRow(),
      preferences: createDefaultModelPreferenceRows()
    })
  }

  run(db: DbType): void {
    db.transaction((tx) => ensureCherryAiDefaultModelSetupTx(tx))
  }
}
