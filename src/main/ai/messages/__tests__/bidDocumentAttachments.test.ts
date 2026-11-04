import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  bidFingerprint: vi.fn(() => 'a'.repeat(64)),
  bidDocumentId: vi.fn(() => `rf-${'a'.repeat(32)}`),
  writeBidDocumentHandle: vi.fn(),
  ingestBidDocument: vi.fn(),
  watchBidDocumentParse: vi.fn(),
  setBidAttachmentStatus: vi.fn()
}))

vi.mock('@main/ai/bidDocument/documentHandle', () => ({
  BID_CHECK_COVERAGE_TOOL_NAME: 'bid_check_coverage',
  BID_READ_CHUNKS_TOOL_NAME: 'bid_read_chunks',
  MAX_BID_DOCUMENT_BYTES: 128 * 1024 * 1024,
  bidFingerprint: mocks.bidFingerprint,
  bidDocumentId: mocks.bidDocumentId,
  writeBidDocumentHandle: mocks.writeBidDocumentHandle
}))

vi.mock('@main/ai/bidDocument/ragflowDocuments', () => ({
  ingestBidDocument: mocks.ingestBidDocument,
  watchBidDocumentParse: mocks.watchBidDocumentParse
}))

vi.mock('@main/ai/bidDocument/attachmentStatus', () => ({
  setBidAttachmentStatus: mocks.setBidAttachmentStatus
}))

import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'

import { prepareBidDocumentMessage, withBidDocumentFailureNotes } from '../bidDocumentAttachments'

let workspace: string

const makeMessage = (parts: unknown[]): AgentSessionMessageEntity =>
  ({ id: 'm1', sessionId: 's1', data: { parts } }) as unknown as AgentSessionMessageEntity

const filePart = (path: string, filename: string, mediaType = 'application/pdf') => ({
  type: 'file',
  mediaType,
  url: pathToFileURL(path).href,
  filename
})

const run = (message: AgentSessionMessageEntity, agentId = 'bid-analysis') =>
  prepareBidDocumentMessage({
    agentId,
    sessionId: 's1',
    workspacePath: workspace,
    message,
    signal: new AbortController().signal
  })

const makeFile = async (name: string, content = '%PDF-1.4 fake'): Promise<string> => {
  const path = join(workspace, name)
  await writeFile(path, Buffer.from(content))
  return path
}

beforeEach(async () => {
  vi.clearAllMocks()
  workspace = await mkdtemp(join(tmpdir(), 'bid-doc-attachments-'))
  mocks.ingestBidDocument.mockResolvedValue({
    datasetId: 'kb-1',
    documentId: 'doc-1',
    documentName: 'bid.pdf',
    reused: false
  })
  mocks.writeBidDocumentHandle.mockResolvedValue(undefined)
  mocks.watchBidDocumentParse.mockResolvedValue(undefined)
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
})

describe('prepareBidDocumentMessage', () => {
  it('uploads a PDF and replaces the file part with the read protocol', async () => {
    const path = await makeFile('bid.pdf', 'pdf bytes')
    const message = makeMessage([filePart(path, 'bid.pdf')])

    const result = await run(message)
    const part = result.data.parts?.[0]
    const text = part?.type === 'text' ? part.text : ''

    expect(part?.type).toBe('text')
    expect(text).toContain(`文档句柄：${`rf-${'a'.repeat(32)}`}`)
    expect(text).toContain('mcp__cherry-tools__bid_read_chunks')
    expect(text).toContain('mcp__cherry-tools__bid_check_coverage')
    expect(text).toContain('TemporaryKB')
    expect(message.data.parts?.[0]?.type).toBe('file')

    expect(mocks.ingestBidDocument).toHaveBeenCalledWith(
      expect.objectContaining({ fingerprint: 'a'.repeat(64), filename: 'bid.pdf', content: expect.any(Buffer) })
    )
    expect(mocks.writeBidDocumentHandle).toHaveBeenCalledWith(
      expect.objectContaining({ datasetId: 'kb-1', documentId: 'doc-1', kind: 'pdf', filename: 'bid.pdf' })
    )
    expect(mocks.setBidAttachmentStatus).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'uploading', filename: 'bid.pdf' })
    )
    expect(mocks.setBidAttachmentStatus).toHaveBeenCalledWith(expect.objectContaining({ phase: 'parsing', percent: 0 }))
    expect(mocks.watchBidDocumentParse).toHaveBeenCalledWith(
      expect.objectContaining({ datasetId: 'kb-1', documentId: 'doc-1' })
    )
  })

  it('records DOCX attachments with the docx kind', async () => {
    const path = await makeFile('tender.docx', 'docx bytes')
    await run(
      makeMessage([
        filePart(path, 'tender.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      ])
    )

    expect(mocks.writeBidDocumentHandle).toHaveBeenCalledWith(expect.objectContaining({ kind: 'docx' }))
  })

  it('uploads PDF/DOCX for every agent and leaves other formats untouched', async () => {
    const pdfPath = await makeFile('bid.pdf')
    const txtPath = await makeFile('notes.txt', 'hello')

    const message = makeMessage([filePart(pdfPath, 'bid.pdf')])
    await expect(run(message, 'other-agent')).resolves.not.toBe(message)
    expect(mocks.ingestBidDocument).toHaveBeenCalledTimes(1)

    const textMessage = makeMessage([{ type: 'text', text: 'hello' }, filePart(txtPath, 'notes.txt', 'text/plain')])
    await expect(run(textMessage, 'other-agent')).resolves.toBe(textMessage)
    expect(mocks.ingestBidDocument).toHaveBeenCalledTimes(1)
  })

  it('replaces a failed upload with a failure note instead of the original file', async () => {
    const path = await makeFile('bid.pdf')
    mocks.ingestBidDocument.mockRejectedValueOnce(new Error('RagFlow service is unavailable'))

    const result = await run(makeMessage([filePart(path, 'bid.pdf')]))
    const part = result.data.parts?.[0]
    const text = part?.type === 'text' ? part.text : ''

    expect(text).toContain('上传/解析 RagFlow 失败')
    expect(text).toContain('RagFlow service is unavailable')
    expect(result.data.parts?.some((item) => item.type === 'file')).toBe(false)
    expect(mocks.writeBidDocumentHandle).not.toHaveBeenCalled()
  })
})

describe('withBidDocumentFailureNotes', () => {
  it('only rewrites PDF/DOCX file parts', async () => {
    const pdfPath = await makeFile('bid.pdf')
    const txtPath = await makeFile('notes.txt', 'hello')
    const message = makeMessage([
      filePart(pdfPath, 'bid.pdf'),
      filePart(txtPath, 'notes.txt', 'text/plain'),
      { type: 'text', text: 'keep me' }
    ])

    const result = withBidDocumentFailureNotes(message, new Error('boom'))

    expect(result.data.parts?.[0]?.type).toBe('text')
    expect(result.data.parts?.[1]?.type).toBe('file')
    expect(result.data.parts?.[2]?.type).toBe('text')
    expect(result.data.parts?.[0]?.type === 'text' && result.data.parts[0].text).toContain('boom')
  })
})
