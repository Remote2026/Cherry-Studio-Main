# RagFlow 知识库对接

## 已定方案

- RagFlow 作为远程知识库提供方。
- Cherry Studio 不另行构建、也不保存第二份本地 RagFlow 知识库。
- 文档解析、分块、embedding、向量存储、检索、重排全部由 RagFlow 负责。
- Cherry Studio 保留自己的应用 SQLite 库，用于存聊天、助手、偏好与集成配置。
- 第一阶段保持本地知识库能力不变，仅在 RagFlow 类型的知识库上绕过本地链路。

## 待办事项

### 0. 仓库基线

- [x] 配置可用的 GPG 签名环境。
- [x] 用 `git commit -S --signoff` 提交仓库基线。
- [x] 确认提交同时带有 `gpgsig` 与 `Signed-off-by`。

### 1. RagFlow 配置界面

- [x] 在应用设置区域下新增面向用户的 RagFlow 设置页。
- [x] 新增服务地址输入框，初始默认值为 `http://localhost`。
- [x] 新增 API Key 密码框，支持显示/隐藏切换。
- [x] 新增保存操作。
- [x] 新增连接测试操作，走主进程 RagFlow 客户端。
- [x] 对无效 URL 与空 API Key 给出明确校验提示。
- [x] 对连接失败、未授权、RagFlow 服务不可用给出可操作的错误提示。
- [x] 打开页面时加载已保存的配置。
- [x] API Key 不得进入 renderer 网络请求、日志、导出与错误消息。
- [x] 通过既有的应用偏好/配置边界存储配置。
- [x] 确保 API Key 在诊断信息与配置序列化输出中被脱敏。

### 2. RagFlow API 客户端

- [x] 用已配置的服务地址与 API Key 实现主进程 RagFlow 客户端。
- [x] 支持 `GET /api/v1/datasets` 列出数据集。
- [x] 支持 `GET /api/v1/datasets/{id}/documents` 列出文档。
- [x] 支持 `POST /api/v1/retrieval` 用于召回测试与聊天检索。
- [x] 由主进程发送 `Authorization: Bearer <RAGFLOW_API_KEY>`。
- [x] 把 RagFlow 响应归一化为既有的知识库结果与引用结构。
- [x] 统一处理 HTTP 错误、响应格式异常、超时与服务不可用。

### 3. 复用知识库界面

- [x] 在既有知识库流程中加入 RagFlow/本地的知识源选择器。
- [x] 复用现有知识库列表界面展示 RagFlow 数据集。
- [x] 复用现有数据源界面展示 RagFlow 文档。
- [x] 复用召回测试界面调用 RagFlow 检索。
- [x] 展示文档名、内容片段、得分与来源元数据。
- [x] 对 RagFlow 数据集隐藏本地 embedding、分块、索引与本地上传控件。
- [x] 第一阶段 RagFlow 数据集管理保持只读，文档在 RagFlow 侧管理。
  - 例外：标书分析附件会由主进程上传到 `TemporaryKB`（`parser_id=general`）；知识库 UI 的只读边界不变。

### 4. 聊天与助手集成

- [x] 为 `local` 与 `ragflow` 增加显式的知识源标记。
- [x] 把选中的 RagFlow 数据集 ID 持久化到对应的助手/聊天配置。
- [x] 把 RagFlow 类型的检索路由到 RagFlow 检索端点。
- [x] 复用现有的知识库结果、引用与消息渲染组件。
- [x] 确保切换选中的数据集会改变检索范围。
- [x] 防止 RagFlow 数据集 ID 被传给本地 `KnowledgeService`。

### 5. 本地 RAG 边界

- [x] RagFlow 类型的知识库不调用本地 embedding 模型。
- [x] RagFlow 类型的知识库不创建、不更新本地 `index.sqlite` 与向量记录。
- [x] 保留应用 SQLite，因为其中存有其它 Cherry Studio 业务数据。
- [x] 在类生产使用中验证 RagFlow 模式之前，不移除本地知识库实现。
- [ ] 迁移期结束后再评估是否移除本地 embedding 与向量库依赖。

### 6. 测试与验证

- [x] 测试 RagFlow 配置的加载、编辑、保存与重新加载。
- [x] 测试 API Key 的掩码与脱敏。
- [x] 测试数据集列表与检索的正常路径。
- [x] 测试未授权、不可达、超时、响应格式异常等失败路径。
- [x] 测试本地与 RagFlow 知识源互不调用对方的存储与 API。
- [x] 测试聊天输出中的引用与来源元数据。
- [x] 运行相关单元测试与 renderer 测试。
- [x] 运行 `pnpm typecheck`。
- [x] 运行 `pnpm i18n:check`。
- [ ] 用 `pnpm check --plan` 与 `pnpm check` 运行受影响检查。

## 验收标准

- 用户能完全通过界面配置 RagFlow 服务地址与 API Key。
- API Key 不硬编码、不出现在 renderer 请求中、不写入日志。
- 配置完成的用户能在 Cherry Studio 中看到 RagFlow 数据集并跑通召回测试。
- 聊天检索走 RagFlow，且不在本地生成文档、embedding 或向量索引。
- 迁移期内既有本地知识库照常可用。

## 延后项：内网离线跟进

放在 RagFlow 工作之后做。

提交 `f10993a` 已把区域固定为 CN、默认关闭自动更新检查、停止拉取供应商目录。
下面这些出网点在无外网部署下仍未处理。

### A. 把所有出网点收敛到内网模式开关

- [ ] 应用更新下载与版本历史（`AppUpdaterService`）。
- [ ] OCR 语言包（`TesseractRuntimeService`）。
- [ ] Python 运行时与 pip 安装（`pythonRuntime`、`BinaryManager`）。
- [ ] 本地模型下载（`local_model.download` 处理函数）。
- [ ] 小程序安装及其更新检查（`httpSource`、`feature.mini_app.*`）。
- [ ] Cherry Cloud 与 Jina 搜索（`CherryCloudService`、`JinaProvider`）。
- [ ] 集中开关（统一的"内网模式"标志或内部镜像配置），而不是每个服务各加一道守卫。
- [ ] 跑一次无网络的打包版本，确认日志中不再有周期性的出网失败。

### B. 移除遗留的代理 key getter

- [ ] 删除 `src/main/services/proxy/ProxyService.ts` 中的 `appliedProxyKey`——它唯一的消费方是 `f10993a` 移除的区域缓存失效逻辑——以及 `ProxyService.test.ts` 中对应的断言。
