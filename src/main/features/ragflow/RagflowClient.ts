import { net } from 'electron'
import * as z from 'zod'

import { application } from '@application'
import type { ragflowErrorCodes } from '@shared/ipc/errors/ragflow'
import type {
  RagflowChunk,
  RagflowDataset,
  RagflowDocument,
  RagflowRetrievalHit,
  RagflowRunState
} from '@shared/ipc/schemas/ragflow'

const RAGFLOW_REQUEST_TIMEOUT_MS = 10_000

// RagFlow's own documented defaults, used when a payload omits the field.
const DEFAULT_SIMILARITY_THRESHOLD = 0.2
const DEFAULT_VECTOR_SIMILARITY_WEIGHT = 0.3

type RagflowConfig = {
  apiKey: string
  apiUrl: string
}

export type RagflowErrorKind = keyof typeof ragflowErrorCodes

export class RagflowClientError extends Error {
  readonly kind: RagflowErrorKind
  readonly status?: number

  constructor(kind: RagflowErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'RagflowClientError'
    this.kind = kind
    this.status = status
  }
}

/**
 * RagFlow answers a failed call with HTTP 200 and a non-zero `code` in the body,
 * so the envelope is the only place a logical failure is visible.
 */
const envelopeSchema = z.object({
  code: z.number(),
  // 1.0 无消息时回 "message": null，旧版是字符串或缺省。
  message: z.string().nullish(),
  data: z.unknown().optional()
})

const datasetPayloadSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  document_count: z.number().int().min(0),
  chunk_count: z.number().int().min(0),
  embedding_model: z.string().nullish(),
  similarity_threshold: z.number().nullish(),
  vector_similarity_weight: z.number().nullish(),
  // 1.0 的数据集列表不再返回 create_time，只在数据集详情里给。
  create_time: z.number().nullish(),
  update_time: z.number()
})

const documentPayloadSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number().int().min(0).optional(),
  chunk_count: z.number().int().min(0).optional(),
  token_count: z.number().int().min(0).optional(),
  // 1.0 的文档列表用 ingestion_status 表达解析状态，不再返回 run。
  run: z.string().nullish(),
  ingestion_status: z.string().nullish(),
  progress: z.number().optional(),
  suffix: z.string().optional(),
  create_time: z.number(),
  update_time: z.number()
})

/** List-chunks reports the document name as `docnm_kwd`; retrieval as `document_keyword`. */
// 1.0 的 chunk 列表给的是引擎原始字段：chunk_id / content_with_weight，且不带 document_id。
const chunkPayloadSchema = z
  .object({
    id: z.string().nullish(),
    chunk_id: z.string().nullish(),
    content: z.string().nullish(),
    content_with_weight: z.string().nullish(),
    document_id: z.string().nullish(),
    docnm_kwd: z.string().optional(),
    document_keyword: z.string().optional(),
    available: z.boolean().optional(),
    similarity: z.number().optional(),
    vector_similarity: z.number().optional(),
    term_similarity: z.number().optional(),
    highlight: z.string().optional()
  })
  .refine((chunk) => (chunk.id ?? chunk.chunk_id) !== undefined, { message: 'chunk id is missing' })
  .refine((chunk) => (chunk.content ?? chunk.content_with_weight) !== undefined, {
    message: 'chunk content is missing'
  })

const datasetsResponseSchema = z.object({
  data: z.array(datasetPayloadSchema),
  total_datasets: z.number().int().min(0).optional()
})

const documentsResponseSchema = z.object({
  data: z.object({ docs: z.array(documentPayloadSchema), total: z.number().int().min(0).optional() })
})

const chunksResponseSchema = z.object({
  data: z.object({ chunks: z.array(chunkPayloadSchema), total: z.number().int().min(0).optional() })
})

const retrievalResponseSchema = z.object({
  data: z.object({ chunks: z.array(chunkPayloadSchema), total: z.number().int().min(0).optional() })
})

// Older RagFlow builds report the run state as the numeric status code.
const RUN_STATES_BY_CODE: Record<string, RagflowRunState> = {
  '0': 'UNSTART',
  '1': 'RUNNING',
  '2': 'CANCEL',
  '3': 'DONE',
  '4': 'FAIL'
}

// 1.0 把解析状态搬到 ingestion_status，词汇表也从 DONE/FAIL 变成 COMPLETED/FAILED 等。
const RUN_STATES_BY_WORD: Record<string, RagflowRunState> = {
  UNSTART: 'UNSTART',
  CREATED: 'UNSTART',
  SCHEDULED: 'UNSTART',
  RUNNING: 'RUNNING',
  STOPPING: 'RUNNING',
  STOPPED: 'CANCEL',
  COMPLETED: 'DONE',
  DONE: 'DONE',
  FAILED: 'FAIL',
  FAIL: 'FAIL',
  CANCEL: 'CANCEL',
  CANCELED: 'CANCEL'
}

const toRunState = (run: string | null | undefined, ingestionStatus: string | null | undefined): RagflowRunState => {
  const legacy = run?.toUpperCase()
  if (legacy) return RUN_STATES_BY_CODE[legacy] ?? RUN_STATES_BY_WORD[legacy] ?? 'UNSTART'
  return RUN_STATES_BY_WORD[ingestionStatus?.toUpperCase() ?? ''] ?? 'UNSTART'
}

const toIsoTime = (epochMs: number): string => new Date(epochMs).toISOString()

const toDataset = (payload: z.infer<typeof datasetPayloadSchema>): RagflowDataset => ({
  id: payload.id,
  name: payload.name,
  description: payload.description ?? null,
  documentCount: payload.document_count,
  chunkCount: payload.chunk_count,
  embeddingModel: payload.embedding_model ?? '',
  similarityThreshold: payload.similarity_threshold ?? DEFAULT_SIMILARITY_THRESHOLD,
  vectorSimilarityWeight: payload.vector_similarity_weight ?? DEFAULT_VECTOR_SIMILARITY_WEIGHT,
  // 列表缺 create_time 时用 update_time 兜底。
  createdAt: toIsoTime(payload.create_time ?? payload.update_time),
  updatedAt: toIsoTime(payload.update_time)
})

const toDocument = (payload: z.infer<typeof documentPayloadSchema>): RagflowDocument => ({
  id: payload.id,
  name: payload.name,
  size: payload.size ?? 0,
  chunkCount: payload.chunk_count ?? 0,
  tokenCount: payload.token_count ?? 0,
  run: toRunState(payload.run, payload.ingestion_status),
  progress: payload.progress ?? 0,
  suffix: payload.suffix ?? '',
  createdAt: toIsoTime(payload.create_time),
  updatedAt: toIsoTime(payload.update_time)
})

const toChunk = (payload: z.infer<typeof chunkPayloadSchema>, documentId: string): RagflowChunk => ({
  id: payload.id ?? payload.chunk_id ?? '',
  content: payload.content ?? payload.content_with_weight ?? '',
  // 1.0 的 chunk 列表不带 document_id，按请求的文档回填。
  documentId: payload.document_id ?? documentId,
  documentName: payload.docnm_kwd ?? payload.document_keyword ?? '',
  available: payload.available ?? true
})

const toRetrievalHit = (payload: z.infer<typeof chunkPayloadSchema>): RagflowRetrievalHit => ({
  chunkId: payload.id ?? payload.chunk_id ?? '',
  content: payload.content ?? payload.content_with_weight ?? '',
  documentId: payload.document_id ?? '',
  documentName: payload.docnm_kwd ?? payload.document_keyword ?? '',
  similarity: payload.similarity ?? 0,
  vectorSimilarity: payload.vector_similarity ?? 0,
  termSimilarity: payload.term_similarity ?? 0,
  ...(payload.highlight === undefined ? {} : { highlight: payload.highlight })
})

type QueryValue = string | number | boolean | undefined

const buildQuery = (params: Record<string, QueryValue>): string => {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value))
  }
  const query = search.toString()
  return query ? `?${query}` : ''
}

export type ListDatasetsInput = {
  page?: number
  pageSize?: number
  name?: string
}

export type ListDocumentsInput = {
  datasetId: string
  page?: number
  pageSize?: number
  keywords?: string
}

export type ListChunksInput = {
  datasetId: string
  documentId: string
  page?: number
  pageSize?: number
  keywords?: string
}

export type RetrieveInput = {
  question: string
  datasetIds: string[]
  page?: number
  pageSize?: number
  similarityThreshold?: number
  vectorSimilarityWeight?: number
  topK?: number
  rerankId?: string
  keyword?: boolean
  highlight?: boolean
}

export class RagflowClient {
  /** Verifies reachability and credentials with the cheapest authenticated call. */
  async testConnection(): Promise<void> {
    await this.listDatasets({ page: 1, pageSize: 1 })
  }

  async listDatasets(input: ListDatasetsInput = {}): Promise<{ items: RagflowDataset[]; total: number }> {
    const query = buildQuery({ page: input.page, page_size: input.pageSize, name: input.name })
    const payload = await this.request('GET', `/api/v1/datasets${query}`, datasetsResponseSchema)
    return { items: payload.data.map(toDataset), total: payload.total_datasets ?? payload.data.length }
  }

  async listDocuments(input: ListDocumentsInput): Promise<{ items: RagflowDocument[]; total: number }> {
    const query = buildQuery({ page: input.page, page_size: input.pageSize, keywords: input.keywords })
    const payload = await this.request(
      'GET',
      `/api/v1/datasets/${encodeURIComponent(input.datasetId)}/documents${query}`,
      documentsResponseSchema
    )
    return { items: payload.data.docs.map(toDocument), total: payload.data.total ?? payload.data.docs.length }
  }

  async listChunks(input: ListChunksInput): Promise<{ items: RagflowChunk[]; total: number }> {
    const query = buildQuery({ page: input.page, page_size: input.pageSize, keywords: input.keywords })
    const path = `/api/v1/datasets/${encodeURIComponent(input.datasetId)}/documents/${encodeURIComponent(input.documentId)}/chunks${query}`
    const payload = await this.request('GET', path, chunksResponseSchema)
    return {
      items: payload.data.chunks.map((chunk) => toChunk(chunk, input.documentId)),
      total: payload.data.total ?? payload.data.chunks.length
    }
  }

  async retrieve(input: RetrieveInput): Promise<{ items: RagflowRetrievalHit[]; total: number }> {
    const body = {
      question: input.question,
      dataset_ids: input.datasetIds,
      page: input.page,
      page_size: input.pageSize,
      similarity_threshold: input.similarityThreshold,
      vector_similarity_weight: input.vectorSimilarityWeight,
      top_k: input.topK,
      rerank_id: input.rerankId,
      keyword: input.keyword,
      highlight: input.highlight
    }
    const payload = await this.request('POST', '/api/v1/retrieval', retrievalResponseSchema, body)
    return { items: payload.data.chunks.map(toRetrievalHit), total: payload.data.total ?? payload.data.chunks.length }
  }

  private getConfig(): RagflowConfig {
    const preferenceService = application.get('PreferenceService')
    const apiUrl = preferenceService.get('feature.ragflow.api_url').trim().replace(/\/+$/, '')
    const apiKey = preferenceService.get('feature.ragflow.api_key').trim()

    try {
      const url = new URL(apiUrl)
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || !apiKey) throw new Error()
    } catch {
      throw new RagflowClientError('CONFIG_INVALID', 'RagFlow configuration is invalid')
    }

    return { apiKey, apiUrl }
  }

  private async request<S extends z.ZodType>(
    method: 'GET' | 'POST',
    path: string,
    schema: S,
    body?: Record<string, unknown>
  ): Promise<z.infer<S>> {
    const { apiKey, apiUrl } = this.getConfig()
    let response: Response

    try {
      response = await net.fetch(`${apiUrl}${path}`, {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
        method,
        redirect: 'manual',
        signal: AbortSignal.timeout(RAGFLOW_REQUEST_TIMEOUT_MS)
      })
    } catch {
      throw new RagflowClientError('UNAVAILABLE', 'RagFlow service is unavailable')
    }

    if (response.status === 401 || response.status === 403) {
      throw new RagflowClientError('UNAUTHORIZED', 'RagFlow rejected the API key', response.status)
    }

    if (response.status >= 300) {
      throw new RagflowClientError(
        response.status >= 500 ? 'UNAVAILABLE' : 'REQUEST_FAILED',
        response.status >= 500
          ? 'RagFlow service is unavailable'
          : `RagFlow request failed with HTTP ${response.status}`,
        response.status
      )
    }

    let parsed: unknown
    try {
      parsed = await response.json()
    } catch {
      throw new RagflowClientError('MALFORMED_RESPONSE', 'RagFlow returned an invalid response', response.status)
    }

    const envelope = envelopeSchema.safeParse(parsed)
    if (!envelope.success) {
      throw new RagflowClientError('MALFORMED_RESPONSE', 'RagFlow returned an invalid response', response.status)
    }

    if (envelope.data.code !== 0) {
      // RagFlow's own message is the actionable part (missing field, unknown
      // dataset, validation detail) — surface it instead of the bare code.
      throw new RagflowClientError(
        'REQUEST_FAILED',
        envelope.data.message ?? `RagFlow returned code ${envelope.data.code}`,
        response.status
      )
    }

    // The schema describes the body, not just `data`: RagFlow puts counts like
    // `total_datasets` beside `data` rather than inside it.
    const result = schema.safeParse(parsed)
    if (!result.success) {
      throw new RagflowClientError('MALFORMED_RESPONSE', 'RagFlow returned an invalid response', response.status)
    }
    return result.data
  }
}

export const ragflowClient = new RagflowClient()
