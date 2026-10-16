// Minimal Markdown → styled PDF generator.
// Usage: node deploy/md-to-pdf.mjs <input.md> <output.pdf>
// Renders the .md to a themed HTML file, then prints it to PDF via headless
// Chrome or Edge (whichever is installed). Requires the `marked` package.
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { marked } from 'marked'

const run = promisify(execFile)
const [, , inPath, outPath] = process.argv
if (!inPath || !outPath) { console.error('usage: node md-to-pdf.mjs <in.md> <out.pdf>'); process.exit(1) }

const md = await readFile(inPath, 'utf8')
const title = (md.match(/^#\s+(.+)$/m)?.[1] || path.basename(inPath)).trim()
const body = marked.parse(md)

const css = `
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", "Noto Sans", Arial, sans-serif; color: #1f2937; font-size: 11pt; line-height: 1.5; }
  h1 { font-size: 21pt; color: #0f7a3d; border-bottom: 3px solid #16a34a; padding-bottom: 8px; margin: 0 0 6px; }
  h2 { font-size: 14.5pt; color: #0f7a3d; margin: 22px 0 8px; padding-top: 6px; border-top: 1px solid #e5e7eb; }
  h3 { font-size: 12pt; color: #111827; margin: 16px 0 6px; }
  p { margin: 8px 0; }
  strong { color: #111827; }
  a { color: #0f7a3d; text-decoration: none; }
  code { background: #f3f4f6; padding: 1px 5px; border-radius: 4px; font-family: "Cascadia Code", Consolas, monospace; font-size: 9.5pt; color: #b91c1c; }
  pre { background: #0b1020; color: #e5e7eb; padding: 14px 16px; border-radius: 8px; overflow-x: auto; font-size: 9pt; line-height: 1.35; }
  pre code { background: none; color: inherit; padding: 0; }
  blockquote { margin: 12px 0; padding: 8px 14px; background: #f0fdf4; border-left: 4px solid #16a34a; color: #374151; border-radius: 0 6px 6px 0; }
  blockquote p { margin: 4px 0; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 9.7pt; }
  th, td { border: 1px solid #d1d5db; padding: 7px 10px; text-align: left; vertical-align: top; }
  th { background: #16a34a; color: #fff; font-weight: 600; }
  tr:nth-child(even) td { background: #f9fafb; }
  hr { border: none; border-top: 1px solid #e5e7eb; margin: 22px 0; }
  ul, ol { margin: 8px 0; padding-left: 22px; }
  li { margin: 3px 0; }
  table, pre, blockquote, h2, h3 { page-break-inside: avoid; }
  .doc-footer { margin-top: 26px; padding-top: 10px; border-top: 1px solid #e5e7eb; font-size: 8.5pt; color: #9ca3af; }
`

const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${css}</style></head>
<body>${body}<div class="doc-footer">NativeTalk Platform · generated from ${path.basename(inPath)}</div></body></html>`

const htmlPath = outPath.replace(/\.pdf$/i, '') + '.tmp.html'
await writeFile(htmlPath, html, 'utf8')

const candidates = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
]
const browser = candidates.find((p) => existsSync(p))
if (!browser) { console.error('No Chrome/Edge found for PDF rendering'); process.exit(1) }

const absHtml = 'file:///' + path.resolve(htmlPath).replace(/\\/g, '/')
const absPdf = path.resolve(outPath)
await run(browser, [
  '--headless', '--disable-gpu', '--no-pdf-header-footer',
  `--print-to-pdf=${absPdf}`, absHtml,
], { maxBuffer: 1024 * 1024 * 32 })

console.log('PDF written:', absPdf)
