import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RagflowDataset, RagflowDocument } from '@shared/ipc/schemas/ragflow'

const { client } = vi.hoisted(() => ({
  client: {
    listDatasets: vi.fn(),
    createDataset: vi.fn(),
    updateDatasetParser: vi.fn(),
    listDocuments: vi.fn(),
    uploadDocument: vi.fn(),
    updateDocumentMetadata: vi.fn(),
    startParsing: vi.fn(),
    findDocument: vi.fn()
  }
}))

vi.mock('@main/features/ragflow', () => ({ ragflowClient: client }))

const makeDataset = (overrides: Partial<RagflowDataset> = {}): RagflowDataset => ({
  id: 'kb-1',
  name: 'TemporaryKB',
  description: null,
  documentCount: 1,
  chunkCount: 10,
  embeddingModel: 'embedding',
  similarityThreshold: 0.2,
  vectorSimilarityWeight: 0.3,
  parserId: 'general',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides
})

const makeDocument = (overrides: Partial<RagflowDocument> = {}): RagflowDocument => ({
  id: 'doc-1',
  name: 'bid.pdf',
  size: 1,
  chunkCount: 1,
  tokenCount: 1,
  run: 'DONE',
  progress: 1,
  suffix: 'pdf',
  metaFields: { fingerprint: 'fp' },
  progressMessage: null,
  latestEventMessage: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides
})

const load = async () => {
  vi.resetModules()
  return await import('../ragflowDocuments')
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('ensureTemporaryKb', () => {
  it('creates the fixed dataset with the general parser and caches it', async () => {
    client.listDatasets.mockResolvedValueOnce({ items: [], total: 0 })
    client.createDataset.mockResolvedValueOnce({ id: 'kb-1', name: 'TemporaryKB', parserId: 'general' })

    const { ensureTemporaryKb } = await load()
    await expect(ensureTemporaryKb()).resolves.toEqual({ id: 'kb-1', name: 'TemporaryKB' })
    await expect(ensureTemporaryKb()).resolves.toEqual({ id: 'kb-1', name: 'TemporaryKB' })

    expect(client.listDatasets).toHaveBeenCalledTimes(1)
    expect(client.createDataset).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'TemporaryKB', parserId: 'general' })
    )
  })

  it('reuses an existing dataset', async () => {
    client.listDatasets.mockResolvedValueOnce({ items: [makeDataset()], total: 1 })

    const { ensureTemporaryKb } = await load()
    await expect(ensureTemporaryKb()).resolves.toEqual({ id: 'kb-1', name: 'TemporaryKB' })
    expect(client.createDataset).not.toHaveBeenCalled()
  })

  it('fixes an empty dataset with the wrong parser', async () => {
    client.listDatasets.mockResolvedValueOnce({
      items: [makeDataset({ parserId: 'book', documentCount: 0 })],
      total: 1
    })

    const { ensureTemporaryKb } = await load()
    await ensureTemporaryKb()

    expect(client.updateDatasetParser).toHaveBeenCalledWith(
      expect.objectContaining({ datasetId: 'kb-1', parserId: 'general' })
    )
  })

  it('refuses to silently reuse a populated dataset with the wrong parser', async () => {
    client.listDatasets.mockResolvedValueOnce({
      items: [makeDataset({ parserId: 'book', documentCount: 3 })],
      total: 1
    })

    const { ensureTemporaryKb } = await load()
    await expect(ensureTemporaryKb()).rejects.toThrow(/解析器是 book/)
    expect(client.updateDatasetParser).not.toHaveBeenCalled()
  })

  it('repairs a populated dataset when the parser is missing', async () => {
    client.listDatasets.mockResolvedValueOnce({
      items: [makeDataset({ parserId: null, documentCount: 0 })],
      total: 1
    })

    const { ensureTemporaryKb } = await load()
    await ensureTemporaryKb()

    expect(client.updateDatasetParser).toHaveBeenCalledWith(
      expect.objectContaining({ datasetId: 'kb-1', parserId: 'general' })
    )
  })

  it('refuses to reuse a populated dataset when the parser is missing', async () => {
    client.listDatasets.mockResolvedValueOnce({
      items: [makeDataset({ parserId: null, documentCount: 1 })],
      total: 1
    })

    const { ensureTemporaryKb } = await load()
    await expect(ensureTemporaryKb()).rejects.toThrow(/解析器是 unknown/)
  })
})

describe('findDocumentByFingerprint', () => {
  it('filters the metadata query by the exact fingerprint', async () => {
    client.listDocuments.mockResolvedValueOnce({
      items: [makeDocument({ id: 'other', metaFields: { fingerprint: 'other' } }), makeDocument({ id: 'hit' })],
      total: 2
    })

    const { findDocumentByFingerprint } = await load()
    const hit = await findDocumentByFingerprint({ datasetId: 'kb-1', fingerprint: 'fp' })

    expect(hit?.document.id).toBe('hit')
    expect(hit?.failed).toBe(false)
    expect(client.listDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { fingerprint: 'fp' }, pageSize: 100 })
    )
  })

  it('reports a failed document so the caller can re-parse instead of re-uploading', async () => {
    client.listDocuments.mockResolvedValueOnce({
      items: [makeDocument({ run: 'FAIL' })],
      total: 1
    })

    const { findDocumentByFingerprint } = await load()
    await expect(findDocumentByFingerprint({ datasetId: 'kb-1', fingerprint: 'fp' })).resolves.toMatchObject({
      failed: true
    })
  })

  it('selects the newest matching document and treats cancelled documents as failed', async () => {
    client.listDocuments.mockResolvedValueOnce({
      items: [
        makeDocument({ id: 'old', run: 'DONE', updatedAt: '2026-01-01T00:00:00.000Z' }),
        makeDocument({ id: 'new', run: 'CANCEL', updatedAt: '2026-01-02T00:00:00.000Z' })
      ],
      total: 2
    })

    const { findDocumentByFingerprint } = await load()
    await expect(findDocumentByFingerprint({ datasetId: 'kb-1', fingerprint: 'fp' })).resolves.toMatchObject({
      document: { id: 'new' },
      failed: true
    })
  })
})

describe('ingestBidDocument', () => {
  it('reuses a completed document without uploading', async () => {
    client.listDatasets.mockResolvedValue({ items: [makeDataset()], total: 1 })
    client.listDocuments.mockResolvedValue({ items: [makeDocument()], total: 1 })

    const { ingestBidDocument } = await load()
    await expect(
      ingestBidDocument({ fingerprint: 'fp', filename: 'bid.pdf', content: new Uint8Array([1]) })
    ).resolves.toMatchObject({ reused: true, documentId: 'doc-1' })

    expect(client.uploadDocument).not.toHaveBeenCalled()
  })

  it('uploads, writes the fingerprint, and starts parsing on a miss', async () => {
    client.listDatasets.mockResolvedValue({ items: [makeDataset()], total: 1 })
    client.listDocuments.mockResolvedValue({ items: [], total: 0 })
    client.uploadDocument.mockResolvedValue({ id: 'doc-2', name: 'bid.pdf', size: 1, chunkCount: 0, tokenCount: 0 })
    client.updateDocumentMetadata.mockResolvedValue(undefined)
    client.startParsing.mockResolvedValue(undefined)

    const { ingestBidDocument } = await load()
    await expect(
      ingestBidDocument({ fingerprint: 'fp', filename: 'bid.pdf', content: new Uint8Array([1]) })
    ).resolves.toMatchObject({ reused: false, documentId: 'doc-2' })

    expect(client.updateDocumentMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'doc-2', metaFields: { fingerprint: 'fp' } })
    )
    expect(client.startParsing).toHaveBeenCalledWith(expect.objectContaining({ documentIds: ['doc-2'] }))
  })

  it('restarts parsing for a cancelled matching document', async () => {
    client.listDatasets.mockResolvedValue({ items: [makeDataset()], total: 1 })
    client.listDocuments.mockResolvedValue({
      items: [makeDocument({ run: 'CANCEL' })],
      total: 1
    })
    client.startParsing.mockResolvedValue(undefined)

    const { ingestBidDocument } = await load()
    await expect(
      ingestBidDocument({ fingerprint: 'fp', filename: 'bid.pdf', content: new Uint8Array([1]) })
    ).resolves.toMatchObject({ reused: true, documentId: 'doc-1' })

    expect(client.startParsing).toHaveBeenCalledWith(expect.objectContaining({ documentIds: ['doc-1'] }))
  })

  it('fails when fingerprint metadata cannot be written after retry', async () => {
    client.listDatasets.mockResolvedValue({ items: [makeDataset()], total: 1 })
    client.listDocuments.mockResolvedValue({ items: [], total: 0 })
    client.uploadDocument.mockResolvedValue({ id: 'doc-2', name: 'bid.pdf', size: 1, chunkCount: 0, tokenCount: 0 })
    client.updateDocumentMetadata.mockRejectedValue(new Error('metadata unavailable'))

    const { ingestBidDocument } = await load()
    await expect(
      ingestBidDocument({ fingerprint: 'fp', filename: 'bid.pdf', content: new Uint8Array([1]) })
    ).rejects.toThrow(/指纹写入失败/)

    expect(client.updateDocumentMetadata).toHaveBeenCalledTimes(2)
    expect(client.startParsing).not.toHaveBeenCalled()
  })

  it('serializes concurrent ingests for the same fingerprint', async () => {
    client.listDatasets.mockResolvedValue({ items: [makeDataset()], total: 1 })
    let listCalls = 0
    client.listDocuments.mockImplementation(async () => {
      listCalls += 1
      if (listCalls === 1) {
        await new Promise((resolve) => setTimeout(resolve, 20))
        return { items: [], total: 0 }
      }
      return { items: [makeDocument({ id: 'doc-2', run: 'RUNNING' })], total: 1 }
    })
    client.uploadDocument.mockResolvedValue({ id: 'doc-2', name: 'bid.pdf', size: 1, chunkCount: 0, tokenCount: 0 })
    client.updateDocumentMetadata.mockResolvedValue(undefined)
    client.startParsing.mockResolvedValue(undefined)

    const { ingestBidDocument } = await load()
    const results = await Promise.all([
      ingestBidDocument({ fingerprint: 'fp', filename: 'bid.pdf', content: new Uint8Array([1]) }),
      ingestBidDocument({ fingerprint: 'fp', filename: 'bid.pdf', content: new Uint8Array([1]) })
    ])

    expect(client.uploadDocument).toHaveBeenCalledTimes(1)
    expect(results.map((result) => result.reused).sort()).toEqual([false, true])
  })
})

describe('waitForBidDocument', () => {
  it('waits through RUNNING and reports DONE', async () => {
    client.findDocument
      .mockResolvedValueOnce(makeDocument({ run: 'RUNNING', progress: 0.5 }))
      .mockResolvedValueOnce(makeDocument({ run: 'DONE', progress: 1 }))

    const { waitForBidDocument } = await load()
    await expect(
      waitForBidDocument({ datasetId: 'kb-1', documentId: 'doc-1', timeoutMs: 1_000, intervalMs: 1 })
    ).resolves.toMatchObject({ status: 'done' })
  })

  it('surfaces the latest ingestion event on failure', async () => {
    client.findDocument.mockResolvedValueOnce(makeDocument({ run: 'FAIL', latestEventMessage: 'boom' }))

    const { waitForBidDocument } = await load()
    await expect(
      waitForBidDocument({ datasetId: 'kb-1', documentId: 'doc-1', timeoutMs: 1_000, intervalMs: 1 })
    ).resolves.toMatchObject({ status: 'failed', error: 'boom' })
  })

  it('returns processing with progress when the wait budget expires', async () => {
    client.findDocument.mockResolvedValue(makeDocument({ run: 'RUNNING', progress: 0.4 }))

    const { waitForBidDocument } = await load()
    await expect(
      waitForBidDocument({ datasetId: 'kb-1', documentId: 'doc-1', timeoutMs: 0, intervalMs: 1 })
    ).resolves.toMatchObject({ status: 'processing', progress: 0.4 })
  })
})
