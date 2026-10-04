import { expect, mock, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'
import type { On, RenderElement, RenderSurface } from 'claude-code'

type SidebarMount = Mounted<RenderSurface, 'Pane'>

const SURFACES = ['terminal', 'desktop'] as const
const PANE_PROPS = {
  title: 'Todos',
  isFocused: false,
  bodyColumns: 40,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
} as const

const TODOS = [
  { content: 'Wrote the sidebar', status: 'completed', activeForm: 'Writing the sidebar' },
  { content: 'Write the tests', status: 'in_progress', activeForm: 'Writing the tests' },
  { content: 'Ship it', status: 'pending', activeForm: 'Shipping it' },
] as const

const SET_TODOS = 'mcp__todo-sidebar__set_todos'

async function mountSidebar($: Engine, surface: RenderSurface): Promise<SidebarMount> {
  return $.ui.mount({
    plugin: 'todo-sidebar',
    surface,
    component: 'Pane',
    props: PANE_PROPS,
    requestId: 'todo-sidebar',
  })
}

type Drawn = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

function isDrawn(value: unknown): value is Drawn {
  return typeof value === 'object' && value !== null && 'type' in value
}

function textOf(node: unknown): string {
  if (typeof node === 'string') return node
  if (!isDrawn(node)) return ''
  return (node.children ?? []).map(textOf).join('')
}

function collectRows(node: unknown, rows: string[]): void {
  if (!isDrawn(node)) return
  const isRow = node.type === 'Box' && node.props?.flexDirection === 'row'
  if (node.type === 'Text' || isRow) {
    const parts = isRow ? (node.children ?? []).map(textOf) : [textOf(node)]
    const indent = typeof node.props?.paddingLeft === 'number' ? ' '.repeat(node.props.paddingLeft) : ''
    rows.push(indent + parts.filter(part => part !== '').join(' ').trimEnd())
    return
  }
  for (const child of node.children ?? []) collectRows(child, rows)
}

async function drawnRows(ui: SidebarMount): Promise<string[]> {
  const rows: string[] = []
  collectRows((await ui.drawn()) as RenderElement, rows)
  return rows
}

function mockSession(on: On): void {
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.id', () => ({ value: 'session-1' }))
}

function answerFileTools(on: On): void {
  on('tool.call', { tool: 'Read' }, () => ({ result: { type: 'text', file: { filePath: 'x', content: '', numLines: 0, startLine: 1, totalLines: 0 } } }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  on('tool.call', { tool: 'Edit' }, (_, e) => ({
    result: {
      filePath: e.file_path,
      oldString: e.old_string,
      newString: e.new_string,
      originalFile: null,
      structuredPatch: [],
      userModified: false,
      replaceAll: false,
      gitDiff: { filename: e.file_path, status: 'modified', additions: 42, deletions: 6, changes: 48, patch: '' },
    },
  }))
}

test('shows a placeholder before any todo is written', async ($, on) => {
  mockSession(on)
  mock.store(on)
  for (const surface of SURFACES) {
    const ui = await mountSidebar($, surface)

    expect(await drawnRows(ui)).toEqual(['No todos yet.'])
  }
})

test('set_todos draws the title, check marks and the running step in its active form', async ($, on) => {
  mockSession(on)
  mock.store(on)
  const answer = await $.tool.call({ tool: SET_TODOS, title: 'Build the sidebar', todos: [...TODOS] })

  for (const surface of SURFACES) {
    const ui = await mountSidebar($, surface)

    expect(answer.result).toBe('Sidebar updated: 1/3 done, 1 in progress.')
    expect(await drawnRows(ui)).toEqual([
      'Build the sidebar',
      '✓ Wrote the sidebar',
      '○ Writing the tests…',
      '○ Ship it',
    ])
  }
})

test('set_todos without a title falls back to a progress summary', async ($, on) => {
  mockSession(on)
  mock.store(on)
  await $.tool.call({ tool: SET_TODOS, todos: [...TODOS] })
  const ui = await mountSidebar($, 'terminal')

  expect((await drawnRows(ui))[0]).toBe('1/3 done, 1 in progress')
})

test('set_todos denies a malformed list and keeps the previous one', async ($, on) => {
  mockSession(on)
  mock.store(on)
  await $.tool.call({ tool: SET_TODOS, todos: [...TODOS] })
  const denied = await $.tool.call({ tool: SET_TODOS, todos: [{ content: 'Bad status', status: 'done' }] })
  const ui = await mountSidebar($, 'terminal')

  expect(denied.deny).toBe('set_todos: todos[0].status must be one of pending, in_progress, completed')
  expect(await drawnRows(ui)).toHaveLength(4)
})

test('tool calls appear as an activity log with verb, target and diff counts', { options: { showActivityLog: true } }, async ($, on) => {
  mockSession(on)
  mock.store(on)
  answerFileTools(on)
  await $.tool.call({ tool: SET_TODOS, todos: [...TODOS] })

  await $.tool.call({ tool: 'Read', file_path: '/repo/auth.provider.ts' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/auth/oauth.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Bash', command: 'npm   test' })
  const ui = await mountSidebar($, 'terminal')

  expect((await drawnRows(ui)).slice(4)).toEqual([
    '│ Read auth.provider.ts',
    '│ Edit src/auth/oauth.ts (+42 -6)',
    '│ Run  npm test',
  ])
})

test('set_todos itself never shows up in the activity log', async ($, on) => {
  mockSession(on)
  mock.store(on)
  await $.tool.call({ tool: SET_TODOS, todos: [...TODOS] })
  const ui = await mountSidebar($, 'terminal')

  expect((await drawnRows(ui)).some(row => row.startsWith('│'))).toBe(false)
})

test('a successful TodoWrite still mirrors into the sidebar', async ($, on) => {
  mockSession(on)
  mock.store(on)
  on('tool.call', { tool: 'TodoWrite' }, (_, e) => ({ result: { oldTodos: [], newTodos: [...e.todos] } }))

  await $.tool.call({ tool: 'TodoWrite', todos: [...TODOS] })
  const ui = await mountSidebar($, 'terminal')

  expect(await drawnRows(ui)).toHaveLength(4)
})

test('/todos-demo fills the sidebar with the example task', async ($, on) => {
  mockSession(on)
  mock.store(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))

  const answer = await $.command.run({
    command: 'todos-demo',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
  const ui = await mountSidebar($, 'terminal')
  const rows = await drawnRows(ui)

  expect(answer?.text).toBe('Example list of 6 todos shown in the sidebar.')
  expect(rows[0]).toBe('Implement OAuth scopes')
  expect(rows).toHaveLength(14)
})

const PARENT_WITH_SUBTASKS = {
  content: 'Update documentation',
  status: 'pending',
  activeForm: 'Updating documentation',
  subtasks: [
    { content: 'Wrote docs/oauth.md', status: 'completed', activeForm: 'Writing docs/oauth.md' },
    { content: 'Add README section', status: 'in_progress', activeForm: 'Adding README section' },
    { content: 'Link from CHANGELOG', status: 'pending', activeForm: 'Linking from CHANGELOG' },
  ],
} as const

test('subtasks draw indented and a partly done parent gets a yellow half-filled circle', async ($, on) => {
  mockSession(on)
  mock.store(on)
  const answer = await $.tool.call({ tool: SET_TODOS, todos: [PARENT_WITH_SUBTASKS] })

  for (const surface of SURFACES) {
    const ui = await mountSidebar($, surface)

    expect(answer.result).toBe('Sidebar updated: 0/1 done, 1 in progress.')
    expect(await drawnRows(ui)).toEqual([
      '0/1 done, 1 in progress',
      '◐ Updating documentation…',
      '    ✓ Wrote docs/oauth.md',
      '    ○ Adding README section…',
      '    ○ Link from CHANGELOG',
    ])
  }
})

test('a parent is done once every subtask is done, whatever its own status says', async ($, on) => {
  mockSession(on)
  mock.store(on)
  const allDone = {
    ...PARENT_WITH_SUBTASKS,
    subtasks: PARENT_WITH_SUBTASKS.subtasks.map(step => ({ ...step, status: 'completed' as const })),
  }
  await $.tool.call({ tool: SET_TODOS, todos: [allDone] })
  const ui = await mountSidebar($, 'terminal')

  expect((await drawnRows(ui)).slice(0, 2)).toEqual(['1/1 done, 0 in progress', '✓ Update documentation'])
})

test('a parent with only pending subtasks keeps its own status', async ($, on) => {
  mockSession(on)
  mock.store(on)
  const untouched = {
    ...PARENT_WITH_SUBTASKS,
    status: 'in_progress' as const,
    subtasks: PARENT_WITH_SUBTASKS.subtasks.map(step => ({ ...step, status: 'pending' as const })),
  }
  await $.tool.call({ tool: SET_TODOS, todos: [untouched] })
  const ui = await mountSidebar($, 'terminal')

  expect((await drawnRows(ui))[1]).toBe('○ Updating documentation…')
})

test('subtasks nested deeper than one level are denied', async ($, on) => {
  mockSession(on)
  mock.store(on)
  const tooDeep = {
    content: 'Parent',
    status: 'pending',
    subtasks: [{ content: 'Child', status: 'pending', subtasks: [{ content: 'Grandchild', status: 'pending' }] }],
  }
  const denied = await $.tool.call({ tool: SET_TODOS, todos: [tooDeep] })

  expect(denied.deny).toBe('set_todos: todos[0].subtasks[0].subtasks: only one level of subtasks is supported')
})

test('a malformed subtask names its path in the denial', async ($, on) => {
  mockSession(on)
  mock.store(on)
  const denied = await $.tool.call({
    tool: SET_TODOS,
    todos: [{ content: 'Parent', status: 'pending', subtasks: [{ content: '', status: 'pending' }] }],
  })

  expect(denied.deny).toBe('set_todos: todos[0].subtasks[0].content must be a non-empty string')
})

const TURN_DONE = { reason: 'answer', answer: 'done', durationMs: 1000, isAborted: false, turnId: 't1' } as const

test('the activity log clears when the turn completes', { options: { showActivityLog: true } }, async ($, on) => {
  mockSession(on)
  mock.store(on)
  answerFileTools(on)
  on('turn.complete', () => ({ text: 'done' }))
  await $.tool.call({ tool: SET_TODOS, todos: [...TODOS] })
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts' })

  await $.turn.complete(TURN_DONE)
  const ui = await mountSidebar($, 'terminal')

  expect((await drawnRows(ui)).some(row => row.startsWith('│'))).toBe(false)
})

test('a subagent turn completing leaves the activity log alone', { options: { showActivityLog: true } }, async ($, on) => {
  mockSession(on)
  mock.store(on)
  answerFileTools(on)
  on('turn.complete', () => ({ text: 'done' }))
  await $.tool.call({ tool: SET_TODOS, todos: [...TODOS] })
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts' })

  await $.turn.complete({ ...TURN_DONE, agentId: 'agent-1' })
  const ui = await mountSidebar($, 'terminal')

  expect(await drawnRows(ui)).toContain('│ Read a.ts')
})

test('the activity log clears when the running step changes and stays otherwise', { options: { showActivityLog: true } }, async ($, on) => {
  mockSession(on)
  mock.store(on)
  answerFileTools(on)
  await $.tool.call({ tool: SET_TODOS, todos: [...TODOS] })
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts' })

  const ui = await mountSidebar($, 'terminal')

  await $.tool.call({ tool: SET_TODOS, title: 'Renamed', todos: [...TODOS] })
  expect(await drawnRows(ui)).toContain('│ Read a.ts')

  const advanced = TODOS.map((step, index) => ({
    ...step,
    status: index === 2 ? ('in_progress' as const) : ('completed' as const),
  }))
  await $.tool.call({ tool: SET_TODOS, todos: advanced })
  expect((await drawnRows(ui)).some(row => row.startsWith('│'))).toBe(false)
})

function answerSessionStart(on: On): void {
  on('session.start', () => ({ cwd: '/repo' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__todo-sidebar__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
}

test('set_todos saves the list under the session id', async ($, on) => {
  mockSession(on)
  const writes: unknown[] = []
  on('store.set', (_, e) => {
    writes.push(e)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [] }))

  await $.tool.call({ tool: SET_TODOS, title: 'Saved', todos: [...TODOS] })

  expect(writes).toEqual([{ key: 'session:session-1', value: { title: 'Saved', todos: [...TODOS] } }])
})

test('a resumed session restores the saved list on start', async ($, on) => {
  mockSession(on)
  answerSessionStart(on)
  mock.store(on, { 'session:session-1': { title: 'Restored', todos: [...TODOS] } })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await mountSidebar($, 'terminal')

  expect((await drawnRows(ui)).slice(0, 2)).toEqual(['Restored', '✓ Wrote the sidebar'])
})

test('a start with todos already in state does not overwrite them from the store', async ($, on) => {
  mockSession(on)
  answerSessionStart(on)
  mock.store(on, { 'session:session-1': { title: 'Stale', todos: [...TODOS] } })
  await $.tool.call({ tool: SET_TODOS, title: 'Live', todos: [TODOS[2]] })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await mountSidebar($, 'terminal')

  expect((await drawnRows(ui))[0]).toBe('Live')
})

test('rows are drawn without gray dimming, only the activity bar is dim', { options: { showActivityLog: true } }, async ($, on) => {
  mockSession(on)
  mock.store(on)
  answerFileTools(on)
  await $.tool.call({ tool: SET_TODOS, todos: [...TODOS] })
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts' })
  const ui = await mountSidebar($, 'terminal')

  const texts = await ui.findAll({ type: 'Text' })
  const dimmed = texts.filter(element => element.props.dimColor === true).map(element => element.text)
  expect(dimmed).toEqual(['│'])
})

test('the half-filled parent mark is yellow and a single-step todo keeps the plain circle', async ($, on) => {
  mockSession(on)
  mock.store(on)
  await $.tool.call({ tool: SET_TODOS, todos: [PARENT_WITH_SUBTASKS, TODOS[1]] })
  const ui = await mountSidebar($, 'terminal')

  const marks = (await ui.findAll({ type: 'Text' })).filter(element => ['◐', '○', '✓'].includes(element.text))
  expect(marks[0]).toMatchObject({ text: '◐', props: { color: 'yellow' } })
  expect(marks[4]).toMatchObject({ text: '○' })
  expect(marks[4]?.props.color).toBeUndefined()
})

test('a parent with one subtask done and the rest pending is half-filled, not running', async ($, on) => {
  mockSession(on)
  mock.store(on)
  const oneDone = {
    ...PARENT_WITH_SUBTASKS,
    subtasks: PARENT_WITH_SUBTASKS.subtasks.map((step, index) => ({
      ...step,
      status: index === 0 ? ('completed' as const) : ('pending' as const),
    })),
  }
  await $.tool.call({ tool: SET_TODOS, todos: [oneDone] })
  const ui = await mountSidebar($, 'terminal')

  expect((await drawnRows(ui))[1]).toBe('◐ Updating documentation…')
})

const SPAWN = {
  tool_use_id: 'spawn-1',
  prompt: 'Review the auth module',
  description: 'Review the auth module',
  subagentType: 'code-reviewer',
  provider: { plugin: 'test', tier: 'user' },
  parentModel: 'claude-sonnet-5-5',
  background: true,
  fork: false,
} as const

const AGENT_LIST = [
  { id: 'a1', name: 'reviewer', description: 'Review the auth module', type: 'code-reviewer', status: 'running' },
  { id: 'a2', description: 'Find all callers of login()', type: 'Explore', status: 'waiting' },
  { id: 'a3', name: 'docs', description: 'Write docs', type: 'general-purpose', status: 'completed' },
] as const

test('the activity log is off by default: tool calls draw no rows', async ($, on) => {
  mockSession(on)
  mock.store(on)
  answerFileTools(on)
  await $.tool.call({ tool: SET_TODOS, todos: [...TODOS] })
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts' })
  const ui = await mountSidebar($, 'terminal')

  expect((await drawnRows(ui)).some(row => row.startsWith('│'))).toBe(false)
})

test('spawning an agent lists it under an Agents heading with its mark, label and type', async ($, on) => {
  mockSession(on)
  mock.store(on)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  on('agent.list', () => ({ value: [...AGENT_LIST] }))
  await $.tool.call({ tool: SET_TODOS, todos: [TODOS[1]] })

  await $.agent.spawn(SPAWN)
  const ui = await mountSidebar($, 'terminal')

  expect((await drawnRows(ui)).slice(2)).toEqual([
    'Agents',
    '○ reviewer… code-reviewer',
    '◐ Find all callers of login() Explore waiting',
    '✓ docs general-purpose',
  ])
})

test('agent marks are colored by status', async ($, on) => {
  mockSession(on)
  mock.store(on)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  on('agent.list', () => ({ value: [...AGENT_LIST, { id: 'a4', description: 'Crashed', type: 'Explore', status: 'failed' }] }))

  await $.agent.spawn(SPAWN)
  const ui = await mountSidebar($, 'terminal')

  const marks = (await ui.findAll({ type: 'Text' })).filter(element => ['○', '◐', '✓', '✗'].includes(element.text))
  expect(marks.map(mark => mark.props.color)).toEqual([undefined, 'yellow', 'green', 'red'])
})

test('a finished agent stays one more turn and then drops from the list', async ($, on) => {
  mockSession(on)
  mock.store(on)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a3' }))
  on('agent.list', () => ({ value: [AGENT_LIST[2]] }))
  on('turn.complete', () => ({ text: 'done' }))
  await $.agent.spawn(SPAWN)
  const ui = await mountSidebar($, 'terminal')
  expect(await drawnRows(ui)).toContain('✓ docs general-purpose')

  await $.turn.complete(TURN_DONE)
  expect(await drawnRows(ui)).not.toContain('✓ docs general-purpose')
})

test('a subagent finishing its turn refreshes the roster without ageing finished agents', async ($, on) => {
  mockSession(on)
  mock.store(on)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a3' }))
  on('agent.list', () => ({ value: [AGENT_LIST[2]] }))
  on('turn.complete', () => ({ text: 'done' }))
  await $.agent.spawn(SPAWN)
  const ui = await mountSidebar($, 'terminal')

  await $.turn.complete({ ...TURN_DONE, agentId: 'a3' })
  expect(await drawnRows(ui)).toContain('✓ docs general-purpose')
})

test('when rows run short the agents block keeps its rows and the activity log shrinks', { options: { showActivityLog: true } }, async ($, on) => {
  mockSession(on)
  mock.store(on)
  answerFileTools(on)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  on('agent.list', () => ({ value: [...AGENT_LIST] }))
  await $.tool.call({ tool: SET_TODOS, todos: [TODOS[1]] })
  await $.agent.spawn(SPAWN)
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/b.ts' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/c.ts' })

  const ui = await $.ui.mount({
    plugin: 'todo-sidebar',
    surface: 'terminal',
    component: 'Pane',
    props: { ...PANE_PROPS, scroll: { offset: 0, bodyRows: 12 } },
    requestId: 'todo-sidebar',
  })
  const rows = await drawnRows(ui)

  expect(rows.filter(row => row.startsWith('│'))).toEqual(['│ Read b.ts', '│ Read c.ts'])
  expect(rows.filter(row => row.includes('code-reviewer') || row.includes('Explore') || row.includes('general-purpose'))).toHaveLength(3)
})
