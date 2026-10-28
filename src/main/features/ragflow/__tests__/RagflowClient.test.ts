import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchMock, preferenceGetMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  preferenceGetMock: vi.fn()
}))

vi.mock('electron', () => ({ net: { fetch: fetchMock } }))
vi.mock('@application', () => ({ application: { get: () => ({ get: preferenceGetMock }) } }))

import { RagflowClientError, ragflowClient } from '../RagflowClient'

const API_URL = 'https://ragflow.example.com'

/** Payload shapes below mirror a live RagFlow v0.26.4 instance. */
const DATASET_PAYLOAD = {
  avatar: null,
  chunk_count: 136,
  chunk_method: 'manual',
  create_date: '2026-09-25T20:56:34',
  create_time: 1790340994491,
  created_by: 'cd8f1b069a4411f1ae2a7915157d2a8e',
  description: null,
  document_count: 1,
  embedding_model: 'text-embedding-v4@Qwen@Tongyi-Qianwen',
  id: '8989b0fab8e011f1bdf4a90f31e75474',
  language: 'English',
  name: 'bidding-docs',
  nickname: 'admin',
  parser_config: { graphrag: { use_graphrag: false }, llm_id: 'deepseek-v4-flash@deepseek@DeepSeek' },
  permission: 'me',
  similarity_threshold: 0.2,
  status: '1',
  tenant_id: 'cd8f1b069a4411f1ae2a7915157d2a8e',
  token_num: 20144,
  update_date: '2026-09-25T20:57:54',
  update_time: 1790341074742,
  vector_similarity_weight: 0.3
}

const DOCUMENT_PAYLOAD = {
  chunk_count: 136,
  create_date: '2026-09-25T20:56:58',
  create_time: 1790341018115,
  created_by: 'cd8f1b069a4411f1ae2a7915157d2a8e',
  dataset_id: '8989b0fab8e011f1bdf4a90f31e75474',
  id: '97986ddab8e011f1bdf4a90f31e75474',
  location: 'bid.docx',
  meta_fields: {},
  name: 'bid.docx',
  nickname: 'admin',
  progress: 1,
  progress_msg: 'Task completed',
  run: 'DONE',
  size: 1327966,
  source_type: 'local',
  status: '1',
  suffix: 'docx',
  thumbnail: '',
  token_count: 20144,
  type: 'doc',
  update_date: '2026-09-25T20:57:59',
  update_time: 1790341079142
}

const STORED_CHUNK_PAYLOAD = {
  available: true,
  content: 'The bidder shall submit two sealed envelopes.',
  dataset_id: '8989b0fab8e011f1bdf4a90f31e75474',
  docnm_kwd: 'bid.docx',
  document_id: '97986ddab8e011f1bdf4a90f31e75474',
  id: '321dcf760c3cf1e5',
  image_id: '',
  important_keywords: [],
  positions: [],
  questions: [],
  tag_kwd: []
}

const RETRIEVAL_CHUNK_PAYLOAD = {
  content: 'The bidder shall submit two sealed envelopes.',
  content_ltks: 'bidder submit two sealed envelope',
  dataset_id: '8989b0fab8e011f1bdf4a90f31e75474',
  doc_type_kwd: '',
  document_id: '97986ddab8e011f1bdf4a90f31e75474',
  document_keyword: 'bid.docx',
  id: '6f91590e5e582332',
  image_id: '',
  important_keywords: [],
  mom_id: '',
  positions: [],
  row_id: null,
  similarity: 0.6081276995748497,
  tag_kwd: [],
  term_similarity: 0.5894739136783568,
  vector_similarity: 0.6516532
}

const fetchUrl = (callIndex = 0) => fetchMock.mock.calls[callIndex][0] as string
const fetchInit = (callIndex = 0) => fetchMock.mock.calls[callIndex][1] as RequestInit

beforeEach(() => {
  vi.clearAllMocks()
  preferenceGetMock.mockImplementation((key: string) => {
    if (key === 'feature.ragflow.api_url') return `${API_URL}/`
    if (key === 'feature.ragflow.api_key') return 'secret-key'
    throw new Error(`Unexpected preference key: ${key}`)
  })
})

describe('RagflowClient.testConnection', () => {
  it('calls the datasets endpoint from main with the configured bearer token', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ code: 0, data: [], total_datasets: 0 }))

    await expect(ragflowClient.testConnection()).resolves.toBeUndefined()

    expect(fetchUrl()).toBe(`${API_URL}/api/v1/datasets?page=1&page_size=1`)
    expect(fetchInit()).toMatchObject({ method: 'GET', redirect: 'manual' })
    expect(new Headers(fetchInit().headers).get('Authorization')).toBe('Bearer secret-key')
  })

  it.each([401, 403])('classifies HTTP %i as unauthorized', async (status) => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status }))

    await expect(ragflowClient.testConnection()).rejects.toMatchObject({ kind: 'UNAUTHORIZED', status })
  })

  it.each([500, 503])('classifies HTTP %i as unavailable', async (status) => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status }))

    await expect(ragflowClient.testConnection()).rejects.toMatchObject({ kind: 'UNAVAILABLE', status })
  })

  it('classifies network failures as unavailable without exposing the API key', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connect failed for secret-key'))

    const error = await ragflowClient.testConnection().catch((value) => value)

    expect(error).toBeInstanceOf(RagflowClientError)
    expect(error).toMatchObject({ kind: 'UNAVAILABLE' })
    expect(error.message).not.toContain('secret-key')
  })

  it('rejects incomplete configuration before making a request', async () => {
    preferenceGetMock.mockImplementation((key: string) => (key === 'feature.ragflow.api_url' ? 'ftp://localhost' : ''))

    await expect(ragflowClient.testConnection()).rejects.toMatchObject({ kind: 'CONFIG_INVALID' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('classifies invalid JSON as a malformed response', async () => {
    fetchMock.mockResolvedValueOnce({ status: 200, json: vi.fn().mockRejectedValue(new SyntaxError('invalid json')) })

    await expect(ragflowClient.testConnection()).rejects.toMatchObject({ kind: 'MALFORMED_RESPONSE', status: 200 })
  })

  it('rejects a response whose payload does not match the endpoint shape', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ code: 0, data: {} }))

    await expect(ragflowClient.testConnection()).rejects.toMatchObject({ kind: 'MALFORMED_RESPONSE' })
  })
})

describe('RagflowClient envelope handling', () => {
  it('surfaces the RagFlow message when HTTP 200 carries a non-zero code', async () => {
    // RagFlow reports logical failures — unknown dataset, missing field — this way.
    fetchMock.mockResolvedValueOnce(Response.json({ code: 102, message: "You don't own the dataset deadbeef." }))

    await expect(ragflowClient.testConnection()).rejects.toMatchObject({
      kind: 'REQUEST_FAILED',
      message: "You don't own the dataset deadbeef."
    })
  })

  it('falls back to the code when a failed envelope carries no message', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ code: 101 }))

    await expect(ragflowClient.testConnection()).rejects.toMatchObject({
      kind: 'REQUEST_FAILED',
      message: 'RagFlow returned code 101'
    })
  })
})

describe('RagflowClient.listDatasets', () => {
  it('trims a dataset payload to the fields the knowledge UI uses', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ code: 0, data: [DATASET_PAYLOAD], total_datasets: 4 }))

    const result = await ragflowClient.listDatasets({ page: 2, pageSize: 10, name: 'bidding' })

    expect(fetchUrl()).toBe(`${API_URL}/api/v1/datasets?page=2&page_size=10&name=bidding`)
    expect(result.total).toBe(4)
    expect(result.items).toEqual([
      {
        id: '8989b0fab8e011f1bdf4a90f31e75474',
        name: 'bidding-docs',
        description: null,
        documentCount: 1,
        chunkCount: 136,
        embeddingModel: 'text-embedding-v4@Qwen@Tongyi-Qianwen',
        similarityThreshold: 0.2,
        vectorSimilarityWeight: 0.3,
        createdAt: new Date(1790340994491).toISOString(),
        updatedAt: new Date(1790341074742).toISOString()
      }
    ])
  })

  it('counts the returned datasets when the total is absent', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ code: 0, data: [DATASET_PAYLOAD] }))

    await expect(ragflowClient.listDatasets()).resolves.toMatchObject({ total: 1 })
    expect(fetchUrl()).toBe(`${API_URL}/api/v1/datasets`)
  })

  it('accepts the 1.0 list row that omits create_time', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ code: 0, data: [{ ...DATASET_PAYLOAD, create_time: undefined }], total_datasets: 1 })
    )

    const { items } = await ragflowClient.listDatasets()

    expect(items[0].createdAt).toBe(new Date(DATASET_PAYLOAD.update_time).toISOString())
  })
})

describe('RagflowClient.listDocuments', () => {
  it('reads documents from inside data and canonicalizes the run state', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ code: 0, data: { docs: [DOCUMENT_PAYLOAD], total: 1 }, message: 'success' })
    )

    const result = await ragflowClient.listDocuments({ datasetId: 'ds-1', page: 1, pageSize: 50 })

    expect(fetchUrl()).toBe(`${API_URL}/api/v1/datasets/ds-1/documents?page=1&page_size=50`)
    expect(result.total).toBe(1)
    expect(result.items[0]).toMatchObject({
      id: '97986ddab8e011f1bdf4a90f31e75474',
      name: 'bid.docx',
      size: 1327966,
      chunkCount: 136,
      tokenCount: 20144,
      run: 'DONE',
      progress: 1,
      suffix: 'docx'
    })
  })

  it.each([
    ['3', 'DONE'],
    ['1', 'RUNNING'],
    ['fail', 'FAIL']
  ])('maps the legacy numeric run state %s to %s', async (run, expected) => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ code: 0, data: { docs: [{ ...DOCUMENT_PAYLOAD, run }], total: 1 } })
    )

    const { items } = await ragflowClient.listDocuments({ datasetId: 'ds-1' })

    expect(items[0].run).toBe(expected)
  })

  it.each([
    ['COMPLETED', 'DONE'],
    ['FAILED', 'FAIL'],
    ['RUNNING', 'RUNNING'],
    ['UNSTART', 'UNSTART']
  ])('reads the 1.0 ingestion status %s as %s', async (ingestionStatus, expected) => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        code: 0,
        data: { docs: [{ ...DOCUMENT_PAYLOAD, run: undefined, ingestion_status: ingestionStatus }], total: 1 }
      })
    )

    const { items } = await ragflowClient.listDocuments({ datasetId: 'ds-1' })

    expect(items[0].run).toBe(expected)
  })
})

describe('RagflowClient.listChunks', () => {
  it('reads the document name from docnm_kwd and defaults availability to true', async () => {
    const withoutAvailability: Record<string, unknown> = { ...STORED_CHUNK_PAYLOAD }
    delete withoutAvailability.available
    fetchMock.mockResolvedValueOnce(Response.json({ code: 0, data: { chunks: [withoutAvailability], total: 136 } }))

    const result = await ragflowClient.listChunks({ datasetId: 'ds-1', documentId: 'doc-1' })

    expect(fetchUrl()).toBe(`${API_URL}/api/v1/datasets/ds-1/documents/doc-1/chunks`)
    expect(result.items).toEqual([
      {
        id: '321dcf760c3cf1e5',
        content: 'The bidder shall submit two sealed envelopes.',
        documentId: '97986ddab8e011f1bdf4a90f31e75474',
        documentName: 'bid.docx',
        available: true
      }
    ])
  })

  it('accepts the raw engine rows of a 1.0 chunk list', async () => {
    const rawChunk = {
      _index: 'ragflow_tenant',
      available: true,
      chunk_id: '321dcf760c3cf1e5',
      content_with_weight: 'The bidder shall submit two sealed envelopes.',
      doc_type_kwd: 'image',
      docnm_kwd: 'bid.docx',
      image_id: ''
    }
    fetchMock.mockResolvedValueOnce(Response.json({ code: 0, data: { chunks: [rawChunk], total: 1 } }))

    const { items } = await ragflowClient.listChunks({ datasetId: 'ds-1', documentId: 'doc-1' })

    expect(items).toEqual([
      {
        id: '321dcf760c3cf1e5',
        content: 'The bidder shall submit two sealed envelopes.',
        documentId: 'doc-1',
        documentName: 'bid.docx',
        available: true
      }
    ])
  })
})

describe('RagflowClient.retrieve', () => {
  it('accepts the null message in a 1.0 success envelope', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ code: 0, data: { chunks: [RETRIEVAL_CHUNK_PAYLOAD] }, message: null })
    )

    const { items } = await ragflowClient.retrieve({ question: 'q', datasetIds: ['ds-1'] })

    expect(items[0].chunkId).toBe('6f91590e5e582332')
  })

  it('posts the retrieval body in RagFlow terms and returns similarity-ranked hits', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        code: 0,
        data: { chunks: [RETRIEVAL_CHUNK_PAYLOAD], doc_aggs: [], total: 6 }
      })
    )

    const result = await ragflowClient.retrieve({
      question: 'envelope requirements',
      datasetIds: ['ds-1'],
      pageSize: 5,
      similarityThreshold: 0.4
    })

    expect(fetchUrl()).toBe(`${API_URL}/api/v1/retrieval`)
    expect(fetchInit()).toMatchObject({ method: 'POST' })
    expect(new Headers(fetchInit().headers).get('Content-Type')).toBe('application/json')
    expect(JSON.parse(fetchInit().body as string)).toEqual({
      question: 'envelope requirements',
      dataset_ids: ['ds-1'],
      page_size: 5,
      similarity_threshold: 0.4
    })
    expect(result.total).toBe(6)
    expect(result.items).toEqual([
      {
        chunkId: '6f91590e5e582332',
        content: 'The bidder shall submit two sealed envelopes.',
        documentId: '97986ddab8e011f1bdf4a90f31e75474',
        documentName: 'bid.docx',
        similarity: 0.6081276995748497,
        vectorSimilarity: 0.6516532,
        termSimilarity: 0.5894739136783568
      }
    ])
  })

  it('carries the highlight through when RagFlow returns one', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ code: 0, data: { chunks: [{ ...RETRIEVAL_CHUNK_PAYLOAD, highlight: '<em>bidder</em>' }] } })
    )

    const { items } = await ragflowClient.retrieve({ question: 'q', datasetIds: ['ds-1'] })

    expect(items[0].highlight).toBe('<em>bidder</em>')
  })
})
