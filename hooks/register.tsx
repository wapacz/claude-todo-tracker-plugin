import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, Register, ToolCallInput, ToolCallResult } from 'claude-code'

import type { AgentRow, Step, TodoItem, TodoStatus, ToolActivity } from '../types'

const PANE_ID = 'todo-sidebar'
const PANE_TITLE = 'Todos'
const OPEN_COMMAND = 'todos'
const DEMO_COMMAND = 'todos-demo'
const SET_TODOS_TOOL = 'set_todos'
const ACTIVITY_ROWS = 6
const BASH_TARGET_LENGTH = 32
const SUBTASK_INDENT = 4
const KEPT_SESSIONS = 20
const ENDED_AGENT_TURNS_SHOWN = 1
const PANE_FIXED_ROWS = 4

const todos = atom({ plugin: 'todo-sidebar', key: 'todos' } as const, [])
const title = atom({ plugin: 'todo-sidebar', key: 'title' } as const, null)
const toolActivity = atom({ plugin: 'todo-sidebar', key: 'toolActivity' } as const, [])
const agents = atom({ plugin: 'todo-sidebar', key: 'agents' } as const, [])

const STATUSES: readonly TodoStatus[] = ['pending', 'in_progress', 'completed']

const SILENT_TOOLS = new Set(['TodoWrite', 'mcp__todo-sidebar__set_todos', 'ToolSearch'])

const TOOL_VERB: Record<string, string> = {
  Bash: 'Run',
}

const DEMO_TITLE = 'Implement OAuth scopes'
const DEMO_TODOS: TodoItem[] = [
  { content: 'Added Google OAuth provider', status: 'completed', activeForm: 'Adding Google OAuth provider' },
  { content: 'Updated callback handling', status: 'completed', activeForm: 'Updating callback handling' },
  { content: 'Configured scope mapping', status: 'completed', activeForm: 'Configuring scope mapping' },
  { content: 'Added tests for OAuth flow', status: 'completed', activeForm: 'Adding tests for OAuth flow' },
  {
    content: 'Update documentation',
    status: 'in_progress',
    activeForm: 'Updating documentation',
    subtasks: [
      { content: 'Wrote docs/oauth.md', status: 'completed', activeForm: 'Writing docs/oauth.md' },
      { content: 'Add README section', status: 'in_progress', activeForm: 'Adding README section' },
      { content: 'Link from CHANGELOG', status: 'pending', activeForm: 'Linking from CHANGELOG' },
    ],
  },
  { content: 'Open pull request', status: 'pending', activeForm: 'Opening pull request' },
]
const DEMO_ACTIVITY: ToolActivity[] = [
  { id: 'demo-1', verb: 'Read', target: 'auth.provider.ts', isDone: true },
  { id: 'demo-2', verb: 'Edit', target: 'src/auth/oauth.ts (+42 -6)', isDone: true },
  { id: 'demo-3', verb: 'Run', target: 'npm test', isDone: true },
  { id: 'demo-4', verb: 'Write', target: 'docs/oauth.md', isDone: false },
]

const STEP_PROPERTIES = {
  content: { type: 'string', description: 'Past tense once done reads best, e.g. "Added OAuth provider"' },
  status: { type: 'string', enum: STATUSES },
  activeForm: { type: 'string', description: 'Present continuous form, e.g. "Updating documentation"' },
}

const SET_TODOS_SCHEMA = {
  type: 'object',
  required: ['todos'],
  properties: {
    title: { type: 'string', description: 'Short name of the task the list belongs to, e.g. "Implement OAuth scopes"' },
    todos: {
      type: 'array',
      description: 'The whole list, in order; it replaces the previous one.',
      items: {
        type: 'object',
        required: ['content', 'status'],
        properties: {
          ...STEP_PROPERTIES,
          subtasks: {
            type: 'array',
            description:
              'Optional one level of subtasks. The parent is shown running while any subtask runs ' +
              'and done once all are done, so update the subtasks and leave the parent status as is.',
            items: { type: 'object', required: ['content', 'status'], properties: STEP_PROPERTIES },
          },
        },
      },
    },
  },
}

type ParsedTodos = { success: true; todos: TodoItem[] } | { success: false; error: string }

function isTodoStatus(value: unknown): value is TodoStatus {
  return typeof value === 'string' && STATUSES.includes(value as TodoStatus)
}

function parseStep(value: unknown, path: string): Step | string {
  if (typeof value !== 'object' || value === null) return `${path} is not an object`
  const { content, status, activeForm } = value as Record<string, unknown>
  if (typeof content !== 'string' || content.trim() === '') return `${path}.content must be a non-empty string`
  if (!isTodoStatus(status)) return `${path}.status must be one of ${STATUSES.join(', ')}`

  return { content, status, activeForm: typeof activeForm === 'string' ? activeForm : content }
}

function parseSubtasks(value: unknown, path: string): Step[] | string {
  if (value === undefined) return []
  if (!Array.isArray(value)) return `${path} must be an array`
  const parsed = value.map((entry, index) => {
    const step = parseStep(entry, `${path}[${index}]`)
    const hasNested = typeof entry === 'object' && entry !== null && 'subtasks' in entry
    return hasNested ? `${path}[${index}].subtasks: only one level of subtasks is supported` : step
  })
  const firstError = parsed.find(step => typeof step === 'string')
  if (typeof firstError === 'string') return firstError

  return parsed.filter((step): step is Step => typeof step !== 'string')
}

function parseTodoItem(value: unknown, index: number): TodoItem | string {
  const path = `todos[${index}]`
  const step = parseStep(value, path)
  if (typeof step === 'string') return step
  const subtasks = parseSubtasks((value as Record<string, unknown>).subtasks, `${path}.subtasks`)
  if (typeof subtasks === 'string') return subtasks

  return subtasks.length === 0 ? step : { ...step, subtasks }
}

function parseTodos(value: unknown): ParsedTodos {
  if (!Array.isArray(value)) return { success: false, error: 'todos must be an array' }
  const parsed = value.map(parseTodoItem)
  const firstError = parsed.find(item => typeof item === 'string')
  if (typeof firstError === 'string') return { success: false, error: firstError }

  return { success: true, todos: parsed.filter((item): item is TodoItem => typeof item !== 'string') }
}

type StepMark = TodoStatus | 'partial'

function hasPartlyDoneSubtasks(item: TodoItem): boolean {
  const subtasks = item.subtasks ?? []
  const hasStarted = subtasks.some(step => step.status !== 'pending')
  const isAllDone = subtasks.every(step => step.status === 'completed')
  return subtasks.length > 0 && hasStarted && !isAllDone
}

function effectiveStatus(item: TodoItem): TodoStatus {
  const subtasks = item.subtasks ?? []
  if (subtasks.length === 0) return item.status
  if (subtasks.every(step => step.status === 'completed')) return 'completed'
  return hasPartlyDoneSubtasks(item) ? 'in_progress' : item.status
}

function markOf(item: TodoItem): StepMark {
  return hasPartlyDoneSubtasks(item) ? 'partial' : effectiveStatus(item)
}

const MARK_GLYPH: Record<StepMark, string> = {
  completed: '✓',
  partial: '◐',
  in_progress: '○',
  pending: '○',
}

const MARK_COLOR: Record<StepMark, string | undefined> = {
  completed: 'green',
  partial: 'yellow',
  in_progress: undefined,
  pending: undefined,
}

function isRunning(mark: StepMark): boolean {
  return mark === 'in_progress' || mark === 'partial'
}

const ENDED_AGENT_STATUSES: ReadonlySet<AgentRow['status']> = new Set(['completed', 'failed', 'killed'])

const AGENT_GLYPH: Record<AgentRow['status'], string> = {
  pending: '○',
  running: '○',
  waiting: '◐',
  idle: '◐',
  completed: '✓',
  failed: '✗',
  killed: '✗',
}

const AGENT_COLOR: Record<AgentRow['status'], string | undefined> = {
  pending: undefined,
  running: undefined,
  waiting: 'yellow',
  idle: 'yellow',
  completed: 'green',
  failed: 'red',
  killed: 'red',
}

function hasEnded(row: AgentRow): boolean {
  return ENDED_AGENT_STATUSES.has(row.status)
}

function toAgentRow(info: AgentInfo, previous: readonly AgentRow[]): AgentRow {
  const known = previous.find(row => row.id === info.id)
  return {
    id: info.id,
    label: info.name ?? info.description,
    type: info.type,
    status: info.status,
    turnsSinceEnd: known?.turnsSinceEnd ?? 0,
  }
}

function agentRowsFrom(listed: readonly AgentInfo[], previous: readonly AgentRow[]): AgentRow[] {
  return listed
    .map(info => toAgentRow(info, previous))
    .filter(row => !hasEnded(row) || row.turnsSinceEnd < ENDED_AGENT_TURNS_SHOWN)
}

function ageEndedAgents(rows: readonly AgentRow[]): AgentRow[] {
  return rows.map(row => (hasEnded(row) ? { ...row, turnsSinceEnd: row.turnsSinceEnd + 1 } : row))
}

function agentStatusNote(row: AgentRow): string {
  return row.status === 'running' || row.status === 'completed' ? '' : row.status
}

function parseTitle(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function runningStepOf(list: readonly TodoItem[]): string | null {
  const parent = list.find(item => effectiveStatus(item) === 'in_progress')
  if (parent === undefined) return null
  const child = (parent.subtasks ?? []).find(step => step.status === 'in_progress')
  return child === undefined ? parent.content : `${parent.content} > ${child.content}`
}

type SavedList = { title: string | null; todos: TodoItem[] }

function parseSaved(value: unknown): SavedList | null {
  if (typeof value !== 'object' || value === null) return null
  const { title: savedTitle, todos: savedTodos } = value as Record<string, unknown>
  const parsed = parseTodos(savedTodos)
  return parsed.success ? { title: parseTitle(savedTitle), todos: parsed.todos } : null
}

function countByStatus(list: readonly TodoItem[], status: TodoStatus): number {
  return list.filter(item => effectiveStatus(item) === status).length
}

function summarize(list: readonly TodoItem[]): string {
  const done = countByStatus(list, 'completed')
  const active = countByStatus(list, 'in_progress')
  return `${done}/${list.length} done, ${active} in progress`
}

function relativeTo(root: string, path: string): string {
  const prefix = root.endsWith('/') ? root : `${root}/`
  return path.startsWith(prefix) ? path.slice(prefix.length) : path
}

function shortVerb(tool: string): string {
  const mcpName = tool.match(/^mcp__[^_]+(?:_[^_]+)*__(.+)$/)
  if (mcpName?.[1] !== undefined) return mcpName[1]
  return TOOL_VERB[tool] ?? tool
}

function describeTarget(e: ToolCallInput, root: string): string {
  if (e.tool === 'Read' || e.tool === 'Edit' || e.tool === 'Write' || e.tool === 'NotebookEdit') {
    return relativeTo(root, e.tool === 'NotebookEdit' ? e.notebook_path : e.file_path)
  }
  if (e.tool === 'Bash') return e.command.replace(/\s+/g, ' ').slice(0, BASH_TARGET_LENGTH)
  if (e.tool === 'Agent') return e.description
  if (e.tool === 'Skill') return e.skill
  return ''
}

function describeDiff(e: ToolCallInput, ran: ToolCallResult): string {
  if (ran.deny !== undefined || ran.isError === true) return ' (failed)'
  if (e.tool !== 'Edit' && e.tool !== 'Write') return ''
  const result = ran.result as { gitDiff?: { additions: number; deletions: number } } | undefined
  const diff = result?.gitDiff
  return diff === undefined ? '' : ` (+${diff.additions} -${diff.deletions})`
}

async function storeKeyOf($: EngineInterface): Promise<string> {
  return `session:${await $.session.id()}`
}

async function persist($: EngineInterface): Promise<void> {
  const [heading, list] = await Promise.all([read($, title), read($, todos)])
  const saved: SavedList = { title: heading, todos: list }
  await $.store.set(await storeKeyOf($), saved)
  const stale = (await $.store.keys()).filter(key => key.startsWith('session:')).slice(0, -KEPT_SESSIONS)
  await Promise.all(stale.map(key => $.store.delete(key)))
}

async function refreshAgents($: EngineInterface): Promise<void> {
  const listed = await $.agent.list()
  await update($, agents, previous => agentRowsFrom(listed, previous))
}

async function restore($: EngineInterface): Promise<void> {
  const current = await read($, todos)
  if (current.length > 0) return
  const saved = parseSaved(await $.store.get(await storeKeyOf($)))
  if (saved === null) return
  await update($, title, () => saved.title)
  await update($, todos, () => saved.todos)
}

export const register: Register = (on, options) => {
  const isActivityLogShown = options.showActivityLog === true
  on('session.start', async ($, e, next) => {
    await restore($)
    await $.command.register({ name: OPEN_COMMAND, description: 'Open the todo sidebar' })
    await $.command.register({ name: DEMO_COMMAND, description: 'Fill the todo sidebar with an example list' })
    await $.tool.register({
      name: SET_TODOS_TOOL,
      description:
        'Replace the todo list shown in the Todos sidebar. Call it whenever your plan changes: ' +
        'when you start a multi-step task (give a short title), start a step (in_progress) or finish one (completed).',
      inputSchema: SET_TODOS_SCHEMA,
    })
    void $.ui.open({ id: PANE_ID, title: PANE_TITLE })

    return next(e)
  })

  on('command.run', { command: OPEN_COMMAND }, async $ => {
    const opened = await $.ui.open({ id: PANE_ID, title: PANE_TITLE })
    const text = opened.isPlaced
      ? 'Todo sidebar opened.'
      : 'Todo sidebar will appear once the terminal is wide enough for a dock.'

    return { text }
  })

  on('command.run', { command: DEMO_COMMAND }, async $ => {
    await update($, title, () => DEMO_TITLE)
    await update($, todos, () => DEMO_TODOS)
    await update($, toolActivity, () => DEMO_ACTIVITY)
    await $.ui.open({ id: PANE_ID, title: PANE_TITLE })

    return { text: `Example list of ${DEMO_TODOS.length} todos shown in the sidebar.` }
  })

  on('tool.call', { tool: 'mcp__todo-sidebar__set_todos' }, async ($, e) => {
    const parsed = parseTodos(e.todos)
    if (!parsed.success) return { deny: `set_todos: ${parsed.error}` }

    const nextTitle = parseTitle(e.title)
    if (nextTitle !== null) await update($, title, () => nextTitle)
    const previous = await read($, todos)
    const hasStepChanged = runningStepOf(previous) !== runningStepOf(parsed.todos)
    if (hasStepChanged) await update($, toolActivity, () => [])
    await update($, todos, () => parsed.todos)
    await persist($)

    return { result: `Sidebar updated: ${summarize(parsed.todos)}.` }
  })

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    const hasSucceeded = ran.deny === undefined && ran.isError !== true

    if (hasSucceeded) {
      await update($, todos, () => [...e.todos])
      await persist($)
    }

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const isMainThread = e.agentId === undefined
    if (isMainThread) {
      await update($, toolActivity, () => [])
      await update($, agents, ageEndedAgents)
    }
    await refreshAgents($)

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    await refreshAgents($)

    return started
  })

  on('tool.call', async ($, e, next) => {
    if (!isActivityLogShown || SILENT_TOOLS.has(e.tool)) return next(e)

    const root = await $.session.cwd()
    const id = e.tool_use_id
    const row: ToolActivity = { id, verb: shortVerb(e.tool), target: describeTarget(e, root), isDone: false }
    await update($, toolActivity, list => [...list, row].slice(-ACTIVITY_ROWS))

    const ran = await next(e)
    const target = `${row.target}${describeDiff(e, ran)}`
    await update($, toolActivity, list =>
      list.map(one => (one.id === id ? { ...one, target, isDone: true } : one)),
    )

    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const drawStep = (step: Step, mark: StepMark, indent: number) => (
      <Box flexDirection="row" gap={1} paddingLeft={indent}>
        <Text color={MARK_COLOR[mark]}>{MARK_GLYPH[mark]}</Text>
        <Text wrap="truncate-end">{isRunning(mark) ? `${step.activeForm}…` : step.content}</Text>
      </Box>
    )
    const [list, heading, activity, roster] = await Promise.all([
      read($, todos),
      read($, title),
      read($, toolActivity),
      read($, agents),
    ])
    const verbWidth = Math.max(0, ...activity.map(row => row.verb.length))
    const todoRows = list.reduce((count, item) => count + 1 + (item.subtasks?.length ?? 0), 0)
    const agentRows = roster.length === 0 ? 0 : roster.length + 2
    const activityRoom = Math.max(0, e.props.scroll.bodyRows - PANE_FIXED_ROWS - todoRows - agentRows)
    const shownActivity = activity.slice(-activityRoom)

    return (
      <Box flexDirection="column" paddingX={1} paddingTop={1} gap={1}>
        <Text bold>{heading ?? (list.length === 0 ? 'No todos yet.' : summarize(list))}</Text>
        {list.length > 0 && (
          <Box flexDirection="column">
            {list.flatMap(item => [
              drawStep(item, markOf(item), 0),
              ...(item.subtasks ?? []).map(step => drawStep(step, step.status, SUBTASK_INDENT)),
            ])}
          </Box>
        )}
        {shownActivity.length > 0 && (
          <Box flexDirection="column">
            {shownActivity.map(row => (
              <Box flexDirection="row" gap={1}>
                <Text dimColor>│</Text>
                <Text>{row.verb.padEnd(verbWidth)}</Text>
                <Text wrap="truncate-end">{row.target}</Text>
              </Box>
            ))}
          </Box>
        )}
        {roster.length > 0 && (
          <Box flexDirection="column">
            <Text bold>Agents</Text>
            {roster.map(row => (
              <Box flexDirection="row" gap={1}>
                <Text color={AGENT_COLOR[row.status]}>{AGENT_GLYPH[row.status]}</Text>
                <Text wrap="truncate-end">{row.status === 'running' ? `${row.label}…` : row.label}</Text>
                <Text>{row.type}</Text>
                {agentStatusNote(row) !== '' && <Text>{agentStatusNote(row)}</Text>}
              </Box>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
