import type { Elements, RenderSurface } from 'claude-code'

import { FONT, escapeXml, svg, textWidth } from './agent-drawings'
import { textBar } from './agent-runs'

// The plan's overall bar, as savvy-progress draws its flow: finished rows out of all rows.
export type PlanProgress = { done: number; total: number }

export type PlanProgressView = { progress: PlanProgress; columns: number; isDesktop: boolean }

export const PLAN_BAR_HEIGHT = 18

const ACCENT = '#8f8cf4'
const DONE = '#5fbf8f'
const BAR_MIN = 6
const BAR_MAX = 24
const DESKTOP_PIXELS_PER_COLUMN = 8
const DESKTOP_MIN_WIDTH = 200
const LABEL_GAP = 10

export function hasPlanProgress(progress: PlanProgress): boolean {
  return progress.total > 0
}

export function planFraction(progress: PlanProgress): number {
  return progress.total > 0 ? Math.min(1, progress.done / progress.total) : 0
}

export function isPlanFinished(progress: PlanProgress): boolean {
  return hasPlanProgress(progress) && progress.done >= progress.total
}

export function planProgressLabel(progress: PlanProgress): string {
  return `${progress.done}/${progress.total} · ${Math.round(planFraction(progress) * 100)}%`
}

function barColor(progress: PlanProgress): string {
  return isPlanFinished(progress) ? DONE : ACCENT
}

function terminalBarWidth(progress: PlanProgress, columns: number): number {
  return Math.max(BAR_MIN, Math.min(BAR_MAX, columns - planProgressLabel(progress).length - 1))
}

// One gap above the bar plus the bar itself, so the activity log is budgeted by what the pane really draws.
export function planProgressLines(progress: PlanProgress): number {
  return hasPlanProgress(progress) ? 2 : 0
}

export function planProgressSvg(width: number, progress: PlanProgress): string {
  const label = planProgressLabel(progress)
  const trackWidth = Math.max(0, width - textWidth(label, 11) - LABEL_GAP)
  const fillWidth = Math.round(trackWidth * planFraction(progress))
  return svg(
    width,
    PLAN_BAR_HEIGHT,
    `<rect class="k" x="0" y="7" width="${trackWidth}" height="4" rx="2"/><rect fill="${barColor(progress)}" x="0" y="7" width="${fillWidth}" height="4" rx="2"/>
<text class="s" x="${width}" y="13" text-anchor="end" font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${escapeXml(label)}</text>`,
  )
}

export function PlanProgressBar(ui: Elements[RenderSurface], view: PlanProgressView) {
  if (!hasPlanProgress(view.progress)) return null
  const { Box, Text } = ui
  const label = planProgressLabel(view.progress)
  if (view.isDesktop && 'Svg' in ui) {
    const width = Math.max(DESKTOP_MIN_WIDTH, view.columns * DESKTOP_PIXELS_PER_COLUMN)
    return <ui.Svg source={planProgressSvg(width, view.progress)} alt={`Plan ${label}`} width={width} height={PLAN_BAR_HEIGHT} />
  }
  const bar = textBar(planFraction(view.progress), terminalBarWidth(view.progress, view.columns))
  return (
    <Box flexDirection="row" gap={1}>
      <Text color={barColor(view.progress)}>{bar}</Text>
      <Text dimColor>{label}</Text>
    </Box>
  )
}
