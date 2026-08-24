import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMatchTask } from '../src/taskText.js'

test('buildMatchTask 包含入队指引与 queueId', () => {
  const t = buildMatchTask({ queueId: 'q1' })
  assert.ok(t.includes('df_join_custom_queue'), '应指引 df_join_custom_queue 入队')
  assert.ok(t.includes('q1'), '应包含 queueId')
})

test('buildMatchTask 包含等待决策与收尾指引', () => {
  const t = buildMatchTask({ queueId: 'q1' })
  assert.ok(t.includes('df_await_turn'), '应指引 df_await_turn 等待决策')
  assert.ok(t.includes('needDecision'), '应说明 needDecision 判定')
  assert.ok(t.includes('df_finish'), '应指引 gameOver 时 df_finish 收尾')
})

test('buildMatchTask gameMode 传入时出现对应模式名', () => {
  const t = buildMatchTask({ queueId: 'q1', gameMode: 'classic' })
  assert.ok(t.includes('classic'), '应包含模式名')
})

test('buildMatchTask 不传 gameMode 时无模式名', () => {
  const t = buildMatchTask({ queueId: 'q1' })
  assert.ok(!t.includes('模式='), '缺省不应出现模式字段')
})
