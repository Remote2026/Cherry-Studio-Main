import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { McpServer } from '@modelcontextprotocol/server'
import JSZip from 'jszip'

import { resolveDocumentSource, type CherryDocumentContext } from '@main/ai/mcp/servers/cherryDocumentTools'
import { modelOutputToMcpResult } from '@main/ai/mcp/toolResult'
import {
  BUSINESS_BID_CREATE_DOCX_TOOL_NAME,
  BUSINESS_BID_CREATE_DOCX_DESCRIPTION,
  businessBidCreateDocxInputSchema,
  businessBidCreateDocxOutputSchema
} from '@shared/ai/builtinTools'

const xmlEscape = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

const highlightFor = (status: 'filled' | 'pending' | 'confirmed'): string =>
  status === 'pending' ? 'red' : status === 'confirmed' ? 'orange' : 'yellow'

const markedText = (value: string, status: 'filled' | 'pending' | 'confirmed'): string =>
  `<w:r><w:rPr><w:highlight w:val="${highlightFor(status)}"/></w:rPr><w:t xml:space="preserve">${xmlEscape(value)}</w:t></w:r>`

function replaceTextRun(
  xml: string,
  anchorText: string,
  value: string,
  status: 'filled' | 'pending' | 'confirmed',
  position: 'after' | 'replace'
) {
  const escaped = xmlEscape(anchorText)
  const pattern = new RegExp(`(<w:r\\b[^>]*>[\\s\\S]*?<w:t[^>]*>${escaped}</w:t>[\\s\\S]*?</w:r>)`, 'g')
  let count = 0
  const next = xml.replace(pattern, (run) => {
    count += 1
    return position === 'replace' ? markedText(value, status) : `${run}${markedText(value, status)}`
  })
  return { xml: next, count }
}

export function registerBusinessBidDocumentTools(server: McpServer, context: CherryDocumentContext): void {
  server.registerTool(
    BUSINESS_BID_CREATE_DOCX_TOOL_NAME,
    { description: BUSINESS_BID_CREATE_DOCX_DESCRIPTION, inputSchema: businessBidCreateDocxInputSchema },
    async (input) => {
      const template = await resolveDocumentSource(context, input.templatePath)
      const report = await resolveDocumentSource(context, input.reportPath)
      if (!template.filename.toLowerCase().endsWith('.docx')) {
        throw new Error('商务标书模板必须是 DOCX 文件')
      }
      if (!report.filename.toLowerCase().endsWith('.html') && !report.filename.toLowerCase().endsWith('.htm')) {
        throw new Error('招标文件分析报告必须是 HTML 文件')
      }
      const reportText = Buffer.from(report.data, 'base64').toString('utf8')
      if (!reportText.trim()) throw new Error('招标文件分析报告为空')

      const zip = await JSZip.loadAsync(Buffer.from(template.data, 'base64'))
      if (!zip.file('word/document.xml')) throw new Error('模板不是有效的 DOCX 文件')

      const wordFiles = Object.keys(zip.files).filter(
        (name) => name === 'word/document.xml' || /^word\/(header|footer)\d+\.xml$/.test(name)
      )
      const missing: string[] = []
      let replaced = 0
      for (const replacement of input.replacements) {
        let count = 0
        for (const filename of wordFiles) {
          const entry = zip.file(filename)
          if (!entry) continue
          const current = await entry.async('string')
          const result = replaceTextRun(
            current,
            replacement.anchorText,
            replacement.value,
            replacement.status,
            replacement.position
          )
          if (result.count > 0) zip.file(filename, result.xml)
          count += result.count
        }
        if (count === 0) missing.push(replacement.anchorText)
        replaced += count
      }

      const outputDirectory = path.resolve(context.workspacePath)
      await mkdir(outputDirectory, { recursive: true })
      const safeProjectName = input.projectName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim()
      const outputPath = path.join(outputDirectory, `${safeProjectName}-商务标书.docx`)
      const output = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
      await writeFile(outputPath, output, { flag: 'wx' }).catch(async (error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        await writeFile(outputPath, output)
      })
      const checklistPath = path.join(outputDirectory, `${safeProjectName}-商务标书-待补充事项清单.html`)
      const checklist = missing.length
        ? missing.map((item) => `<li>${xmlEscape(item)}</li>`).join('')
        : '<li>未发现未匹配的模板字段；仍需人工核验企业资料、分页和打印效果。</li>'
      await writeFile(
        checklistPath,
        `<!doctype html><meta charset="utf-8"><title>${xmlEscape(safeProjectName)}待补充事项</title><h1>待补充事项</h1><ul>${checklist}</ul>`,
        { encoding: 'utf8' }
      )

      return modelOutputToMcpResult({
        type: 'json',
        value: businessBidCreateDocxOutputSchema.parse({ path: outputPath, checklistPath, replaced, missing })
      })
    }
  )
}
