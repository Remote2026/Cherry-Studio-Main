import type { SettingsSearchEntry } from '../settingsSearch/types'

export const route = '/settings/ragflow'

export const entries: SettingsSearchEntry[] = [
  {
    anchorId: 'service-url',
    titleKey: 'settings.ragflow.fields.service_url',
    groupKey: 'settings.ragflow.title',
    aliases: ['RagFlow', 'RAG', '知识库', '服务地址']
  },
  {
    anchorId: 'api-key',
    titleKey: 'settings.ragflow.fields.api_key',
    groupKey: 'settings.ragflow.title',
    aliases: ['RagFlow API key', 'API 密钥']
  },
  {
    anchorId: 'save',
    titleKey: 'common.save',
    groupKey: 'settings.ragflow.title'
  }
]
