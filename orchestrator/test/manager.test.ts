import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { AgentProcessManager } from '../src/manager.js'
import type { SpawnDshOptions } from '../src/spawn.js'

/** 用无害 node 脚本代替真实 dsh spawn，保持测试夹具封闭。 */
function fakeSpawn(exitAfterMs = 50, exitCode = 0): (opts: SpawnDshOptions) => ChildProcess {
  return (opts) =>
    spawn(process.execPath, ['-e', `console.log('hello-${opts.sid}'); setTimeout(()=>process.exit(${exitCode}),${exitAfterMs})`], {
      env: { ...process.env, DF_AGENT_SID: opts.sid },
    })
}

/** 轮询等待条件成立；Windows 下子进程启动耗时波动，禁用固定等待时长。 */
async function waitFor(cond: () => boolean, timeoutMs = 3000, intervalMs = 20): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor 超时')
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

const BASE_OPTS = { dshRoot: '.', profile: 'darkforest' }

test('allocateSid 从池顺序分配、不重复、耗尽返回 null', () => {
  const m = new AgentProcessManager(fakeSpawn(), { ...BASE_OPTS, seedSids: ['a1', 'a2', 'a3'] })
  const got = new Set<string>()
  for (let i = 0; i < 3; i++) {
    const sid = m.allocateSid()
    assert.ok(sid, '应有可用 sid')
    got.add(sid)
  }
  assert.equal(got.size, 3, '分配不重复')
  assert.equal(m.allocateSid(), null, '池耗尽返回 null')
})

test('spawnFromPool 创建 running 条目', () => {
  const m = new AgentProcessManager(fakeSpawn(), { ...BASE_OPTS, seedSids: ['a1'] })
  const info = m.spawnFromPool('任务')
  assert.equal(info.sid, 'a1')
  assert.equal(info.status, 'running')
  assert.ok(info.pid, '有 pid')
  assert.equal(m.list().length, 1)
  assert.equal(m.get('a1')?.sid, 'a1')
})

test('spawnWithSid 显式指定 sid（不入池）', () => {
  const m = new AgentProcessManager(fakeSpawn(), { ...BASE_OPTS, seedSids: [] })
  const info = m.spawnWithSid('custom', '任务')
  assert.equal(info.sid, 'custom')
  assert.equal(m.list().length, 1)
})

test('进程退出后 status 置 done 且 exitCode=0', async () => {
  const m = new AgentProcessManager(fakeSpawn(30, 0), { ...BASE_OPTS, seedSids: ['a1'] })
  m.spawnFromPool('任务')
  await waitFor(() => m.list()[0]?.status === 'done')
  assert.equal(m.list()[0].status, 'done')
  assert.equal(m.list()[0].exitCode, 0)
})

test('进程非零退出后 status 置 error', async () => {
  const m = new AgentProcessManager(fakeSpawn(30, 3), { ...BASE_OPTS, seedSids: ['a1'] })
  m.spawnFromPool('任务')
  await waitFor(() => m.list()[0]?.status === 'error')
  assert.equal(m.list()[0].status, 'error')
  assert.equal(m.list()[0].exitCode, 3)
})

test('进程退出后 sid 释放回池（可复用）', async () => {
  const m = new AgentProcessManager(fakeSpawn(30, 0), { ...BASE_OPTS, seedSids: ['a1'] })
  m.spawnFromPool('任务')
  await waitFor(() => m.get('a1')?.status === 'done')
  // 退出释放后应可再次分配同一 sid
  assert.equal(m.allocateSid(), 'a1')
})

test('kill 移除条目且幂等', () => {
  const m = new AgentProcessManager(fakeSpawn(1000, 0), { ...BASE_OPTS, seedSids: ['a1'] })
  const info = m.spawnFromPool('任务')
  assert.equal(m.kill(info.sid), true)
  assert.equal(m.list().length, 0)
  assert.equal(m.kill(info.sid), false)
})

test('logTail 捕获 stdout', async () => {
  const m = new AgentProcessManager(fakeSpawn(30, 0), { ...BASE_OPTS, seedSids: ['a1'] })
  m.spawnFromPool('任务')
  await waitFor(() => m.list()[0]?.logTail.some((l) => l.includes('hello-a1')))
  assert.ok(m.list()[0].logTail.some((l) => l.includes('hello-a1')), '应捕获到 stdout 行')
})

test('disposeAll 清空全部条目', () => {
  const m = new AgentProcessManager(fakeSpawn(), { ...BASE_OPTS, seedSids: ['a1', 'a2'] })
  m.spawnFromPool('任务')
  m.spawnFromPool('任务')
  m.disposeAll()
  assert.equal(m.list().length, 0)
})
