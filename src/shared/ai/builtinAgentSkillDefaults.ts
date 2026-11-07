export const BUSINESS_BID_AGENT_ID = 'business-bid'

/**
 * 这些内置技能依赖 Pandoc、LibreOffice、Python 或 shell 路由，商务标书 Agent
 * 只使用内置文档工具，默认不加载它们。
 */
const DEFAULT_DISABLED_BUILTIN_SKILLS_BY_AGENT: Readonly<Record<string, ReadonlySet<string>>> = {
  [BUSINESS_BID_AGENT_ID]: new Set(['docx', 'office-transform', 'pdf', 'pptx', 'xlsx', 'cherry-tool-guide'])
}

/** 无 agent_skill 记录时，内置技能对该 Agent 的默认启用状态；用户显式设置始终优先。 */
export function isBuiltinSkillEnabledForAgentByDefault(agentId: string, folderName: string): boolean {
  return !DEFAULT_DISABLED_BUILTIN_SKILLS_BY_AGENT[agentId]?.has(folderName)
}
