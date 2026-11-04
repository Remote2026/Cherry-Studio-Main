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
  // rc2 返回 parser_id；旧版可能是 chunk_method。
  parser_id: z.string().nullish(),
  chunk_method: z.string().nullish(),
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
  meta_fields: z.record(z.string(), z.unknown()).nullish(),
  progress_msg: z.string().nullish(),
  latest_ingestion_event: z.object({ message: z.string().nullish() }).nullish(),
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
    // PDF 位置：[[page, left, right, top, bottom], ...]。
    positions: z.array(z.array(z.number())).nullish(),
    position_int: z.array(z.array(z.number())).nullish(),
    doc_type_kwd: z.union([z.string(), z.array(z.string())]).nullish(),
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

const createdDatasetResponseSchema = z.object({
  data: z.object({ id: z.string(), name: z.string(), parser_id: z.string().nullish() })
})

const uploadedDocumentPayloadSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number().int().min(0).optional(),
  chunk_count: z.number().int().min(0).optional(),
  token_count: z.number().int().min(0).optional(),
  ingestion_status: z.string().nullish(),
  parser_id: z.string().nullish()
})

const uploadDocumentsResponseSchema = z.object({
  data: z.union([z.array(uploadedDocumentPayloadSchema), uploadedDocumentPayloadSchema])
})

const okResponseSchema = z.object({ data: z.unknown().optional() })

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
  const current = ingestionStatus?.toUpperCase()
  if (current) return RUN_STATES_BY_WORD[current] ?? 'UNSTART'
  const legacy = run?.toUpperCase()
  return legacy ? (RUN_STATES_BY_CODE[legacy] ?? RUN_STATES_BY_WORD[legacy] ?? 'UNSTART') : 'UNSTART'
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
  parserId: payload.parser_id ?? payload.chunk_method ?? null,
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
  metaFields: payload.meta_fields ?? null,
  progressMessage: payload.progress_msg ?? null,
  latestEventMessage: payload.latest_ingestion_event?.message ?? null,
  createdAt: toIsoTime(payload.create_time),
  updatedAt: toIsoTime(payload.update_time)
})

const toChunk = (payload: z.infer<typeof chunkPayloadSchema>, documentId: string): RagflowChunk => {
  const positions = payload.positions ?? payload.position_int ?? []
  const pages = [
    ...new Set(positions.map((position) => position[0]).filter((page) => Number.isFinite(page) && page > 0))
  ]
  const docType = Array.isArray(payload.doc_type_kwd)
    ? (payload.doc_type_kwd[0] ?? null)
    : (payload.doc_type_kwd ?? null)

  return {
    id: payload.id ?? payload.chunk_id ?? '',
    content: payload.content ?? payload.content_with_weight ?? '',
    // 1.0 的 chunk 列表不带 document_id，按请求的文档回填。
    documentId: payload.document_id ?? documentId,
    documentName: payload.docnm_kwd ?? payload.document_keyword ?? '',
    available: payload.available ?? true,
    ...(pages.length > 0 ? { pages } : {}),
    ...(docType ? { docType } : {})
  }
}

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
  signal?: AbortSignal
}

export type ListDocumentsInput = {
  datasetId: string
  page?: number
  pageSize?: number
  keywords?: string
  id?: string
  /** 按文档 metadata 过滤，例如 { fingerprint: '...' }。 */
  metadata?: Record<string, string>
  signal?: AbortSignal
}

export type CreateDatasetInput = {
  name: string
  /** 默认 general（PDF 走 DeepDOC；表格保留为 HTML chunk）。 */
  parserId?: string
  signal?: AbortSignal
}

export type CreatedDataset = {
  id: string
  name: string
  parserId: string | null
}

export type UploadDocumentInput = {
  datasetId: string
  filename: string
  content: Uint8Array
  signal?: AbortSignal
}

export type UploadedDocument = {
  id: string
  name: string
  size: number
  chunkCount: number
  tokenCount: number
}

export type UpdateDocumentMetadataInput = {
  datasetId: string
  documentId: string
  metaFields: Record<string, string>
  signal?: AbortSignal
}

export type StartParsingInput = {
  datasetId: string
  documentIds: string[]
  signal?: AbortSignal
}

export type FindDocumentInput = {
  datasetId: string
  documentId: string
  signal?: AbortSignal
}

export type ListChunksInput = {
  datasetId: string
  documentId: string
  page?: number
  pageSize?: number
  keywords?: string
  signal?: AbortSignal
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
  signal?: AbortSignal
}

export class RagflowClient {
  /** Verifies reachability and credentials with the cheapest authenticated call. */
  async testConnection(): Promise<void> {
    await this.listDatasets({ page: 1, pageSize: 1 })
  }

  async listDatasets(input: ListDatasetsInput = {}): Promise<{ items: RagflowDataset[]; total: number }> {
    const query = buildQuery({ page: input.page, page_size: input.pageSize, name: input.name })
    const payload = await this.request('GET', `/api/v1/datasets${query}`, datasetsResponseSchema, undefined, {
      signal: input.signal
    })
    return { items: payload.data.map(toDataset), total: payload.total_datasets ?? payload.data.length }
  }

  async listDocuments(input: ListDocumentsInput): Promise<{ items: RagflowDocument[]; total: number }> {
    const search = new URLSearchParams(
      buildQuery({ page: input.page, page_size: input.pageSize, keywords: input.keywords, id: input.id })
    )
    for (const [key, value] of Object.entries(input.metadata ?? {})) {
      search.set(`metadata[${key}]`, value)
    }
    const query = search.toString()
    const payload = await this.request(
      'GET',
      `/api/v1/datasets/${encodeURIComponent(input.datasetId)}/documents${query ? `?${query}` : ''}`,
      documentsResponseSchema,
      undefined,
      { signal: input.signal }
    )
    return { items: payload.data.docs.map(toDocument), total: payload.data.total ?? payload.data.docs.length }
  }

  /** 创建数据集；rc2 必须带 parse_type=1（BuiltIn）+ parser_id。 */
  async createDataset(input: CreateDatasetInput): Promise<CreatedDataset> {
    const payload = await this.request(
      'POST',
      '/api/v1/datasets',
      createdDatasetResponseSchema,
      { name: input.name, parse_type: 1, parser_id: input.parserId ?? 'general' },
      { signal: input.signal }
    )
    return { id: payload.data.id, name: payload.data.name, parserId: payload.data.parser_id ?? null }
  }

  /** 上传本地文件；multipart 字段固定为 file。 */
  async uploadDocument(input: UploadDocumentInput): Promise<UploadedDocument> {
    // 复制到独立的 ArrayBuffer，避免 SharedArrayBuffer 形态不满足 BlobPart 类型。
    const bytes = new Uint8Array(input.content.byteLength)
    bytes.set(input.content)
    const form = new FormData()
    form.append('file', new Blob([bytes.buffer]), input.filename)
    const payload = await this.request(
      'POST',
      `/api/v1/datasets/${encodeURIComponent(input.datasetId)}/documents?type=local`,
      uploadDocumentsResponseSchema,
      form,
      { timeoutMs: 120_000, signal: input.signal }
    )
    const document = Array.isArray(payload.data) ? payload.data[0] : payload.data
    if (!document) throw new RagflowClientError('MALFORMED_RESPONSE', 'RagFlow did not return the uploaded document')
    return {
      id: document.id,
      name: document.name,
      size: document.size ?? 0,
      chunkCount: document.chunk_count ?? 0,
      tokenCount: document.token_count ?? 0
    }
  }

  /** 修正空数据集的解析器（TemporaryKB 必须是 general）。 */
  async updateDatasetParser(input: { datasetId: string; parserId: string; signal?: AbortSignal }): Promise<void> {
    await this.request(
      'PUT',
      `/api/v1/datasets/${encodeURIComponent(input.datasetId)}`,
      okResponseSchema,
      { parser_id: input.parserId, parse_type: 1 },
      { signal: input.signal }
    )
  }

  /** 替换文档 metadata（rc2 的 PATCH 会覆盖整个 meta_fields）。 */
  async updateDocumentMetadata(input: UpdateDocumentMetadataInput): Promise<void> {
    await this.request(
      'PATCH',
      `/api/v1/datasets/${encodeURIComponent(input.datasetId)}/documents/${encodeURIComponent(input.documentId)}`,
      okResponseSchema,
      { meta_fields: input.metaFields },
      { signal: input.signal }
    )
  }

  /** 触发异步解析；返回的 success_count 不在这里解释。 */
  async startParsing(input: StartParsingInput): Promise<void> {
    await this.request(
      'POST',
      `/api/v1/datasets/${encodeURIComponent(input.datasetId)}/documents/parse`,
      okResponseSchema,
      { document_ids: input.documentIds },
      { timeoutMs: 30_000, signal: input.signal }
    )
  }

  /** 按 id 精确定位文档；不存在返回 null。 */
  async findDocument(input: FindDocumentInput): Promise<RagflowDocument | null> {
    try {
      const { items } = await this.listDocuments({
        datasetId: input.datasetId,
        id: input.documentId,
        pageSize: 100,
        signal: input.signal
      })
      return items.find((document) => document.id === input.documentId) ?? null
    } catch (error) {
      // rc2 对不存在/无权限的 id 返回 code 102 "you don't own the document ..."。
      if (
        error instanceof RagflowClientError &&
        error.kind === 'REQUEST_FAILED' &&
        /don't own|not found|does not exist/i.test(error.message)
      ) {
        return null
      }
      throw error
    }
  }

  async listChunks(input: ListChunksInput): Promise<{ items: RagflowChunk[]; total: number }> {
    const query = buildQuery({ page: input.page, page_size: input.pageSize, keywords: input.keywords })
    const path = `/api/v1/datasets/${encodeURIComponent(input.datasetId)}/documents/${encodeURIComponent(input.documentId)}/chunks${query}`
    const payload = await this.request('GET', path, chunksResponseSchema, undefined, { signal: input.signal })
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
    const payload = await this.request('POST', '/api/v1/retrieval', retrievalResponseSchema, body, {
      timeoutMs: 30_000,
      signal: input.signal
    })
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
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    schema: S,
    body?: Record<string, unknown> | FormData,
    options: { timeoutMs?: number; signal?: AbortSignal } = {}
  ): Promise<z.infer<S>> {
    const { apiKey, apiUrl } = this.getConfig()
    const isFormData = body instanceof FormData
    const timeout = AbortSignal.timeout(options.timeoutMs ?? RAGFLOW_REQUEST_TIMEOUT_MS)
    const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout
    let response: Response

    try {
      response = await net.fetch(`${apiUrl}${path}`, {
        body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
          ...(body === undefined || isFormData ? {} : { 'Content-Type': 'application/json' })
        },
        method,
        redirect: 'manual',
        signal
      })
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason ?? error
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
