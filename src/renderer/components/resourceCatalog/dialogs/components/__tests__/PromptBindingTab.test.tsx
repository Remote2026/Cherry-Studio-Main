import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { Prompt } from '@shared/data/types/prompt'

import { PromptBindingTab } from '../PromptBindingTab'

const mocks = vi.hoisted(() => ({
  updatePrompt: vi.fn()
}))

const prompt: Prompt = {
  id: 'prompt-1',
  title: '生成分析问卷',
  content: '分析项目招标文件，生成html格式的分析问卷',
  visibility: 'restricted',
  orderKey: 'a0',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@data/hooks/useDataApi', () => ({
  useDataChange: vi.fn(),
  useQuery: () => ({ data: [prompt], error: undefined, isLoading: false, refetch: vi.fn() })
}))

vi.mock('@data/hooks/useReorder', () => ({
  useReorder: () => ({ applyReorderedList: vi.fn(), isPending: false })
}))

vi.mock('@renderer/hooks/resourceCatalog', () => ({
  usePromptBindingMutations: () => ({ bindPrompt: vi.fn(), unbindPrompt: vi.fn() }),
  usePromptMutations: () => ({ createPrompt: vi.fn() }),
  usePromptMutationsById: () => ({ updatePrompt: mocks.updatePrompt, deletePrompt: vi.fn() })
}))

vi.mock('@renderer/services/toast', () => ({ toast: { error: vi.fn() } }))

vi.mock('../CatalogPicker', () => ({
  AddCatalogPopover: () => <button type="button">bind-prompt</button>,
  CatalogEmptyPlaceholder: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('../../edit', () => ({
  PromptEditDialog: ({
    open,
    onSave,
    onCancel
  }: {
    open: boolean
    onSave: (data: { title: string; content: string; visibility: 'restricted' }) => Promise<void>
    onCancel: () => void
  }) =>
    open ? (
      <div>
        <button
          type="button"
          onClick={() => void onSave({ title: '新标题', content: '新内容', visibility: 'restricted' })}>
          save-prompt
        </button>
        <button type="button" onClick={onCancel}>
          cancel-prompt
        </button>
      </div>
    ) : null
}))

describe('PromptBindingTab', () => {
  it('edits a bound prompt without changing its binding', async () => {
    const user = userEvent.setup()
    mocks.updatePrompt.mockResolvedValue(prompt)

    render(<PromptBindingTab enabled target={{ type: 'agent', id: 'bid-analysis' }} />)

    await user.click(screen.getByRole('button', { name: 'settings.prompts.edit' }))
    await user.click(screen.getByRole('button', { name: 'save-prompt' }))

    await waitFor(() => expect(mocks.updatePrompt).toHaveBeenCalledWith({ title: '新标题', content: '新内容' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'save-prompt' })).not.toBeInTheDocument())
  })
})
