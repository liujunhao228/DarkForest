import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { defaultDshArgs } from '../src/spawn.js'

test('defaultDshArgs 组装 dsh 启动 argv', () => {
  const args = defaultDshArgs({
    sid: 'agt_Test_1',
    task: '加入自定义队列打完整局',
    dshRoot: 'E:/deepseek-harness',
    profile: 'darkforest',
  })
  assert.deepEqual(args, [
    '--import',
    'tsx/esm',
    resolve('E:/deepseek-harness', 'apps/cli/src/bin.ts'),
    '--profile',
    'darkforest',
    '加入自定义队列打完整局',
  ])
})

test('defaultDshArgs 保留中文 task 原样（不经 shell 重编码）', () => {
  const task = '你是《黑暗森林》玩家，用 df_* 工具打完整局'
  const args = defaultDshArgs({
    sid: 'a1',
    task,
    dshRoot: 'E:/deepseek-harness',
    profile: 'darkforest',
  })
  // 中文任务必须是 argv 的独立元素且逐字符一致
  assert.equal(args[args.length - 1], task)
  assert.equal(args.length, 6, 'argv 中不出现 shell 包装或拼接')
})
