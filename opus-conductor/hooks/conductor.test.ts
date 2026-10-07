import { expect, mock, test } from 'claude-code/testing'

import { applyAction, describeCall, newMission, progress, taskIdIn } from './mission'

const PANE = { component: 'Pane', requestId: 'opus-conductor', props: { title: 'Opus Conductor', isFocused: false, bodyColumns: 80, placement: 'dock' } as never } as const

test('the plan weighs tasks by size and counts a worker\'s reported %', async () => {
  let m = newMission('Ship the parser', 0)
  m = applyAction(m, { action: 'plan', tasks: [{ title: 'design', size: 'S', owner: 'opus' }, { title: 'build', size: 'L' }] }, 1).mission
  expect(m.tasks.map(t => t.owner)).toEqual(['opus', 'sonnet'])
  m = applyAction(m, { action: 'done', ids: [1] }, 2).mission
  expect(progress(m).pct).toBe(25)
  m = applyAction(m, { action: 'start', ids: [2] }, 3).mission
  const worker = { id: 'a1', label: '', model: 'claude-sonnet-5-5', type: '', startedAt: 3, endedAt: 0, status: 'running' as const, tools: 4, doing: '', pct: 50, taskId: 2, summary: '' }
  expect(progress(m, [worker]).pct).toBe(63)
  m = applyAction(m, { action: 'complete', note: 'verified' }, 4).mission
  expect(m.status).toBe('done')
  expect(progress(m).pct).toBe(100)
})

test('agent calls are tied to tasks and described in a line', async () => {
  expect(taskIdIn('#3 add tests', undefined)).toBe(3)
  expect(taskIdIn('no id', 'Task #12: build')).toBe(12)
  expect(describeCall('Edit', { file_path: 'C:\\x\\parser.ts' })).toBe('editing parser.ts')
  expect(describeCall('Bash', { command: 'npm test' })).toBe('$ npm test')
})

test('/conduct passes the goal to its markdown brief and starts the board; control words stay local', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on)
  const reached: string[] = []
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('command.run', (_$, e) => {
    reached.push(e.args)
    return { text: 'brief' }
  })
  await $.command.run({ command: 'opus-conductor:conduct', args: 'Ship the parser' } as never)
  await $.command.run({ command: 'conduct', args: 'auto off' } as never)
  await $.command.run({ command: 'conduct', args: '' } as never)
  expect(reached).toEqual(['Ship the parser'])
  await $.tool.call({ tool: 'mcp__opus-conductor__mission', action: 'plan', tasks: [{ title: 'write the lexer', size: 'M', owner: 'sonnet' }] } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'opus-conductor', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /Ship the parser/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /write the lexer/ })).toBeDefined()
    expect(await ui.find({ key: 'conduct-stop' })).toBeDefined()
    expect((await ui.find({ key: 'conduct-auto' }))?.props.label).toBe('Autopilot: off')
    await ui.unmount()
  }
})

test('during a mission labor runs on Sonnet 5.5, never Haiku, and lands on the board', async ($, on) => {
  mock.clock(on, { now: 1000 })
  const models: (string | undefined)[] = []
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('command.run', () => ({ text: 'brief' }))
  on('agent.spawn', (_$, e) => {
    models.push(e.model)
    return { model: e.model ?? 'inherit', agentId: `a${models.length}` }
  })
  await $.command.run({ command: 'conduct', args: 'Ship the parser' } as never)
  await $.tool.call({ tool: 'mcp__opus-conductor__mission', action: 'plan', tasks: [{ title: 'write the lexer', size: 'M' }] } as never)

  await $.agent.spawn({ prompt: 'scan', description: 'explore code', subagentType: 'Explore', model: 'haiku' } as never)
  await $.agent.spawn({ prompt: 'build it', description: '#1 write the lexer', subagentType: 'opus-conductor:worker' } as never)
  expect(models).toEqual(['claude-sonnet-5-5', undefined])

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'opus-conductor', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /AGENTS · 2 running/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /#1 write the lexer/ })).toBeDefined()
    await ui.unmount()
  }
})
