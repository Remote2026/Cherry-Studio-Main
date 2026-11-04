import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  bidDocumentFilePath,
  bidDocumentId,
  bidFingerprint,
  isBidDocumentId,
  readBidDocumentHandle,
  readThroughOf,
  updateBidReadThrough,
  writeBidDocumentHandle
} from '../documentHandle'

let workspace: string

const fingerprint = 'a'.repeat(64)
const docId = bidDocumentId(fingerprint)

const write = (sessionId = 's1') =>
  writeBidDocumentHandle({
    workspacePath: workspace,
    sessionId,
    docId,
    fingerprint,
    kind: 'pdf',
    filename: 'bid.pdf',
    datasetId: 'kb-1',
    documentId: 'doc-1'
  })

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'bid-doc-handle-'))
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
})

describe('bid document handle', () => {
  it('derives a stable content fingerprint and handle id', () => {
    expect(bidFingerprint(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
    expect(docId).toBe(`rf-${'a'.repeat(32)}`)
    expect(isBidDocumentId(docId)).toBe(true)
    expect(isBidDocumentId('pdf-0123456789abcdef0123456789abcdef')).toBe(false)
  })

  it('round-trips a handle and merges sessions for the same file', async () => {
    const first = await write('s1')
    expect(first).toMatchObject({
      version: 2,
      docId,
      fingerprint,
      datasetId: 'kb-1',
      documentId: 'doc-1',
      sessionIds: ['s1'],
      readThroughBySession: {}
    })

    const merged = await write('s2')
    expect(merged.sessionIds).toEqual(['s1', 's2'])
    expect(merged.createdAt).toBe(first.createdAt)

    await expect(readBidDocumentHandle({ workspacePath: workspace, sessionId: 's2', docId })).resolves.toMatchObject({
      documentId: 'doc-1'
    })
    await expect(readBidDocumentHandle({ workspacePath: workspace, sessionId: 's3', docId })).rejects.toThrow(
      '不属于当前会话'
    )
  })

  it('never regresses the contiguous read ledger', async () => {
    await write()
    const input = { workspacePath: workspace, sessionId: 's1', docId }

    expect(await updateBidReadThrough({ ...input, readThrough: 5 })).toBe(5)
    expect(await updateBidReadThrough({ ...input, readThrough: 3 })).toBe(5)

    const handle = await readBidDocumentHandle(input)
    expect(readThroughOf(handle, 's1')).toBe(5)
    expect(readThroughOf(handle, 's2')).toBe(0)
  })

  it('rejects malformed, outdated, and missing handles', async () => {
    const input = { workspacePath: workspace, sessionId: 's1', docId }
    await expect(readBidDocumentHandle(input)).rejects.toThrow('文档已过期或不存在')

    await write()
    const file = bidDocumentFilePath(workspace, docId)
    await writeFile(file, 'not json')
    await expect(readBidDocumentHandle(input)).rejects.toThrow('文档已过期或不存在')

    await writeFile(file, JSON.stringify({ version: 1, docId }))
    await expect(readBidDocumentHandle(input)).rejects.toThrow('文档已过期或不存在')
  })

  it('rejects handle ids that escape the document directory', () => {
    expect(() => bidDocumentFilePath(workspace, '../escape')).toThrow('文档句柄无效')
  })
})
