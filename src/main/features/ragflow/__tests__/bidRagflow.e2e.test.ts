/**
 * Live RagFlow 1.0 E2E for the bid-analysis TemporaryKB path.
 *
 * Skipped unless RAGFLOW_E2E=1 and RAGFLOW_E2E_API_KEY are set. Never prints the key.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

const RUN = process.env.RAGFLOW_E2E === '1' && Boolean(process.env.RAGFLOW_E2E_API_KEY)
const API_URL = (process.env.RAGFLOW_E2E_API_URL ?? 'http://localhost').replace(/\/+$/, '')
const API_KEY = process.env.RAGFLOW_E2E_API_KEY ?? ''
const FIXTURE_DIR = join(process.cwd(), 'tests/fixtures/documents')

type Envelope<T> = { code: number; message?: string | null; data: T }

const api = async <T>(path: string, init: RequestInit = {}): Promise<Envelope<T>> => {
  const headers: Record<string, string> = { Authorization: `Bearer ${API_KEY}` }
  if (typeof init.body === 'string') headers['Content-Type'] = 'application/json'
  const response = await fetch(`${API_URL}${path}`, { ...init, headers: { ...headers, ...(init.headers as object) } })
  const envelope = (await response.json()) as Envelope<T>
  if (!response.ok || envelope.code !== 0) {
    throw new Error(`RagFlow E2E ${path} failed: HTTP ${response.status} ${envelope.message ?? ''}`)
  }
  return envelope
}

const fileBytes = async (name: string): Promise<Uint8Array<ArrayBuffer>> => {
  const source = await readFile(join(FIXTURE_DIR, name))
  const bytes = new Uint8Array(source.byteLength)
  bytes.set(source)
  return bytes
}

const createDataset = async (name: string): Promise<string> => {
  const envelope = await api<{ id: string }>('/api/v1/datasets', {
    method: 'POST',
    body: JSON.stringify({ name, parse_type: 1, parser_id: 'general' })
  })
  return envelope.data.id
}

const upload = async (datasetId: string, name: string): Promise<string> => {
  const form = new FormData()
  form.append('file', new Blob([await fileBytes(name)]), name)
  const envelope = await api<Array<{ id: string }>>(`/api/v1/datasets/${datasetId}/documents?type=local`, {
    method: 'POST',
    body: form
  })
  const document = envelope.data[0]
  if (!document) throw new Error(`RagFlow E2E did not return a document for ${name}`)
  return document.id
}

const parseAndWait = async (datasetId: string, documentId: string): Promise<void> => {
  await api(`/api/v1/datasets/${datasetId}/documents/parse`, {
    method: 'POST',
    body: JSON.stringify({ document_ids: [documentId] })
  })

  const deadline = Date.now() + 180_000
  for (;;) {
    const envelope = await api<{ docs: Array<{ ingestion_status?: string | null; progress?: number }> }>(
      `/api/v1/datasets/${datasetId}/documents?page_size=100&id=${documentId}`
    )
    const status = envelope.data.docs[0]?.ingestion_status ?? ''
    if (status === 'COMPLETED') return
    if (status === 'FAILED' || status === 'STOPPED') throw new Error(`RagFlow parse ended as ${status}`)
    if (Date.now() >= deadline) throw new Error('RagFlow parse timed out')
    await new Promise((resolve) => setTimeout(resolve, 2_000))
  }
}

const listChunks = async (datasetId: string, documentId: string): Promise<Array<Record<string, unknown>>> => {
  const chunks: Array<Record<string, unknown>> = []
  for (let page = 1; ; page += 1) {
    const envelope = await api<{ chunks: Array<Record<string, unknown>>; total?: number }>(
      `/api/v1/datasets/${datasetId}/documents/${documentId}/chunks?page=${page}&page_size=100`
    )
    chunks.push(...envelope.data.chunks)
    if (envelope.data.chunks.length < 100) return chunks
    if (envelope.data.total !== undefined && chunks.length >= envelope.data.total) return chunks
  }
}

const contentOf = (chunks: Array<Record<string, unknown>>): string =>
  chunks.map((chunk) => String(chunk.content_with_weight ?? chunk.content ?? '')).join('\n')

const deleteDataset = async (datasetId: string): Promise<void> => {
  await api('/api/v1/datasets', { method: 'DELETE', body: JSON.stringify({ ids: [datasetId] }) })
}

describe.skipIf(!RUN)('RagFlow bid analysis E2E', () => {
  let datasetId = ''

  afterAll(async () => {
    if (datasetId) await deleteDataset(datasetId).catch(() => undefined)
  })

  it('keeps DOCX tables/headings and PDF page positions in document order', async () => {
    datasetId = await createDataset(`CherryE2E-${Date.now()}`)

    const docxId = await upload(datasetId, 'table.docx')
    await parseAndWait(datasetId, docxId)
    const docxChunks = await listChunks(datasetId, docxId)
    const docxText = contentOf(docxChunks)
    for (const token of ['R1C1', 'R2C3', 'R3C2', 'MERGED-TOP-LEFT', 'M1C2-P2']) {
      expect(docxText.split(token).length - 1, token).toBe(1)
    }
    expect(docxChunks.some((chunk) => String(chunk.content_with_weight ?? '').includes('<table>'))).toBe(true)

    const headingsId = await upload(datasetId, 'headings.docx')
    await parseAndWait(datasetId, headingsId)
    const headingText = contentOf(await listChunks(datasetId, headingsId))
    for (const token of ['第三章 投标人资格要求', '3.1.2 企业资质', '评分项', '资质A', '10']) {
      expect(headingText, token).toContain(token)
    }

    const pdfId = await upload(datasetId, 'table-ruled.pdf')
    await parseAndWait(datasetId, pdfId)
    const pdfChunks = await listChunks(datasetId, pdfId)
    const tableChunk = pdfChunks.find((chunk) => String(chunk.content_with_weight ?? '').includes('<table>'))
    expect(tableChunk).toBeDefined()
    expect(String(tableChunk?.content_with_weight ?? '')).toContain('P1R1C1')
    const positions = tableChunk?.positions ?? tableChunk?.position_int
    expect(Array.isArray(positions) && positions.length > 0, 'PDF table chunk has positions').toBe(true)
  }, 240_000)
})
