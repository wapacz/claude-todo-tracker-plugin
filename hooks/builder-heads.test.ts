import { expect, test } from 'claude-code/testing'

import { builderHead } from './builder-heads'

const COSTUMES = ['fable', 'heavy', 'careful', 'medium', 'light', 'explore', 'other'] as const

test('every tier wears its own helmet', () => {
  const drawings = COSTUMES.map(costume => builderHead(0, 0, costume, '#378ADD', false))

  expect(new Set(drawings).size).toBe(COSTUMES.length)
})

test('a working builder gets the run class that drives its animations', () => {
  expect(builderHead(0, 0, 'heavy', '#D85A30', true)).toContain('class="c-heavy run"')
  expect(builderHead(0, 0, 'heavy', '#D85A30', false)).toContain('class="c-heavy"')
})

test('the tier accent colors the helmet', () => {
  expect(builderHead(0, 0, 'medium', '#123456', false)).toContain('fill="#123456"')
})

test('an unknown costume falls back to the plain hard hat', () => {
  const plain = builderHead(0, 0, 'other', '#888780', false)
  const unknown = builderHead(0, 0, 'mystery', '#888780', false)

  expect(unknown.replace('c-mystery', 'c-other')).toBe(plain)
})

test('props sit inside the nodding head while the vest stays still', () => {
  const drawing = builderHead(0, 0, 'explore', '#888780', true)

  expect(drawing.indexOf('<g class="bm">')).toBeGreaterThan(drawing.indexOf('<g class="hd">'))
  expect(drawing.indexOf('<g class="bd">')).toBeLessThan(drawing.indexOf('<g class="hd">'))
})
