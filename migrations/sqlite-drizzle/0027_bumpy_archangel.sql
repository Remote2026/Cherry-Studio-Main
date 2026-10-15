PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_knowledge_item` (
	`id` text PRIMARY KEY NOT NULL,
	`base_id` text NOT NULL,
	`group_id` text,
	`type` text NOT NULL,
	`remote_id` text,
	`data` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`base_id`) REFERENCES `knowledge_base`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`base_id`,`group_id`) REFERENCES `knowledge_item`(`base_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "knowledge_item_type_check" CHECK("__new_knowledge_item"."type" IN ('file', 'url', 'note', 'directory', 'ragflow')),
	CONSTRAINT "knowledge_item_status_check" CHECK("__new_knowledge_item"."status" IN ('idle', 'preparing', 'processing', 'reading', 'embedding', 'completed', 'failed', 'deleting')),
	CONSTRAINT "knowledge_item_type_status_check" CHECK(
        ("__new_knowledge_item"."type" IN ('file', 'url', 'note') AND "__new_knowledge_item"."status" IN ('idle', 'processing', 'reading', 'embedding', 'completed', 'failed', 'deleting'))
        OR ("__new_knowledge_item"."type" = 'directory' AND "__new_knowledge_item"."status" IN ('idle', 'preparing', 'processing', 'completed', 'failed', 'deleting'))
        OR ("__new_knowledge_item"."type" = 'ragflow' AND "__new_knowledge_item"."status" IN ('idle', 'processing', 'completed', 'failed'))
      ),
	CONSTRAINT "knowledge_item_type_remote_id_check" CHECK(("__new_knowledge_item"."type" = 'ragflow') = ("__new_knowledge_item"."remote_id" IS NOT NULL)),
	CONSTRAINT "knowledge_item_status_error_check" CHECK(
        (
          "__new_knowledge_item"."status" IN ('idle', 'preparing', 'processing', 'reading', 'embedding', 'completed', 'deleting')
          AND "__new_knowledge_item"."error" IS NULL
        )
        OR (
          "__new_knowledge_item"."status" = 'failed'
          AND "__new_knowledge_item"."error" IS NOT NULL
          AND length(trim("__new_knowledge_item"."error")) > 0
        )
      )
);
--> statement-breakpoint
-- 手改，每次 `db:migrations:generate` 后都要重做：旧 `knowledge_item` 没有 `remote_id` 列，
-- drizzle 生成的 `SELECT "remote_id"` 无法执行。存量行都早于镜像功能，一律按本地条目处理。
-- 漏掉这里会在 PREPARE 阶段就报错（空表也一样），由 `applyMigrations.populated.test.ts` 兜住。
INSERT INTO `__new_knowledge_item`("id", "base_id", "group_id", "type", "remote_id", "data", "status", "error", "created_at", "updated_at") SELECT "id", "base_id", "group_id", "type", NULL, "data", "status", "error", "created_at", "updated_at" FROM `knowledge_item`;--> statement-breakpoint
DROP TABLE `knowledge_item`;--> statement-breakpoint
ALTER TABLE `__new_knowledge_item` RENAME TO `knowledge_item`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_item_remote_id_unique` ON `knowledge_item` (`remote_id`);--> statement-breakpoint
CREATE INDEX `knowledge_item_base_type_created_idx` ON `knowledge_item` (`base_id`,`type`,`created_at`);--> statement-breakpoint
CREATE INDEX `knowledge_item_base_group_created_idx` ON `knowledge_item` (`base_id`,`group_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_item_baseId_id_unique` ON `knowledge_item` (`base_id`,`id`);--> statement-breakpoint
CREATE TABLE `__new_knowledge_base` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`source` text DEFAULT 'local' NOT NULL,
	`remote_id` text,
	`group_id` text,
	`dimensions` integer,
	`embedding_model_id` text,
	`status` text NOT NULL,
	`error` text,
	`rerank_model_id` text,
	`file_processor_id` text,
	`chunk_size` integer NOT NULL,
	`chunk_overlap` integer NOT NULL,
	`chunk_strategy` text DEFAULT 'structured' NOT NULL,
	`chunk_separator` text DEFAULT '\n\n' NOT NULL,
	`threshold` real,
	`document_count` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`embedding_model_id`) REFERENCES `user_model`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rerank_model_id`) REFERENCES `user_model`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "knowledge_base_chunk_strategy_check" CHECK("__new_knowledge_base"."chunk_strategy" IN ('structured', 'delimiter')),
	CONSTRAINT "knowledge_base_status_check" CHECK("__new_knowledge_base"."status" IN ('completed', 'failed')),
	CONSTRAINT "knowledge_base_source_check" CHECK("__new_knowledge_base"."source" IN ('local', 'ragflow')),
	CONSTRAINT "knowledge_base_source_remote_id_check" CHECK(("__new_knowledge_base"."source" = 'ragflow') = ("__new_knowledge_base"."remote_id" IS NOT NULL)),
	CONSTRAINT "knowledge_base_status_error_check" CHECK(
        (
          "__new_knowledge_base"."status" = 'completed'
          AND "__new_knowledge_base"."error" IS NULL
          AND (
            (
              "__new_knowledge_base"."embedding_model_id" IS NOT NULL
              AND "__new_knowledge_base"."dimensions" IS NOT NULL
              AND "__new_knowledge_base"."dimensions" > 0
            )
            OR (
              "__new_knowledge_base"."embedding_model_id" IS NULL
              AND "__new_knowledge_base"."dimensions" IS NULL
            )
          )
        )
        OR (
          "__new_knowledge_base"."status" = 'failed'
          AND "__new_knowledge_base"."error" IS NOT NULL
          AND length(trim("__new_knowledge_base"."error")) > 0
        )
      )
);
--> statement-breakpoint
-- 手改，每次 `db:migrations:generate` 后都要重做：旧 `knowledge_base` 既无 `source` 也无
-- `remote_id`，drizzle 生成的 `SELECT "source", "remote_id"` 无法执行。存量库全是本地库，
-- 与本迁移给新行设的 DEFAULT 一致。漏掉这里会在 PREPARE 阶段就报错（空表也一样）。
INSERT INTO `__new_knowledge_base`("id", "name", "source", "remote_id", "group_id", "dimensions", "embedding_model_id", "status", "error", "rerank_model_id", "file_processor_id", "chunk_size", "chunk_overlap", "chunk_strategy", "chunk_separator", "threshold", "document_count", "created_at", "updated_at") SELECT "id", "name", 'local', NULL, "group_id", "dimensions", "embedding_model_id", "status", "error", "rerank_model_id", "file_processor_id", "chunk_size", "chunk_overlap", "chunk_strategy", "chunk_separator", "threshold", "document_count", "created_at", "updated_at" FROM `knowledge_base`;--> statement-breakpoint
DROP TABLE `knowledge_base`;--> statement-breakpoint
ALTER TABLE `__new_knowledge_base` RENAME TO `knowledge_base`;--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_base_source_remote_id_unique` ON `knowledge_base` (`source`,`remote_id`);