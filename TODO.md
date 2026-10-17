# TODO

## 当前待办 / 待拍板（2026-10-17）

### 1. 裁剪改动：等手工测试后提交

工作区（基于 `b003cfb`）有 46 个文件的未提交改动，全部属于 2026-10-17 的内网裁剪：

- **Sentry 移除**：删除四个模块与四个测试；渲染进程的全局错误改由 `LoggerService` 写入本地日志
- **语言包裁到中英文**：删除 10 个 locale JSON，仅保留 zh-cn / zh-tw / en-us
- **打包排除**：`electron-builder.yml`、`scripts/__tests__/package-contents.test.ts`（部分已暂存）
- **文档**：[README.md](README.md)（日志与崩溃路径）、[软件使用说明](软件使用说明.md)、本文件

> **状态：暂不提交**（用户明确要求），等 APP 手工功能测试反馈。

- [ ] 手工测试通过后提交以上改动

### 2. 方案 C：出网入口收敛（待拍板）

内网**完全无出网**。已完成：地区固定 CN、关闭自动更新、停止 provider 目录自动拉取。
以下入口尚未收敛，启动或使用时仍会尝试外网（失败即超时或报错）：

- [ ] OCR 语言包下载
- [ ] Python 运行时（uv）下载
- [ ] pip 源
- [ ] 本地模型下载（详细方案见下文「本地模型：自定义下载源」一节）
- [ ] 小程序安装
- [ ] Cherry Cloud
- [ ] Jina 等第三方服务

> **状态：待拍板。** 2026-10-17 决定：内网文件服务器建好前不动代码。
> 若启动日志仍出现周期性出网报错，即属本方案范围。

### 3. RagFlow 集成遗留（有意保留）

- [ ] **迁移期结束后评估**：是否移除本地 embedding 与向量库依赖（当前本地知识库与远程 RagFlow 并存，用户要求保留本地知识库）
- [ ] **全量 `pnpm check`**：仓库无 remote，`--plan` 会选全量门禁；本机存在与改动无关的环境性失败，跑之前先对照已知基线
- [ ] **镜像条目深读缺口**：`kb_read` / `kb_grep` 走 Concept ID（本地材料路径），镜像条目没有对应物，模型检索命中后无法深读（第一阶段已知功能缺口）

## 本地模型：自定义下载源（内网文件服务器）

> **状态：未开始。** 2026-10-17 决定：内网文件服务器尚未建设，**先保持现有的动态下载方式（不动代码）**；
> 服务器建好后再按本文实施。在此之前，离线部署按 [软件使用说明](软件使用说明.md) 第 3 节的"下载后拷贝目录"操作。

### 目标

让「设置 → 环境依赖 → 本地模型」的下载地址可配置，指向内网静态文件服务器。
配置后应用直接从内网下载模型与推理运行时，不再需要人工拷贝目录。

### 现状（为什么成本不高）

下载层已经是表驱动 + 多镜像回退 + sha256 校验，只需开一个口子：

| 环节 | 位置 | 现状 |
| --- | --- | --- |
| 模型文件源 | `src/main/ai/localModel/acquisition/modelSource.ts` | `SOURCES` 表：huggingface / modelscope，含 host、路径模板、revision |
| npm 包源 | `src/main/ai/localModel/acquisition/tarballArtifact.ts` | `NPM_REGISTRIES` 表：npmjs / npmmirror |
| 偏好解析 | `src/main/ipc/handlers/localModel.ts` | 唯一一处，目前写死为 `regionService.isInChina() ? 'china-first' : 'global-first'` |

### 服务器需要托管的内容（约 1 GB）

**布局一：HF 兼容** —— `<模型基址>/<repo>/resolve/main/<file>`

| 文件 | 大小 |
| --- | --- |
| `onnx-community/Qwen3-Embedding-0.6B-ONNX/resolve/main/config.json` | 小 |
| `…/tokenizer_config.json` | 小 |
| `…/tokenizer.json` | 11 MB |
| `…/onnx/model_quantized.onnx` | 585 MB |
| `PaddlePaddle/PP-OCRv6_medium_det_onnx/resolve/main/inference.onnx` | 59 MB |
| `PaddlePaddle/PP-OCRv6_medium_rec_onnx/resolve/main/inference.onnx` | 73 MB |
| `PaddlePaddle/PP-OCRv6_medium_rec_onnx/resolve/main/inference.yml` | 小 |

**布局二：npm 兼容** —— `<npm 基址>/<包名>/-/<包名>-<版本>.tgz`

| 文件 | 说明 |
| --- | --- |
| `onnxruntime-node/-/onnxruntime-node-1.25.1.tgz` | npm 原包（解压后 216 MB，应用只取 `package/bin/napi-v6/win32/x64/`） |

nginx 静态托管这两个目录即可，无需服务端代码。

### 拟定改动方案（方案 A，推荐）

1. **新增两个偏好键**（空值 = 沿用现有的按地区自动选择）：
   - `feature.local_model.models_url` —— 模型文件基址
   - `feature.local_model.npm_registry_url` —— npm 包基址
2. `modelSource.ts` / `tarballArtifact.ts` 各加一个 `custom` 源。
   **配置了自定义源就只走它，不回退外网**（离线环境里试外网只会白等超时）。
3. 入口放在「设置 → 环境依赖 → 本地模型」页面顶部：两个 URL 输入 + 保存，非法 URL 在输入时拦截。
4. i18n（zh-cn / zh-tw / en-us）。
5. 单元测试：源顺序、自定义优先、URL 校验、回退行为。
6. 完成后把 `软件使用说明.md` 第 3 节从"拷贝目录"改写为"配置内网下载源"。
7. 偏好键需要改 `scripts/data-classify/data/classification.json`，再跑 `cd scripts/data-classify && npm run generate`（仓库规定流程，生成文件不可手改）。

### 待定决策

- [ ] **服务端布局**：推荐照搬上游布局（上述两张表原样镜像，服务端零代码）。
      备选是自定义扁平布局（只放 9 个文件），但需要给 catalog 增加逐文件哈希并改提取逻辑，工作量和维护成本都更高，不建议首版做。
- [ ] **onnxruntime 包体积**：sha256 固定，服务器必须托管字节一致的 npm 原包（216 MB 解压体积，实际只用 win32-x64 的 5 个文件）。
      如嫌大，二期可给自定义源加"按文件直接下载 + 逐文件哈希"的能力。
- [ ] **入口位置**：默认放「设置 → 环境依赖 → 本地模型」；若希望和代理设置放一起也可调整。

### 验收标准

- 在无外网的环境中，把两个 URL 指向内网服务器后，「本地嵌入模型」和「本地 OCR 模型」都能点下载并显示「已就绪」。
- 未配置 URL 时行为与现在完全一致。
- 下载失败（URL 不可达 / 哈希不符）给出明确提示，且不会静默回退到外网。
