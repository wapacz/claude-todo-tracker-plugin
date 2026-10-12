export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export type Step = {
  content: string
  status: TodoStatus
  activeForm: string
  isForUser: boolean
}

export type TodoItem = Step & {
  subtasks?: Step[]
}

export type ToolActivity = {
  id: string
  verb: string
  target: string
  isDone: boolean
}

export type SessionSummary = {
  bullets: string[]
  coveredMessages: number
  checkedAtTurn: number
}

export type AgentRunStatus = 'running' | 'done' | 'failed'

export type AgentRun = {
  id: string
  agentId?: string
  type: string
  description: string
  model: string
  effort?: string
  status: AgentRunStatus
  startedAt: number
  endedAt?: number
  contextTokens: number
  contextMax: number
  tokens: number
  costUsd: number
  modelRequests: number
  round: number
  stepsDone?: number
  stepsTotal?: number
  stepNote?: string
}

declare module 'claude-code' {
  interface PluginState {
    'todo-sidebar': {
      todos: TodoItem[]
      title: string | null
      toolActivity: ToolActivity[]
      agentRuns: AgentRun[]
      isFinishedAgentsShown: boolean
      now: number
      expandedParents: string[]
      summary: SessionSummary
      keeperCoveredMessages: number
    }
  }
}
