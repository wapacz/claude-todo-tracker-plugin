import { expect, test } from 'claude-code/testing'

import {
  costOf,
  formatCost,
  formatElapsed,
  formatTokens,
  modelName,
  progressOf,
  textBar,
  tierOf,
  totalsOf,
  withEndedRun,
  withModelRequest,
  withReportedSteps,
  withStartedRun,
} from './agent-runs'

const SPAWNED = { id: 'a1', agentId: 'a1', type: 'savvy-medium', description: 'Add login form', model: 'claude-opus-5-5' }
const toMicroDollars = (usd: number | undefined) => Math.round((usd ?? 0) * 1e6)

const USAGE = { input_tokens: 1_000, output_tokens: 500, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 2_000 }

test('cost is estimated from the per-model price table', () => {
  expect(toMicroDollars(costOf('claude-opus-5-5', USAGE))).toBe(1_000 * 4 + 500 * 20 + 10_000 * 0.2 + 2_000 * 5)
  expect(toMicroDollars(costOf('claude-haiku-5-5', USAGE))).toBe(1_000 * 1 + 500 * 5 + 10_000 * 0.1 + 2_000 * 1.25)
})

test('model ids read as family and version', () => {
  expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelName('claude-sonnet-5-5-20260601')).toBe('Sonnet 5.5')
  expect(modelName('claude-fable-5-1[1m]')).toBe('Fable 5.1')
  expect(modelName('custom-model')).toBe('custom-model')
})

test('only savvy worker types get a tier, also when shipped in a plugin', () => {
  expect(tierOf('savvy-careful')).toBe('careful')
  expect(tierOf('savvy-flow:savvy-heavy')).toBe('heavy')
  expect(tierOf('savvy-unknown')).toBe('other')
  expect(tierOf('Explore')).toBe('other')
})

test('a started run counts earlier runs of the same task as rounds', () => {
  const first = withStartedRun([], SPAWNED, 100)
  const second = withStartedRun(first, { ...SPAWNED, id: 'a2', agentId: 'a2', description: 'add login  form!' }, 200)

  expect(second.map(run => run.round)).toEqual([1, 2])
  expect(second[1]).toMatchObject({ status: 'running', startedAt: 200, tokens: 0, contextMax: 1_000_000 })
})

test('each model request replaces the context and adds tokens and cost', () => {
  const started = withStartedRun([], SPAWNED, 0)
  const once = withModelRequest(started, 'a1', { usage: USAGE, model: 'claude-opus-5-5', effort: 'medium' })
  const twice = withModelRequest(once, 'a1', { usage: USAGE, model: 'claude-opus-5-5' })

  expect(twice[0]).toMatchObject({ contextTokens: 13_500, tokens: 27_000, modelRequests: 2, effort: 'medium' })
  expect(toMicroDollars(twice[0]?.costUsd)).toBe(toMicroDollars(2 * costOf('claude-opus-5-5', USAGE)))
})

test('a run whose requests went unseen takes the turn total when it ends', () => {
  const started = withStartedRun([], SPAWNED, 0)
  const ended = withEndedRun(started, 'a1', { isAnswered: true, at: 5_000, usage: { ...USAGE, model: 'claude-haiku-5-5' } })

  expect(ended[0]).toMatchObject({ status: 'done', endedAt: 5_000, tokens: 13_500, model: 'claude-haiku-5-5' })
})

test('a run that saw its requests keeps its own sum when it ends', () => {
  const seen = withModelRequest(withStartedRun([], SPAWNED, 0), 'a1', { usage: USAGE, model: 'claude-opus-5-5' })
  const ended = withEndedRun(seen, 'a1', { isAnswered: false, at: 1, usage: { ...USAGE, input_tokens: 999_999 } })

  expect(ended[0]).toMatchObject({ status: 'failed', tokens: 13_500 })
})

test('reported steps are clamped to the plan and a blank note is dropped', () => {
  const started = withStartedRun([], SPAWNED, 0)
  const reported = withReportedSteps(started, 'a1', { done: 9, total: 4, note: '  ' })

  expect(reported[0]).toMatchObject({ stepsDone: 4, stepsTotal: 4, stepNote: undefined })
  expect(progressOf(reported[0] ?? started[0]!)).toBe(1)
})

test('progress is unknown without reported steps until the run is done', () => {
  const started = withStartedRun([], SPAWNED, 0)
  const done = withEndedRun(started, 'a1', { isAnswered: true, at: 1 })

  expect(progressOf(started[0]!)).toBeNull()
  expect(progressOf(done[0]!)).toBe(1)
})

test('totals span from the first start to the latest end or now', () => {
  const runs = withStartedRun(withEndedRun(withStartedRun([], SPAWNED, 1_000), 'a1', { isAnswered: true, at: 4_000 }), { ...SPAWNED, id: 'a2', agentId: 'a2' }, 2_000)

  expect(totalsOf(runs, 9_000).elapsedMs).toBe(8_000)
  expect(totalsOf([], 9_000)).toEqual({ costUsd: 0, tokens: 0, elapsedMs: 0 })
})

test('numbers are formatted short', () => {
  expect([formatTokens(950), formatTokens(13_500), formatTokens(2_300_000)]).toEqual(['950', '14k', '2.3M'])
  expect([formatCost(0.123), formatCost(12.34)]).toEqual(['≈$0.12', '≈$12.3'])
  expect([formatElapsed(65_000), formatElapsed(3_725_000)]).toEqual(['1:05', '1:02:05'])
  expect(textBar(0.5, 4)).toBe('██░░')
})
