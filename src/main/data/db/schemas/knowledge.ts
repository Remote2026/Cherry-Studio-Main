import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  integer,
  real,
  sqliteTable,
  text,
  unique,
  uniqueIndex
} from 'drizzle-orm/sqlite-core'

import {
  type KnowledgeBaseErrorCode,
  type KnowledgeBaseSource,
  type KnowledgeBaseStatus,
  type KnowledgeChunkStrategy,
  type KnowledgeItemData,
  type KnowledgeItemStatus,
  type KnowledgeItemType
} from '@shared/data/types/knowledge'

import { createUpdateTimestamps, uuidPrimaryKey, uuidPrimaryKeyOrdered } from './_columnHelpers'
import { groupTable } from './group'
import { userModelTable } from './userModel'

// Durable base metadata; per-base vector stores remain runtime artifacts.
export const knowledgeBaseTable = sqliteTable(
  'knowledge_base',
  {
    id: uuidPrimaryKey(),
    name: text().notNull(),
    source: text().$type<KnowledgeBaseSource>().notNull().default('local'),
    /** 所镜像的 RagFlow 数据集 id，当且仅当 `source` 为 `ragflow` 时非空。 */
    remoteId: text(),
    groupId: text().references(() => groupTable.id, { onDelete: 'set null' }),
    dimensions: integer(),

    embeddingModelId: text().references(() => userModelTable.id),

    status: text().$type<KnowledgeBaseStatus>().notNull(),
    error: text().$type<KnowledgeBaseErrorCode>(),

    // Preserve the base when an optional rerank model is removed.
    rerankModelId: text().references(() => userModelTable.id, { onDelete: 'set null' }),

    fileProcessorId: text(),

    chunkSize: integer().notNull(),
    chunkOverlap: integer().notNull(),
    chunkStrategy: text().$type<KnowledgeChunkStrategy>().notNull().default('structured'),
    chunkSeparator: text().notNull().default('\\n\\n'),
    threshold: real(),
    documentCount: integer(),

    ...createUpdateTimestamps
  },
  (t) => [
    check('knowledge_base_chunk_strategy_check', sql`${t.chunkStrategy} IN ('structured', 'delimiter')`),
    check('knowledge_base_status_check', sql`${t.status} IN ('completed', 'failed')`),
    check('knowledge_base_source_check', sql`${t.source} IN ('local', 'ragflow')`),
    // 把来源标记和它蕴含的 identity 绑在一起，防止两者漂移。
    check('knowledge_base_source_remote_id_check', sql`(${t.source} = 'ragflow') = (${t.remoteId} IS NOT NULL)`),
    // 一个数据集最多镜像成一个库；本地库的 remote_id 为 NULL，在 UNIQUE 下互不冲突。
    uniqueIndex('knowledge_base_source_remote_id_unique').on(t.source, t.remoteId),
    check(
      'knowledge_base_status_error_check',
      sql`
        (
          ${t.status} = 'completed'
          AND ${t.error} IS NULL
          AND (
            (
              ${t.embeddingModelId} IS NOT NULL
              AND ${t.dimensions} IS NOT NULL
              AND ${t.dimensions} > 0
            )
            OR (
              ${t.embeddingModelId} IS NULL
              AND ${t.dimensions} IS NULL
            )
          )
        )
        OR (
          ${t.status} = 'failed'
          AND ${t.error} IS NOT NULL
          AND length(trim(${t.error})) > 0
        )
      `
    )
  ]
)

// User-added sources and expanded import children; chunks/embeddings live in the vector store.
export const knowledgeItemTable = sqliteTable(
  'knowledge_item',
  {
    id: uuidPrimaryKeyOrdered(),
    baseId: text()
      .notNull()
      .references(() => knowledgeBaseTable.id, { onDelete: 'cascade' }),

    // The composite self-FK below keeps expanded children in the owner's base.
    groupId: text(),

    type: text().$type<KnowledgeItemType>().notNull(),

    /** 所镜像的 RagFlow 文档 id，只在该条目是 `ragflow` 类型时非空。 */
    remoteId: text(),

    data: text({ mode: 'json' }).$type<KnowledgeItemData>().notNull(),

    status: text().$type<KnowledgeItemStatus>().notNull(),
    error: text(),

    ...createUpdateTimestamps
  },
  (t) => [
    check('knowledge_item_type_check', sql`${t.type} IN ('file', 'url', 'note', 'directory', 'ragflow')`),
    check(
      'knowledge_item_status_check',
      sql`${t.status} IN ('idle', 'preparing', 'processing', 'reading', 'embedding', 'completed', 'failed', 'deleting')`
    ),
    check(
      'knowledge_item_type_status_check',
      sql`
        (${t.type} IN ('file', 'url', 'note') AND ${t.status} IN ('idle', 'processing', 'reading', 'embedding', 'completed', 'failed', 'deleting'))
        OR (${t.type} = 'directory' AND ${t.status} IN ('idle', 'preparing', 'processing', 'completed', 'failed', 'deleting'))
        OR (${t.type} = 'ragflow' AND ${t.status} IN ('idle', 'processing', 'completed', 'failed'))
      `
    ),
    // 没有这个配对，镜像行就无法从检索命中的文档 id 反查回来。
    check('knowledge_item_type_remote_id_check', sql`(${t.type} = 'ragflow') = (${t.remoteId} IS NOT NULL)`),
    // 一个文档最多镜像成一条；本地条目的 remote_id 为 NULL，在 UNIQUE 下互不冲突。
    uniqueIndex('knowledge_item_remote_id_unique').on(t.remoteId),
    check(
      'knowledge_item_status_error_check',
      sql`
        (
          ${t.status} IN ('idle', 'preparing', 'processing', 'reading', 'embedding', 'completed', 'deleting')
          AND ${t.error} IS NULL
        )
        OR (
          ${t.status} = 'failed'
          AND ${t.error} IS NOT NULL
          AND length(trim(${t.error})) > 0
        )
      `
    ),
    // Deletes expanded children when their group-owner item is deleted.
    foreignKey({ columns: [t.baseId, t.groupId], foreignColumns: [t.baseId, t.id] }).onDelete('cascade'),
    // Supports list queries by base/type with stable creation ordering.
    index('knowledge_item_base_type_created_idx').on(t.baseId, t.type, t.createdAt),
    // Supports fetches of all children for a group owner inside a base.
    index('knowledge_item_base_group_created_idx').on(t.baseId, t.groupId, t.createdAt),
    // Required target for the composite self-reference above.
    unique('knowledge_item_baseId_id_unique').on(t.baseId, t.id)
  ]
)
