import { createHash } from 'node:crypto'

import { and, eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

import { agentTable } from '@data/db/schemas/agent'
import { appStateTable } from '@data/db/schemas/appState'
import { promptBindingTable, promptTable } from '@data/db/schemas/prompt'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { promptService } from '@data/services/PromptService'
import type { AgentConfiguration } from '@shared/data/api/schemas/agents'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'

import type { DbType, ISeeder } from '../../types'

export const BID_ANALYSIS_AGENT_ID = 'bid-analysis'
const INSTALL_MARKER_KEY = 'seed:bidAnalysis:installed'

// v1 发布的默认值；仅用于识别未被用户修改的存量安装并升级。
const PREVIOUS_NAME = '标书分析'
const PREVIOUS_INSTRUCTIONS = '你是标书顾问'
const PREVIOUS_DESCRIPTION = '分析招标文件，生成 HTML 格式的分析问卷'
const PREVIOUS_PROMPT_TITLE = '生成分析问卷'
const PREVIOUS_PROMPT_CONTENT = '分析项目招标文件，生成html格式的分析问卷'
const PREVIOUS_AVATAR = '📋'
/** v6-v9 默认 instructions 的 sha256；只用于识别“未被用户改过”的存量安装。 */
const PREVIOUS_INSTRUCTIONS_V6_SHA256 = '3e7ccf1e8357e91dd16e65b6dd023c4fd9400148c3e05d6432347e928a6c2a5f'
const PREVIOUS_INSTRUCTIONS_V7_SHA256 = 'ee07ffc29d10b32be67be58ae8e43c5cb4f67a59ba6910c5d5ceaf396dd4afdc'
const PREVIOUS_INSTRUCTIONS_V8_SHA256 = '475b4f06dfede6803054d09e7e0944dba5d2dffacb38c128ed27653214733ce6'
const PREVIOUS_INSTRUCTIONS_V9_SHA256 = 'ba19287fe5a9d95af9c032d54295b445626357c1e2b0b311f08125c81ea4ff4a'
const PREVIOUS_INSTRUCTIONS_V10_SHA256 = '62edb602720619c37f7992da8fd68c756bb76daf77af4a751abbcee271be9aeb'
const PREVIOUS_INSTRUCTIONS_V11_SHA256 = '33a8ef1bff6c9e02b301d987d4fe9e0d1e5a8a244105ab2b1b975eb747acb739'
const PREVIOUS_INSTRUCTIONS_V12_SHA256 = '5fc6177dacddaed1dd5870f2bea85aa73cf8c5dd42edcd9ecf2290fef33c987e'

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex')

const BID_ANALYSIS_PROMPT_CONTENT = `请分析本次上传的招标文件，严格按照系统提示词规定的工作流程、风险识别规则和报告结构完成分析。

**本次任务参数：**
- 目标包号：全部包（如有多包，逐包分析）。
- 分析视角：投标人视角。
- 输出格式：HTML 文件。
- 报告文件名：项目名-分析报告.html（项目名必须取自招标文件原文）。

**重点关注：**
1. 资格条件及硬性准入风险。
2. 全部★实质性条款及响应风险。
3. 评分规则、得分预估及主要失分点。
4. 全部明确规定的废标、无效投标及否决投标情形。
5. 投标文件格式模板、编制、签字盖章及封装要求。
6. 需要向采购人或代理机构书面澄清的问题。

请核对文件完整性、补遗及澄清文件，确保重要结论能够追溯至原文。

如缺少企业资料，继续完成招标文件分析，并将企业资格、响应能力及实际得分标记为“待核实”，不得编造。

如果没有可读取的招标文件附件，也没有指定可访问的工作目录，请先提示我提供文件，不得直接生成虚构报告。

最终生成实际可打开、便于阅读和打印的 HTML 报告文件。文件名必须严格为“项目名-分析报告.html”，项目名取自招标文件原文；不得使用“xxxx”“项目名”等占位符，也不得使用其他后缀或文件名。生成后提供已确认的文件链接。`

const BID_ANALYSIS_INSTRUCTIONS = `# 角色

你是资深投标顾问和招标采购文件分析专家。根据用户提供的招标文件、补遗澄清文件和企业资料，识别投标要求、资格条件、否决风险、评分机会和材料缺口，并生成可追溯的 HTML 分析报告。

# 核心原则

1. 只依据实际提供且成功读取的文件作结论；不得编造项目名称、金额、日期、资质、业绩、人员、评分或条款。
2. 重要结论必须引用文件名、章节或条款号、可确认的页码和必要的原文摘录；原文与分析结论分开。
3. 区分“文件明确规定”“依据文件分析得出”“风险提示”“待核实”。找不到条款时写“未检索到明确依据”，不得推断为文件不存在。
4. 企业资料不足时继续分析招标文件；企业资格、响应能力和得分统一标记为“待核实”。本分析不构成法律意见或中标承诺。

# 附件角色

按用户指示和文件内容区分：招标文件、公告、补遗和澄清是项目要求依据；企业资料用于能力判断；模板仅用于参考结构，不得替代本项目原文件。角色不明且会影响结论时先询问，否则标记为“待确认”。多包项目逐包分析，只有文件明确允许时才合并结论。

# 文档读取

没有可读取的招标文件或用户指定目录时，先要求用户提供文件。收到文档句柄后，严格按 RagFlow 工具描述连续读取，完成 coverage 检查后再分析；不得跳读、直接读取原文件、在解析完成前猜测内容，或把不完整 coverage 说成全文分析。页码、章节和表格内容以工具返回结果为准。

# 分析范围

根据文件实际内容提取：

- 项目、包号、采购方式、预算/限价、关键时间和文件完整性。
- 资格条件：主体、资质、财务、纳税、社保、业绩、人员、信誉及其他门槛。
- 商务和技术要求：交付、付款、质保、售后、参数、认证、履约责任等。
- 全部 ★ 条款、实质性要求、资格性/符合性审查、否决投标、无效投标和废标情形。
- 评标方法、评分项目、价格公式、证明材料、得分预估和失分点。
- 投标文件组成、模板、格式、签字盖章、份数、装订、密封、电子提交、样品和演示要求。
- 补遗、澄清和文件冲突，以及可直接提交给采购人或代理机构的澄清问题。

资格状态只能使用：满足、需澄清、不满足、待核实。企业资料缺失或证据不足时不得判为满足或不满足；不得把常见经验当作本项目明确的废标条件。

# 输出

生成实际可打开的 UTF-8 HTML 文件，文件名必须严格为“项目名-分析报告.html”：项目名取自招标文件原文，清理 Windows/macOS/Linux 不允许的路径字符；不得使用占位名、随机名或其他命名格式。报告包含：

1. 分析摘要和项目基本信息。
2. 文件完整性与证据限制。
3. 资格及符合性审查清单。
4. 商务技术条款响应表。
5. 评分规则、得分预估和证据缺口。
6. 投标文件编制及提交检查单。
7. 废标和重大风险清单。
8. 待澄清问题、文件清单和合规声明。

表格至少包含要求或结论、文件依据、原文摘录、当前状态、风险等级、所需材料和下一步行动。缺少信息时使用“文件未明确”“待核实”或“未检索到明确依据”，不得用虚构数据或“其余类似”代替分析。只有在文件确实生成并确认路径后，才能提供文件链接。`
// A seeder is a versioned rollout snapshot. The agent is a regular (non-builtin)
// library entry: users can edit its prompt and settings, and deleting it is final.
const BID_ANALYSIS_SEED = {
  name: '招标文件分析',
  description: '分析招标文件，生成 HTML 格式的分析报告',
  instructions: BID_ANALYSIS_INSTRUCTIONS,
  prompt: {
    title: '生成分析报告',
    content: BID_ANALYSIS_PROMPT_CONTENT
  },
  configuration: {
    avatar: '🍆',
    permission_mode: 'bypassPermissions',
    bootstrap_completed: true,
    env_vars: {}
  } satisfies AgentConfiguration
} as const

export class BidAnalysisSeeder implements ISeeder {
  readonly name = 'bidAnalysis'
  readonly description = 'Insert the built-in bid analysis agent and its editable user prompt'
  readonly executionPolicy = 'run-on-change' as const
  readonly version = '13'

  run(db: DbType): void {
    db.transaction((tx) => {
      const existing = tx
        .select({
          id: agentTable.id,
          name: agentTable.name,
          description: agentTable.description,
          instructions: agentTable.instructions,
          configuration: agentTable.configuration
        })
        .from(agentTable)
        .where(eq(agentTable.id, BID_ANALYSIS_AGENT_ID))
        .limit(1)
        .all()
      if (existing.length > 0) {
        // Mark the install even for libraries seeded before the marker existed, so a
        // later seeder version cannot resurrect an agent the user has deleted.
        this.ensureInstallMarkerTx(tx)
        // 只升级仍是旧版默认值的字段；用户改过的名称、描述、提示词一律保留。
        const upgrades: Partial<typeof agentTable.$inferInsert> = {}
        if (existing[0].name === PREVIOUS_NAME) {
          upgrades.name = BID_ANALYSIS_SEED.name
        }
        if (existing[0].description === PREVIOUS_DESCRIPTION) {
          upgrades.description = BID_ANALYSIS_SEED.description
        }
        if (
          existing[0].instructions === PREVIOUS_INSTRUCTIONS ||
          sha256(existing[0].instructions) === PREVIOUS_INSTRUCTIONS_V6_SHA256 ||
          sha256(existing[0].instructions) === PREVIOUS_INSTRUCTIONS_V7_SHA256 ||
          sha256(existing[0].instructions) === PREVIOUS_INSTRUCTIONS_V8_SHA256 ||
          sha256(existing[0].instructions) === PREVIOUS_INSTRUCTIONS_V9_SHA256 ||
          sha256(existing[0].instructions) === PREVIOUS_INSTRUCTIONS_V10_SHA256 ||
          sha256(existing[0].instructions) === PREVIOUS_INSTRUCTIONS_V11_SHA256 ||
          sha256(existing[0].instructions) === PREVIOUS_INSTRUCTIONS_V12_SHA256
        ) {
          upgrades.instructions = BID_ANALYSIS_INSTRUCTIONS
        }
        if (existing[0].configuration?.avatar === PREVIOUS_AVATAR) {
          upgrades.configuration = { ...existing[0].configuration, avatar: BID_ANALYSIS_SEED.configuration.avatar }
        }
        if (Object.keys(upgrades).length > 0) {
          tx.update(agentTable).set(upgrades).where(eq(agentTable.id, BID_ANALYSIS_AGENT_ID)).run()
        }
        this.upgradeUserPromptTx(tx)
        return
      }
      if (this.hasInstallMarkerTx(tx)) return

      const row = agentService.createAgentTx(tx, BID_ANALYSIS_AGENT_ID, {
        id: BID_ANALYSIS_AGENT_ID,
        type: 'pi',
        name: BID_ANALYSIS_SEED.name,
        description: BID_ANALYSIS_SEED.description,
        instructions: BID_ANALYSIS_SEED.instructions,
        // No model at seed time: the seeder runs before preferences are ready, and the
        // user picks a pi-compatible model in the Agent editor before the first message.
        model: null,
        configuration: { ...BID_ANALYSIS_SEED.configuration }
      })
      if (!row) {
        throw new Error('insert succeeded but select returned no bid analysis agent row')
      }

      promptService.createRestrictedForTargetTx(tx, { type: 'agent', id: BID_ANALYSIS_AGENT_ID }, [
        { ...BID_ANALYSIS_SEED.prompt }
      ])

      // One seeded session gives the agent an entry in the Agents sidebar.
      agentSessionService.createTx(tx, uuidv4(), {
        agentId: BID_ANALYSIS_AGENT_ID,
        name: '',
        workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM }
      })

      this.ensureInstallMarkerTx(tx)
    })
  }

  // 只升级仍绑定在本智能体上、且标题和内容都未被用户修改过的种子提示词。
  private upgradeUserPromptTx(tx: Pick<DbType, 'select' | 'update'>): void {
    const prompts = tx
      .select({ id: promptTable.id, title: promptTable.title, content: promptTable.content })
      .from(promptBindingTable)
      .innerJoin(promptTable, eq(promptBindingTable.promptId, promptTable.id))
      .where(and(eq(promptBindingTable.targetType, 'agent'), eq(promptBindingTable.targetId, BID_ANALYSIS_AGENT_ID)))
      .all()
    for (const prompt of prompts) {
      const isUntouchedSeedPrompt =
        prompt.title === PREVIOUS_PROMPT_TITLE &&
        (prompt.content === PREVIOUS_PROMPT_CONTENT || prompt.content === BID_ANALYSIS_PROMPT_CONTENT)
      if (!isUntouchedSeedPrompt) continue
      tx.update(promptTable)
        .set({ title: BID_ANALYSIS_SEED.prompt.title, content: BID_ANALYSIS_PROMPT_CONTENT })
        .where(eq(promptTable.id, prompt.id))
        .run()
    }
  }

  private hasInstallMarkerTx(tx: Pick<DbType, 'select'>): boolean {
    return (
      tx
        .select({ key: appStateTable.key })
        .from(appStateTable)
        .where(eq(appStateTable.key, INSTALL_MARKER_KEY))
        .limit(1)
        .all().length > 0
    )
  }

  private ensureInstallMarkerTx(tx: Pick<DbType, 'insert'>): void {
    tx.insert(appStateTable)
      .values({
        key: INSTALL_MARKER_KEY,
        value: { installedAt: Date.now() },
        description: 'Set once the bid analysis seed has been installed; prevents recreating a user-deleted agent'
      })
      .onConflictDoNothing()
      .run()
  }
}
