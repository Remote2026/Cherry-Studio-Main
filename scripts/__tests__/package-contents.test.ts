import { readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { getNativeModuleFilters } from '../packaging/before-pack'

const projectRoot = path.resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)
const builderRequire = createRequire(require.resolve('electron-builder'))
const { FileMatcher } = builderRequire('app-builder-lib/out/fileMatcher')
const config = parse(readFileSync(path.join(projectRoot, 'electron-builder.yml'), 'utf8')) as { files: string[] }
const fileStat = statSync(path.join(projectRoot, 'package.json'))

function includesFile(filename: string, patterns = config.files): boolean {
  return new FileMatcher(projectRoot, projectRoot, (value: string) => value, patterns).createFilter()(
    path.join(projectRoot, filename),
    fileStat
  )
}

describe('packaged dependency contents', () => {
  it.each([
    ['darwin', 'arm64', 'darwin-arm64'],
    ['darwin', 'x64', 'darwin-x64'],
    ['linux', 'arm64', 'linux-arm64-gnu'],
    ['linux', 'x64', 'linux-x64-gnu'],
    ['win32', 'arm64', 'win32-arm64-msvc'],
    ['win32', 'x64', 'win32-x64-msvc']
  ])('keeps only %s %s native payloads, including nested dependencies', (platform, arch, nativeBindingTarget) => {
    const patterns = [...config.files, ...getNativeModuleFilters(platform, arch)]
    for (const modules of ['node_modules', 'node_modules/consumer/node_modules']) {
      for (const targetPlatform of ['darwin', 'linux', 'win32']) {
        for (const targetArch of ['arm64', 'x64']) {
          const target = `${targetPlatform}-${targetArch}`
          const keep = targetPlatform === platform && targetArch === arch
          for (const file of [
            `@koromix/koffi-${target}/koffi.node`,
            `node-pty/prebuilds/${target}/pty.node`,
            `selection-hook/prebuilds/${target}/selection.node`
          ]) {
            expect(includesFile(`${modules}/${file}`, patterns), file).toBe(keep)
          }
        }
      }
      for (const target of [
        'darwin-arm64',
        'darwin-x64',
        'darwin-universal',
        'linux-arm64-gnu',
        'linux-x64-gnu',
        'linux-x64-musl',
        'win32-arm64-msvc',
        'win32-x64-msvc'
      ]) {
        const file = `${modules}/@mariozechner/clipboard-${target}/clipboard.node`
        expect(includesFile(file, patterns), file).toBe(target === nativeBindingTarget)
      }
      for (const target of [
        'darwin-arm64',
        'darwin-x64',
        'linux-arm64-gnu',
        'linux-x64-gnu',
        'win32-arm64-msvc',
        'win32-ia32-msvc',
        'win32-x64-msvc'
      ]) {
        const file = `${modules}/node-addon-require-builtin-${target}/package.json`
        expect(includesFile(file, patterns), file).toBe(target === nativeBindingTarget)
      }
    }
  })

  // 内网版裁剪：见 electron-builder.yml，恢复功能即删掉对应排除行。
  it.each(['node_modules', 'node_modules/consumer/node_modules'])(
    'never packages the Claude Code native CLI under %s',
    (modules) => {
      for (const target of ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64']) {
        const file = `${modules}/@anthropic-ai/claude-agent-sdk-${target}/claude`
        expect(includesFile(file), file).toBe(false)
      }
      // 没有原生 CLI 时 SDK 包本身也启动不了，整包一并去掉。
      const sdk = `${modules}/@anthropic-ai/claude-agent-sdk/package.json`
      expect(includesFile(sdk), sdk).toBe(false)
    }
  )

  // 内网版裁剪第二轮：见 electron-builder.yml。这些包要么依赖内网到不了的服务，
  // 要么依赖首次使用时联网下载的模型/语言包。
  it.each([
    '@larksuiteoapi/node-sdk/lib/index.js',
    '@sentry/electron/main/index.js',
    'tesseract.js/package.json',
    'tesseract.js-core/package.json',
    'zlibjs/package.json'
  ])('drops %s from every nested node_modules', (file) => {
    for (const modules of ['node_modules', 'node_modules/consumer/node_modules']) {
      expect(includesFile(`${modules}/${file}`), file).toBe(false)
    }
  })

  it('keeps pdf.js to the files the app reads at runtime', () => {
    // 主进程按 app 路径读取这两个目录（见 pdfjsHandlers），缺了中文 PDF 会渲染成空白。
    for (const file of ['cmaps/Adobe-GB1-UCS2.bcmap', 'standard_fonts/LiberationSans-Regular.ttf']) {
      expect(includesFile(`node_modules/pdfjs-dist/${file}`), file).toBe(true)
    }
    // pdf.js 与 worker 已内联进渲染包，node_modules 里这几份是重复副本。
    for (const file of [
      'build/pdf.mjs',
      'legacy/build/pdf.mjs',
      'web/pdf_viewer.mjs',
      'image_decoders/pdf.image_decoders.mjs'
    ]) {
      expect(includesFile(`node_modules/pdfjs-dist/${file}`), file).toBe(false)
    }
  })

  it('keeps the Pi runtime, the local embedding runtime, the document readers and the system OCR', () => {
    // Pi 是裁剪后唯一还能执行技能（office-transform 等）的运行时，连带依赖必须留着。
    for (const file of [
      'node_modules/@earendil-works/pi-coding-agent/package.json',
      'node_modules/@earendil-works/pi-ai/package.json',
      'node_modules/highlight.js/package.json',
      'node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm',
      // 本地知识库的内置 embedding：模型与 onnxruntime 绑定是部署期数据，JS 运行时必须在包里。
      'node_modules/@huggingface/transformers/package.json',
      // 向量库本体。
      'node_modules/@aiany/sqlite-vec-windows-x64/vec0.dll',
      'node_modules/@vectorstores/core/package.json',
      // 文档解析链：应用主要用来处理文档，全部保留。
      'node_modules/@firecrawl/anydoc/package.json',
      'node_modules/officeparser/package.json',
      'node_modules/jsdom/package.json',
      // 本地 OCR：PaddleOCR 的 JS 部分在包里，模型按需下载；Windows 原生 OCR 也在。
      'node_modules/ppu-paddle-ocr/package.json',
      'node_modules/ppu-ocv/package.json',
      'node_modules/@techstark/opencv-js/dist/opencv.js',
      'node_modules/@napi-rs/system-ocr/package.json'
    ]) {
      expect(includesFile(file), file).toBe(true)
    }
  })

  it('keeps uv/uvx/rg and the MinGit shell for Pi, and drops mise, bun and the rest of MinGit', () => {
    const binaries = 'resources/binaries/win32-x64'
    for (const file of ['mise.exe', 'mise-shim.exe', 'bun.exe', 'git/cmd/git.exe', 'git/mingw64/bin/git.exe']) {
      expect(includesFile(`${binaries}/${file}`), file).toBe(false)
    }
    // Python 供给由 uv 提供，删掉它等于砍掉内置 Python 运行时。
    for (const file of ['uv.exe', 'uvx.exe', 'rg.exe']) {
      expect(includesFile(`${binaries}/${file}`), file).toBe(true)
    }
    // Pi 在 Windows 上必须有一个 bash；MinGit 的 usr/bin/sh.exe 就是 GNU bash 并自带 coreutils。
    for (const file of ['git/usr/bin/sh.exe', 'git/usr/bin/ls.exe', 'git/usr/bin/msys-2.0.dll']) {
      expect(includesFile(`${binaries}/${file}`), file).toBe(true)
    }
  })

  it('ships the offline Python runtime and wheelhouse for bundled document skills', () => {
    const binaries = 'resources/binaries/win32-x64'
    for (const file of [
      'python/python.exe',
      'python/Lib/site-packages/openpyxl/__init__.py',
      'python-wheels/defusedxml-0.7.1-py2.py3-none-any.whl'
    ]) {
      expect(includesFile(`${binaries}/${file}`), file).toBe(true)
    }
  })

  it.each(['node_modules', 'node_modules/consumer/node_modules'])(
    'excludes SQLite build inputs and cached binaries under %s while preserving its runtime',
    (modules) => {
      const root = `${modules}/better-sqlite3`
      for (const file of [
        'deps/sqlite3/sqlite3.c',
        'build/Release/obj/gen/sqlite3/sqlite3.c',
        'bin/darwin-x64-149/better-sqlite3.node',
        'src/better_sqlite3.cpp'
      ]) {
        expect(includesFile(`${root}/${file}`), file).toBe(false)
      }
      for (const file of ['package.json', 'lib/database.js', 'build/Release/better_sqlite3.node']) {
        expect(includesFile(`${root}/${file}`), file).toBe(true)
      }
    }
  )

  it('excludes dependency documentation images without removing runtime assets or source JS', () => {
    for (const file of [
      'node_modules/selection-hook/docs/images/selection-hook.gif',
      'node_modules/@earendil-works/pi-coding-agent/docs/images/exy.png'
    ]) {
      expect(includesFile(file), file).toBe(false)
    }
    for (const file of [
      'node_modules/koffi/src/koffi/index.cjs',
      'node_modules/@deepseek-ai/dsh-sandbox-windows-acl/assets/cherry_acl.ps1',
      'node_modules/@deepseek-ai/dsh-sandbox-windows-acl/assets/SKILL.md',
      'node_modules/pdfjs-dist/cmaps/Adobe-GB1-UCS2.bcmap',
      'resources/builtin-agents/icon.png'
    ]) {
      expect(includesFile(file), file).toBe(true)
    }
  })
})
