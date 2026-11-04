import type { McpServer } from '@modelcontextprotocol/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readBidDocumentHandle: vi.fn(),
  readThroughOf: vi.fn(),
  touchBidDocumentHandle: vi.fn(),
  updateBidReadThrough: vi.fn(),
  waitForBidDocument: vi.fn(),
  readBidChunkBatch: vi.fn(),
  checkBidCoverage: vi.fn()
}))

vi.mock('@main/ai/bidDocument/documentHandle', () => ({
  BID_READ_CHUNKS_TOOL_NAME: 'bid_read_chunks',
  BID_CHECK_COVERAGE_TOOL_NAME: 'bid_check_coverage',
  readBidDocumentHandle: mocks.readBidDocumentHandle,
  readThroughOf: mocks.readThroughOf,
  touchBidDocumentHandle: mocks.touchBidDocumentHandle,
  updateBidReadThrough: mocks.updateBidReadThrough
}))

vi.mock('@main/ai/bidDocument/chunkReader', () => ({
  readBidChunkBatch: mocks.readBidChunkBatch,
  checkBidCoverage: mocks.checkBidCoverage
}))

vi.mock('@main/ai/bidDocument/ragflowDocuments', () => ({
  waitForBidDocument: mocks.waitForBidDocument
}))

import { registerBidDocumentTools } from '../bidDocumentTools'

type ToolResult = { content: Array<{ type: string; text?: string }> }
type ToolHandler = (input: Record<string, unknown>, ctx: unknown) => Promise<ToolResult>

const makeServer = () => ({ registerTool: vi.fn() })

const handlerFor = (server: ReturnType<typeof makeServer>, name: string): ToolHandler => {
  const call = server.registerTool.mock.calls.find(([toolName]) => toolName === name)
  if (!call) throw new Error(`missing tool ${name}`)
  return call[2] as ToolHandler
}

const ctx = { mcpReq: { signal: new AbortController().signal } }

const read = async (input: Record<string, unknown>, name = 'bid_read_chunks') => {
  const server = makeServer()
  registerBidDocumentTools(server as unknown as McpServer, { sessionId: 's1', workspacePath: 'workspace' })
  const result = await handlerFor(server, name)(input, ctx)
  return JSON.parse(result.content[0]?.text ?? '{}')
}

const handle = {
  version: 2,
  docId: `rf-${'a'.repeat(32)}`,
  fingerprint: 'a'.repeat(64),
  kind: 'pdf',
  filename: 'bid.pdf',
  datasetId: 'kb-1',
  documentId: 'doc-1',
  sessionIds: ['s1'],
  createdAt: 1,
  lastAccessAt: 1,
  readThroughBySession: { s1: 0 }
}

const document = { id: 'doc-1', name: 'bid.pdf', chunkCount: 3, run: 'DONE', progress: 1 }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.readBidDocumentHandle.mockResolvedValue(handle)
  mocks.readThroughOf.mockReturnValue(0)
  mocks.updateBidReadThrough.mockResolvedValue(1)
  mocks.touchBidDocumentHandle.mockResolvedValue(undefined)
})

describe('bid_read_chunks', () => {
  it('returns processing with a retry hint while RagFlow is still parsing', async () => {
    mocks.waitForBidDocument.mockResolvedValue({ status: 'processing', document, progress: 0.4 })

    await expect(read({ docId: handle.docId })).resolves.toMatchObject({
      status: 'processing',
      progress: 0.4,
      retryAfterMs: 5_000,
      filename: 'bid.pdf'
    })
    expect(mocks.readBidChunkBatch).not.toHaveBeenCalled()
  })

  it('returns the batch and advances the contiguous read ledger', async () => {
    mocks.waitForBidDocument.mockResolvedValue({ status: 'done', document })
    mocks.readBidChunkBatch.mockResolvedValue({
      content: '[第1段｜3.1.2 企业资质]\ntext',
      startIndex: 0,
      endIndex: 0,
      nextIndex: 1,
      done: false,
      total: 3,
      tokens: 10,
      sectionPath: ['3.1.2 企业资质'],
      sectionNumber: '3.1.2',
      sectionConfidence: 'high'
    })

    const result = await read({ docId: handle.docId })

    expect(result).toMatchObject({
      status: 'completed',
      startIndex: 0,
      endIndex: 0,
      nextIndex: 1,
      done: false,
      total: 3,
      sectionNumber: '3.1.2'
    })
    expect(mocks.updateBidReadThrough).toHaveBeenCalledWith(expect.objectContaining({ readThrough: 1 }))
  })

  it('treats a parsed document with no chunks as failed', async () => {
    mocks.waitForBidDocument.mockResolvedValue({ status: 'done', document: { ...document, chunkCount: 0 } })
    mocks.readBidChunkBatch.mockResolvedValue({
      content: '',
      startIndex: 0,
      endIndex: -1,
      nextIndex: null,
      done: true,
      total: 0,
      tokens: 0
    })

    await expect(read({ docId: handle.docId })).resolves.toMatchObject({
      status: 'failed',
      error: expect.stringContaining('没有分块')
    })
  })

  it('does not advance the ledger when the agent jumps ahead', async () => {
    mocks.readThroughOf.mockReturnValue(0)
    mocks.waitForBidDocument.mockResolvedValue({ status: 'done', document })
    mocks.readBidChunkBatch.mockResolvedValue({
      content: 'text',
      startIndex: 2,
      endIndex: 2,
      nextIndex: null,
      done: true,
      total: 3,
      tokens: 1
    })

    await read({ docId: handle.docId, startIndex: 2 })

    expect(mocks.updateBidReadThrough).toHaveBeenCalledWith(expect.objectContaining({ readThrough: 0 }))
  })

  it('surfaces a parse failure and a stale handle as failed JSON', async () => {
    mocks.waitForBidDocument.mockResolvedValueOnce({ status: 'failed', document, error: 'boom' })
    await expect(read({ docId: handle.docId })).resolves.toMatchObject({ status: 'failed', error: 'boom' })

    mocks.readBidDocumentHandle.mockRejectedValueOnce(new Error('文档已过期或不存在，请重新发送附件'))
    await expect(read({ docId: handle.docId })).resolves.toMatchObject({
      status: 'failed',
      error: '文档已过期或不存在，请重新发送附件'
    })
  })
})

describe('bid_check_coverage', () => {
  it('returns the coverage report only after parsing is done', async () => {
    mocks.waitForBidDocument.mockResolvedValue({ status: 'done', document })
    mocks.checkBidCoverage.mockResolvedValue({
      total: 3,
      readThrough: 1,
      gaps: [[1, 2]],
      complete: false,
      sections: { total: 2, covered: 1, missing: ['3.2 财务要求'] },
      tables: { total: 1, covered: 0, unreadIndices: [2] }
    })

    await expect(read({ docId: handle.docId }, 'bid_check_coverage')).resolves.toMatchObject({
      status: 'completed',
      total: 3,
      readThrough: 1,
      complete: false,
      gaps: [[1, 2]],
      tables: { total: 1, covered: 0, unreadIndices: [2] }
    })
    expect(mocks.touchBidDocumentHandle).toHaveBeenCalled()
  })
})
