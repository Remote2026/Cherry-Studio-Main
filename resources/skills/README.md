# 内置技能资源

这里的一层目录会在应用启动时由 `installBuiltinSkills()` 同步到
`{userData}/Data/Skills/<folder>/`，并以 `source='builtin'` 登记。新增、删除或修改目录后
必须重启应用才会生效。

## 来源与许可

| 目录 | 来源 | 许可 |
|---|---|---|
| `docx` / `pptx` / `xlsx` / `pdf` | [anthropics/skills](https://github.com/anthropics/skills)，2026-10-17 导入 | Anthropic source-available，**禁止复制与再分发**（见各目录 `LICENSE.txt`） |
| `canvas-design` | 同上 | Apache-2.0；`canvas-fonts/*-OFL.txt` 为 SIL OFL 1.1 |
| `frontend-design` | 同上 | Apache-2.0 |
| `cherry-browser` / `cherry-tool-guide` / `find-skills` / `office-transform` | Cherry Studio 自有 | 见仓库根 LICENSE |

`docx`、`pptx`、`xlsx`、`pdf` 保留上游原文，不做 Cherry 定制；升级时整目录覆盖。
`docx`/`pptx`/`xlsx` 各自带一份相同的 `scripts/office/`（OOXML validators 与 XSD schemas），
这是技能自包含所必需的，不要去重或改成符号链接。

## 运行时依赖

技能脚本通过 shell 里的 `python` / `uv run --with <pkg> python` 执行。Windows x64 构建的安装包
会随包提供离线运行时：

- `resources/binaries/win32-x64/python/`：CPython 3.12 + 预装 site-packages
- `resources/binaries/win32-x64/python-wheels/`：wheelhouse，供 `uv --with` 离线解析

Pi runtime 启动时会注入 `PATH`、`UV_PYTHON`、`UV_OFFLINE`、`UV_FIND_LINKS`、
`PYTHONDONTWRITEBYTECODE` 等环境变量。`uv run --with <pkg>` 只从随包 wheelhouse
离线解析；请求的包不在 wheelhouse 内时命令直接失败，不会回退到在线安装。
`resources/binaries` 被 gitignore，需要联网开发机先运行：

```bash
node scripts/prepare-python-runtime.js
```

预装包覆盖：`defusedxml`、`lxml`、`Pillow`、`openpyxl`、`pypdf`、`pdfplumber`、`pdf2image`、
`python-docx`、`python-pptx`、`PyYAML`、`reportlab`。

## 离线能力边界

Windows x64 安装包内已包含 Python 解释器、运行时依赖中列出的 Python 包、`uv`/`uvx` 以及
对应的 wheelhouse。以下能力在完全无网络的环境下可用/不可用：

| 技能 | 离线可用 | 离线不可用（缺少外部程序或包） |
|---|---|---|
| `docx` | `python-docx` 读写、OOXML 校验 | npm `docx` 创建路径、`pandoc` 读取、LibreOffice 转换与 `accept_changes.py`、Poppler |
| `pptx` | `python-pptx` 编辑、XSD 校验、`clean.py` | npm `pptxgenjs`/`sharp`/`react-icons` 创建路径、`markitdown` 读取、`thumbnail.py`（需 LibreOffice + Poppler） |
| `xlsx` | `openpyxl` 创建/编辑/提取、`office-transform` patch-copy | `pandas`、`markitdown`、`recalc.py`（需 LibreOffice 重算公式） |
| `pdf` | `pypdf`/`pdfplumber` 提取与表单、`reportlab` 生成、`pypdfium2` 渲染 | Poppler（`pdftoppm`/`pdftotext`/`pdfimages`）、Tesseract + `pytesseract`（OCR）、`pdf2image` 的图片转换路径 |
| `office-transform` | 全部（`openpyxl`/`python-docx`/`pypdf`/`python-pptx` 均在 wheelhouse） | 无 |

离线读取文档优先使用应用内置的 `mcp__cherry-tools__to_markdown`（随包 `@firecrawl/anydoc`，
支持 doc/docx/odt/rtf/epub/pdf/演示文稿/表格/csv），不要依赖 `pandoc` 或 `markitdown`。
生成或修改 Office 文件时，使用随包的 Python 库（`python-docx`、`python-pptx`、`openpyxl`、
`reportlab`）或 `office-transform` 的 Generate 路径；不要走技能原文中的 npm 创建路径。

已知限制：

- 仅 Windows x64 有离线 Python；其他平台回退到 uv 在线下载。
- 未打包 LibreOffice、Poppler、pandoc、Tesseract、Node/bun，因此上表“不可用”列的功能在
  内网环境下无法使用。
- 内置的 `docx`/`pptx`/`xlsx`/`pdf` 保持上游原文，其 SKILL.md 中的 npm、pandoc、markitdown
  工作流以 Anthropic 沙箱为前提，不适用于本安装包；不要为适配离线环境修改这些技能文件，
  改用上表列出的替代路径。
- `docx/scripts/accept_changes.py` 的 `/tmp` 路径是上游 POSIX 假设，未修改。
- 不要在 `Data/Skills` 的技能目录里留下 `__pycache__`、`.venv` 或输出文件；否则下次启动会因
  目录哈希不一致而整目录重装。
