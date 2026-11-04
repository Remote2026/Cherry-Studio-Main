/** 标书附件专用 RagFlow 数据集：固定名称，导入知识库时必须隐藏。 */
export const TEMPORARY_KB_NAME = 'TemporaryKB'

export const RAGFLOW_HIDDEN_DATASET_NAMES: ReadonlySet<string> = new Set([TEMPORARY_KB_NAME])

export const isVisibleRagflowDataset = (dataset: { name: string }): boolean =>
  !RAGFLOW_HIDDEN_DATASET_NAMES.has(dataset.name)
