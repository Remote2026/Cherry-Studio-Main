import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { McpServer } from '@modelcontextprotocol/server'
import { connectMcpTestClient } from '@test-helpers/mcp/client'
import JSZip from 'jszip'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', () => ({ application: { get: () => ({ getPhysicalPath: vi.fn() }) } }))
vi.mock('@main/ai/messages/agentSessionAttachments', () => ({ listAgentSessionAttachments: () => [] }))

import { registerBusinessBidDocumentTools } from '../businessBidDocumentTools'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('business bid DOCX tool', () => {
  it('fills an existing template field without requiring placeholders', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'business-bid-docx-'))
    roots.push(root)
    const workspacePath = path.join(root, 'workspace')
    await mkdir(workspacePath)

    const zip = new JSZip()
    zip.file(
      'word/document.xml',
      '<w:document><w:body><w:p><w:r><w:t>投标人名称：</w:t></w:r></w:p></w:body></w:document>'
    )
    await writeFile(path.join(workspacePath, 'template.docx'), await zip.generateAsync({ type: 'nodebuffer' }))
    await writeFile(path.join(workspacePath, 'report.html'), '<html><body>Project</body></html>')

    const server = new McpServer({ name: 'test', version: '1.0.0' })
    registerBusinessBidDocumentTools(server, {
      agentDataPath: root,
      sessionId: 'session',
      workspacePath
    })
    const client = await connectMcpTestClient(() => server)
    const result = await client.callTool({
      name: 'business_bid_create_docx',
      arguments: {
        templatePath: 'template.docx',
        reportPath: 'report.html',
        projectName: 'Demo',
        replacements: [{ anchorText: '投标人名称：', value: 'Acme', status: 'filled', position: 'after' }]
      }
    })
    await client.close()

    expect(result.isError).toBeFalsy()
    const output = JSON.parse((result.content[0] as { text: string }).text)
    expect(output.replaced).toBe(1)
    expect(output.checklistPath).toContain('待补充事项清单.html')
    const outputZip = await JSZip.loadAsync(await readFile(output.path))
    const document = await outputZip.file('word/document.xml')!.async('string')
    expect(document).toContain('<w:highlight w:val="yellow"/>')
    expect(document).toContain('Acme')
    expect(document).toContain('投标人名称：')
    expect(document).not.toContain('<w:r><w:r>')
  })
})
