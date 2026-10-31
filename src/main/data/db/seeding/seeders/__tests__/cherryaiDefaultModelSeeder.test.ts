import { setupTestDatabase } from '@test-helpers/db'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryAiProviderModule from '@main/ai/provider/cherryai'

const { mockIsCherryAiConfigured } = vi.hoisted(() => ({
  mockIsCherryAiConfigured: vi.fn(() => true)
}))

vi.mock('@main/ai/provider/cherryai', async (importOriginal) => ({
  ...(await importOriginal<typeof CherryAiProviderModule>()),
  isCherryAiConfigured: mockIsCherryAiConfigured
}))

import { agentTable } from '@data/db/schemas/agent'
import { assistantTable } from '@data/db/schemas/assistant'
import { preferenceTable } from '@data/db/schemas/preference'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import {
  CherryAiDefaultModelSeeder,
  DEFAULT_MODEL_PREFERENCE_KEYS
} from '@data/db/seeding/seeders/cherryaiDefaultModelSeeder'
import { generateOrderKeyBetween } from '@data/services/utils/orderKey'
import {
  CHERRY_CLOUD_PROVIDER_ID,
  CHERRYAI_API_BASE_URL,
  CHERRYAI_DEFAULT_MODEL_GROUP,
  CHERRYAI_DEFAULT_MODEL_ID,
  CHERRYAI_DEFAULT_MODEL_NAME,
  CHERRYAI_DEFAULT_UNIQUE_MODEL_ID,
  CHERRYAI_PROVIDER_ID
} from '@shared/data/presets/cherryai'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import { ENDPOINT_TYPE } from '@shared/data/types/model'

describe('CherryAiDefaultModelSeeder', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    mockMainLoggerService.warn.mockClear()
    mockIsCherryAiConfigured.mockReturnValue(true)
  })

  async function readPreferenceValue(key: string) {
    const [preference] = await dbh.db
      .select()
      .from(preferenceTable)
      .where(and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, key)))
      .limit(1)
    return preference?.value
  }

  async function expectSeededDefaultModelPreferences() {
    for (const key of DEFAULT_MODEL_PREFERENCE_KEYS) {
      expect(await readPreferenceValue(key)).toBe(CHERRYAI_DEFAULT_UNIQUE_MODEL_ID)
    }
  }

  it('seeds branded CherryAI providers, Qwen model, and missing default model preferences', async () => {
    new CherryAiDefaultModelSeeder().run(dbh.db)

    const [provider] = await dbh.db
      .select()
      .from(userProviderTable)
      .where(eq(userProviderTable.providerId, CHERRYAI_PROVIDER_ID))
      .limit(1)
    const [model] = await dbh.db
      .select()
      .from(userModelTable)
      .where(eq(userModelTable.id, CHERRYAI_DEFAULT_UNIQUE_MODEL_ID))
      .limit(1)
    const [cloudProvider] = await dbh.db
      .select()
      .from(userProviderTable)
      .where(eq(userProviderTable.providerId, CHERRY_CLOUD_PROVIDER_ID))
      .limit(1)

    expect(provider).toMatchObject({
      providerId: CHERRYAI_PROVIDER_ID,
      presetProviderId: CHERRYAI_PROVIDER_ID,
      name: 'CherryAI',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      isEnabled: true
    })
    expect(provider?.endpointConfigs?.[ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]?.baseUrl).toBe(CHERRYAI_API_BASE_URL)
    expect(cloudProvider).toMatchObject({
      providerId: CHERRY_CLOUD_PROVIDER_ID,
      presetProviderId: CHERRYAI_PROVIDER_ID,
      name: 'CherryAI',
      defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
      isEnabled: true
    })
    expect(model).toMatchObject({
      id: CHERRYAI_DEFAULT_UNIQUE_MODEL_ID,
      providerId: CHERRYAI_PROVIDER_ID,
      modelId: CHERRYAI_DEFAULT_MODEL_ID,
      name: CHERRYAI_DEFAULT_MODEL_NAME,
      group: CHERRYAI_DEFAULT_MODEL_GROUP,
      isEnabled: true,
      isHidden: false
    })
    await expectSeededDefaultModelPreferences()
    expect(mockMainLoggerService.warn).toHaveBeenCalledWith('Self-healed missing CherryAI default provider', {
      providerId: CHERRYAI_PROVIDER_ID
    })
    expect(mockMainLoggerService.warn).toHaveBeenCalledWith('Self-healed missing CherryAI default model', {
      modelId: CHERRYAI_DEFAULT_UNIQUE_MODEL_ID
    })
    expect(mockMainLoggerService.warn).toHaveBeenCalledWith('Self-healed missing default model preference', {
      key: 'chat.default_model_id',
      value: CHERRYAI_DEFAULT_UNIQUE_MODEL_ID
    })
    expect(await readPreferenceValue('topic.naming.model_id')).toBeUndefined()
  })

  it('does not overwrite existing non-empty default model preferences', async () => {
    await dbh.db.insert(preferenceTable).values([
      {
        scope: 'default',
        key: 'chat.default_model_id',
        value: 'openai::gpt-4o'
      },
      {
        scope: 'default',
        key: 'feature.quick_assistant.model_id',
        value: 'anthropic::claude-3-haiku'
      },
      {
        scope: 'default',
        key: 'feature.translate.model_id',
        value: 'google::gemini-2.5-flash'
      }
    ])

    new CherryAiDefaultModelSeeder().run(dbh.db)

    expect(await readPreferenceValue('chat.default_model_id')).toBe('openai::gpt-4o')
    expect(await readPreferenceValue('feature.quick_assistant.model_id')).toBe('anthropic::claude-3-haiku')
    expect(await readPreferenceValue('feature.translate.model_id')).toBe('google::gemini-2.5-flash')
  })

  it('preserves existing null default model preferences', async () => {
    await dbh.db.insert(preferenceTable).values(
      DEFAULT_MODEL_PREFERENCE_KEYS.map((key) => ({
        scope: 'default',
        key,
        value: null
      }))
    )

    new CherryAiDefaultModelSeeder().run(dbh.db)

    for (const key of DEFAULT_MODEL_PREFERENCE_KEYS) {
      expect(await readPreferenceValue(key)).toBeNull()
    }
  })

  it('preserves existing empty default model preferences', async () => {
    await dbh.db.insert(preferenceTable).values(
      DEFAULT_MODEL_PREFERENCE_KEYS.map((key) => ({
        scope: 'default',
        key,
        value: ''
      }))
    )

    new CherryAiDefaultModelSeeder().run(dbh.db)

    for (const key of DEFAULT_MODEL_PREFERENCE_KEYS) {
      expect(await readPreferenceValue(key)).toBe('')
    }
  })

  it('hides the CherryAI model and clears its references when the client secret is missing', async () => {
    mockIsCherryAiConfigured.mockReturnValue(true)
    new CherryAiDefaultModelSeeder().run(dbh.db)
    dbh.db.delete(assistantTable).run()
    dbh.db.delete(agentTable).run()
    dbh.db.delete(preferenceTable).run()
    await dbh.db.insert(assistantTable).values({
      name: 'Cherry Assistant',
      emoji: '😀',
      settings: DEFAULT_ASSISTANT_SETTINGS,
      orderKey: generateOrderKeyBetween(null, null),
      modelId: CHERRYAI_DEFAULT_UNIQUE_MODEL_ID
    })
    await dbh.db.insert(agentTable).values({
      id: 'cherryai-agent',
      type: 'pi',
      name: 'CherryAI Agent',
      description: '',
      instructions: '',
      orderKey: generateOrderKeyBetween(null, null),
      model: CHERRYAI_DEFAULT_UNIQUE_MODEL_ID
    })
    await dbh.db.insert(preferenceTable).values(
      DEFAULT_MODEL_PREFERENCE_KEYS.map((key) => ({
        scope: 'default',
        key,
        value: CHERRYAI_DEFAULT_UNIQUE_MODEL_ID
      }))
    )

    mockIsCherryAiConfigured.mockReturnValue(false)
    new CherryAiDefaultModelSeeder().run(dbh.db)

    const [model] = await dbh.db
      .select()
      .from(userModelTable)
      .where(eq(userModelTable.id, CHERRYAI_DEFAULT_UNIQUE_MODEL_ID))
      .limit(1)
    const [assistant] = await dbh.db.select().from(assistantTable).limit(1)
    const [agent] = await dbh.db.select().from(agentTable).limit(1)
    expect(model).toMatchObject({ isEnabled: false, isHidden: true })
    expect(assistant?.modelId).toBeNull()
    expect(agent?.model).toBeNull()
    for (const key of DEFAULT_MODEL_PREFERENCE_KEYS) {
      expect(await readPreferenceValue(key)).toBeUndefined()
    }
  })

  it('re-enables the CherryAI model when the client secret is configured', async () => {
    mockIsCherryAiConfigured.mockReturnValue(false)
    new CherryAiDefaultModelSeeder().run(dbh.db)

    mockIsCherryAiConfigured.mockReturnValue(true)
    new CherryAiDefaultModelSeeder().run(dbh.db)

    const [model] = await dbh.db
      .select()
      .from(userModelTable)
      .where(eq(userModelTable.id, CHERRYAI_DEFAULT_UNIQUE_MODEL_ID))
      .limit(1)
    expect(model).toMatchObject({ isEnabled: true, isHidden: false })
  })

  it('preserves an existing CherryAI provider row', async () => {
    await dbh.db.insert(userProviderTable).values({
      providerId: CHERRYAI_PROVIDER_ID,
      presetProviderId: CHERRYAI_PROVIDER_ID,
      name: 'Renamed CherryAI',
      orderKey: generateOrderKeyBetween(null, null)
    })

    new CherryAiDefaultModelSeeder().run(dbh.db)

    const [provider] = await dbh.db
      .select()
      .from(userProviderTable)
      .where(eq(userProviderTable.providerId, CHERRYAI_PROVIDER_ID))
      .limit(1)
    const [model] = await dbh.db
      .select()
      .from(userModelTable)
      .where(eq(userModelTable.id, CHERRYAI_DEFAULT_UNIQUE_MODEL_ID))
      .limit(1)

    expect(provider?.name).toBe('Renamed CherryAI')
    expect(model?.id).toBe(CHERRYAI_DEFAULT_UNIQUE_MODEL_ID)
  })
})
