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
`PYTHONDONTWRITEBYTECODE` 等环境变量。`resources/binaries` 被 gitignore，需要联网开发机先运行：

```bash
node scripts/prepare-python-runtime.js
```

预装包覆盖：`defusedxml`、`lxml`、`Pillow`、`openpyxl`、`pypdf`、`pdfplumber`、`pdf2image`、
`python-docx`、`python-pptx`、`PyYAML`、`reportlab`。

已知限制：

- 仅 Windows x64 有离线 Python；其他平台回退到 uv 在线下载。
- 未打包 LibreOffice、Poppler、pandoc、Tesseract、Node/bun。依赖它们的功能不可用：
  `docx/scripts/accept_changes.py`、`pptx/scripts/thumbnail.py`、`xlsx/scripts/recalc.py`、
  `pdf/scripts/convert_pdf_to_images.py`，以及 `docx`/`pptx` SKILL.md 中的 npm 创建路径。
- `docx/scripts/accept_changes.py` 的 `/tmp` 路径是上游 POSIX 假设，未修改。
- 不要在 `Data/Skills` 的技能目录里留下 `__pycache__`、`.venv` 或输出文件；否则下次启动会因
  目录哈希不一致而整目录重装。
