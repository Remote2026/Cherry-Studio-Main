import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RagflowChunk } from '@shared/ipc/schemas/ragflow'

const { client } = vi.hoisted(() => ({ client: { listChunks: vi.fn() } }))

vi.mock('@main/features/ragflow', () => ({ ragflowClient: client }))

const makeChunk = (id: string, content: string, overrides: Partial<RagflowChunk> = {}): RagflowChunk => ({
  id,
  content,
  documentId: 'doc-1',
  documentName: 'bid.pdf',
  available: true,
  ...overrides
})

const load = async () => {
  vi.resetModules()
  return await import('../chunkReader')
}

beforeEach(() => {
  vi.resetAllMocks()
})

const chunks = [
  makeChunk('c1', '3.1.2 企业资质\n投标人应具备以下资质：'),
  makeChunk('c2', '资质A 10分\n资质B 5分'),
  makeChunk('c3', '<table><tr><td>评分项</td><td>分值</td></tr></table>', { docType: 'table' })
]

describe('readBidChunkBatch', () => {
  it('reads from index 0 with section and table headers', async () => {
    client.listChunks.mockResolvedValueOnce({ items: chunks, total: 3 })

    const { readBidChunkBatch } = await load()
    const batch = await readBidChunkBatch({ datasetId: 'kb-1', documentId: 'doc-1' })

    expect(batch).toMatchObject({ startIndex: 0, endIndex: 2, nextIndex: null, done: true, total: 3 })
    expect(batch.content).toContain('[第1段｜3.1.2 企业资质]')
    expect(batch.content).toContain('[第2段｜3.1.2 企业资质]')
    expect(batch.content).toContain('[第3段｜表｜3.1.2 企业资质]')
    expect(batch.sectionNumber).toBe('3.1.2')
    expect(batch.sectionConfidence).toBe('high')
  })

  it('annotates PDF page ranges from positions', async () => {
    client.listChunks.mockResolvedValueOnce({
      items: [makeChunk('c1', '3.1 基本资格要求\n正文', { pages: [3, 4] })],
      total: 1
    })

    const { readBidChunkBatch } = await load()
    const batch = await readBidChunkBatch({ datasetId: 'kb-1', documentId: 'doc-1' })

    expect(batch.content).toContain('[第1段｜第3-4页｜3.1 基本资格要求]')
  })

  it('starts at a 0-based index and keeps at least one chunk under a tight budget', async () => {
    client.listChunks.mockResolvedValueOnce({
      items: [makeChunk('c1', 'a'.repeat(2_000)), makeChunk('c2', 'b'.repeat(2_000)), makeChunk('c3', 'c')],
      total: 3
    })

    const { readBidChunkBatch } = await load()
    const first = await readBidChunkBatch({ datasetId: 'kb-1', documentId: 'doc-1', maxTokens: 1 })
    expect(first.startIndex).toBe(0)
    expect(first.endIndex).toBe(0)
    expect(first.nextIndex).toBe(1)

    const second = await readBidChunkBatch({
      datasetId: 'kb-1',
      documentId: 'doc-1',
      startIndex: 2,
      maxTokens: 10_000
    })
    expect(second.content).toContain('[第3段]')
    expect(second.done).toBe(true)
  })

  it('caches the document chunks between reads', async () => {
    client.listChunks.mockResolvedValue({ items: chunks, total: 3 })

    const { readBidChunkBatch } = await load()
    await readBidChunkBatch({ datasetId: 'kb-1', documentId: 'doc-1' })
    await readBidChunkBatch({ datasetId: 'kb-1', documentId: 'doc-1', startIndex: 1 })

    expect(client.listChunks).toHaveBeenCalledTimes(1)
  })

  it('rejects duplicate chunk ids instead of silently skipping content', async () => {
    client.listChunks.mockResolvedValueOnce({ items: [chunks[0], chunks[0]], total: 2 })

    const { readBidChunkBatch } = await load()
    await expect(readBidChunkBatch({ datasetId: 'kb-1', documentId: 'doc-1' })).rejects.toThrow(/重复/)
  })

  it('rejects a chunk count that does not match total', async () => {
    const hundred = Array.from({ length: 100 }, (_, index) => makeChunk(`c${index}`, `content ${index}`))
    client.listChunks
      .mockResolvedValueOnce({ items: hundred, total: 101 })
      .mockResolvedValueOnce({ items: [], total: 101 })

    const { readBidChunkBatch } = await load()
    await expect(readBidChunkBatch({ datasetId: 'kb-1', documentId: 'doc-1' })).rejects.toThrow(/数量与 total/)
  })

  it('reloads the cache when the expected total changes after re-parsing', async () => {
    client.listChunks
      .mockResolvedValueOnce({ items: chunks, total: 3 })
      .mockResolvedValueOnce({ items: [chunks[0]], total: 1 })

    const { readBidChunkBatch } = await load()
    await readBidChunkBatch({ datasetId: 'kb-1', documentId: 'doc-1', expectedTotal: 3 })
    await readBidChunkBatch({ datasetId: 'kb-1', documentId: 'doc-1', expectedTotal: 1 })

    expect(client.listChunks).toHaveBeenCalledTimes(2)
  })
})

describe('checkBidCoverage', () => {
  const fiveChunks = [
    makeChunk('c1', '3.1.2 企业资质\n投标人应具备以下资质：'),
    makeChunk('c2', '资质A 10分'),
    makeChunk('c3', '<table><tr><td>评分项</td></tr></table>', { docType: 'table' }),
    makeChunk('c4', '3.2 财务要求\n提供近三年审计报告。'),
    makeChunk('c5', '正文')
  ]

  it('reports gaps, missing sections, and unread tables', async () => {
    client.listChunks.mockResolvedValueOnce({ items: fiveChunks, total: 5 })

    const { checkBidCoverage } = await load()
    const coverage = await checkBidCoverage({ datasetId: 'kb-1', documentId: 'doc-1', readThrough: 2 })

    expect(coverage).toMatchObject({
      total: 5,
      readThrough: 2,
      complete: false,
      gaps: [[2, 4]],
      sections: { total: 2, covered: 1, missing: ['3.2 财务要求'] },
      tables: { total: 1, covered: 0, unreadIndices: [2] }
    })
  })

  it('is complete only after the contiguous read reaches the end', async () => {
    client.listChunks.mockResolvedValueOnce({ items: fiveChunks, total: 5 })

    const { checkBidCoverage } = await load()
    const coverage = await checkBidCoverage({ datasetId: 'kb-1', documentId: 'doc-1', readThrough: 5 })

    expect(coverage).toMatchObject({
      complete: true,
      gaps: [],
      sections: { total: 2, covered: 2, missing: [] },
      tables: { total: 1, covered: 1, unreadIndices: [] }
    })
  })

  it('returns null tables when the version cannot identify them', async () => {
    client.listChunks.mockResolvedValueOnce({ items: [makeChunk('c1', '普通正文')], total: 1 })

    const { checkBidCoverage } = await load()
    const coverage = await checkBidCoverage({ datasetId: 'kb-1', documentId: 'doc-1', readThrough: 1 })

    expect(coverage.tables).toBeNull()
  })
})
