import { v4 as uuidv4 } from 'uuid'

import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { BUILTIN_AGENT_ROLE, CHERRY_SUPPORT_AGENT_ID } from '@shared/ai/builtinAgent'
import type { AgentConfiguration } from '@shared/data/api/schemas/agents'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'

import type { DbType, ISeeder } from '../../types'

const CHERRY_SUPPORT_SEED = {
  name: '企业知识库查询',
  instructions: `# 角色

你是企业知识库查询 Agent，负责帮助用户查询、核对和整理企业资料。

# 工作目标

- 查询企业基本信息、资质证书、业绩合同、人员、财务、产品、案例及其他企业资料。
- 仅以 RagFlow 企业知识库中的原始资料为依据，不得编造、推测或把常识当作企业事实。
- 默认查询全部可访问的 RagFlow 知识库，不要只查询第一个数据库或依赖单个命中文档。

# 查询流程

1. 每次查询先调用 \`kb_list\`，盘点全部可访问的 RagFlow 知识库及文档范围。
2. 如果没有可用的 RagFlow 知识库，立即告知用户“尚未配置企业知识库”，并提示用户先完成 RagFlow 知识库配置和同步，不要凭空回答。
3. 使用 \`kb_search\` 在全部相关知识库中检索；命中后必须使用 \`kb_read\` 阅读原文和上下文。
4. 对多个条件逐项检索和核对，不得用一份文档代替全部证据。

# 回答要求

- 每个关键结论都必须附带引用信息：知识库名称、文档名称，以及页码、章节、段落或其他可定位的原文位置。
- 引用必须来自实际读取的原文；只有标题或搜索摘要不能作为充分依据。
- 明确区分“已找到”“未找到”“资料不足”和“资料冲突”。
- 证书有效期、合同金额、日期、人员任职、资质范围等敏感信息必须优先核对原文。
- 资料缺失时列出需要补充的具体资料；资料冲突时列出冲突来源并请求确认。
- 用户要求汇总时使用清晰的表格或分点输出，不隐瞒未检索到的结果。
- 仅查询和整理企业资料，不替用户虚构投标承诺、证明材料或合规结论。`,
  configuration: {
    avatar: '🧰',
    permission_mode: 'acceptEdits',
    bootstrap_completed: true,
    builtin_role: BUILTIN_AGENT_ROLE.SUPPORT,
    env_vars: {}
  } satisfies AgentConfiguration
} as const

export class CherrySupportSeeder implements ISeeder {
  readonly name = 'cherrySupport'
  readonly description = 'Insert the enterprise knowledge base query agent'
  readonly executionPolicy = 'run-on-change' as const
  readonly version = '4'

  run(db: DbType): void {
    db.transaction((tx) => {
      agentService.clearUntrustedBuiltinSupportRolesTx(tx)
      agentService.claimBuiltinSupportIdentityTx(tx)
      const existing = agentService.findBuiltinAgentByRoleTx(tx, BUILTIN_AGENT_ROLE.SUPPORT, {
        includeDeleted: true
      })
      if (existing) {
        agentService.updateAgentTx(tx, existing.id, {
          name: CHERRY_SUPPORT_SEED.name,
          instructions: CHERRY_SUPPORT_SEED.instructions
        })
        return
      }

      const assistant = agentService.findBuiltinAgentByRoleTx(tx, BUILTIN_AGENT_ROLE.ASSISTANT)
      const agentId = CHERRY_SUPPORT_AGENT_ID
      const row = agentService.createAgentTx(tx, agentId, {
        id: agentId,
        // 内网版裁掉了 Claude Code，内置智能体改用保留下来的 Pi 运行时。
        type: 'pi',
        name: CHERRY_SUPPORT_SEED.name,
        description: '',
        instructions: CHERRY_SUPPORT_SEED.instructions,
        model: assistant?.model ?? null,
        configuration: { ...CHERRY_SUPPORT_SEED.configuration }
      })

      if (!row) {
        throw new Error('insert succeeded but select returned no builtin Cherry Support row')
      }

      agentSessionService.createTx(tx, uuidv4(), {
        agentId,
        name: '',
        workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM }
      })
    })
  }
}
