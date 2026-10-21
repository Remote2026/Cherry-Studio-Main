# 内网版欢迎页改造：移除 CherryIN 登录，引导配置内网模型

Date: 2026-10-21
Status: Approved

## 背景

内网构建无法访问 `open.cherryin.ai` 与 `api.cherry-ai.com`。首次启动的欢迎页却把
“连接 CherryIN”作为主按钮，用户点击后必然失败；真正可行的是配置内网部署的
OpenAI 兼容网关（vLLM / OneAPI / NewAPI 等）。

本次改造只调整欢迎页的入口与文案，复用现有服务商创建流程，不新增专用表单。

## 目标

- 欢迎页不再展示 CherryIN / Cherry Cloud 登录入口。
- 主路径改为“配置内网模型”：点击后进入服务商步骤，并自动打开“新建自定义服务商”
  抽屉（默认 OpenAI Chat Completions）。
- 用户填写内网网关地址与 API Key 后，沿用现有 API 设置/模型启用流程，再进入
  “选择默认模型”步骤。

## 非目标

- 不从 provider registry 删除 CherryIN，也不在设置页隐藏它。
- 不新增内网模型专用表单或新的 IPC/数据层。
- 不修改“选择默认模型”步骤、隐私同意逻辑、“稍后设置”逻辑。
- 不修改默认模型种子值（`cherryai/qwen`）与内置助手的模型绑定。

## 交互设计

### 欢迎页

- 主按钮（primary, lg）：`配置内网模型`，使用 Server 图标。
- 点击行为：先执行 `runAfterPrivacyChoice(...)`；隐私持久化成功后：
  1. 设置 `autoOpenCreateProvider = true`
  2. `step = 'provider'`
- 删除原来的 CherryIN / Cherry Cloud 登录按钮。
- 保留：语言选择、“稍后设置”、隐私勾选。
- 底部提示文案改为“填写内网模型服务地址和密钥，即可开始使用”。

### 服务商步骤

- 从主按钮进入时，`ProviderEditorDrawer` 以 `create-custom` 模式自动打开。
- 关闭抽屉后仍可浏览完整服务商列表；CherryIN 仍保留在列表中。
- “下一步”门槛不变：至少一个非 Cherry 托管服务商，且该服务商下至少一个启用模型。

### 选择默认模型

保持不变。

## 代码改动

### `src/renderer/windows/main/onboarding/OnboardingPage.tsx`

- 欢迎页按钮替换为主按钮“配置内网模型”。
- 删除 CherryIN OAuth 与 Cherry Cloud 登录相关代码及其孤儿状态：
  - `oauthWithCherryIn`、`CHERRYIN_OAUTH_SERVER`、`CHERRYIN_LOGIN_LOADING_TIMEOUT_MS`
  - `useCherryAccountSession` 及其派生状态与取消登录处理
  - `useProvider('cherryin')`、`useProviderModelSync('cherryin')`
  - `handleCherryInLogin`、`isLoggingIn`、`loginAttemptRef`、`loginLoadingTimeoutRef`
  - `completeWithCloudAgentModel` 与云模型同步 effect
  - 无可用云模型提示 Dialog 与相关 state
  - `enableCherryAccountLogin` prop、`getAppEdition`、`isCnEdition`
- 保留 `updateSeededAgentModels`（仍被 `updateSeededResourceModels` 使用）。
- `OnboardingProviderSettings` 增加 `autoOpenCreateProvider` 透传；该值在组件挂载时
  固化一次，避免重渲染时重复打开抽屉。

### `src/renderer/pages/settings/ProviderSettings/ProviderSettingsPage.tsx`

- 新增可选 prop `autoOpenCreateProvider?: boolean`，默认 `false`，透传给 `ProviderList`。

### `src/renderer/pages/settings/ProviderSettings/ProviderList/ProviderList.tsx`

- 新增可选 prop `autoOpenCreateProvider?: boolean`。
- 挂载时若为 `true`，调用一次 `openProviderEditor()`；抽屉关闭后不重复打开。

### i18n

同步修改 `en-us.json`、`zh-cn.json`、`zh-tw.json`：

- 新增 `onboarding.welcome.setup_intranet_model`
- 更新 `onboarding.welcome.setup_hint`
- 删除不再使用的 key：
  - `onboarding.welcome.login_cherryin`
  - `onboarding.welcome.login_cherry_cloud`
  - `onboarding.welcome.other_provider`
  - `onboarding.toast.connected`
  - `onboarding.cloud.no_available_models`

## 测试

- `OnboardingPage.test.tsx`
  - 删除 CherryIN / Cherry Cloud 登录相关用例与对应 mock。
  - 更新欢迎页按钮 key 的断言。
  - 新增：点击“配置内网模型”后进入服务商步骤，且 `autoOpenCreateProvider` 为 `true`。
- `ProviderList.test.tsx`
  - 新增：`autoOpenCreateProvider` 为 `true` 时，挂载即打开新建服务商抽屉。
- 现有隐私、跳过、完成引导、默认模型选择的用例保持通过。

## 验证计划

1. i18n 改动 → `pnpm i18n:check`
2. 组件与测试 → `pnpm test:renderer src/renderer/windows/main/onboarding/__tests__/OnboardingPage.test.tsx src/renderer/pages/settings/ProviderSettings/__tests__/ProviderList.test.tsx`
3. 类型与 lint → `pnpm check --plan` 后执行受影响任务
4. 手动冒烟 → 全新 userData 启动：欢迎页只有“配置内网模型 / 稍后设置”；点击后服务商页
   自动弹出新建抽屉；创建成功后进入选模型步骤。

## 风险与假设

- 假设内网网关兼容 OpenAI Chat Completions；抽屉默认即该协议，其他协议仍可在高级设置中配置。
- 自动打开抽屉依赖 `ProviderList` 在服务商数据加载完成后挂载；加载期间显示现有 Spinner。
- Cherry Cloud 登录代码在本构建中原本不可达（`ENABLE_CHERRY_ACCOUNT_LOGIN = false`），
  删除不影响其他入口（`UserPopup` 仍使用 `useCherryAccountSession`）。
