import { expect, test } from 'claude-code/testing'

import { isPlanFinished, planFraction, planProgressLabel, planProgressLines, planProgressSvg } from './plan-progress'

test('the label shows finished rows out of all rows and the rounded percent', () => {
  expect(planProgressLabel({ done: 2, total: 3 })).toBe('2/3 · 67%')
  expect(planProgressLabel({ done: 0, total: 4 })).toBe('0/4 · 0%')
})

test('an empty plan has no bar and takes no lines', () => {
  expect(planFraction({ done: 0, total: 0 })).toBe(0)
  expect(planProgressLines({ done: 0, total: 0 })).toBe(0)
  expect(isPlanFinished({ done: 0, total: 0 })).toBe(false)
})

test('a plan with rows takes the gap above it and one bar line', () => {
  expect(planProgressLines({ done: 1, total: 5 })).toBe(2)
})

test('the fraction never runs past a full bar', () => {
  expect(planFraction({ done: 7, total: 5 })).toBe(1)
  expect(isPlanFinished({ done: 5, total: 5 })).toBe(true)
})

test('the desktop bar fills its track in proportion and turns green when finished', () => {
  const half = planProgressSvg(300, { done: 1, total: 2 })
  const finished = planProgressSvg(300, { done: 2, total: 2 })

  expect(half).toContain('fill="#8f8cf4"')
  expect(half).toContain('1/2 · 50%')
  expect(finished).toContain('fill="#5fbf8f"')
})
