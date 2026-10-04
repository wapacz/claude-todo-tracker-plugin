export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export type Step = {
  content: string
  status: TodoStatus
  activeForm: string
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

export type AgentRow = {
  id: string
  label: string
  type: string
  status: 'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed'
  turnsSinceEnd: number
}

declare module 'claude-code' {
  interface PluginState {
    'todo-sidebar': {
      todos: TodoItem[]
      title: string | null
      toolActivity: ToolActivity[]
      agents: AgentRow[]
      expandedParents: string[]
    }
  }
}
