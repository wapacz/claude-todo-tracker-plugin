import type { Elements, RenderSurface } from 'claude-code'

import type { AgentRun, AgentRunStatus } from '../types'
import { AGENT_ROW_HEIGHT, TOTALS_HEIGHT, agentRowSvg, totalsSvg } from './agent-drawings'
import {
  colorOf,
  contextPercent,
  isRunning,
  modelLabel,
  progressOf,
  statsLabel,
  stepsLabel,
  textBar,
  tierOf,
  totalsLabel,
  totalsOf,
} from './agent-runs'

export type AgentSectionView = {
  runs: readonly AgentRun[]
  at: number
  isFinishedShown: boolean
  columns: number
  isDesktop: boolean
  onToggleFinished: () => void
}

type WrappedLineCount = (text: string, width: number) => number

const ROW_INDENT = 2
const BAR_MIN = 6
const BAR_MAX = 16
const DESKTOP_PIXELS_PER_COLUMN = 8
const DESKTOP_MIN_WIDTH = 200

const STATUS_GLYPH: Record<AgentRunStatus, string> = { running: '●', done: '✓', failed: '✗' }

function statusColor(run: AgentRun): string {
  if (run.status === 'failed') return 'red'
  if (run.status === 'done') return 'green'
  return colorOf(tierOf(run.type))
}

function kindLabel(run: AgentRun): string {
  const tier = tierOf(run.type)
  return tier === 'other' ? run.type : tier
}

function metaLine(run: AgentRun): string {
  const parts = [kindLabel(run), modelLabel(run)]
  if (run.round > 1) parts.push(`round ${run.round}`)
  if (run.status === 'failed') parts.push('error')
  return parts.join(' · ')
}

function barWidth(columns: number): number {
  return Math.max(BAR_MIN, Math.min(BAR_MAX, Math.floor(columns / 3)))
}

function progressLine(run: AgentRun, at: number): string {
  const steps = stepsLabel(run)
  return steps === '' ? statsLabel(run, at) : `${steps} · ${statsLabel(run, at)}`
}

// Newest first, as the work most likely to be watched.
function splitRuns(runs: readonly AgentRun[]): { running: AgentRun[]; finished: AgentRun[] } {
  const newestFirst = [...runs].reverse()
  return { running: newestFirst.filter(isRunning), finished: newestFirst.filter(run => !isRunning(run)) }
}

function finishedToggleLabel(count: number, isShown: boolean): string {
  return `${isShown ? '▾' : '▸'} Finished · ${count}`
}

function visibleRuns(view: AgentSectionView): AgentRun[] {
  const { running, finished } = splitRuns(view.runs)
  return view.isFinishedShown ? [...running, ...finished] : running
}

// Mirrors the terminal drawing below, so the activity log is budgeted by the lines agents really take.
export function agentSectionLines(view: AgentSectionView, wrappedLineCount: WrappedLineCount): number {
  if (view.runs.length === 0) return 0
  const { finished } = splitRuns(view.runs)
  const rowWidth = view.columns - ROW_INDENT
  const runLines = (run: AgentRun) =>
    wrappedLineCount(run.description || run.type, rowWidth - ROW_INDENT) +
    wrappedLineCount(metaLine(run), rowWidth) +
    wrappedLineCount(progressLine(run, view.at), rowWidth - barWidth(view.columns) - 1)
  const heading = 1 + wrappedLineCount(totalsLabel(totalsOf(view.runs, view.at)), view.columns)
  const toggle = finished.length > 0 ? 1 : 0
  const gapAbove = 1
  return gapAbove + heading + toggle + visibleRuns(view).reduce((sum, run) => sum + runLines(run), 0)
}

function TerminalAgentRow(ui: Elements[RenderSurface], run: AgentRun, view: AgentSectionView) {
  const { Box, Text } = ui
  const progress = progressOf(run)
  const color = colorOf(tierOf(run.type))
  // Without reported steps the bar shows how full the context is, dimmed.
  const bar = textBar(progress ?? contextPercent(run) / 100, barWidth(view.columns))
  return (
    <Box key={run.id} flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Text color={color}>▣</Text>
        <Text wrap="wrap">{run.description || run.type}</Text>
        <Text color={statusColor(run)}>{STATUS_GLYPH[run.status]}</Text>
      </Box>
      <Box flexDirection="row" paddingLeft={ROW_INDENT}>
        <Text dimColor wrap="wrap">{metaLine(run)}</Text>
      </Box>
      <Box flexDirection="row" gap={1} paddingLeft={ROW_INDENT}>
        {progress === null ? <Text dimColor>{bar}</Text> : <Text color={color}>{bar}</Text>}
        <Text dimColor wrap="wrap">{progressLine(run, view.at)}</Text>
      </Box>
    </Box>
  )
}

function desktopWidth(columns: number): number {
  return Math.max(DESKTOP_MIN_WIDTH, columns * DESKTOP_PIXELS_PER_COLUMN)
}

function rowAlt(run: AgentRun, at: number): string {
  return `${run.description || run.type}: ${metaLine(run)}, ${run.status}, ${progressLine(run, at)}`
}

export function AgentSection(ui: Elements[RenderSurface], view: AgentSectionView) {
  if (view.runs.length === 0) return null
  const { Box, Text, Button } = ui
  const { running, finished } = splitRuns(view.runs)
  const totals = totalsOf(view.runs, view.at)
  const width = desktopWidth(view.columns)
  const isSvgDrawn = view.isDesktop && 'Svg' in ui
  const drawRun = (run: AgentRun) =>
    isSvgDrawn && 'Svg' in ui ? (
      <ui.Svg key={run.id} source={agentRowSvg(width, run, view.at)} alt={rowAlt(run, view.at)} width={width} height={AGENT_ROW_HEIGHT} />
    ) : (
      TerminalAgentRow(ui, run, view)
    )

  return (
    <Box flexDirection="column">
      <Text bold>Agents</Text>
      {isSvgDrawn && 'Svg' in ui ? (
        <ui.Svg source={totalsSvg(width, totals)} alt={totalsLabel(totals)} width={width} height={TOTALS_HEIGHT} />
      ) : (
        <Text dimColor wrap="wrap">{totalsLabel(totals)}</Text>
      )}
      {running.map(drawRun)}
      {finished.length > 0 && (
        <Box flexDirection="row">
          <Button
            key="finished-agents"
            plain
            label={finishedToggleLabel(finished.length, view.isFinishedShown)}
            onPress={view.onToggleFinished}
          />
        </Box>
      )}
      {view.isFinishedShown && finished.map(drawRun)}
    </Box>
  )
}
