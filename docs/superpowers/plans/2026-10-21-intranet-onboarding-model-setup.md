# 内网版欢迎页改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 首次启动欢迎页不再显示 CherryIN / Cherry Cloud 登录，改为“配置内网模型”，点击后进入服务商步骤并自动打开新建自定义服务商抽屉。

**Architecture:** 在现有 `ProviderList` 上增加一个一次性的 `autoOpenCreateProvider` 开关，由 `ProviderSettingsPage` 透传；`OnboardingPage` 在欢迎页主按钮点击后置位该开关，并删除原登录路径。i18n 只改三份语言包中的相关 key。

**Tech Stack:** React 18 + TypeScript、Vitest + Testing Library、i18next、现有 `@cherrystudio/ui` 组件。

---

### Task 1: ProviderList 支持自动打开新建服务商抽屉

**Files:**
- Modify: `src/renderer/pages/settings/ProviderSettings/ProviderList/ProviderList.tsx`
- Modify: `src/renderer/pages/settings/ProviderSettings/ProviderSettingsPage.tsx`
- Test: `src/renderer/pages/settings/ProviderSettings/__tests__/ProviderList.test.tsx`

- [ ] **Step 1: 写失败测试**

在 `ProviderList.test.tsx` 的 `describe('ProviderList', ...)` 内、`it('reports a newly created custom provider so model setup can continue automatically', ...)` 之后加入：

```tsx
it('opens the custom provider form on mount when autoOpenCreateProvider is set', async () => {
  render(<ProviderList selectedProviderId="openai" autoOpenCreateProvider onSelectProvider={vi.fn()} />)

  expect(await screen.findByTestId('provider-editor-drawer')).toHaveAttribute('data-open', 'true')
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:renderer src/renderer/pages/settings/ProviderSettings/__tests__/ProviderList.test.tsx -t "autoOpenCreateProvider"`

Expected: FAIL，`Unable to find an element by: [data-testid="provider-editor-drawer"]`（或 TypeScript 报 `autoOpenCreateProvider` 不存在）。

- [ ] **Step 3: 给 ProviderList 增加 prop 与一次性打开逻辑**

在 `ProviderListProps` 中加入字段：

```tsx
export interface ProviderListProps {
  selectedProviderId?: string
  filterModeHint?: ProviderFilterMode
  autoOpenCreateProvider?: boolean
  onSelectProvider: (providerId: string) => void
  onCustomProviderCreated?: (providerId: string, hasApiKey: boolean) => void
}
```

在函数参数解构中加入默认值：

```tsx
export default function ProviderList({
  selectedProviderId,
  filterModeHint,
  autoOpenCreateProvider = false,
  onSelectProvider,
  onCustomProviderCreated
}: ProviderListProps) {
```

在 `openProviderEditor` 定义之后加入：

```tsx
  useEffect(() => {
    if (autoOpenCreateProvider) {
      openProviderEditor()
    }
  }, [autoOpenCreateProvider, openProviderEditor])
```

`openProviderEditor` 已由 `useCallback` 包裹且依赖稳定，effect 只会在挂载/开关变化时触发一次；抽屉关闭不会重复打开。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test:renderer src/renderer/pages/settings/ProviderSettings/__tests__/ProviderList.test.tsx -t "autoOpenCreateProvider"`

Expected: PASS。

- [ ] **Step 5: ProviderSettingsPage 透传 prop**

修改 `ProviderSettingsPage.tsx`：

```tsx
interface ProviderSettingsContentProps {
  rawProviders: Provider[]
  autoOpenCreateProvider?: boolean
}

function ProviderSettingsContent({
  rawProviders,
  autoOpenCreateProvider = false
}: ProviderSettingsContentProps) {
```

在 `<ProviderList ... />` 上加入：

```tsx
      <ProviderList
        selectedProviderId={selectedProviderId}
        filterModeHint={filterModeHint}
        autoOpenCreateProvider={autoOpenCreateProvider}
        onSelectProvider={setSelectedProviderId}
        onCustomProviderCreated={handleCustomProviderCreated}
      />
```

在文件底部替换默认导出：

```tsx
interface ProviderSettingsPageProps {
  autoOpenCreateProvider?: boolean
}

export default function ProviderSettingsPage({
  autoOpenCreateProvider = false
}: ProviderSettingsPageProps) {
```

并把最后一行改为：

```tsx
  return <ProviderSettingsContent rawProviders={providers} autoOpenCreateProvider={autoOpenCreateProvider} />
```

- [ ] **Step 6: 运行该文件全部测试**

Run: `pnpm test:renderer src/renderer/pages/settings/ProviderSettings/__tests__/ProviderList.test.tsx`

Expected: PASS（现有用例不受影响）。

- [ ] **Step 7: 提交**

```bash
git add src/renderer/pages/settings/ProviderSettings/ProviderList/ProviderList.tsx \
  src/renderer/pages/settings/ProviderSettings/ProviderSettingsPage.tsx \
  src/renderer/pages/settings/ProviderSettings/__tests__/ProviderList.test.tsx
git commit -S --signoff -m "feat(provider-settings): 支持自动打开新建服务商表单

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: 欢迎页改为“配置内网模型”

**Files:**
- Modify: `src/renderer/windows/main/onboarding/OnboardingPage.tsx`
- Modify: `src/renderer/windows/main/onboarding/__tests__/OnboardingPage.test.tsx`
- Modify: `src/renderer/i18n/locales/en-us.json`
- Modify: `src/renderer/i18n/locales/zh-cn.json`
- Modify: `src/renderer/i18n/locales/zh-tw.json`

- [ ] **Step 1: 更新测试 mock 与 helper**

在 `OnboardingPage.test.tsx` 中：

删除以下 mock 常量：

```tsx
const addApiKeyMock = vi.fn()
const updateProviderMock = vi.fn()
const oauthWithCherryInMock = vi.fn()
const syncProviderModelsMock = vi.fn()
const toastSuccessMock = vi.fn()
```

删除整个 `cloudMocks` 常量。

删除以下 `vi.mock` 块：

```tsx
vi.mock('@renderer/utils/appEdition', ...)
vi.mock('@renderer/ipc', ...)
vi.mock('@renderer/services/oauth', ...)
```

把 `@renderer/hooks/useProvider` 的 mock 改为只保留 `useProviders`：

```tsx
vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => ({ providers: enabledProvidersMock, isLoading: false })
}))
```

把 `@renderer/pages/settings/ProviderSettings` 的 mock 改为：

```tsx
vi.mock('@renderer/pages/settings/ProviderSettings', () => ({
  ProviderSettingsPage: ({ autoOpenCreateProvider }: { autoOpenCreateProvider?: boolean }) => (
    <div data-testid="provider-settings" data-auto-open-create-provider={String(Boolean(autoOpenCreateProvider))} />
  )
}))
```

删除 `import userEvent from '@testing-library/user-event'`（剩余用例不再使用）。

把 `openProviderSetup` 改为：

```tsx
async function openProviderSetup() {
  fireEvent.click(screen.getByRole('button', { name: /onboarding\.welcome\.setup_intranet_model/ }))
  await screen.findByTestId('provider-settings')
}
```

- [ ] **Step 2: 删除登录相关测试与 beforeEach 配置**

删除以下整段测试：

- `starts CherryIN login without privacy acceptance and disables data collection`
- `uses CherryIN in the CN edition when Cherry Account onboarding is disabled`
- `keeps CherryIN in the global edition when Cherry Account onboarding is enabled`
- `uses cancellable Cherry Cloud login instead of CherryIN in the CN edition`
- `selects the first available Cherry Cloud Agent model and completes onboarding`
- `opens provider setup after the warning even when an ordinary chat model is available`
- `hides the login icon while loading and restores the action after ten seconds`
- `syncs CherryIN models before moving a fresh install to model selection`
- `returns to provider setup when CherryIN sync finds no enabled model`

删除 `afterEach(() => { vi.useRealTimers() })`。

在 `beforeEach` 中删除这些行：

```tsx
    cloudMocks.appEdition = 'global'
    cloudMocks.statusListener = undefined
    cloudMocks.ipcRequest.mockImplementation(...)
    oauthWithCherryInMock.mockResolvedValue('sk-test')
    addApiKeyMock.mockResolvedValue(undefined)
    updateProviderMock.mockResolvedValue(undefined)
    syncProviderModelsMock.mockResolvedValue(...)
```

保留 `i18nMock.changeLanguage.mockResolvedValue(undefined)`。

把两处 `onboarding.welcome.other_provider` 断言改为 `onboarding.welcome.setup_intranet_model`：

- `shows the privacy control only on the welcome step`
- `stays on the welcome page when saving privacy acceptance fails`

- [ ] **Step 3: 新增失败测试**

在 `it('shows provider setup when choosing another provider', ...)` 之后加入：

```tsx
it('opens the custom provider form when setting up an intranet model', async () => {
  render(<OnboardingPage />)

  fireEvent.click(screen.getByRole('button', { name: 'onboarding.welcome.setup_intranet_model' }))

  expect(await screen.findByTestId('provider-settings')).toHaveAttribute(
    'data-auto-open-create-provider',
    'true'
  )
})

it('does not auto-open the custom provider form when returning from model selection', async () => {
  render(<OnboardingPage />)

  await openModelSelection()
  fireEvent.click(screen.getByRole('button', { name: 'onboarding.select_model.title' }))

  expect(await screen.findByTestId('provider-settings')).toHaveAttribute(
    'data-auto-open-create-provider',
    'false'
  )
})
```

- [ ] **Step 4: 运行测试确认失败**

Run: `pnpm test:renderer src/renderer/windows/main/onboarding/__tests__/OnboardingPage.test.tsx`

Expected: FAIL，欢迎页找不到 `onboarding.welcome.setup_intranet_model` 按钮。

- [ ] **Step 5: 实现 OnboardingPage**

按下述修改 `OnboardingPage.tsx`。

**5a. 导入调整**

替换 lucide 导入：

```tsx
import { ArrowLeft, Check, Languages, Server } from 'lucide-react'
```

替换 React 导入：

```tsx
import { useCallback, useMemo, useState } from 'react'
```

从 `@cherrystudio/ui` 导入中删除 `Dialog`、`DialogContent`、`DialogDescription`、`DialogFooter`、`DialogHeader`、`DialogTitle`。

删除这些导入：

```tsx
import { useCherryAccountSession } from '@renderer/hooks/useCherryAccountSession'
import { oauthWithCherryIn } from '@renderer/services/oauth'
import { getAppEdition } from '@renderer/utils/appEdition'
import type { CherryCloudStatus } from '@shared/ipc/schemas/cherryCloud'
```

把 provider hooks 改为：

```tsx
import { useProviders } from '@renderer/hooks/useProvider'
```

把 ProviderSettings 导入改为：

```tsx
import { ProviderSettingsPage } from '@renderer/pages/settings/ProviderSettings'
```

**5b. 删除常量、prop 与登录状态**

删除以下声明：

```tsx
interface OnboardingPageProps {
  enableCherryAccountLogin?: boolean
}

const ENABLE_CHERRY_ACCOUNT_LOGIN = false
const CHERRYIN_OAUTH_SERVER = 'https://open.cherryin.ai'
const CHERRYIN_LOGIN_LOADING_TIMEOUT_MS = 10_000
```

保留 `PESSIMISTIC_PREFERENCE_OPTIONS`、`isOnboardingModel`、`ONBOARDING_PREFERENCE_KEYS`。

将 `OnboardingProviderSettings` 替换为：

```tsx
function OnboardingProviderSettings({ autoOpenCreateProvider = false }: { autoOpenCreateProvider?: boolean }) {
  const [initialAutoOpen] = useState(autoOpenCreateProvider)
  const router = useMemo(() => {
    const routeTree = createRootRoute({
      component: () => <ProviderSettingsPage autoOpenCreateProvider={initialAutoOpen} />
    })
    const history = createMemoryHistory({ initialEntries: ['/'] })
    return createRouter({ routeTree, history })
  }, [initialAutoOpen])

  return <RouterProvider router={router} />
}
```

把组件签名改为：

```tsx
export default function OnboardingPage() {
```

删除以下状态与引用（`isCompleting` 与 `setIsCompleting` 保留）：

```tsx
  const appEdition = getAppEdition()
  const { addApiKey, updateProvider } = useProvider('cherryin')
  const { syncProviderModels } = useProviderModelSync('cherryin')
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [showNoCloudModelsDialog, setShowNoCloudModelsDialog] = useState(false)
  const loginAttemptRef = useRef(0)
  const loginLoadingTimeoutRef = useRef<number | null>(null)
  const cloudStatusRef = useRef<CherryCloudStatus | null>(null)
  const hasRoutedCloudLoginRef = useRef(false)
  const isCnEdition = appEdition === 'cn'
  const shouldUseCherryAccountLogin = isCnEdition && enableCherryAccountLogin
  const { status: cloudStatus, login: handleCherryCloudLogin, cancelLogin: handleCherryCloudLoginCancel, isCancellingLogin: isCancellingCloudLogin, isAuthorizing: isCloudAuthorizing } = useCherryAccountSession(shouldUseCherryAccountLogin)
  cloudStatusRef.current = cloudStatus
```

新增：

```tsx
  const [autoOpenCreateProvider, setAutoOpenCreateProvider] = useState(false)
```

删除 `completeWithCloudAgentModel`、`useEffect` 云模型同步块、登录超时清理 `useEffect`、`handleCherryInLogin`、`isPrimaryLoginPending`、`primaryLoginLabel`。

**5c. 欢迎页按钮替换**

把欢迎页 `<div className="mt-8 flex w-full flex-col gap-3">` 内的两个按钮整体替换为：

```tsx
                  <div className="mt-8 flex w-full flex-col gap-3">
                    <Button
                      type="button"
                      size="lg"
                      className="h-11 w-full rounded-xl"
                      disabled={isUpdatingPrivacy}
                      onClick={() =>
                        void runAfterPrivacyChoice(() => {
                          setAutoOpenCreateProvider(true)
                          setStep('provider')
                        })
                      }>
                      <Server size={16} />
                      {t('onboarding.welcome.setup_intranet_model')}
                    </Button>
                  </div>
```

**5d. 服务商步骤传递开关**

把 `<OnboardingProviderSettings />` 改为：

```tsx
<OnboardingProviderSettings autoOpenCreateProvider={autoOpenCreateProvider} />
```

把选择模型页的返回按钮改为：

```tsx
                  onBack={() => {
                    setAutoOpenCreateProvider(false)
                    setStep('provider')
                  }}
```

**5e. 删除无云模型 Dialog**

删除文件末尾的 `<Dialog open={showNoCloudModelsDialog} ...>...</Dialog>` 整块，保留 `PrivacyPolicyDialog`。

- [ ] **Step 6: 更新 i18n**

**en-us.json**

删除：

```json
  "onboarding.cloud.no_available_models": "No models are available for this account. Set up another provider to continue.",
  "onboarding.toast.connected": "Successfully connected to CherryIN",
  "onboarding.welcome.login_cherry_cloud": "Sign in to Cherry Cloud",
  "onboarding.welcome.login_cherryin": "Connect CherryIN",
  "onboarding.welcome.other_provider": "Set up another provider",
```

把：

```json
  "onboarding.welcome.setup_hint": "You can change providers anytime in Settings",
```

改为：

```json
  "onboarding.welcome.setup_hint": "Enter your intranet model service URL and API key to get started",
  "onboarding.welcome.setup_intranet_model": "Set up intranet model",
```

**zh-cn.json**

删除：

```json
  "onboarding.cloud.no_available_models": "当前账户没有可用模型，请配置其他服务商后继续。",
  "onboarding.toast.connected": "成功连接 CherryIN",
  "onboarding.welcome.login_cherry_cloud": "Cherry Cloud 登录",
  "onboarding.welcome.login_cherryin": "连接 CherryIN",
  "onboarding.welcome.other_provider": "配置其他服务商",
```

把：

```json
  "onboarding.welcome.setup_hint": "您可以随时在设置中更换服务商",
```

改为：

```json
  "onboarding.welcome.setup_hint": "填写内网模型服务地址和密钥，即可开始使用",
  "onboarding.welcome.setup_intranet_model": "配置内网模型",
```

**zh-tw.json**

删除：

```json
  "onboarding.cloud.no_available_models": "目前帳戶沒有可用模型，請設定其他供應商後繼續。",
  "onboarding.toast.connected": "成功連接到 CherryIN",
  "onboarding.welcome.login_cherry_cloud": "Cherry Cloud 登入",
  "onboarding.welcome.login_cherryin": "使用 CherryIN 登入",
  "onboarding.welcome.other_provider": "選擇其他供應商",
```

把：

```json
  "onboarding.welcome.setup_hint": "您可以隨時在設定中變更供應商",
```

改为：

```json
  "onboarding.welcome.setup_hint": "填寫內網模型服務位址和金鑰，即可開始使用",
  "onboarding.welcome.setup_intranet_model": "設定內網模型",
```

- [ ] **Step 7: 运行测试与 i18n 检查**

Run:

```bash
pnpm test:renderer src/renderer/windows/main/onboarding/__tests__/OnboardingPage.test.tsx
pnpm i18n:check
```

Expected: 全部 PASS；`i18n:check` 输出成功。

- [ ] **Step 8: 提交**

```bash
git add src/renderer/windows/main/onboarding/OnboardingPage.tsx \
  src/renderer/windows/main/onboarding/__tests__/OnboardingPage.test.tsx \
  src/renderer/i18n/locales/en-us.json \
  src/renderer/i18n/locales/zh-cn.json \
  src/renderer/i18n/locales/zh-tw.json
git commit -S --signoff -m "feat(onboarding): 欢迎页改为配置内网模型

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: 全量验证与手工冒烟

**Files:** 无新增改动，除非验证发现问题。

- [ ] **Step 1: 查看受影响任务**

Run: `pnpm check --plan`

Expected: 列出 renderer 类型检查、lint、相关测试等任务。

- [ ] **Step 2: 运行受影响检查**

Run: `pnpm check`

Expected: 通过；若 `pnpm check` 因本机已知问题失败，记录失败项并确认与本改动无关。

- [ ] **Step 3: 手工冒烟**

Run:

```bash
env -u ELECTRON_RUN_AS_NODE pnpm dev
```

（如已有实例在运行，先 `taskkill /F /T /IM "Cherry Studio.exe"`。）

验证：

1. 使用全新的用户数据目录启动（或临时移走 `%APPDATA%\CherryStudioDev`）。
2. 欢迎页只显示“配置内网模型”和“稍后设置”，没有 CherryIN / Cherry Cloud 按钮。
3. 点击“配置内网模型”后进入服务商步骤，新建自定义服务商抽屉自动打开。
4. 填写内网 Base URL 与 API Key，完成模型启用后点“下一步”，进入“选择默认模型”。
5. 从选择模型页返回服务商页，抽屉不再自动打开。

- [ ] **Step 4: 提交验证修复（如有）**

若验证阶段做了修正：

```bash
git add -A
git commit -S --signoff -m "fix(onboarding): 修正内网引导验证问题

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```
