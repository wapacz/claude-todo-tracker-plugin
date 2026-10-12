import type { AgentRun } from '../types'

export type TokenUsage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

export type SpawnedAgent = {
  id: string
  agentId?: string
  type: string
  description: string
  model: string
}

export type ReportedSteps = { done?: number; total?: number; note?: string }

export type AgentTotals = { costUsd: number; tokens: number; elapsedMs: number }

const KEPT_RUNS = 50

// The savvy-flow worker tiers; any other agent type wears the plain white hard hat.
export const TIER_COLOR: Record<string, string> = {
  fable: '#7F77DD',
  heavy: '#D85A30',
  careful: '#BA7517',
  medium: '#378ADD',
  light: '#1D9E75',
  other: '#888780',
}

// USD per million tokens: input, output, cache read, cache write. The engine reports tokens,
// not money, so every cost shown is an estimate from this table.
const PRICES: [RegExp, [number, number, number, number]][] = [
  [/fable|mythos/, [10, 50, 0.25, 12.5]],
  [/opus-5-5/, [4, 20, 0.2, 5]],
  [/opus/, [5, 25, 0.5, 6.25]],
  [/sonnet/, [2, 10, 0.2, 2.5]],
  [/haiku/, [1, 5, 0.1, 1.25]],
]
const FALLBACK_PRICE: [number, number, number, number] = [4, 20, 0.2, 5]

function priceOf(model: string): [number, number, number, number] {
  return PRICES.find(([pattern]) => pattern.test(model.toLowerCase()))?.[1] ?? FALLBACK_PRICE
}

export function costOf(model: string, usage: TokenUsage): number {
  const [input, output, cacheRead, cacheWrite] = priceOf(model)
  const dollarsPerMillion =
    (usage.input_tokens || 0) * input +
    (usage.output_tokens || 0) * output +
    (usage.cache_read_input_tokens || 0) * cacheRead +
    (usage.cache_creation_input_tokens || 0) * cacheWrite
  return dollarsPerMillion / 1e6
}

function tokensOf(usage: TokenUsage): number {
  return (
    (usage.input_tokens || 0) +
    (usage.output_tokens || 0) +
    (usage.cache_read_input_tokens || 0) +
    (usage.cache_creation_input_tokens || 0)
  )
}

export function contextWindowOf(model: string): number {
  return /haiku/i.test(model) ? 200_000 : 1_000_000
}

// `savvy-careful`, or `savvy-flow:savvy-careful` when the agents ship in a plugin.
export function tierOf(type: string): string {
  const bare = type.replace(/^[^:]*:/, '')
  const tier = bare.replace(/^savvy-/, '').toLowerCase()
  return bare.startsWith('savvy-') && tier in TIER_COLOR ? tier : 'other'
}

export function costumeOf(type: string): string {
  return type === 'Explore' ? 'explore' : tierOf(type)
}

export function colorOf(tier: string): string {
  return TIER_COLOR[tier] ?? TIER_COLOR.other ?? '#888780'
}

export function modelName(id: string): string {
  const found = /(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2})(?!\d))?/i.exec(id)
  const [, family = '', major = '', minor] = found ?? []
  if (family === '') return id.replace(/^claude-/, '').replace(/\[.*\]$/, '') || '—'
  const familyName = `${family.charAt(0).toUpperCase()}${family.slice(1).toLowerCase()}`
  return `${familyName} ${major}${minor === undefined ? '' : `.${minor}`}`
}

export function modelLabel(run: AgentRun): string {
  return run.effort === undefined ? modelName(run.model) : `${modelName(run.model)} · ${run.effort}`
}

function sameTask(one: string, other: string): boolean {
  const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  return normalize(one) !== '' && normalize(one) === normalize(other)
}

export function withStartedRun(runs: readonly AgentRun[], spawned: SpawnedAgent, at: number): AgentRun[] {
  // A task returned for another round is delegated again under the same description.
  const round = 1 + runs.filter(run => sameTask(run.description, spawned.description)).length
  const run: AgentRun = {
    ...spawned,
    status: 'running',
    startedAt: at,
    contextTokens: 0,
    contextMax: contextWindowOf(spawned.model),
    tokens: 0,
    costUsd: 0,
    modelRequests: 0,
    round,
  }
  return [...runs.filter(one => one.id !== run.id), run].slice(-KEPT_RUNS)
}

export function withModelRequest(
  runs: readonly AgentRun[],
  agentId: string,
  request: { usage: TokenUsage & { model?: string }; model: string; effort?: string | number },
): AgentRun[] {
  const model = request.usage.model || request.model
  return runs.map(run => {
    if (run.agentId !== agentId) return run
    return {
      ...run,
      model,
      effort: typeof request.effort === 'string' ? request.effort : run.effort,
      contextTokens: tokensOf(request.usage),
      contextMax: contextWindowOf(model),
      tokens: run.tokens + tokensOf(request.usage),
      costUsd: run.costUsd + costOf(model, request.usage),
      modelRequests: run.modelRequests + 1,
    }
  })
}

export function withEndedRun(
  runs: readonly AgentRun[],
  agentId: string,
  ending: { isAnswered: boolean; at: number; usage?: TokenUsage & { model?: string } },
): AgentRun[] {
  return runs.map(run => {
    if (run.agentId !== agentId) return run
    const ended: AgentRun = { ...run, status: ending.isAnswered ? 'done' : 'failed', endedAt: ending.at }
    // A run whose model requests went unseen still gets the turn's own sum.
    if (run.modelRequests > 0 || ending.usage === undefined) return ended
    const model = ending.usage.model || run.model
    return { ...ended, model, tokens: tokensOf(ending.usage), costUsd: costOf(model, ending.usage) }
  })
}

export function withReportedSteps(runs: readonly AgentRun[], agentId: string, reported: ReportedSteps): AgentRun[] {
  return runs.map(run => {
    if (run.agentId !== agentId) return run
    const total = Math.max(0, Math.round(reported.total ?? run.stepsTotal ?? 0))
    const done = Math.max(0, Math.round(reported.done ?? run.stepsDone ?? 0))
    const note = reported.note?.trim()
    return { ...run, stepsTotal: total, stepsDone: total > 0 ? Math.min(total, done) : done, stepNote: note === '' ? undefined : note }
  })
}

export function isRunning(run: AgentRun): boolean {
  return run.status === 'running'
}

export function elapsedMs(run: AgentRun, at: number): number {
  return (run.endedAt ?? Math.max(at, run.startedAt)) - run.startedAt
}

// The worker's reported steps when it reports them; a finished run is full; otherwise unknown.
export function progressOf(run: AgentRun): number | null {
  if (run.status === 'done') return 1
  if ((run.stepsTotal ?? 0) > 0) return Math.min(1, (run.stepsDone ?? 0) / (run.stepsTotal ?? 1))
  return null
}

export function contextPercent(run: AgentRun): number {
  return run.contextMax > 0 ? Math.min(100, Math.round((run.contextTokens / run.contextMax) * 100)) : 0
}

export function stepsLabel(run: AgentRun): string {
  if ((run.stepsTotal ?? 0) === 0) return ''
  const note = run.stepNote === undefined ? '' : ` · ${run.stepNote}`
  return `${run.stepsDone ?? 0}/${run.stepsTotal}${note}`
}

export function totalsOf(runs: readonly AgentRun[], at: number): AgentTotals {
  if (runs.length === 0) return { costUsd: 0, tokens: 0, elapsedMs: 0 }
  const start = Math.min(...runs.map(run => run.startedAt))
  const end = Math.max(...runs.map(run => run.endedAt ?? Math.max(at, run.startedAt)))
  return {
    costUsd: runs.reduce((sum, run) => sum + run.costUsd, 0),
    tokens: runs.reduce((sum, run) => sum + run.tokens, 0),
    elapsedMs: end - start,
  }
}

export function formatTokens(count: number): string {
  if (count >= 1e6) return `${(count / 1e6).toFixed(1)}M`
  if (count >= 1e3) return `${Math.round(count / 1e3)}k`
  return `${Math.round(count)}`
}

export function formatCost(usd: number): string {
  return `≈$${usd < 10 ? usd.toFixed(2) : usd.toFixed(1)}`
}

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secondsPart = String(seconds % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${secondsPart}` : `${minutes}:${secondsPart}`
}

export function statsLabel(run: AgentRun, at: number): string {
  return `ctx ${contextPercent(run)}% · ${formatTokens(run.contextTokens)}  ${formatCost(run.costUsd)}  ${formatElapsed(elapsedMs(run, at))}`
}

export function totalsLabel(totals: AgentTotals): string {
  return `${formatCost(totals.costUsd)} · ${formatTokens(totals.tokens)} tokens · ${formatElapsed(totals.elapsedMs)}`
}

export function textBar(fraction: number, width: number): string {
  const filled = Math.round(width * Math.max(0, Math.min(1, fraction)))
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled))
}
