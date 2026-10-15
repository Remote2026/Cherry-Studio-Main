import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { IpcError } from '@shared/ipc/errors/IpcError'
import { ragflowErrorCodes } from '@shared/ipc/errors/ragflow'
import type { RagflowDataset } from '@shared/ipc/schemas/ragflow'

import ImportRagflowDatasetsDialog from '../ImportRagflowDatasetsDialog'

const { mockIpcRequest, mockOpenSettingsTab } = vi.hoisted(() => ({
  mockIpcRequest: vi.fn(),
  mockOpenSettingsTab: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mockIpcRequest } }))
vi.mock('@renderer/services/mainWindowNavigation', () => ({ openSettingsTab: mockOpenSettingsTab }))

const createDataset = (id: string, name: string, documentCount = 3): RagflowDataset => ({
  id,
  name,
  description: null,
  documentCount,
  chunkCount: documentCount * 4,
  embeddingModel: 'BAAI/bge-large',
  similarityThreshold: 0.2,
  vectorSimilarityWeight: 0.3,
  createdAt: '2026-04-08T00:00:00.000Z',
  updatedAt: '2026-04-08T00:00:00.000Z'
})

const renderDialog = (importedRemoteIds: ReadonlySet<string> = new Set()) => {
  const onOpenChange = vi.fn()
  const onImported = vi.fn()

  render(
    <ImportRagflowDatasetsDialog
      open
      importedRemoteIds={importedRemoteIds}
      onOpenChange={onOpenChange}
      onImported={onImported}
    />
  )

  return { onOpenChange, onImported }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ImportRagflowDatasetsDialog', () => {
  it('offers only the datasets that are not mirrored yet', async () => {
    mockIpcRequest.mockResolvedValueOnce({
      items: [createDataset('ds-1', 'Handbook'), createDataset('ds-2', 'Contracts')],
      total: 2
    })

    renderDialog(new Set(['ds-2']))

    await waitFor(() => expect(screen.getByText('Handbook')).toBeInTheDocument())
    // 已镜像的数据集不能再选，否则导入就是个空洞作。
    expect(screen.queryByText('Contracts')).toBeNull()
  })

  it('imports the selected datasets and reports completion', async () => {
    mockIpcRequest.mockResolvedValueOnce({
      items: [createDataset('ds-1', 'Handbook'), createDataset('ds-2', 'Contracts')],
      total: 2
    })
    mockIpcRequest.mockResolvedValueOnce(undefined)
    const { onImported } = renderDialog()

    await userEvent.click(await screen.findByText('Handbook'))
    await userEvent.click(screen.getByText('Contracts'))
    await userEvent.click(screen.getByRole('button', { name: '导入' }))

    await waitFor(() =>
      expect(mockIpcRequest).toHaveBeenCalledWith('ragflow.import_datasets', { datasetIds: ['ds-1', 'ds-2'] })
    )
    await waitFor(() => expect(onImported).toHaveBeenCalledOnce())
  })

  it('keeps the dialog open and reports the failure when the import fails', async () => {
    mockIpcRequest.mockResolvedValueOnce({ items: [createDataset('ds-1', 'Handbook')], total: 1 })
    mockIpcRequest.mockRejectedValueOnce(new IpcError(ragflowErrorCodes.UNAVAILABLE, 'RagFlow service is unavailable'))
    const { onImported, onOpenChange } = renderDialog()

    await userEvent.click(await screen.findByText('Handbook'))
    await userEvent.click(screen.getByRole('button', { name: '导入' }))

    await waitFor(() =>
      expect(mockIpcRequest).toHaveBeenCalledWith('ragflow.import_datasets', { datasetIds: ['ds-1'] })
    )
    expect(onImported).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('points at the settings page when RagFlow is not configured', async () => {
    mockIpcRequest.mockRejectedValueOnce(
      new IpcError(ragflowErrorCodes.CONFIG_INVALID, 'RagFlow configuration is invalid')
    )

    renderDialog()

    const settingsAction = await screen.findByRole('button', { name: '打开 RagFlow 设置' })
    await userEvent.click(settingsAction)

    expect(mockOpenSettingsTab).toHaveBeenCalledWith('/settings/ragflow')
  })

  it('disables the import action until something is selected', async () => {
    mockIpcRequest.mockResolvedValueOnce({ items: [createDataset('ds-1', 'Handbook')], total: 1 })

    renderDialog()

    const importButton = await screen.findByRole('button', { name: '导入' })
    expect(importButton).toBeDisabled()
  })
})
