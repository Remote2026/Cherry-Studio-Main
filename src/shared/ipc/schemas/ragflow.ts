import * as z from 'zod'

import { defineRoute } from '../define'

/**
 * RagFlow documents report processing state either as a word or as the numeric
 * code from older builds; the client canonicalizes both into this union.
 */
export const RagflowRunStateSchema = z.enum(['UNSTART', 'RUNNING', 'CANCEL', 'DONE', 'FAIL'])
export type RagflowRunState = z.infer<typeof RagflowRunStateSchema>

/** A RagFlow dataset, trimmed to the fields the knowledge UI consumes. */
export const RagflowDatasetSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  documentCount: z.number().int().min(0),
  chunkCount: z.number().int().min(0),
  embeddingModel: z.string(),
  similarityThreshold: z.number(),
  vectorSimilarityWeight: z.number(),
  /** rc2 返回 parser_id（如 general/book）；旧版可能是 chunk_method。 */
  parserId: z.string().nullable().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})
export type RagflowDataset = z.infer<typeof RagflowDatasetSchema>

/** A RagFlow document (one knowledge item on the Cherry side). */
export const RagflowDocumentSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number().int().min(0),
  chunkCount: z.number().int().min(0),
  tokenCount: z.number().int().min(0),
  run: RagflowRunStateSchema,
  progress: z.number(),
  suffix: z.string(),
  /** 文档 metadata，用于 fingerprint 去重。 */
  metaFields: z.record(z.string(), z.unknown()).nullable().optional(),
  progressMessage: z.string().nullable().optional(),
  latestEventMessage: z.string().nullable().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})
export type RagflowDocument = z.infer<typeof RagflowDocumentSchema>

/** A stored chunk of a document, as listed by the chunk drill-down. */
export const RagflowChunkSchema = z.object({
  id: z.string(),
  content: z.string(),
  documentId: z.string(),
  documentName: z.string(),
  available: z.boolean(),
  /** PDF 页码（来自 positions 的首个元素），DOCX 为空。 */
  pages: z.array(z.number().int().positive()).optional(),
  /** RagFlow 内容类型：text/table/image 等。 */
  docType: z.string().nullable().optional()
})
export type RagflowChunk = z.infer<typeof RagflowChunkSchema>

/**
 * One retrieval hit. RagFlow reports no chunk ordinal and no token count, so a
 * hit carries neither; callers derive display order from array position.
 */
export const RagflowRetrievalHitSchema = z.object({
  chunkId: z.string(),
  content: z.string(),
  documentId: z.string(),
  documentName: z.string(),
  similarity: z.number(),
  vectorSimilarity: z.number(),
  termSimilarity: z.number(),
  highlight: z.string().optional()
})
export type RagflowRetrievalHit = z.infer<typeof RagflowRetrievalHitSchema>

const pageSchema = z.number().int().min(1).optional()
const pageSizeSchema = z.number().int().min(1).max(100).optional()

export const ragflowRequestSchemas = {
  'ragflow.test_connection': defineRoute({ input: z.void(), output: z.void() }),

  /** 把选中的数据集聚合成本地镜像库；已导入的按远端 id 命中并刷新。 */
  'ragflow.import_datasets': defineRoute({
    input: z.object({ datasetIds: z.array(z.string().min(1)).min(1) }),
    output: z.void()
  }),

  /** 刷新全部已导入的镜像库，并清掉远端已不存在的数据集与文档。 */
  'ragflow.sync': defineRoute({ input: z.void(), output: z.void() }),

  'ragflow.list_datasets': defineRoute({
    input: z.object({
      name: z.string().trim().min(1).optional(),
      page: pageSchema,
      pageSize: pageSizeSchema
    }),
    output: z.object({ items: z.array(RagflowDatasetSchema), total: z.number().int().min(0) })
  }),

  'ragflow.list_documents': defineRoute({
    input: z.object({
      datasetId: z.string().min(1),
      keywords: z.string().trim().min(1).optional(),
      page: pageSchema,
      pageSize: pageSizeSchema
    }),
    output: z.object({ items: z.array(RagflowDocumentSchema), total: z.number().int().min(0) })
  }),

  'ragflow.list_chunks': defineRoute({
    input: z.object({
      datasetId: z.string().min(1),
      documentId: z.string().min(1),
      keywords: z.string().trim().min(1).optional(),
      page: pageSchema,
      pageSize: pageSizeSchema
    }),
    output: z.object({ items: z.array(RagflowChunkSchema), total: z.number().int().min(0) })
  }),

  'ragflow.retrieve': defineRoute({
    input: z.object({
      question: z.string().trim().min(1),
      datasetIds: z.array(z.string().min(1)).min(1),
      page: pageSchema,
      pageSize: pageSizeSchema,
      similarityThreshold: z.number().min(0).max(1).optional(),
      vectorSimilarityWeight: z.number().min(0).max(1).optional(),
      topK: z.number().int().min(1).optional(),
      rerankId: z.string().min(1).optional(),
      keyword: z.boolean().optional(),
      highlight: z.boolean().optional()
    }),
    output: z.object({ items: z.array(RagflowRetrievalHitSchema), total: z.number().int().min(0) })
  })
}
