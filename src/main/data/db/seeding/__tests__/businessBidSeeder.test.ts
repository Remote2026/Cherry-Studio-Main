import '@data/services/AgentSessionMessageService'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { appStateTable } from '@data/db/schemas/appState'
import { promptBindingTable, promptTable } from '@data/db/schemas/prompt'
import {
  BusinessBidSeeder,
  BUSINESS_BID_AGENT_ID,
  BUSINESS_BID_PREVIOUS_PROMPT_CONTENT
} from '@data/db/seeding/seeders/businessBidSeeder'
import { agentService } from '@data/services/AgentService'
import { promptService } from '@data/services/PromptService'
import { generateOrderKeyBetween } from '@data/services/utils/orderKey'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'

describe('BusinessBidSeeder', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    dbh.db.delete(agentSessionMessageTable).run()
    dbh.db.delete(agentSessionTable).run()
    dbh.db.delete(agentWorkspaceTable).run()
    dbh.db.delete(promptBindingTable).run()
    dbh.db.delete(promptTable).run()
    dbh.db.delete(agentTable).run()
    dbh.db.delete(appStateTable).run()
  })

  it('uses a stable seeder identity', () => {
    const seeder = new BusinessBidSeeder()
    expect(seeder.name).toBe('businessBid')
    expect(seeder.version).toBe('9')
    expect(seeder.executionPolicy).toBe('run-on-change')
    expect(seeder.description).toBeTruthy()
  })

  it('creates the business bid agent with its system prompt and avatar', () => {
    new BusinessBidSeeder().run(dbh.db)

    const [agent] = dbh.db.select().from(agentTable).where(eq(agentTable.id, BUSINESS_BID_AGENT_ID)).all()
    expect(agent).toMatchObject({
      id: 'business-bid',
      type: 'pi',
      name: '生成商务标书',
      description: '根据招标文件分析报告生成商务投标文件 DOCX',
      model: null
    })
    expect(agent.instructions.startsWith('# 角色')).toBe(true)
    expect(agent.instructions).toContain('你是专业的商务投标文件编制 Agent')
    expect(agent.instructions).toContain('一个商务标书模板 DOCX')
    expect(agent.instructions).toContain('一个招标文件分析报告 HTML')
    expect(agent.instructions).toContain('企业知识库')
    expect(agent.instructions).toContain('黄色高亮')
    expect(agent.configuration).toMatchObject({
      avatar: '🍆',
      permission_mode: 'bypassPermissions',
      bootstrap_completed: true,
      env_vars: {}
    })
    expect(agent.configuration).not.toHaveProperty('builtin_role')
  })

  it('creates a system session without pre-seeded messages', () => {
    new BusinessBidSeeder().run(dbh.db)

    const [session] = dbh.db
      .select()
      .from(agentSessionTable)
      .where(eq(agentSessionTable.agentId, BUSINESS_BID_AGENT_ID))
      .all()
    expect(session).toMatchObject({ agentId: BUSINESS_BID_AGENT_ID, name: '' })
    const [workspace] = dbh.db
      .select()
      .from(agentWorkspaceTable)
      .where(eq(agentWorkspaceTable.id, session.workspaceId))
      .all()
    expect(workspace).toMatchObject({ type: AGENT_WORKSPACE_TYPE.SYSTEM })
    expect(
      dbh.db.select().from(agentSessionMessageTable).where(eq(agentSessionMessageTable.sessionId, session.id)).all()
    ).toHaveLength(0)
  })

  it('binds the editable user prompt to the agent', () => {
    new BusinessBidSeeder().run(dbh.db)

    const [prompt] = promptService.listBoundToTarget({ type: 'agent', id: BUSINESS_BID_AGENT_ID })
    expect(prompt).toMatchObject({
      title: '生成商务标书',
      visibility: 'restricted'
    })
    expect(prompt.content.startsWith('# 任务：基于招标文件分析报告生成商务投标文件 DOCX')).toBe(true)
    expect(prompt.content).toContain('{项目名}-商务标书-待补充事项清单.html')
    expect(dbh.db.select().from(promptBindingTable).all()).toHaveLength(1)
  })

  it('upgrades an untouched seeded prompt to the current content', () => {
    new BusinessBidSeeder().run(dbh.db)
    const [seeded] = promptService.listBoundToTarget({ type: 'agent', id: BUSINESS_BID_AGENT_ID })
    promptService.update(seeded.id, { content: BUSINESS_BID_PREVIOUS_PROMPT_CONTENT })

    new BusinessBidSeeder().run(dbh.db)

    const [prompt] = promptService.listBoundToTarget({ type: 'agent', id: BUSINESS_BID_AGENT_ID })
    expect(prompt.content.startsWith('# 任务：基于招标文件分析报告生成商务投标文件 DOCX')).toBe(true)
  })

  it('upgrades the avatar of an unmodified install', () => {
    dbh.db
      .insert(agentTable)
      .values({
        id: BUSINESS_BID_AGENT_ID,
        type: 'pi',
        name: '生成商务标书',
        description: '',
        instructions: '',
        configuration: { avatar: '📑', custom: true },
        orderKey: generateOrderKeyBetween(null, null)
      })
      .run()

    new BusinessBidSeeder().run(dbh.db)

    const [agent] = dbh.db.select().from(agentTable).where(eq(agentTable.id, BUSINESS_BID_AGENT_ID)).all()
    expect(agent.configuration).toMatchObject({ avatar: '🍆', custom: true })
  })

  it('keeps a user-customized avatar', () => {
    dbh.db
      .insert(agentTable)
      .values({
        id: BUSINESS_BID_AGENT_ID,
        type: 'pi',
        name: '生成商务标书',
        description: '',
        instructions: '',
        configuration: { avatar: '🥝' },
        orderKey: generateOrderKeyBetween(null, null)
      })
      .run()

    new BusinessBidSeeder().run(dbh.db)

    const [agent] = dbh.db.select().from(agentTable).where(eq(agentTable.id, BUSINESS_BID_AGENT_ID)).all()
    expect(agent.configuration).toMatchObject({ avatar: '🥝' })
  })

  it('is idempotent across repeated runs', () => {
    const seeder = new BusinessBidSeeder()
    seeder.run(dbh.db)
    seeder.run(dbh.db)

    expect(dbh.db.select().from(agentTable).all()).toHaveLength(1)
    expect(dbh.db.select().from(agentSessionTable).all()).toHaveLength(1)
    expect(dbh.db.select().from(promptTable).all()).toHaveLength(1)
    expect(dbh.db.select().from(promptBindingTable).all()).toHaveLength(1)
  })

  it('preserves agent edits but force-updates the bound prompt', () => {
    new BusinessBidSeeder().run(dbh.db)
    dbh.db
      .update(agentTable)
      .set({ name: '我的商务标书助手', description: '自定义描述', instructions: '自定义提示词' })
      .where(eq(agentTable.id, BUSINESS_BID_AGENT_ID))
      .run()
    const [prompt] = promptService.listBoundToTarget({ type: 'agent', id: BUSINESS_BID_AGENT_ID })
    promptService.update(prompt.id, { title: '自定义标题', content: '自定义内容' })

    new BusinessBidSeeder().run(dbh.db)

    const [agent] = dbh.db.select().from(agentTable).where(eq(agentTable.id, BUSINESS_BID_AGENT_ID)).all()
    expect(agent.name).toBe('我的商务标书助手')
    expect(agent.description).toBe('自定义描述')
    expect(agent.instructions.startsWith('# 角色')).toBe(true)
    const [updated] = promptService.listBoundToTarget({ type: 'agent', id: BUSINESS_BID_AGENT_ID })
    expect(updated).toMatchObject({
      title: '生成商务标书',
      content: expect.stringContaining('# 任务：基于招标文件分析报告生成商务投标文件 DOCX')
    })
  })

  it('does not recreate a soft-deleted agent', () => {
    new BusinessBidSeeder().run(dbh.db)
    agentService.deleteAgent(BUSINESS_BID_AGENT_ID)

    new BusinessBidSeeder().run(dbh.db)

    expect(dbh.db.select().from(agentTable).all()).toHaveLength(1)
    const [agent] = dbh.db.select().from(agentTable).all()
    expect(agent.deletedAt).not.toBeNull()
  })

  it('does not recreate a permanently deleted agent and keeps the install marker', () => {
    new BusinessBidSeeder().run(dbh.db)
    agentService.deleteAgent(BUSINESS_BID_AGENT_ID)
    agentService.deleteAgent(BUSINESS_BID_AGENT_ID, { permanent: true })

    new BusinessBidSeeder().run(dbh.db)

    expect(dbh.db.select().from(agentTable).all()).toHaveLength(0)
    expect(promptService.listBoundToTarget({ type: 'agent', id: BUSINESS_BID_AGENT_ID })).toHaveLength(0)
    const [marker] = dbh.db
      .select()
      .from(appStateTable)
      .where(eq(appStateTable.key, 'seed:businessBid:installed'))
      .all()
    expect(marker).toBeDefined()
  })

  it('leaves unrelated agents untouched', () => {
    dbh.db
      .insert(agentTable)
      .values({
        id: 'ordinary-agent',
        type: 'pi',
        name: 'Ordinary Agent',
        description: '',
        instructions: '',
        orderKey: generateOrderKeyBetween(null, null)
      })
      .run()

    new BusinessBidSeeder().run(dbh.db)

    expect(dbh.db.select().from(agentTable).all()).toHaveLength(2)
    expect(dbh.db.select().from(agentTable).where(eq(agentTable.id, 'ordinary-agent')).all()).toHaveLength(1)
  })
})
