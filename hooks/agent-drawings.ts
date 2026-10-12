// Desktop drawings of agent runs: each row is one SVG because the desktop wraps sibling elements
// onto new lines. The row layout, status marks and text fitting are adapted from savvy-progress
// (https://github.com/johnnyvizz/claude-kit/tree/main/plugins/savvy-progress); the builder heads
// in builder-heads.ts are this plugin's own.
//
// MIT License
//
// Copyright (c) 2026 johnnyvizz
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
import type { AgentRun } from '../types'
import {
  colorOf,
  costumeOf,
  modelLabel,
  progressOf,
  contextPercent,
  statsLabel,
  stepsLabel,
  tierOf,
  formatCost,
  formatTokens,
  formatElapsed,
} from './agent-runs'
import type { AgentTotals } from './agent-runs'
import { BUILDER_CSS, builderHead } from './builder-heads'

export const AGENT_ROW_HEIGHT = 66
export const TOTALS_HEIGHT = 44

const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif"
const TEXT_LEFT = 42

const PANE_CSS = `<style>
.t{fill:#1f1f1f}.s{fill:#6b6b68}.m{fill:#9a9a96}.k{fill:#ecebe8}.ln{stroke:#e4e4e1}.tile{fill:#f4f3f0}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.s{fill:#a8a8a4}.m{fill:#7d7d79}.k{fill:#2c2c2b}.ln{stroke:#333331}.tile{fill:#262625}}
.live{animation:p 1.6s ease-in-out infinite}@keyframes p{50%{opacity:.3}}
@media (prefers-reduced-motion: reduce){.live{animation:none}}
</style>`

function escapeXml(text: string): string {
  return text.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] ?? char)
}

// Rough advance of system UI text, in em; good enough to fit a line into its slot.
function charEm(char: string): number {
  if (/[\s.,:;'|!il1()[\]]/.test(char)) return 0.3
  return /[A-Zmw@%]/.test(char) ? 0.72 : 0.56
}

export function textWidth(text: string, size: number): number {
  return [...text].reduce((width, char) => width + charEm(char) * size, 0)
}

export function fitText(text: string, size: number, maxWidth: number): string {
  if (textWidth(text, size) <= maxWidth) return text
  let fitted = ''
  for (const char of text) {
    if (textWidth(`${fitted}${char}…`, size) > maxWidth) break
    fitted += char
  }
  return `${fitted}…`
}

function statusMark(x: number, y: number, run: AgentRun, color: string): string {
  if (run.status === 'running') return `<circle class="live" cx="${x}" cy="${y}" r="3.5" fill="${color}"/>`
  if (run.status === 'done') {
    return `<path d="M${x - 5} ${y}l3.5 3.5 6.5-7" fill="none" stroke="#3B9C5F" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
  }
  return `<path d="M${x - 4} ${y - 4}l8 8M${x + 4} ${y - 4}l-8 8" stroke="#D0453F" stroke-width="1.8" stroke-linecap="round"/>`
}

function svg(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${PANE_CSS}${BUILDER_CSS}${body}</svg>`
}

export function agentRowSvg(width: number, run: AgentRun, at: number): string {
  const tier = tierOf(run.type)
  const color = colorOf(tier)
  const textWidthAvailable = width - TEXT_LEFT - 22
  const meta = [modelLabel(run)]
  if (run.round > 1) meta.push(`round ${run.round}`)
  if (run.status === 'failed') meta.push('error')
  const progress = progressOf(run)
  const stats = statsLabel(run, at)
  const steps = stepsLabel(run)
  const stepsWidth = Math.max(0, textWidthAvailable - textWidth(stats, 11) - 12)
  // Without reported steps the bar falls back to the context fill, drawn grey.
  const fillWidth = Math.round(textWidthAvailable * (progress ?? contextPercent(run) / 100))
  const fill = progress === null ? ' class="m"' : ` fill="${color}"`
  const stepsText =
    steps !== '' && stepsWidth > 30
      ? `<text class="t" x="${TEXT_LEFT}" y="49" font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${escapeXml(fitText(steps, 11, stepsWidth))}</text>`
      : ''
  return svg(
    width,
    AGENT_ROW_HEIGHT,
    `${builderHead(0, 14, costumeOf(run.type), colorOf(costumeOf(run.type)), run.status === 'running')}
<text class="t" x="${TEXT_LEFT}" y="18" font-family="${FONT}" font-size="13" font-weight="600">${escapeXml(fitText(run.description || run.type, 13, textWidthAvailable))}</text>
<text x="${TEXT_LEFT}" y="34" font-family="${FONT}" font-size="11"><tspan fill="${color}">${escapeXml(tier === 'other' ? run.type : tier)}</tspan><tspan class="s">  ${escapeXml(meta.join('  ·  '))}</tspan></text>
${stepsText}
<text class="s" x="${TEXT_LEFT + textWidthAvailable}" y="49" text-anchor="end" font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${escapeXml(stats)}</text>
<rect class="k" x="${TEXT_LEFT}" y="55" width="${textWidthAvailable}" height="4" rx="2"/><rect${fill} x="${TEXT_LEFT}" y="55" width="${fillWidth}" height="4" rx="2"/>
${statusMark(width - 8, 16, run, color)}
<line class="ln" x1="0" y1="65.5" x2="${width}" y2="65.5"/>`,
  )
}

export function totalsSvg(width: number, totals: AgentTotals): string {
  const gap = 6
  const tileWidth = (width - gap * 2) / 3
  const tile = (index: number, label: string, value: string) =>
    `<rect class="tile" x="${index * (tileWidth + gap)}" y="0" width="${tileWidth}" height="40" rx="8"/>
<text class="s" x="${index * (tileWidth + gap) + 9}" y="16" font-family="${FONT}" font-size="11">${label}</text>
<text class="t" x="${index * (tileWidth + gap) + 9}" y="33" font-family="${FONT}" font-size="15" font-weight="600" font-variant-numeric="tabular-nums">${value}</text>`
  return svg(
    width,
    TOTALS_HEIGHT,
    `${tile(0, 'Cost', escapeXml(formatCost(totals.costUsd)))}${tile(1, 'Tokens', formatTokens(totals.tokens))}${tile(2, 'Time', formatElapsed(totals.elapsedMs))}`,
  )
}
