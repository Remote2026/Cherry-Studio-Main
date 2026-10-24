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
import { BidAnalysisSeeder, BID_ANALYSIS_AGENT_ID } from '@data/db/seeding/seeders/bidAnalysisSeeder'
import { agentService } from '@data/services/AgentService'
import { promptService } from '@data/services/PromptService'
import { generateOrderKeyBetween } from '@data/services/utils/orderKey'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'

describe('BidAnalysisSeeder', () => {
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
    const seeder = new BidAnalysisSeeder()
    expect(seeder.name).toBe('bidAnalysis')
    expect(seeder.version).toBe('6')
    expect(seeder.executionPolicy).toBe('run-on-change')
    expect(seeder.description).toBeTruthy()
  })

  it('creates the bid analysis agent with its system prompt and avatar', () => {
    new BidAnalysisSeeder().run(dbh.db)

    const [agent] = dbh.db.select().from(agentTable).where(eq(agentTable.id, BID_ANALYSIS_AGENT_ID)).all()
    expect(agent).toMatchObject({
      id: 'bid-analysis',
      type: 'pi',
      name: '招标文件分析',
      description: '分析招标文件，生成 HTML 格式的分析报告',
      model: null
    })
    expect(agent.instructions.startsWith('# 角色定义')).toBe(true)
    expect(agent.instructions).toContain('你是一名资深投标顾问和招标采购文件分析专家')
    expect(agent.configuration).toMatchObject({
      avatar: '🍆',
      permission_mode: 'bypassPermissions',
      bootstrap_completed: true,
      env_vars: {}
    })
    expect(agent.configuration).not.toHaveProperty('builtin_role')
  })

  it('upgrades the system prompt of an unmodified v1 install', () => {
    dbh.db
      .insert(agentTable)
      .values({
        id: BID_ANALYSIS_AGENT_ID,
        type: 'pi',
        name: '标书分析',
        description: '分析招标文件，生成 HTML 格式的分析问卷',
        instructions: '你是标书顾问',
        orderKey: generateOrderKeyBetween(null, null)
      })
      .run()
    dbh.db.insert(appStateTable).values({ key: 'seed:bidAnalysis:installed', value: {} }).run()

    new BidAnalysisSeeder().run(dbh.db)

    const [agent] = dbh.db.select().from(agentTable).where(eq(agentTable.id, BID_ANALYSIS_AGENT_ID)).all()
    expect(agent.name).toBe('招标文件分析')
    expect(agent.description).toBe('分析招标文件，生成 HTML 格式的分析报告')
    expect(agent.instructions.startsWith('# 角色定义')).toBe(true)
    expect(agent.instructions).not.toBe('你是标书顾问')
  })

  it('creates a system session without pre-seeded messages', () => {
    new BidAnalysisSeeder().run(dbh.db)

    const [session] = dbh.db
      .select()
      .from(agentSessionTable)
      .where(eq(agentSessionTable.agentId, BID_ANALYSIS_AGENT_ID))
      .all()
    expect(session).toMatchObject({ agentId: BID_ANALYSIS_AGENT_ID, name: '' })
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
    new BidAnalysisSeeder().run(dbh.db)

    const [prompt] = promptService.listBoundToTarget({ type: 'agent', id: BID_ANALYSIS_AGENT_ID })
    expect(prompt).toMatchObject({
      title: '生成分析报告',
      visibility: 'restricted'
    })
    expect(prompt.content.startsWith('请分析本次上传的招标文件')).toBe(true)
    expect(prompt.content).toContain('报告文件名：xxxx招标文件分析报告.html')
    expect(dbh.db.select().from(promptBindingTable).all()).toHaveLength(1)
  })

  it('upgrades the bound user prompt of an unmodified install', () => {
    dbh.db
      .insert(agentTable)
      .values({
        id: BID_ANALYSIS_AGENT_ID,
        type: 'pi',
        name: '标书分析',
        description: '分析招标文件，生成 HTML 格式的分析问卷',
        instructions: '你是标书顾问',
        orderKey: generateOrderKeyBetween(null, null)
      })
      .run()
    promptService.createRestrictedForTargetTx(dbh.db, { type: 'agent', id: BID_ANALYSIS_AGENT_ID }, [
      { title: '生成分析问卷', content: '分析项目招标文件，生成html格式的分析问卷' }
    ])
    dbh.db.insert(appStateTable).values({ key: 'seed:bidAnalysis:installed', value: {} }).run()

    new BidAnalysisSeeder().run(dbh.db)

    const [agent] = dbh.db.select().from(agentTable).where(eq(agentTable.id, BID_ANALYSIS_AGENT_ID)).all()
    expect(agent.name).toBe('招标文件分析')
    const [prompt] = promptService.listBoundToTarget({ type: 'agent', id: BID_ANALYSIS_AGENT_ID })
    expect(prompt.title).toBe('生成分析报告')
    expect(prompt.content.startsWith('请分析本次上传的招标文件')).toBe(true)
  })

  it('upgrades the avatar of an unmodified install', () => {
    dbh.db
      .insert(agentTable)
      .values({
        id: BID_ANALYSIS_AGENT_ID,
        type: 'pi',
        name: '我的分析助手',
        description: '自定义描述',
        instructions: '自定义提示词',
        configuration: { avatar: '📋', custom: true },
        orderKey: generateOrderKeyBetween(null, null)
      })
      .run()

    new BidAnalysisSeeder().run(dbh.db)

    const [agent] = dbh.db.select().from(agentTable).where(eq(agentTable.id, BID_ANALYSIS_AGENT_ID)).all()
    expect(agent.configuration).toMatchObject({ avatar: '🍆', custom: true })
  })

  it('keeps a user-customized avatar', () => {
    dbh.db
      .insert(agentTable)
      .values({
        id: BID_ANALYSIS_AGENT_ID,
        type: 'pi',
        name: '我的分析助手',
        description: '自定义描述',
        instructions: '自定义提示词',
        configuration: { avatar: '🦄' },
        orderKey: generateOrderKeyBetween(null, null)
      })
      .run()

    new BidAnalysisSeeder().run(dbh.db)

    const [agent] = dbh.db.select().from(agentTable).where(eq(agentTable.id, BID_ANALYSIS_AGENT_ID)).all()
    expect(agent.configuration).toMatchObject({ avatar: '🦄' })
  })

  it('is idempotent across repeated runs', () => {
    const seeder = new BidAnalysisSeeder()
    seeder.run(dbh.db)
    seeder.run(dbh.db)

    expect(dbh.db.select().from(agentTable).all()).toHaveLength(1)
    expect(dbh.db.select().from(agentSessionTable).all()).toHaveLength(1)
    expect(dbh.db.select().from(promptTable).all()).toHaveLength(1)
    expect(dbh.db.select().from(promptBindingTable).all()).toHaveLength(1)
  })

  it('preserves user edits when the seeder reruns', () => {
    new BidAnalysisSeeder().run(dbh.db)
    dbh.db
      .update(agentTable)
      .set({ name: '我的标书助手', description: '自定义描述', instructions: '自定义提示词' })
      .where(eq(agentTable.id, BID_ANALYSIS_AGENT_ID))
      .run()
    const [prompt] = promptService.listBoundToTarget({ type: 'agent', id: BID_ANALYSIS_AGENT_ID })
    promptService.update(prompt.id, { title: '自定义标题', content: '自定义内容' })

    new BidAnalysisSeeder().run(dbh.db)

    const [agent] = dbh.db.select().from(agentTable).where(eq(agentTable.id, BID_ANALYSIS_AGENT_ID)).all()
    expect(agent.name).toBe('我的标书助手')
    expect(agent.description).toBe('自定义描述')
    expect(agent.instructions).toBe('自定义提示词')
    const [updated] = promptService.listBoundToTarget({ type: 'agent', id: BID_ANALYSIS_AGENT_ID })
    expect(updated).toMatchObject({ title: '自定义标题', content: '自定义内容' })
  })

  it('does not recreate a soft-deleted agent', () => {
    new BidAnalysisSeeder().run(dbh.db)
    agentService.deleteAgent(BID_ANALYSIS_AGENT_ID)

    new BidAnalysisSeeder().run(dbh.db)

    expect(dbh.db.select().from(agentTable).all()).toHaveLength(1)
    const [agent] = dbh.db.select().from(agentTable).all()
    expect(agent.deletedAt).not.toBeNull()
  })

  it('does not recreate a permanently deleted agent and keeps the install marker', () => {
    new BidAnalysisSeeder().run(dbh.db)
    agentService.deleteAgent(BID_ANALYSIS_AGENT_ID)
    agentService.deleteAgent(BID_ANALYSIS_AGENT_ID, { permanent: true })

    new BidAnalysisSeeder().run(dbh.db)

    expect(dbh.db.select().from(agentTable).all()).toHaveLength(0)
    expect(promptService.listBoundToTarget({ type: 'agent', id: BID_ANALYSIS_AGENT_ID })).toHaveLength(0)
    const [marker] = dbh.db
      .select()
      .from(appStateTable)
      .where(eq(appStateTable.key, 'seed:bidAnalysis:installed'))
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

    new BidAnalysisSeeder().run(dbh.db)

    expect(dbh.db.select().from(agentTable).all()).toHaveLength(2)
    expect(dbh.db.select().from(agentTable).where(eq(agentTable.id, 'ordinary-agent')).all()).toHaveLength(1)
  })
})
