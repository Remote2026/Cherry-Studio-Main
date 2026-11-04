import { randomUUID } from 'node:crypto'

import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import type { RagflowDataset, RagflowDocument, RagflowRunState } from '@shared/ipc/schemas/ragflow'
import type { PosixRelativeFilePath } from '@shared/utils/file'

const { listDatasetsMock, listDocumentsMock } = vi.hoisted(() => ({
  listDatasetsMock: vi.fn(),
  listDocumentsMock: vi.fn()
}))

vi.mock('../RagflowClient', () => ({
  RagflowClientError: class RagflowClientError extends Error {
    readonly kind: string
    constructor(kind: string, message: string) {
      super(message)
      this.kind = kind
    }
  },
  ragflowClient: { listDatasets: listDatasetsMock, listDocuments: listDocumentsMock }
}))

vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: vi.fn() }))

import { RagflowKnowledgeSyncService, ragflowKnowledgeSyncService } from '../RagflowKnowledgeSyncService'

const LOCAL_BASE_ID = '11111111-1111-4111-8111-111111111111'
const LOCAL_ITEM_ID = '0198f3f2-7d1a-7abc-8def-123456789abc'
const PAGE_SIZE = 100

const createDataset = (id: string, name = `Dataset ${id}`): RagflowDataset => ({
  id,
  name,
  description: null,
  documentCount: 0,
  chunkCount: 0,
  embeddingModel: 'BAAI/bge-large',
  similarityThreshold: 0.2,
  vectorSimilarityWeight: 0.3,
  createdAt: '2026-04-08T00:00:00.000Z',
  updatedAt: '2026-04-08T00:00:00.000Z'
})

const createDocument = (id: string, run: RagflowRunState = 'DONE', name = `${id}.pdf`): RagflowDocument => ({
  id,
  name,
  size: 1024,
  chunkCount: 3,
  tokenCount: 300,
  run,
  progress: run === 'DONE' ? 1 : 0,
  suffix: 'pdf',
  createdAt: '2026-04-08T00:00:00.000Z',
  updatedAt: '2026-04-08T00:00:00.000Z'
})

/** 让 listDatasets/listDocuments 按 PAGE_SIZE 分页返回给定集合。 */
const stubPaged = (mock: typeof listDatasetsMock, items: unknown[]) => {
  mock.mockImplementation((input: { page?: number } = {}) => {
    const page = input.page ?? 1
    const start = (page - 1) * PAGE_SIZE
    return Promise.resolve({ items: items.slice(start, start + PAGE_SIZE), total: items.length })
  })
}

describe('RagflowKnowledgeSyncService', () => {
  const dbh = setupTestDatabase()

  const mirrorBases = () =>
    dbh.db.select().from(knowledgeBaseTable).where(eq(knowledgeBaseTable.source, 'ragflow')).all()
  const mirrorItems = () => dbh.db.select().from(knowledgeItemTable).where(eq(knowledgeItemTable.type, 'ragflow')).all()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exports a module-level singleton', () => {
    expect(ragflowKnowledgeSyncService).toBeInstanceOf(RagflowKnowledgeSyncService)
  })

  it('mirrors an imported dataset and its documents', async () => {
    stubPaged(listDatasetsMock, [createDataset('ds-1', 'Handbook')])
    stubPaged(listDocumentsMock, [createDocument('doc-1')])

    await ragflowKnowledgeSyncService.importDatasets(['ds-1'])

    const [base] = mirrorBases()
    expect(base).toMatchObject({
      name: 'Handbook',
      source: 'ragflow',
      remoteId: 'ds-1',
      status: 'completed',
      embeddingModelId: null,
      dimensions: null
    })

    const [item] = mirrorItems()
    expect(item).toMatchObject({
      baseId: base.id,
      type: 'ragflow',
      remoteId: 'doc-1',
      status: 'completed',
      data: { source: 'doc-1.pdf' }
    })
  })

  it('hides TemporaryKB from imports and prunes an existing mirror without touching the remote dataset', async () => {
    stubPaged(listDatasetsMock, [createDataset('ds-1', 'Handbook'), createDataset('temp', 'TemporaryKB')])
    stubPaged(listDocumentsMock, [createDocument('doc-1')])

    await ragflowKnowledgeSyncService.importDatasets(['ds-1'])
    expect(mirrorBases().map((base) => base.remoteId)).not.toContain('temp')
    await expect(ragflowKnowledgeSyncService.importDatasets(['temp'])).rejects.toThrow(/None of the selected/)

    const tempBaseId = randomUUID()
    dbh.db
      .insert(knowledgeBaseTable)
      .values({
        id: tempBaseId,
        name: 'TemporaryKB',
        source: 'ragflow',
        remoteId: 'temp',
        groupId: null,
        dimensions: null,
        embeddingModelId: null,
        status: 'completed',
        error: null,
        chunkSize: 1024,
        chunkOverlap: 200,
        chunkStrategy: 'structured',
        chunkSeparator: '\\n\\n',
        createdAt: 1,
        updatedAt: 1
      })
      .run()

    await ragflowKnowledgeSyncService.sync()

    expect(mirrorBases().some((base) => base.remoteId === 'temp')).toBe(false)
  })

  it('rejects an import whose datasets no longer exist remotely', async () => {
    stubPaged(listDatasetsMock, [createDataset('ds-1')])

    await expect(ragflowKnowledgeSyncService.importDatasets(['gone'])).rejects.toThrow(/no longer|exist|selected/i)
    expect(mirrorBases()).toHaveLength(0)
  })

  it('maps the RagFlow run state onto the local item lifecycle', async () => {
    stubPaged(listDatasetsMock, [createDataset('ds-1')])
    stubPaged(listDocumentsMock, [
      createDocument('done', 'DONE'),
      createDocument('running', 'RUNNING'),
      createDocument('unstart', 'UNSTART'),
      createDocument('failed', 'FAIL'),
      createDocument('cancelled', 'CANCEL')
    ])

    await ragflowKnowledgeSyncService.importDatasets(['ds-1'])

    const byRemoteId = new Map(mirrorItems().map((item) => [item.remoteId, item]))
    expect(byRemoteId.get('done')).toMatchObject({ status: 'completed', error: null })
    expect(byRemoteId.get('running')).toMatchObject({ status: 'processing', error: null })
    expect(byRemoteId.get('unstart')).toMatchObject({ status: 'processing', error: null })
    expect(byRemoteId.get('failed')).toMatchObject({ status: 'failed', error: 'ragflow_parse_failed' })
    expect(byRemoteId.get('cancelled')).toMatchObject({ status: 'failed', error: 'ragflow_parse_failed' })
  })

  it('reads every page of a dataset larger than one page', async () => {
    const documents = Array.from({ length: PAGE_SIZE + 1 }, (_, index) => createDocument(`doc-${index}`))
    stubPaged(listDatasetsMock, [createDataset('ds-1')])
    stubPaged(listDocumentsMock, documents)

    await ragflowKnowledgeSyncService.importDatasets(['ds-1'])

    expect(mirrorItems()).toHaveLength(PAGE_SIZE + 1)
  })

  it('is idempotent across repeated syncs', async () => {
    stubPaged(listDatasetsMock, [createDataset('ds-1')])
    stubPaged(listDocumentsMock, [createDocument('doc-1'), createDocument('doc-2')])

    await ragflowKnowledgeSyncService.importDatasets(['ds-1'])
    await ragflowKnowledgeSyncService.sync()
    await ragflowKnowledgeSyncService.sync()

    expect(mirrorBases()).toHaveLength(1)
    expect(mirrorItems()).toHaveLength(2)
  })

  it('follows a rename made in RagFlow', async () => {
    stubPaged(listDatasetsMock, [createDataset('ds-1', 'Old name')])
    stubPaged(listDocumentsMock, [createDocument('doc-1')])
    await ragflowKnowledgeSyncService.importDatasets(['ds-1'])

    stubPaged(listDatasetsMock, [createDataset('ds-1', 'New name')])
    await ragflowKnowledgeSyncService.sync()

    expect(mirrorBases()[0].name).toBe('New name')
    expect(mirrorItems()).toHaveLength(1)
  })

  it('drops documents that RagFlow no longer reports', async () => {
    stubPaged(listDatasetsMock, [createDataset('ds-1')])
    stubPaged(listDocumentsMock, [createDocument('doc-1'), createDocument('doc-2')])
    await ragflowKnowledgeSyncService.importDatasets(['ds-1'])

    stubPaged(listDocumentsMock, [createDocument('doc-1')])
    await ragflowKnowledgeSyncService.sync()

    expect(mirrorItems().map((item) => item.remoteId)).toEqual(['doc-1'])
  })

  it('drops a mirror whose dataset is gone, leaving local knowledge bases untouched', async () => {
    dbh.db
      .insert(knowledgeBaseTable)
      .values({
        id: LOCAL_BASE_ID,
        name: 'Local base',
        source: 'local',
        remoteId: null,
        groupId: null,
        dimensions: null,
        embeddingModelId: null,
        status: 'completed',
        error: null,
        chunkSize: 1024,
        chunkOverlap: 200,
        chunkStrategy: 'structured',
        chunkSeparator: '\\n\\n',
        createdAt: 1,
        updatedAt: 1
      })
      .run()
    dbh.db
      .insert(knowledgeItemTable)
      .values({
        id: LOCAL_ITEM_ID,
        baseId: LOCAL_BASE_ID,
        groupId: null,
        type: 'file',
        remoteId: null,
        data: { source: 'notes.md', relativePath: 'notes.md' as PosixRelativeFilePath },
        status: 'completed',
        error: null,
        createdAt: 1,
        updatedAt: 1
      })
      .run()

    stubPaged(listDatasetsMock, [createDataset('ds-1')])
    stubPaged(listDocumentsMock, [createDocument('doc-1')])
    await ragflowKnowledgeSyncService.importDatasets(['ds-1'])

    // 远端已经没有这个数据集了。
    stubPaged(listDatasetsMock, [])
    await ragflowKnowledgeSyncService.sync()

    expect(mirrorBases()).toHaveLength(0)
    expect(mirrorItems()).toHaveLength(0)

    const localBases = dbh.db.select().from(knowledgeBaseTable).all()
    const localItems = dbh.db.select().from(knowledgeItemTable).all()
    expect(localBases).toHaveLength(1)
    expect(localBases[0]).toMatchObject({ id: LOCAL_BASE_ID, source: 'local', remoteId: null })
    expect(localItems).toHaveLength(1)
    expect(localItems[0]).toMatchObject({ id: LOCAL_ITEM_ID, type: 'file', remoteId: null })
  })

  it('keeps a dataset mirrored when its documents cannot be listed', async () => {
    stubPaged(listDatasetsMock, [createDataset('ds-1')])
    stubPaged(listDocumentsMock, [createDocument('doc-1')])
    await ragflowKnowledgeSyncService.importDatasets(['ds-1'])

    listDocumentsMock.mockRejectedValueOnce(new Error('RagFlow service is unavailable'))
    await ragflowKnowledgeSyncService.sync()

    expect(mirrorBases()).toHaveLength(1)
    expect(mirrorItems().map((item) => item.remoteId)).toEqual(['doc-1'])
  })
})
