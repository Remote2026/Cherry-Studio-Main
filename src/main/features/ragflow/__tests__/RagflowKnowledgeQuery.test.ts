import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it, vi } from 'vitest'

import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import type { PosixRelativeFilePath } from '@shared/utils/file'

const { retrieveMock, listChunksMock } = vi.hoisted(() => ({ retrieveMock: vi.fn(), listChunksMock: vi.fn() }))

vi.mock('../RagflowClient', () => ({
  RagflowClientError: class RagflowClientError extends Error {},
  ragflowClient: { retrieve: retrieveMock, listChunks: listChunksMock }
}))

import {
  isMirroredBase,
  listRagflowItemChunks,
  resolveMirroredItem,
  searchRagflowKnowledge
} from '../RagflowKnowledgeQuery'

const MIRRORED_BASE_ID = '22222222-2222-4222-8222-222222222222'
const LOCAL_BASE_ID = '33333333-3333-4333-8333-333333333333'
const MIRRORED_ITEM_ID = '0198f3f2-7d1a-7abc-8def-123456789abc'
const PAGE_SIZE = 100

const createHit = (documentId: string, content = 'chunk text') => ({
  chunkId: `chunk-${documentId}`,
  content,
  documentId,
  documentName: 'never read; the mirror owns the display name',
  similarity: 0.5,
  vectorSimilarity: 0.4,
  termSimilarity: 0.3
})

describe('RagflowKnowledgeQuery', () => {
  const dbh = setupTestDatabase()

  const seedBase = (id: string, source: 'local' | 'ragflow', remoteId: string | null) =>
    dbh.db
      .insert(knowledgeBaseTable)
      .values({
        id,
        name: 'Base',
        source,
        remoteId,
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

  const seedMirroredItem = (id: string, documentId: string, name: string) =>
    dbh.db
      .insert(knowledgeItemTable)
      .values({
        id,
        baseId: MIRRORED_BASE_ID,
        groupId: null,
        type: 'ragflow',
        remoteId: documentId,
        data: { source: name },
        status: 'completed',
        error: null,
        createdAt: 1,
        updatedAt: 1
      })
      .run()

  const seedLocalItem = (id: string) =>
    dbh.db
      .insert(knowledgeItemTable)
      .values({
        id,
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

  describe('isMirroredBase', () => {
    it('separates a mirror from a local base', () => {
      seedBase(MIRRORED_BASE_ID, 'ragflow', 'ds-1')
      seedBase(LOCAL_BASE_ID, 'local', null)

      expect(isMirroredBase(MIRRORED_BASE_ID)).toBe(true)
      expect(isMirroredBase(LOCAL_BASE_ID)).toBe(false)
    })
  })

  describe('resolveMirroredItem', () => {
    it('locates the dataset and document behind a mirrored item', () => {
      seedBase(MIRRORED_BASE_ID, 'ragflow', 'ds-1')
      seedMirroredItem(MIRRORED_ITEM_ID, 'doc-1', 'guide.pdf')

      expect(resolveMirroredItem(MIRRORED_BASE_ID, MIRRORED_ITEM_ID)).toEqual({
        datasetId: 'ds-1',
        documentId: 'doc-1',
        itemId: MIRRORED_ITEM_ID,
        source: 'guide.pdf'
      })
    })

    it('refuses to hand a local item to RagFlow', () => {
      seedBase(LOCAL_BASE_ID, 'local', null)
      seedLocalItem(MIRRORED_ITEM_ID)

      expect(resolveMirroredItem(LOCAL_BASE_ID, MIRRORED_ITEM_ID)).toBeUndefined()
    })
  })

  describe('searchRagflowKnowledge', () => {
    it('maps a hit onto the local item that mirrors its document', async () => {
      seedBase(MIRRORED_BASE_ID, 'ragflow', 'ds-1')
      seedMirroredItem(MIRRORED_ITEM_ID, 'doc-1', 'guide.pdf')
      retrieveMock.mockResolvedValueOnce({ items: [createHit('doc-1')], total: 1 })

      const results = await searchRagflowKnowledge(MIRRORED_BASE_ID, 'how do I start')

      expect(retrieveMock).toHaveBeenCalledWith({ question: 'how do I start', datasetIds: ['ds-1'] })
      expect(results).toHaveLength(1)
      expect(results[0]).toMatchObject({
        itemId: MIRRORED_ITEM_ID,
        chunkId: 'chunk-doc-1',
        pageContent: 'chunk text',
        score: 0.5,
        scoreKind: 'relevance',
        rank: 1,
        metadata: { itemId: MIRRORED_ITEM_ID, itemType: 'ragflow', source: 'guide.pdf' }
      })
    })

    it('drops a hit whose document is not mirrored here, since it can be neither opened nor cited', async () => {
      seedBase(MIRRORED_BASE_ID, 'ragflow', 'ds-1')
      seedMirroredItem(MIRRORED_ITEM_ID, 'doc-1', 'guide.pdf')
      retrieveMock.mockResolvedValueOnce({ items: [createHit('doc-unknown')], total: 1 })

      await expect(searchRagflowKnowledge(MIRRORED_BASE_ID, 'question')).resolves.toEqual([])
    })
  })

  describe('listRagflowItemChunks', () => {
    it('maps every page of a document, numbering chunks in response order', async () => {
      const chunks = Array.from({ length: PAGE_SIZE + 1 }, (_, index) => ({
        id: `chunk-${index}`,
        content: `content ${index}`,
        documentId: 'doc-1',
        documentName: 'guide.pdf',
        available: true
      }))
      listChunksMock.mockImplementation((input: { page?: number } = {}) => {
        const start = ((input.page ?? 1) - 1) * PAGE_SIZE
        return Promise.resolve({ items: chunks.slice(start, start + PAGE_SIZE), total: chunks.length })
      })

      const result = await listRagflowItemChunks({
        datasetId: 'ds-1',
        documentId: 'doc-1',
        itemId: MIRRORED_ITEM_ID,
        source: 'guide.pdf'
      })

      expect(result).toHaveLength(PAGE_SIZE + 1)
      expect(result[0]).toMatchObject({
        id: 'chunk-0',
        itemId: MIRRORED_ITEM_ID,
        metadata: { chunkIndex: 0, source: 'guide.pdf', itemType: 'ragflow' }
      })
      expect(result[PAGE_SIZE].metadata.chunkIndex).toBe(PAGE_SIZE)
    })
  })
})
