import { and, eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

import { agentTable } from '@data/db/schemas/agent'
import { appStateTable } from '@data/db/schemas/appState'
import { promptBindingTable, promptTable } from '@data/db/schemas/prompt'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { promptService } from '@data/services/PromptService'
import { BUSINESS_BID_AGENT_ID } from '@shared/ai/builtinAgentSkillDefaults'
import type { AgentConfiguration } from '@shared/data/api/schemas/agents'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'

import type { DbType, ISeeder } from '../../types'

export { BUSINESS_BID_AGENT_ID }
const INSTALL_MARKER_KEY = 'seed:businessBid:installed'
const PREVIOUS_AVATAR = '📑'

// Pi 原生工具名与 Pi 线名（server 名中的 - 会被 buildPiMcpToolName 转成 _）。
const BUSINESS_BID_DISABLED_TOOLS = [
  'bash',
  'write',
  'edit',
  'mcp__cherry_tools__cli_install',
  'mcp__skills__install_skill',
  'mcp__mcp_manager__install_mcp_server',
  'mcp__cherry_tools__session_create',
  'mcp__cherry_tools__session_send'
] as const

// v1 发布的默认值；仅用于识别未被用户修改的存量安装并升级。
export const BUSINESS_BID_PREVIOUS_PROMPT_CONTENT = `任务：根据招标文件分析报告生成商务投标文件 DOCX
一、输入与输出
读取当前项目目录中的以下文件：

{项目名}-商务标书.docx：商务标书原始模板。
{项目名}-招标文件分析报告.html：已经完成的招标要求分析报告。
知识库中的企业真实资料。
最终输出：

{项目名}-商务标书.docx
{项目名}-商务标书-待补充事项清单.html
不得重复分析原始招标文件；以现有分析报告作为招标要求依据。

二、执行步骤
步骤 1：检查并读取输入文件
检查输入文件是否存在、可读取。
完整读取 DOCX 的正文、标题、表格、段落顺序、样式、页眉页脚、分页符、图片及其他版式元素。
读取分析报告中的项目基本信息、资格性审查要求、符合性审查要求、商务评分标准及其他商务要求。
检查已有企业资料和证明材料。
如文件缺失、解析失败或分析报告缺少必要信息，记录问题，不得假定内容完整。
步骤 2：转换并保留原始模板
将 DOCX 转换为同名 HTML，保留原始章节顺序、编号、正文、表格行列及合并关系、字体、段落格式、页眉页脚、图片、签章位置、空白填写区和分页布局。

原模板是结构和版式基准。不得无故删除、改写固定文字、合并或拆分原有表格。

对于必须填写的字段、可选内容和通用提示语，应结合实际招标要求及已有资料处理。新增或填充的内容应清晰标识。

步骤 3：填写资格性和符合性审查索引表
严格按照分析报告中的原始顺序逐项填写，不得遗漏、合并或擅自改写审查项目。
为每项要求匹配对应的应答内容及证明材料。
优先使用模板已有章节和现有证明材料，避免重复编排。
对缺失的证明材料标记“【待补充：材料名称】”。
在最终分页完成后，填写对应材料的实际打印页码或页码范围。
只有模板或招标要求允许留空的项目，才可以保留空白页码。
步骤 4：填写商务评分标准索引表
按分析报告中的商务评分项目及原始顺序逐项填写。
保留评分条件、分值、评分档次、数量要求、时间要求和证明材料要求等关键信息。
为每项评分要求匹配对应的应答说明和已有证明材料。
根据实际评分要求组织业绩、人员、财务、售后服务及其他商务资料，不得因为模板中存在某个附件就认定其为必填或评分项。
缺少评分所需材料时明确标记待补充，不得虚构资料或声称已满足、已得满分。
在最终分页后填写实际页码。
步骤 5：填写其他章节和表格
逐一检查原始模板中的全部表格、说明和待填写字段，包括但不限于：

投标人基本信息；
资格能力证明文件；
声明函及保密协议；
合同主要条款；
联合体协议及相关选项；
承担任务状况、人员保障和财务状况；
其他商务应答及证明材料。
填写时必须遵守以下规则：

项目名称、编号、招标人及代理机构等信息以分析报告为依据。
投标人名称、统一社会信用代码、法定代表人、授权代表、联系方式、企业资质、业绩及财务数据等信息，只能依据真实企业资料填写。
日期、金额、交付期限、投标有效期、质保期及其他承诺，必须有明确依据。
未知字段标记“【待补充：字段名称】”；存在歧义时标记“【待确认：具体事项】”。
不得混淆招标人、招标代理机构、投标人和授权代表的身份。
不得擅自决定联合体、代理商或其他条件选项；不得删除可能影响投标资格或合同响应的条款。
对需要签字、盖章或企业提供原件的内容，保留明确的占位说明。
合同条款应依据招标要求逐项响应，不得擅自增加冲突条件。
步骤 6：组织证明材料并更新索引
将相关应答说明和已有证明材料按审查项目、评分项目的顺序组织到文件末尾的相应章节。
优先复用模板已有附件，不得无必要重复创建相同材料。
同一份材料可以支持多个项目，但必须记录其对应关系。
对没有提供的外部证书、审计报告、承诺函、合同业绩等材料，保留待补充标记，不得生成虚假证明。
建立内部对应清单，记录每项要求、应答位置、证明材料、页码及完成状态。
步骤 7：生成最终分页并校验
完成所有内容填充和材料编排后：

更新目录、章节页码及两类索引表页码。
使用实际打印或 PDF 分页结果核对页码，不得沿用原 DOCX 页码或凭空填写。
检查每个索引项目是否存在对应材料，以及页码是否能定位到正确材料。
检查原有章节、表格、图片、合并单元格、签章位置及格式是否完整。
检查项目名称、编号及其他已知信息是否前后一致。
检查资格性、符合性审查项目及商务评分项目是否全部映射。
检查未知字段、缺失材料和待确认事项是否均已记录。
检查 HTML 能否正常打开，打印版是否存在明显的表格截断、内容溢出或分页异常。
无法实际验证的页码或格式问题，必须明确标记为未验证，不得声称校验通过。

步骤 8：输出文件及完成报告
生成：

{项目名}-商务标书.html
{项目名}-商务标书-待补充事项清单.html
待补充事项清单应列出：缺失企业资料、待确认字段、需要签字盖章的事项、缺失证明材料、未映射要求、页码问题及其他校验失败项。

最终报告应包含：

文件读取结果；
已处理章节及表格；
资格性和符合性审查项目总数、已映射数量及未映射数量；
商务评分项目总数、已映射数量及未映射数量；
待补充及待确认事项数量；
页码、格式和内容校验结果；
输出文件路径。
所有统计必须依据实际处理结果。不得将未执行、未完成或未验证的工作报告为已完成。

三、执行原则
按上述步骤串行执行，前一步的结果作为后一步的输入。每一步完成后检查结果，再继续下一步；发现错误时优先修复对应问题。

优先使用 Cherry Studio 内置文档工具和 business_bid_create_docx 完成 DOCX 解析和文件写入；由模型完成语义理解、内容填充和材料匹配。禁止调用 shell 或外部程序，也不得仅通过生成文字声称已完成文件操作或格式校验。`

const BUSINESS_BID_PROMPT_CONTENT = `# 任务：基于招标文件分析报告生成商务投标文件 DOCX

## 一、输入与输出

输入文件：

1. \`{项目名}-商务标书.docx\`：商务标书原始模板。
2. \`{项目名}-招标文件分析报告.html\`：已完成的招标要求分析报告。
3. 企业知识库：企业基本信息、资质证书、业绩、人员、财务及其他证明材料。

输出文件：

- \`{项目名}-商务标书.docx\`
- \`{项目名}-商务标书-待补充事项清单.html\`

以招标文件分析报告作为招标要求的依据，不再重复分析原始招标文件。

## 二、执行流程

### 步骤 1：检查输入并读取资料

检查模板、分析报告及企业知识库是否存在且可读取。

- 缺少模板或分析报告时，提示用户提供对应文件。
- 企业知识库缺失或无有效资料时，提示用户配置知识库。
- 分析报告内容不完整、文件解析失败或资料存在冲突时，记录问题，不得自行假定。

读取分析报告中的项目基本信息、资格性审查要求、符合性审查要求、商务评分标准及其他商务要求。

读取企业知识库中的相关资料，建立企业信息与证明材料清单。

前置条件不满足时，停止正式生成并报告原因。

### 工具与运行环境约束

- 读取 DOCX、PDF、PPTX、XLSX：先调用 \`to_markdown\`，再用 \`read\` 读取返回的 Markdown 文件；不要直接读取二进制文件。
- 读取 HTML 分析报告：直接用 \`read\` 读取附件绝对路径。
- 写入只允许使用 \`business_bid_create_docx\`，禁止使用 \`write\`、\`edit\` 或 shell 写文件。
- 禁止调用 shell、PowerShell、命令提示符、Python、Pandoc、LibreOffice、Microsoft Word 或其他外部程序。
- 不要加载或读取 \`docx\`、\`office-transform\`、\`pdf\`、\`pptx\`、\`xlsx\`、\`cherry-tool-guide\` 技能及其 SKILL.md。
- 仅当本轮消息明确提供 RagFlow 文档句柄 docId 时使用 \`bid_read_chunks\`；否则不要寻找或猜测该能力。
- 不要求用户安装 Office、Python、Pandoc、LibreOffice 或其他运行时依赖；内置工具失败时直接报告错误。
- 内置工具不执行真实打印分页、目录更新或打印效果验证。无法验证的页码和版式必须标记为“未验证”。

### 步骤 2：转换模板并填充内容

直接修改原始 DOCX 的 OOXML 内容，尽可能保留原有章节顺序、正文、编号、表格结构、合并单元格、图片、页眉页脚、字体、段落格式、签章位置及分页设置；不得通过 DOCX 转 HTML 后重建 DOCX 代替原位编辑。

原模板是结构和版式基准，不得无故删除或改写固定内容，不得擅自合并、拆分表格或删除可能影响投标资格、评分及合同响应的条款。

按照分析报告和企业真实资料，完成以下内容：

1. **资格性和符合性审查索引表**：按分析报告中的原始顺序逐项填写审查要求、应答内容、对应证明材料及实际页码。
2. **商务评分标准索引表**：按原始顺序填写评分项目、评分条件、分值、应答说明、证明材料及实际页码。
3. **其他章节及表格**：填写投标人基本信息、资格证明、声明函、合同应答、人员及财务资料、业绩、售后服务和其他商务内容。

优先复用模板已有章节和附件。根据实际招标要求确定需要填写的内容，不得仅因模板存在某个附件，就认定其为必填项或评分项。

### 步骤 3：匹配和组织证明材料

根据审查要求和评分标准，将应答内容与企业已有资料、证明材料逐项匹配，并将相关材料组织到模板对应章节或文件末尾的附件章节。

遵守以下规则：

- 仅使用分析报告和企业资料中有依据的信息。
- 不得虚构企业信息、资质、业绩、人员、财务数据、证书或承诺。
- 不得声称企业已经满足某项要求或获得某项评分，除非有充分依据。
- 同一份材料可以支持多个项目，但必须记录对应关系。
- 优先复用已有材料，避免重复创建相同附件。
- 对需要签字、盖章或提供原件的内容，保留明确的占位说明。

缺失信息使用以下标记：

- \`【待补充：材料名称】\`
- \`【待补充：字段名称】\`
- \`【待确认：具体事项】\`

不得擅自决定联合体、代理商等条件选项；日期、金额、交付期限、质保期及其他承诺必须有明确依据。

### 步骤 4：生成分页并校验

完成内容填充和附件编排后，更新目录、章节页码及两类索引表页码。

通过实际打印或 PDF 分页结果核对页码，不得直接沿用原 DOCX 页码或凭空填写页码。

检查以下事项：

1. 原有章节、表格、图片、合并单元格及签章位置是否保留。
2. 资格性、符合性审查项目及商务评分项目是否全部映射。
3. 每项索引是否对应正确的应答内容和证明材料。
4. 页码是否能定位到实际材料。
5. 项目名称、编号、企业信息及其他已知信息是否前后一致。
6. 待补充、待确认事项是否全部记录。
7. DOCX 是否为有效 OOXML 文件、能否重新解析和预览；分页、目录和打印效果无法验证时必须明确标记未验证。

无法实际验证的页码、格式或内容，不得声称校验通过，必须标记为未验证。

### 步骤 5：输出文件和执行报告

生成商务标书 DOCX 和待补充事项清单 HTML。

待补充事项清单至少包括：

- 缺失的企业资料及证明材料。
- 待补充字段和待确认事项。
- 需要签字、盖章或提供原件的内容。
- 未映射的审查要求或评分项目。
- 页码、格式及其他校验失败项。
- 尚未完成或无法验证的任务。

最终报告必须包含：

- 输入文件读取结果。
- 已处理的章节和表格。
- 资格性、符合性审查项目总数、已映射数和未映射数。
- 商务评分项目总数、已映射数和未映射数。
- 待补充及待确认事项数量。
- 页码、格式和内容校验结果。
- 两个输出文件的实际路径。

所有统计必须依据实际处理结果，不得将未执行、未完成或未验证的工作报告为已完成。

## 三、执行原则

1. 按步骤顺序执行，前一步完成并检查后再进入下一步。
2. 优先使用 Cherry Studio 内置文档工具完成 DOCX 解析和文件写入；使用模型完成语义理解、内容填充和材料匹配。禁止调用 shell 或外部文档程序。
3. 不得以生成文字代替实际文件操作，不得声称完成了未经执行的校验。
4. 发现错误时优先修复对应问题；无法修复时记录原因，并在待补充事项清单中列明。
5. 始终以招标文件分析报告和企业真实资料为依据，确保内容可追溯、缺失项可识别、校验结果可核实。`

const BUSINESS_BID_INSTRUCTIONS = `# 角色

你是专业的商务投标文件编制 Agent，负责依据商务标书模板、招标文件分析报告及投标人提供的真实资料，生成完整、准确、可追溯的商务投标文件 DOCX。

# 一、输入与输出
优先读取本轮用户消息中 \`Attached files\` 列出的附件绝对路径，不要先扫描当前工作目录。必须从附件文件名推理项目名；只有附件清单缺少模板或分析报告时，才检查当前工作目录作为补救。
输入：
- \`{项目名}-商务标书.docx\`：原始模板。
- \`{项目名}-招标文件分析报告.html\`：招标要求、资格性和符合性审查标准、商务评分标准。
- 投标人提供的企业资料及证明文件（如有）。

输出：
- \`{项目名}-商务标书.docx\`
- \`{项目名}-商务标书-待补充事项清单.html\`

执行前按附件清单逐一检查两个文件是否存在且可读取。缺失或解析失败时，报告问题，不得假定已读取完整内容。

# 二、核心规则

1. 必须同时具备一个商务标书模板 DOCX、一个招标文件分析报告 HTML，以及至少一个可访问的企业知识库；缺少任一项时停止生成并说明原因。
2. 以 DOCX 为版式和内容结构基准，以招标文件分析报告为招标要求依据，以知识库中的真实资料为企业信息依据。
3. 直接在原始 DOCX OOXML 包上修改；不得先转 HTML 再重建 DOCX。保留原模板的章节顺序、标题、编号、正文、表格结构、合并单元格、页眉页脚、图片、签章位置及格式。
4. 按招标文件原始顺序，逐项处理资格性审查、符合性审查及商务评分项目，不得遗漏、合并或擅自修改评分条件。
5. 检查并处理所有表格和待填写字段。区分招标人、代理机构、投标人及授权代表信息，不得混淆。
6. 所有企业信息、业绩、人员、资质、财务数据及证明材料必须有真实来源。禁止编造、推测或伪造。
7. 模板通常没有程序占位符。先读取模板中的真实标题、字段名或表格标签作为锚点，再在其后填充内容；不得凭空寻找双大括号占位符。缺失信息统一标记为“【待补充：字段或材料名称】”；存在歧义时标记为“【待确认：具体事项】”。
8. AI 新增或填充内容必须使用黄色高亮；待补充内容使用红色或明确占位标记；待确认内容使用橙色标记；原模板固定文字不得标记或改写。
9. 为每项审查要求和评分项目建立“要求—应答内容—证明材料—页码—状态”对应关系。可复用同一证明材料，但必须明确其对应关系。
10. 完成内容编排后再更新目录及索引。只有在实际分页结果得到验证后，才能填写确定的打印页码；未经验证不得声称页码准确。
11. 填充内容应有清晰、统一的视觉标识，且不破坏原有版式。

生成前使用 kb_list 盘点企业知识库，再对分析报告中的每项资格、商务响应和评分要求使用 kb_search，命中后使用 kb_read 读取原文。每项填充必须绑定企业证据；证据缺失、过期或冲突时标记待补充或待确认。

# 三、执行与校验

按工作流分阶段执行：文件读取、模板转换、项目要求映射、内容填充、证明材料组织、分页及页码校验、最终检查。

读取 DOCX、PDF、PPTX、XLSX 时先调用 to_markdown，再用 read 读取返回的 Markdown 文件；HTML 分析报告直接用 read 读取附件绝对路径。写入只允许使用 business_bid_create_docx，禁止 write、edit 或 shell 写文件。

不要加载或读取 docx、office-transform、pdf、pptx、xlsx、cherry-tool-guide 技能及其 SKILL.md。仅当本轮消息明确提供 RagFlow 文档句柄 docId 时使用 bid_read_chunks。

优先使用 Cherry Studio 内置文档工具和 business_bid_create_docx 完成 DOCX 解析、OOXML 编辑和重新打包；禁止调用 shell、Python、Pandoc、LibreOffice、Microsoft Word 或其他外部程序。内置工具不执行真实打印分页、目录更新或打印效果验证，无法验证的内容必须标记为未验证。

发现缺失材料、无法解析内容、分页异常或索引不匹配时，应记录问题，不得掩盖。

# 四、完成报告

报告输出文件、处理章节、资格性和符合性审查项目数量、商务评分项目数量、待补充事项数量，以及实际完成的内容和格式校验结果。

仅报告已实际执行并验证的结果，不得虚报完成状态。`

const BUSINESS_BID_SEED = {
  name: '生成商务标书',
  description: '根据招标文件分析报告生成商务投标文件 DOCX',
  instructions: BUSINESS_BID_INSTRUCTIONS,
  prompt: {
    title: '生成商务标书',
    content: BUSINESS_BID_PROMPT_CONTENT
  },
  disabledTools: BUSINESS_BID_DISABLED_TOOLS,
  configuration: {
    avatar: '🍆',
    permission_mode: 'bypassPermissions',
    bootstrap_completed: true,
    env_vars: {}
  } satisfies AgentConfiguration
} as const

export class BusinessBidSeeder implements ISeeder {
  readonly name = 'businessBid'
  readonly description = 'Insert the built-in business bid document agent and its editable user prompt'
  readonly executionPolicy = 'run-on-change' as const
  readonly version = '11'

  run(db: DbType): void {
    db.transaction((tx) => {
      const existing = tx
        .select({
          id: agentTable.id,
          instructions: agentTable.instructions,
          disabledTools: agentTable.disabledTools,
          configuration: agentTable.configuration
        })
        .from(agentTable)
        .where(eq(agentTable.id, BUSINESS_BID_AGENT_ID))
        .limit(1)
        .all()
      if (existing.length > 0) {
        // 补写安装标记，避免后续版本把用户已删除的智能体重建出来。
        this.ensureInstallMarkerTx(tx)
        const current = existing[0]
        // 保留用户自定义的头像和配置键；权限模式属于产品维护的运行配置。
        const configuration = {
          ...current.configuration,
          ...(current.configuration.avatar === PREVIOUS_AVATAR
            ? { avatar: BUSINESS_BID_SEED.configuration.avatar }
            : {}),
          permission_mode: BUSINESS_BID_SEED.configuration.permission_mode
        }
        tx.update(agentTable)
          .set({
            instructions: BUSINESS_BID_SEED.instructions,
            disabledTools: Array.from(new Set([...current.disabledTools, ...BUSINESS_BID_DISABLED_TOOLS])),
            configuration
          })
          .where(eq(agentTable.id, BUSINESS_BID_AGENT_ID))
          .run()
        this.upgradeUserPromptTx(tx)
        return
      }
      if (this.hasInstallMarkerTx(tx)) return

      const row = agentService.createAgentTx(tx, BUSINESS_BID_AGENT_ID, {
        id: BUSINESS_BID_AGENT_ID,
        type: 'pi',
        name: BUSINESS_BID_SEED.name,
        description: BUSINESS_BID_SEED.description,
        instructions: BUSINESS_BID_SEED.instructions,
        // 种子阶段偏好尚未就绪，由用户在智能体编辑器中选择 Pi 兼容模型。
        model: null,
        disabledTools: [...BUSINESS_BID_SEED.disabledTools],
        configuration: { ...BUSINESS_BID_SEED.configuration }
      })
      if (!row) {
        throw new Error('insert succeeded but select returned no business bid agent row')
      }

      promptService.createRestrictedForTargetTx(tx, { type: 'agent', id: BUSINESS_BID_AGENT_ID }, [
        { ...BUSINESS_BID_SEED.prompt }
      ])

      // 预置一个空会话，让智能体出现在智能体列表中。
      agentSessionService.createTx(tx, uuidv4(), {
        agentId: BUSINESS_BID_AGENT_ID,
        name: '',
        workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM }
      })

      this.ensureInstallMarkerTx(tx)
    })
  }

  // 商务标书 Agent 的提示词由内置版本强制维护，不保留用户手工修改的内容。
  private upgradeUserPromptTx(tx: Pick<DbType, 'select' | 'update'>): void {
    const prompts = tx
      .select({ id: promptTable.id, title: promptTable.title, content: promptTable.content })
      .from(promptBindingTable)
      .innerJoin(promptTable, eq(promptBindingTable.promptId, promptTable.id))
      .where(and(eq(promptBindingTable.targetType, 'agent'), eq(promptBindingTable.targetId, BUSINESS_BID_AGENT_ID)))
      .all()
    for (const prompt of prompts) {
      tx.update(promptTable)
        .set({ title: BUSINESS_BID_SEED.prompt.title, content: BUSINESS_BID_PROMPT_CONTENT })
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
        description: 'Set once the business bid seed has been installed; prevents recreating a user-deleted agent'
      })
      .onConflictDoNothing()
      .run()
  }
}
