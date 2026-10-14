import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps, PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { toast } from '@renderer/services/toast'

import RagflowSettings from '../RagflowSettings'

const { ipcRequestMock, setPreferencesMock } = vi.hoisted(() => ({
  ipcRequestMock: vi.fn(),
  setPreferencesMock: vi.fn()
}))
const preferences = { apiUrl: 'http://localhost', apiKey: '' }

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryStudioUi>()

  return {
    ...actual,
    Button: ({ children, ...props }: ComponentProps<'button'>) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    InputGroup: ({ children }: PropsWithChildren) => <div>{children}</div>,
    InputGroupAddon: ({ children }: PropsWithChildren) => <div>{children}</div>,
    InputGroupButton: ({ children, ...props }: ComponentProps<'button'>) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    InputGroupInput: (props: ComponentProps<'input'>) => <input {...props} />,
    Tooltip: ({ children }: PropsWithChildren) => <>{children}</>
  }
})

vi.mock('@renderer/data/hooks/usePreference', () => ({
  useMultiplePreferences: () => [preferences, setPreferencesMock]
}))

vi.mock('@renderer/components/SettingsPrimitives', () => ({
  SettingDescription: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SettingDivider: () => <hr />,
  SettingGroup: ({ children }: PropsWithChildren) => <section>{children}</section>,
  SettingRowTitle: ({ children }: PropsWithChildren) => <label>{children}</label>,
  SettingsContentColumn: ({ children }: PropsWithChildren) => <main>{children}</main>,
  SettingTitle: ({ children }: PropsWithChildren) => <h1>{children}</h1>
}))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'light' })
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: ipcRequestMock } }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('RagflowSettings', () => {
  beforeEach(() => {
    preferences.apiUrl = 'http://localhost'
    preferences.apiKey = ''
    setPreferencesMock.mockReset()
    setPreferencesMock.mockResolvedValue(undefined)
    ipcRequestMock.mockReset()
    ipcRequestMock.mockResolvedValue(undefined)
    vi.clearAllMocks()
  })

  it('does not save an invalid service address', async () => {
    render(<RagflowSettings />)

    fireEvent.change(screen.getByLabelText('settings.ragflow.fields.service_url'), {
      target: { value: 'ftp://localhost' }
    })
    fireEvent.change(screen.getByLabelText('settings.ragflow.fields.api_key'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('settings.ragflow.validation.invalid_url'))
    expect(setPreferencesMock).not.toHaveBeenCalled()
  })

  it('does not save without an API key', async () => {
    render(<RagflowSettings />)

    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('settings.ragflow.validation.missing_api_key'))
    expect(setPreferencesMock).not.toHaveBeenCalled()
  })

  it('saves normalized settings and masks the API key by default', async () => {
    render(<RagflowSettings />)

    const apiKeyInput = screen.getByLabelText('settings.ragflow.fields.api_key')
    fireEvent.change(screen.getByLabelText('settings.ragflow.fields.service_url'), {
      target: { value: 'https://ragflow.example.com/' }
    })
    fireEvent.change(apiKeyInput, { target: { value: ' secret-key ' } })

    expect(apiKeyInput).toHaveAttribute('type', 'password')
    fireEvent.click(screen.getByRole('button', { name: 'settings.provider.api_key.show_key' }))
    expect(apiKeyInput).toHaveAttribute('type', 'text')
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() =>
      expect(setPreferencesMock).toHaveBeenCalledWith({
        apiUrl: 'https://ragflow.example.com',
        apiKey: 'secret-key'
      })
    )
    expect(toast.success).toHaveBeenCalledWith('common.saved')
  })

  it('tests the saved settings through the main-process IPC route', async () => {
    render(<RagflowSettings />)

    fireEvent.change(screen.getByLabelText('settings.ragflow.fields.api_key'), { target: { value: ' secret-key ' } })
    fireEvent.click(screen.getByRole('button', { name: 'settings.ragflow.connection.test' }))

    await waitFor(() => expect(ipcRequestMock).toHaveBeenCalledWith('ragflow.test_connection'))
    expect(toast.success).toHaveBeenCalledWith('settings.ragflow.connection.success')
  })
})
