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
  if (node.type === 'Button') return String(node.props?.label ?? '')
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
  on('session.turns', () => ({ value: 0 }))
  on('session.messages', () => ({ value: [] }))
}

type ToolUse = { tool_use_id: string; tool: string; input: Record<string, unknown>; isError?: true }
type ChatMessage = { role: 'user' | 'assistant'; text: string; toolUses: ToolUse[] }
type Conversation = { turns: number; messages: ChatMessage[] }
type MockedConversation = { chat: Conversation; prompts: string[]; models: string[]; keeperPrompts: string[] }

function modelReply(queue: string[]) {
  const text = queue.shift()
  return text === undefined
    ? { value: { isAnswered: false, reason: 'empty-reply', usage: USAGE } as const }
    : { value: { isAnswered: true, text, usage: USAGE } as const }
}

function mockConversation(on: On, replies: readonly string[], keeperReplies: readonly string[] = []): MockedConversation {
  const chat: Conversation = { turns: 0, messages: [] }
  const prompts: string[] = []
  const models: string[] = []
  const keeperPrompts: string[] = []
  const summaryQueue = [...replies]
  const keeperQueue = [...keeperReplies]
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.turns', () => ({ value: chat.turns }))
  on('session.messages', () => ({ value: [...chat.messages] }))
  on('agent.list', () => ({ value: [] }))
  on('model.complete', (_, e) => {
    models.push(e.model)
    const isKeeper = e.prompt.startsWith('Todo list:')
    ;(isKeeper ? keeperPrompts : prompts).push(e.prompt)
    return modelReply(isKeeper ? keeperQueue : summaryQueue)
  })
  return { chat, prompts, models, keeperPrompts }
}

const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

function say(chat: Conversation, user: string, assistant: string): void {
  chat.turns += 1
  chat.messages.push({ role: 'user', text: user, toolUses: [] }, { role: 'assistant', text: assistant, toolUses: [] })
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

  expect((await drawnRows(ui)).slice(0, 2)).toEqual(['1/1 done, 0 in progress', '✓ Update documentation ▸ 3'])
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

  const saved = TODOS.map(step => ({ ...step, isForUser: false }))
  const summary = { bullets: [], coveredMessages: 0, checkedAtTurn: 0 }
  expect(writes).toEqual([
    { key: 'session:session-1', value: { title: 'Saved', todos: saved, summary, keeperCoveredMessages: 0 } },
  ])
})

test('a resumed session restores the saved list on start', async ($, on) => {
  mockSession(on)
  answerSessionStart(on)
  mock.store(on, { 'session:session-1': { title: 'Restored', todos: TODOS.map(step => ({ ...step, isForUser: false })) } })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await mountSidebar($, 'terminal')

  expect((await drawnRows(ui)).slice(0, 2)).toEqual(['Restored', '✓ Wrote the sidebar'])
})

test('a start with todos already in state does not overwrite them from the store', async ($, on) => {
  mockSession(on)
  answerSessionStart(on)
  mock.store(on, { 'session:session-1': { title: 'Stale', todos: TODOS.map(step => ({ ...step, isForUser: false })) } })
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

const FINISHED_PARENT = {
  ...PARENT_WITH_SUBTASKS,
  content: 'Updated documentation',
  subtasks: PARENT_WITH_SUBTASKS.subtasks.map(step => ({ ...step, status: 'completed' as const })),
}

test('a finished parent hides its subtasks behind a toggle that shows their count', async ($, on) => {
  mockSession(on)
  mock.store(on)
  await $.tool.call({ tool: SET_TODOS, todos: [FINISHED_PARENT, PARENT_WITH_SUBTASKS] })

  for (const surface of SURFACES) {
    const ui = await mountSidebar($, surface)
    const rows = await drawnRows(ui)

    expect(rows[1]).toBe('✓ Updated documentation ▸ 3')
    expect(rows[2]).toBe('◐ Updating documentation…')
    expect(rows).toHaveLength(6)
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(1)
  }
})

test('pressing the toggle expands the finished parent and pressing again collapses it', async ($, on) => {
  mockSession(on)
  mock.store(on)
  await $.tool.call({ tool: SET_TODOS, todos: [FINISHED_PARENT] })
  const ui = await mountSidebar($, 'terminal')

  await ui.press({ key: 'toggle-0' })
  expect(await drawnRows(ui)).toEqual([
    '1/1 done, 0 in progress',
    '✓ Updated documentation ▾',
    '    ✓ Wrote docs/oauth.md',
    '    ✓ Add README section',
    '    ✓ Link from CHANGELOG',
  ])

  await ui.press({ key: 'toggle-0' })
  expect(await drawnRows(ui)).toHaveLength(2)
})

test('an expanded parent that leaves the list is forgotten', async ($, on) => {
  mockSession(on)
  mock.store(on)
  await $.tool.call({ tool: SET_TODOS, todos: [FINISHED_PARENT] })
  const ui = await mountSidebar($, 'terminal')
  await ui.press({ key: 'toggle-0' })

  await $.tool.call({ tool: SET_TODOS, todos: [TODOS[0]] })
  await $.tool.call({ tool: SET_TODOS, todos: [FINISHED_PARENT] })

  expect((await drawnRows(ui))[1]).toBe('✓ Updated documentation ▸ 3')
})

test('a step only the user can take is drawn with a yellow flag and its instruction', async ($, on) => {
  mockSession(on)
  mock.store(on)
  await $.tool.call({
    tool: SET_TODOS,
    todos: [
      TODOS[0],
      { content: 'Approve module 2', status: 'in_progress', activeForm: 'Approving module 2', forUser: true },
      { content: 'Pick the layout', status: 'pending', forUser: true },
    ],
  })

  for (const surface of SURFACES) {
    const ui = await mountSidebar($, surface)

    expect((await drawnRows(ui)).slice(1)).toEqual(['✓ Wrote the sidebar', '⚑ Approve module 2', '⚑ Pick the layout'])
    const flags = (await ui.findAll({ type: 'Text' })).filter(element => element.text === '⚑')
    expect(flags.map(flag => flag.props.color)).toEqual(['yellow', 'yellow'])
  }
})

test('a flagged step that is done shows the green check like any other', async ($, on) => {
  mockSession(on)
  mock.store(on)
  await $.tool.call({ tool: SET_TODOS, todos: [{ content: 'Approved module 2', status: 'completed', forUser: true }] })
  const ui = await mountSidebar($, 'terminal')

  expect((await drawnRows(ui))[1]).toBe('✓ Approved module 2')
})

test('a flagged subtask under a running parent carries the flag too', async ($, on) => {
  mockSession(on)
  mock.store(on)
  const parent = {
    ...PARENT_WITH_SUBTASKS,
    subtasks: [...PARENT_WITH_SUBTASKS.subtasks.slice(0, 2), { content: 'Approve the docs', status: 'pending', forUser: true }],
  }
  await $.tool.call({ tool: SET_TODOS, todos: [parent] })
  const ui = await mountSidebar($, 'terminal')

  expect((await drawnRows(ui))[4]).toBe('    ⚑ Approve the docs')
})

test('forUser must be a boolean', async ($, on) => {
  mockSession(on)
  mock.store(on)
  const denied = await $.tool.call({ tool: SET_TODOS, todos: [{ content: 'x', status: 'pending', forUser: 'yes' }] })

  expect(denied.deny).toBe('set_todos: todos[0].forUser must be true or false')
})

const RUNNING_WITH_SUBTASKS = {
  content: 'Approve §2 Components',
  status: 'in_progress',
  activeForm: 'Approving §2 Components',
  subtasks: [
    { content: 'Reviewed prefixed Turtle', status: 'completed' },
    { content: 'Review breadcrumbs', status: 'in_progress' },
  ],
} as const

test('a finished row resent without subtasks keeps them, all marked done, when its text is unchanged', async ($, on) => {
  mockSession(on)
  mock.store(on)
  await $.tool.call({ tool: SET_TODOS, todos: [TODOS[0], RUNNING_WITH_SUBTASKS] })
  await $.tool.call({ tool: SET_TODOS, todos: [TODOS[0], { ...RUNNING_WITH_SUBTASKS, status: 'completed', subtasks: undefined }] })
  const ui = await mountSidebar($, 'terminal')

  expect((await drawnRows(ui))[2]).toBe('✓ Approve §2 Components ▸ 2')
  await ui.press({ key: 'toggle-1' })
  expect((await drawnRows(ui)).slice(3)).toEqual(['    ✓ Reviewed prefixed Turtle', '    ✓ Review breadcrumbs'])
})

test('a finished row rewritten in past tense at the same position keeps the subtasks too', async ($, on) => {
  mockSession(on)
  mock.store(on)
  await $.tool.call({ tool: SET_TODOS, todos: [TODOS[0], RUNNING_WITH_SUBTASKS, TODOS[2]] })
  await $.tool.call({
    tool: SET_TODOS,
    todos: [TODOS[0], { content: 'Approved §2 Components: prefixed Turtle', status: 'completed' }, { ...TODOS[2], status: 'in_progress' }],
  })
  const ui = await mountSidebar($, 'terminal')

  expect((await drawnRows(ui))[2]).toBe('✓ Approved §2 Components: prefixed Turtle ▸ 2')
})

test('no inheritance when the row brings its own subtasks or the list changed length', async ($, on) => {
  mockSession(on)
  mock.store(on)
  await $.tool.call({ tool: SET_TODOS, todos: [TODOS[0], RUNNING_WITH_SUBTASKS] })

  await $.tool.call({
    tool: SET_TODOS,
    todos: [TODOS[0], { content: 'Approved §2', status: 'completed', subtasks: [{ content: 'Only this', status: 'completed' }] }],
  })
  const ui = await mountSidebar($, 'terminal')
  expect((await drawnRows(ui))[2]).toBe('✓ Approved §2 ▸ 1')

  await $.tool.call({ tool: SET_TODOS, todos: [TODOS[0], { content: 'Approved §2 again', status: 'completed' }, TODOS[2]] })
  expect((await drawnRows(ui))[2]).toBe('✓ Approved §2 again')
})

test('a restored list keeps its flags', async ($, on) => {
  answerSessionStart(on)
  mockSession(on)
  mock.store(on, {
    'session:session-1': {
      title: 'Restored',
      todos: [{ content: 'Approve module 2', status: 'pending', activeForm: 'Approving module 2', isForUser: true }],
    },
  })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await mountSidebar($, 'terminal')

  expect((await drawnRows(ui))[1]).toBe('⚑ Approve module 2')
})

test('the first turn end asks the summary model and draws its bullet above the todo list', async ($, on) => {
  const { chat, prompts } = mockConversation(on, ['Built the todo sidebar plugin'])
  mock.store(on)
  on('turn.complete', () => ({ text: 'done' }))
  await $.tool.call({ tool: SET_TODOS, title: 'Sidebar', todos: [TODOS[0]] })
  say(chat, 'create a sidebar plugin', 'Done, the pane is live.')

  await $.turn.complete(TURN_DONE)
  const ui = await mountSidebar($, 'terminal')

  expect((await drawnRows(ui)).slice(0, 3)).toEqual(['Summary', '· Built the todo sidebar plugin', 'Sidebar'])
  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toContain('user: create a sidebar plugin')
})

test('the transcript excerpt collapses whitespace, skips empty messages and cuts long ones', async ($, on) => {
  const { chat, prompts } = mockConversation(on, ['SAME'])
  mock.store(on)
  on('turn.complete', () => ({ text: 'done' }))
  say(chat, 'line one\n\n   line two', '   ')
  say(chat, 'x'.repeat(700), 'ok')

  await $.turn.complete(TURN_DONE)

  const excerpt = prompts[0]?.split('New messages:\n')[1]
  expect(excerpt).toBe(`user: line one line two\nuser: ${'x'.repeat(600)}\nassistant: ok`)
})

test('the transcript excerpt stops before it outgrows its character budget', async ($, on) => {
  const { chat, prompts } = mockConversation(on, ['SAME'])
  mock.store(on)
  on('turn.complete', () => ({ text: 'done' }))
  for (let i = 0; i < 25; i += 1) say(chat, `${i}`.padEnd(600, '.'), 'ok')

  await $.turn.complete(TURN_DONE)

  const excerpt = prompts[0]?.split('New messages:\n')[1] ?? ''
  expect(excerpt.length).toBeLessThanOrEqual(12000)
  expect(excerpt).toContain('user: 0.')
  expect(excerpt).not.toContain('user: 24.')
})

test('the model is asked again only after six more prompts, and SAME keeps the bullets', async ($, on) => {
  const { chat, prompts } = mockConversation(on, ['Built the sidebar', 'SAME', 'Moved on to publishing'])
  mock.store(on)
  on('turn.complete', () => ({ text: 'done' }))
  const ui = await mountSidebar($, 'terminal')

  say(chat, 'a', 'b')
  await $.turn.complete(TURN_DONE)
  for (let i = 0; i < 5; i += 1) {
    say(chat, 'more', 'ok')
    await $.turn.complete(TURN_DONE)
  }
  expect(prompts).toHaveLength(1)

  say(chat, 'seventh', 'ok')
  await $.turn.complete(TURN_DONE)
  expect(prompts).toHaveLength(2)
  expect(prompts[1]).not.toContain('user: a')
  expect((await drawnRows(ui)).slice(0, 2)).toEqual(['Summary', '· Built the sidebar'])

  for (let i = 0; i < 6; i += 1) say(chat, 'publish it', 'pushed')
  await $.turn.complete(TURN_DONE)
  expect((await drawnRows(ui)).slice(1, 3)).toEqual(['· Built the sidebar', '· Moved on to publishing'])
})

test('the summary keeps at most three bullets, oldest first to go', async ($, on) => {
  const { chat } = mockConversation(on, ['One', 'Two', 'Three', 'Four'])
  mock.store(on)
  on('turn.complete', () => ({ text: 'done' }))
  const ui = await mountSidebar($, 'terminal')

  for (let round = 0; round < 4; round += 1) {
    for (let i = 0; i < 6; i += 1) say(chat, 'x', 'y')
    await $.turn.complete(TURN_DONE)
  }

  expect((await drawnRows(ui)).slice(0, 4)).toEqual(['Summary', '· Two', '· Three', '· Four'])
})

test('a failed model call leaves the summary alone and is retried at the next turn end', async ($, on) => {
  const { chat, prompts } = mockConversation(on, [])
  mock.store(on)
  on('turn.complete', () => ({ text: 'done' }))
  say(chat, 'a', 'b')

  await $.turn.complete(TURN_DONE)
  await $.turn.complete(TURN_DONE)
  const ui = await mountSidebar($, 'terminal')

  expect(prompts).toHaveLength(2)
  expect((await drawnRows(ui))[0]).toBe('No todos yet.')
})

test('a subagent turn end never asks the summary model', async ($, on) => {
  const { chat, prompts } = mockConversation(on, ['Nope'])
  mock.store(on)
  on('turn.complete', () => ({ text: 'done' }))
  say(chat, 'a', 'b')

  await $.turn.complete({ ...TURN_DONE, agentId: 'agent-1' })

  expect(prompts).toHaveLength(0)
})

test('summaryEveryPrompts 0 turns the summary off', { options: { summaryEveryPrompts: 0 } }, async ($, on) => {
  const { chat, prompts } = mockConversation(on, ['Nope'])
  mock.store(on)
  on('turn.complete', () => ({ text: 'done' }))
  say(chat, 'a', 'b')

  await $.turn.complete(TURN_DONE)

  expect(prompts).toHaveLength(0)
})

test('the summary model comes from the summaryModel option', { options: { summaryModel: 'claude-sonnet-5-5' } }, async ($, on) => {
  const { chat, models } = mockConversation(on, ['Hi'])
  mock.store(on)
  on('turn.complete', () => ({ text: 'done' }))
  say(chat, 'a', 'b')

  await $.turn.complete(TURN_DONE)

  expect(models).toEqual(['claude-sonnet-5-5'])
})

test('a restored session brings its summary back', async ($, on) => {
  answerSessionStart(on)
  mockSession(on)
  mock.store(on, {
    'session:session-1': {
      title: 'Restored',
      todos: [{ content: 'x', status: 'completed', activeForm: 'x', isForUser: false }],
      summary: { bullets: ['Built it'], coveredMessages: 4, checkedAtTurn: 2 },
    },
  })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const ui = await mountSidebar($, 'terminal')

  expect((await drawnRows(ui)).slice(0, 2)).toEqual(['Summary', '· Built it'])
})

test('markdown markers are stripped from titles, rows and summary bullets', async ($, on) => {
  const { chat } = mockConversation(on, ['**Shipped** the `sidebar`'])
  mock.store(on)
  on('turn.complete', () => ({ text: 'done' }))
  await $.tool.call({
    tool: SET_TODOS,
    title: '## Fix `auth` flow',
    todos: [
      { content: 'Added **Google** OAuth provider', status: 'completed' },
      { content: 'Edit `src/auth.ts` and _retry_', status: 'in_progress', activeForm: 'Editing *src/auth.ts*' },
      { content: 'Keep 2*3 and snake_case_name as they are', status: 'pending' },
    ],
  })
  say(chat, 'a', 'b')
  await $.turn.complete(TURN_DONE)
  const ui = await mountSidebar($, 'terminal')

  expect(await drawnRows(ui)).toEqual([
    'Summary',
    '· Shipped the sidebar',
    'Fix auth flow',
    '✓ Added Google OAuth provider',
    '○ Editing src/auth.ts…',
    '○ Keep 2*3 and snake_case_name as they are',
  ])
})

const KEEPER_TODOS = [
  { content: 'Wrote the parser', status: 'completed' },
  { content: 'Write the renderer', status: 'in_progress', activeForm: 'Writing the renderer' },
  {
    content: 'Ship it',
    status: 'pending',
    subtasks: [
      { content: 'Approve the release', status: 'pending', forUser: true },
      { content: 'Publish the package', status: 'pending', activeForm: 'Publishing the package' },
    ],
  },
] as const

function act(chat: Conversation, user: string, assistant: string, toolUses: ToolUse[]): void {
  chat.turns += 1
  chat.messages.push({ role: 'user', text: user, toolUses: [] }, { role: 'assistant', text: assistant, toolUses })
}

function edited(file: string): ToolUse {
  return { tool_use_id: `edit-${file}`, tool: 'Edit', input: { file_path: file } }
}

async function startKeeperList($: Engine): Promise<void> {
  await $.tool.call({ tool: SET_TODOS, title: 'Renderer', todos: [...KEEPER_TODOS] })
}

test('a turn without set_todos asks the keeper, who sees the numbered list and the tools the agent ran', async ($, on) => {
  const { chat, keeperPrompts } = mockConversation(on, ['SAME'], ['{"2": "completed", "3.2": "in_progress"}'])
  mock.store(on)
  on('turn.complete', () => ({ text: 'done' }))
  await startKeeperList($)
  act(chat, 'finish the renderer', 'Renderer done, publishing next.', [edited('src/render.ts')])

  await $.turn.complete(TURN_DONE)
  const ui = await mountSidebar($, 'terminal')

  expect(keeperPrompts).toHaveLength(1)
  expect(keeperPrompts[0]).toContain('2 [in_progress] Write the renderer')
  expect(keeperPrompts[0]).toContain('3.1 [pending] (user step) Approve the release')
  expect(keeperPrompts[0]).toContain('assistant used Edit src/render.ts')
  expect((await drawnRows(ui)).slice(-5)).toEqual([
    '✓ Wrote the parser',
    '✓ Write the renderer',
    '◐ Ship it…',
    '    ⚑ Approve the release',
    '    ○ Publishing the package…',
  ])
})

test('the keeper can tick off a user step once the user says it is done', async ($, on) => {
  const { chat } = mockConversation(on, ['SAME'], ['{"3.1": "completed"}'])
  mock.store(on)
  on('turn.complete', () => ({ text: 'done' }))
  await startKeeperList($)
  act(chat, 'ok, release approved', 'Thanks.', [])

  await $.turn.complete(TURN_DONE)
  const ui = await mountSidebar($, 'terminal')

  expect((await drawnRows(ui))).toContain('    ✓ Approve the release')
})

test('a turn in which the agent wrote the list itself is skipped and not read again later', async ($, on) => {
  const { chat, keeperPrompts } = mockConversation(on, ['SAME'], ['{}'])
  mock.store(on)
  on('turn.complete', () => ({ text: 'done' }))
  await startKeeperList($)
  act(chat, 'go', 'Planned it.', [{ tool_use_id: 's1', tool: SET_TODOS, input: {} }])
  await $.turn.complete(TURN_DONE)
  expect(keeperPrompts).toHaveLength(0)

  act(chat, 'next', 'Working on it.', [])
  await $.turn.complete(TURN_DONE)

  expect(keeperPrompts).toHaveLength(1)
  expect(keeperPrompts[0]).not.toContain('Planned it.')
  expect(keeperPrompts[0]).toContain('assistant: Working on it.')
})

test('the keeper stays quiet while the list is empty', async ($, on) => {
  const { chat, keeperPrompts } = mockConversation(on, ['SAME'])
  mock.store(on)
  on('turn.complete', () => ({ text: 'done' }))
  act(chat, 'hi', 'hello', [])

  await $.turn.complete(TURN_DONE)

  expect(keeperPrompts).toHaveLength(0)
})

test('a garbled keeper reply, unknown step numbers and unknown statuses change nothing', async ($, on) => {
  const replies = ['Sure! The renderer is done.', '{"9": "completed", "2": "finished"}']
  const { chat, keeperPrompts } = mockConversation(on, ['SAME'], replies)
  mock.store(on)
  on('turn.complete', () => ({ text: 'done' }))
  await startKeeperList($)
  const ui = await mountSidebar($, 'terminal')
  const before = await drawnRows(ui)

  act(chat, 'a', 'b', [])
  await $.turn.complete(TURN_DONE)
  act(chat, 'c', 'd', [])
  await $.turn.complete(TURN_DONE)

  expect(keeperPrompts).toHaveLength(2)
  expect(await drawnRows(ui)).toEqual(before)
})

test('a failed keeper call is retried at the next turn end with the same messages', async ($, on) => {
  const { chat, keeperPrompts } = mockConversation(on, ['SAME'], [])
  mock.store(on)
  on('turn.complete', () => ({ text: 'done' }))
  await startKeeperList($)
  act(chat, 'first ask', 'ok', [])

  await $.turn.complete(TURN_DONE)
  await $.turn.complete(TURN_DONE)

  expect(keeperPrompts).toHaveLength(2)
  expect(keeperPrompts[1]).toContain('user: first ask')
})

test('a long keeper excerpt keeps the newest messages', async ($, on) => {
  const { chat, keeperPrompts } = mockConversation(on, ['SAME'], ['{}'])
  mock.store(on)
  on('turn.complete', () => ({ text: 'done' }))
  await startKeeperList($)
  for (let i = 0; i < 25; i += 1) act(chat, `${i}`.padEnd(600, '.'), 'ok', [])

  await $.turn.complete(TURN_DONE)

  expect(keeperPrompts[0]).toContain('user: 24.')
  expect(keeperPrompts[0]).not.toContain('user: 0.')
})

test('a keeper reply for a list the agent rewrote meanwhile is dropped', async ($, on) => {
  const chat: Conversation = { turns: 0, messages: [] }
  mock.store(on)
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.turns', () => ({ value: chat.turns }))
  on('session.messages', () => ({ value: [...chat.messages] }))
  on('agent.list', () => ({ value: [] }))
  on('turn.complete', () => ({ text: 'done' }))
  on('model.complete', async (_, e) => {
    if (!e.prompt.startsWith('Todo list:')) return { value: { isAnswered: true, text: 'SAME', usage: USAGE } }
    await $.tool.call({ tool: SET_TODOS, todos: [{ content: 'New plan', status: 'pending' }] })
    return { value: { isAnswered: true, text: '{"1": "completed"}', usage: USAGE } }
  })
  await startKeeperList($)
  act(chat, 'a', 'b', [])

  await $.turn.complete(TURN_DONE)
  const ui = await mountSidebar($, 'terminal')

  expect((await drawnRows(ui)).slice(-1)).toEqual(['○ New plan'])
})

test('statusKeeper false turns the keeper off', { options: { statusKeeper: false } }, async ($, on) => {
  const { chat, keeperPrompts } = mockConversation(on, ['SAME'], ['{"2": "completed"}'])
  mock.store(on)
  on('turn.complete', () => ({ text: 'done' }))
  await startKeeperList($)
  act(chat, 'a', 'b', [])

  await $.turn.complete(TURN_DONE)

  expect(keeperPrompts).toHaveLength(0)
})

test('a resumed session keeps the keeper from reading messages it already checked', async ($, on) => {
  answerSessionStart(on)
  const { chat, keeperPrompts } = mockConversation(on, ['SAME'], ['{}'])
  act(chat, 'old question', 'old answer', [])
  mock.store(on, {
    'session:session-1': {
      title: 'Restored',
      todos: [{ content: 'Do it', status: 'in_progress', activeForm: 'Doing it', isForUser: false }],
      summary: { bullets: ['Did it'], coveredMessages: 2, checkedAtTurn: 1 },
      keeperCoveredMessages: 2,
    },
  })
  on('turn.complete', () => ({ text: 'done' }))

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  act(chat, 'new question', 'new answer', [])
  await $.turn.complete(TURN_DONE)

  expect(keeperPrompts).toHaveLength(1)
  expect(keeperPrompts[0]).not.toContain('old question')
  expect(keeperPrompts[0]).toContain('user: new question')
})
