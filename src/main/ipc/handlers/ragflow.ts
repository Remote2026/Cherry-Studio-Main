import { RagflowClientError, ragflowClient, ragflowKnowledgeSyncService } from '@main/features/ragflow'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { ragflowErrorCodes } from '@shared/ipc/errors/ragflow'
import type { ragflowRequestSchemas } from '@shared/ipc/schemas/ragflow'
import type { IpcHandlersFor } from '@shared/ipc/types'
import { isVisibleRagflowDataset } from '@shared/utils/ragflow'

/** Translates a client failure into the wire error the renderer switches on. */
const run = async <T>(call: () => Promise<T>): Promise<T> => {
  try {
    return await call()
  } catch (error) {
    if (error instanceof RagflowClientError) {
      throw new IpcError(
        ragflowErrorCodes[error.kind],
        error.message,
        error.status ? { status: error.status } : undefined
      )
    }
    throw error
  }
}

export const ragflowHandlers: IpcHandlersFor<typeof ragflowRequestSchemas> = {
  'ragflow.test_connection': () => run(() => ragflowClient.testConnection()),
  'ragflow.import_datasets': (input) => run(() => ragflowKnowledgeSyncService.importDatasets(input.datasetIds)),
  'ragflow.sync': () => run(() => ragflowKnowledgeSyncService.sync()),
  'ragflow.list_datasets': (input) =>
    run(async () => {
      const result = await ragflowClient.listDatasets(input)
      const items = result.items.filter(isVisibleRagflowDataset)
      return { items, total: Math.max(0, result.total - (result.items.length - items.length)) }
    }),
  'ragflow.list_documents': (input) => run(() => ragflowClient.listDocuments(input)),
  'ragflow.list_chunks': (input) => run(() => ragflowClient.listChunks(input)),
  'ragflow.retrieve': (input) => run(() => ragflowClient.retrieve(input))
}
