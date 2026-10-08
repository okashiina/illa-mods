export type Size = 'S' | 'M' | 'L'
export type Owner = 'opus' | 'sonnet' | 'haiku'
export type Effort = 'low' | 'medium' | 'high' | 'xhigh'
export type TaskStatus = 'pending' | 'active' | 'done' | 'dropped'

export type Task = {
  id: number
  title: string
  size: Size
  owner: Owner
  /** the reasoning effort Opus chose for it; absent on tasks planned before 1.4 */
  effort?: Effort
  status: TaskStatus
  agentId: string
  startedAt: number
  doneAt: number
  note: string
}

export type MissionStatus = 'running' | 'waiting' | 'done' | 'stopped'

export type Mission = {
  title: string
  condition: string
  startedAt: number
  endedAt: number
  status: MissionStatus
  tasks: Task[]
  nextId: number
  planAt: number
  continues: number
  note: string
  doing: string
}

export type AgentStatus = 'running' | 'done' | 'failed' | 'stopped'

export type AgentRow = {
  id: string
  label: string
  model: string
  type: string
  startedAt: number
  endedAt: number
  status: AgentStatus
  tools: number
  doing: string
  pct: number
  taskId: number
  /** the effort its agent type runs at; absent for agents that aren't the conductor's */
  effort?: Effort
  summary: string
}

export type ConductorSettings = { auto: boolean; maxContinues: number }

declare module 'claude-code' {
  interface PluginState {
    'opus-conductor': {
      mission: Mission | null
      agents: AgentRow[]
      settings: ConductorSettings
    }
  }
}
