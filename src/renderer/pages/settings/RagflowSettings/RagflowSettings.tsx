import { Eye, EyeOff, Save } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, Tooltip } from '@cherrystudio/ui'
import {
  SettingDescription,
  SettingDivider,
  SettingGroup,
  SettingRowTitle,
  SettingsContentColumn,
  SettingTitle
} from '@renderer/components/SettingsPrimitives'
import { useMultiplePreferences } from '@renderer/data/hooks/usePreference'
import { useTheme } from '@renderer/hooks/useTheme'
import { toast } from '@renderer/services/toast'

const RAGFLOW_PREFERENCE_KEYS = {
  apiUrl: 'feature.ragflow.api_url',
  apiKey: 'feature.ragflow.api_key'
} as const

const isValidRagflowUrl = (value: string) => {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname)
  } catch {
    return false
  }
}

const RagflowSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [preferences, setPreferences] = useMultiplePreferences(RAGFLOW_PREFERENCE_KEYS)
  const [apiUrl, setApiUrl] = useState(preferences.apiUrl)
  const [apiKey, setApiKey] = useState(preferences.apiKey)
  const [apiKeyVisible, setApiKeyVisible] = useState(false)

  useEffect(() => {
    setApiUrl(preferences.apiUrl)
    setApiKey(preferences.apiKey)
  }, [preferences.apiKey, preferences.apiUrl])

  const handleSave = async () => {
    const normalizedUrl = apiUrl.trim().replace(/\/+$/, '')
    const normalizedApiKey = apiKey.trim()

    if (!isValidRagflowUrl(normalizedUrl)) {
      toast.error(t('settings.ragflow.validation.invalid_url'))
      return
    }

    if (!normalizedApiKey) {
      toast.error(t('settings.ragflow.validation.missing_api_key'))
      return
    }

    try {
      await setPreferences({ apiUrl: normalizedUrl, apiKey: normalizedApiKey })
      toast.success(t('common.saved'))
    } catch {
      toast.error(t('common.save_failed'))
    }
  }

  return (
    <SettingsContentColumn theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.ragflow.title')}</SettingTitle>
        <SettingDescription>{t('settings.ragflow.description')}</SettingDescription>
        <SettingDivider />
        <div id="setting-ragflow-service-url" className="scroll-mt-6">
          <SettingRowTitle>{t('settings.ragflow.fields.service_url')}</SettingRowTitle>
          <InputGroup className="mt-2">
            <InputGroupInput
              aria-label={t('settings.ragflow.fields.service_url')}
              value={apiUrl}
              onChange={(event) => setApiUrl(event.target.value)}
              placeholder={t('settings.ragflow.fields.service_url_placeholder')}
              spellCheck={false}
              type="url"
            />
          </InputGroup>
        </div>
        <SettingDivider />
        <div id="setting-ragflow-api-key" className="scroll-mt-6">
          <SettingRowTitle>{t('settings.ragflow.fields.api_key')}</SettingRowTitle>
          <InputGroup className="mt-2">
            <InputGroupInput
              aria-label={t('settings.ragflow.fields.api_key')}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={t('settings.ragflow.fields.api_key_placeholder')}
              spellCheck={false}
              type={apiKeyVisible ? 'text' : 'password'}
            />
            <InputGroupAddon align="inline-end">
              <Tooltip
                content={t(
                  apiKeyVisible ? 'settings.provider.api_key.hide_key' : 'settings.provider.api_key.show_key'
                )}>
                <InputGroupButton
                  size="icon-xs"
                  aria-label={t(
                    apiKeyVisible ? 'settings.provider.api_key.hide_key' : 'settings.provider.api_key.show_key'
                  )}
                  onClick={() => setApiKeyVisible((visible) => !visible)}
                  disabled={!apiKey}>
                  {apiKeyVisible ? <EyeOff /> : <Eye />}
                </InputGroupButton>
              </Tooltip>
            </InputGroupAddon>
          </InputGroup>
        </div>
        <div className="mt-4 flex justify-end">
          <Button id="setting-ragflow-save" onClick={() => void handleSave()}>
            <Save size={14} />
            {t('common.save')}
          </Button>
        </div>
      </SettingGroup>
    </SettingsContentColumn>
  )
}

export default RagflowSettings
