import { beforeEach, describe, expect, it, vi } from 'vitest'

const { testConnectionMock, listDatasetsMock, retrieveMock, importDatasetsMock, syncMock } = vi.hoisted(() => ({
  testConnectionMock: vi.fn(),
  listDatasetsMock: vi.fn(),
  retrieveMock: vi.fn(),
  importDatasetsMock: vi.fn(),
  syncMock: vi.fn()
}))

vi.mock('@main/features/ragflow', () => ({
  RagflowClientError: class RagflowClientError extends Error {
    readonly kind: string
    readonly status?: number

    constructor(kind: string, message: string, status?: number) {
      super(message)
      this.kind = kind
      this.status = status
    }
  },
  ragflowClient: {
    testConnection: testConnectionMock,
    listDatasets: listDatasetsMock,
    listDocuments: vi.fn(),
    listChunks: vi.fn(),
    retrieve: retrieveMock
  },
  ragflowKnowledgeSyncService: { importDatasets: importDatasetsMock, sync: syncMock }
}))

import { RagflowClientError } from '@main/features/ragflow'
import { IpcError } from '@shared/ipc/errors/IpcError'

import { ragflowHandlers } from '../ragflow'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ragflowHandlers', () => {
  it('delegates the connection test', async () => {
    await expect(ragflowHandlers['ragflow.test_connection'](undefined, { senderId: 'w1' })).resolves.toBeUndefined()
    expect(testConnectionMock).toHaveBeenCalledOnce()
  })

  it('returns the retrieval payload unchanged', async () => {
    const payload = { items: [{ chunkId: 'chunk-1', content: 'text' }], total: 1 }
    retrieveMock.mockResolvedValueOnce(payload)

    const input = { question: 'envelopes', datasetIds: ['ds-1'] }
    await expect(ragflowHandlers['ragflow.retrieve'](input, { senderId: 'w1' })).resolves.toBe(payload)
    expect(retrieveMock).toHaveBeenCalledWith(input)
  })

  it('maps client errors to a structured IPC error without including credentials', async () => {
    testConnectionMock.mockRejectedValueOnce(new RagflowClientError('UNAUTHORIZED', 'Unauthorized', 401))

    const error = await ragflowHandlers['ragflow.test_connection'](undefined, { senderId: 'w1' }).catch(
      (value) => value
    )

    expect(error).toBeInstanceOf(IpcError)
    expect(error).toMatchObject({ code: 'RAGFLOW_UNAUTHORIZED' })
    expect(error.toJSON()).not.toHaveProperty('data.apiKey')
  })

  it('maps a RagFlow-reported failure to its own error code', async () => {
    listDatasetsMock.mockRejectedValueOnce(new RagflowClientError('REQUEST_FAILED', "You don't own the dataset."))

    const error = await ragflowHandlers['ragflow.list_datasets']({ page: 1 }, { senderId: 'w1' }).catch(
      (value) => value
    )

    expect(error).toBeInstanceOf(IpcError)
    expect(error).toMatchObject({ code: 'RAGFLOW_REQUEST_FAILED' })
  })

  it('imports the datasets the caller selected', async () => {
    const input = { datasetIds: ['ds-1', 'ds-2'] }
    await expect(ragflowHandlers['ragflow.import_datasets'](input, { senderId: 'w1' })).resolves.toBeUndefined()
    expect(importDatasetsMock).toHaveBeenCalledWith(['ds-1', 'ds-2'])
  })

  it('reports an unreachable RagFlow when a sync fails', async () => {
    syncMock.mockRejectedValueOnce(new RagflowClientError('UNAVAILABLE', 'RagFlow service is unavailable'))

    const error = await ragflowHandlers['ragflow.sync'](undefined, { senderId: 'w1' }).catch((value) => value)

    expect(error).toBeInstanceOf(IpcError)
    expect(error).toMatchObject({ code: 'RAGFLOW_UNAVAILABLE' })
  })
})
