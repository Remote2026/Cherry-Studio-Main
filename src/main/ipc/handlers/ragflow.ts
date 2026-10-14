import { RagflowClientError, ragflowClient } from '@main/features/ragflow'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { ragflowErrorCodes } from '@shared/ipc/errors/ragflow'
import type { ragflowRequestSchemas } from '@shared/ipc/schemas/ragflow'
import type { IpcHandlersFor } from '@shared/ipc/types'

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
  'ragflow.list_datasets': (input) => run(() => ragflowClient.listDatasets(input)),
  'ragflow.list_documents': (input) => run(() => ragflowClient.listDocuments(input)),
  'ragflow.list_chunks': (input) => run(() => ragflowClient.listChunks(input)),
  'ragflow.retrieve': (input) => run(() => ragflowClient.retrieve(input))
}
