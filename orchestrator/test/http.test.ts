import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createHttpServer } from '../src/http.js'
import { AgentProcessManager, type AgentInfo } from '../src/manager.js'
import type { SpawnDshOptions } from '../src/spawn.js'

/** 无害 node 脚本代替真实 dsh spawn。 */
function fakeSpawn(): (opts: SpawnDshOptions) => ChildProcess {
  return (opts) =>
    spawn(process.execPath, ['-e', `setTimeout(()=>process.exit(0), 500)`], {
      env: { ...process.env, DF_AGENT_SID: opts.sid },
    })
}

/** 对指定 sid 抛错（模拟 spawn 失败）；其余正常。 */
function fakeSpawnFailsOn(failSids: string[]): (opts: SpawnDshOptions) => ChildProcess {
  return (opts) => {
    if (failSids.includes(opts.sid)) throw new Error(`spawn ${opts.sid} 失败`)
    return fakeSpawn()(opts)
  }
}

const BASE_OPTS = { dshRoot: '.', profile: 'darkforest' }

async function withServer(
  spawnFn: (opts: SpawnDshOptions) => ChildProcess,
  seedSids: string[],
  fn: (base: string, m: AgentProcessManager) => Promise<void>,
): Promise<void> {
  const m = new AgentProcessManager(spawnFn, { ...BASE_OPTS, seedSids })
  const server = createHttpServer(m)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const addr = server.address()
  if (addr === null || typeof addr === 'string') throw new Error('unexpected address')
  const base = `http://127.0.0.1:${addr.port}`
  try {
    await fn(base, m)
  } finally {
    server.close()
    m.disposeAll()
  }
}

test('POST /api/agents/batch 创建 N 个 agent 返回 sids', async () => {
  await withServer(fakeSpawn(), ['a1', 'a2'], async (base) => {
    const res = await fetch(`${base}/api/agents/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 2, queueId: 'q1' }),
    })
    assert.equal(res.status, 200)
    const body = (await res.json()) as { sids: string[] }
    assert.deepEqual(body.sids, ['a1', 'a2'])
  })
})

test('GET /api/agents 列出全部（不含 logTail）', async () => {
  await withServer(fakeSpawn(), ['a1'], async (base) => {
    await fetch(`${base}/api/agents/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 1, queueId: 'q1' }),
    })
    const res = await fetch(`${base}/api/agents`)
    assert.equal(res.status, 200)
    const body = (await res.json()) as { agents: AgentInfo[] }
    assert.equal(body.agents.length, 1)
    assert.equal(body.agents[0].sid, 'a1')
    assert.equal('logTail' in body.agents[0], false, '列表不应含 logTail')
  })
})

test('GET /api/agents/:sid 返回详情（含 logTail）', async () => {
  await withServer(fakeSpawn(), ['a1'], async (base) => {
    await fetch(`${base}/api/agents/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 1, queueId: 'q1' }),
    })
    const res = await fetch(`${base}/api/agents/a1`)
    assert.equal(res.status, 200)
    const body = (await res.json()) as AgentInfo
    assert.equal(body.sid, 'a1')
    assert.ok(Array.isArray(body.logTail), '详情应含 logTail 数组')
  })
})

test('DELETE /api/agents/:sid 移除条目', async () => {
  await withServer(fakeSpawn(), ['a1'], async (base) => {
    await fetch(`${base}/api/agents/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 1, queueId: 'q1' }),
    })
    const del = await fetch(`${base}/api/agents/a1`, { method: 'DELETE' })
    assert.equal(del.status, 200)
    const list = (await (await fetch(`${base}/api/agents`)).json()) as { agents: AgentInfo[] }
    assert.equal(list.agents.length, 0)
    // 幂等：再删返回 404
    const del2 = await fetch(`${base}/api/agents/a1`, { method: 'DELETE' })
    assert.equal(del2.status, 404)
  })
})

test('POST /api/agents 单 spawn（不指定 sid 从池分配；指定则用显式 sid）', async () => {
  await withServer(fakeSpawn(), ['a1'], async (base) => {
    const r1 = await fetch(`${base}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: '任务' }),
    })
    assert.equal(r1.status, 200)
    assert.equal(((await r1.json()) as { sid: string }).sid, 'a1')

    const r2 = await fetch(`${base}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: '任务', sid: 'custom' }),
    })
    assert.equal(r2.status, 200)
    assert.equal(((await r2.json()) as { sid: string }).sid, 'custom')
    const m = (await (await fetch(`${base}/api/agents`)).json()) as { agents: AgentInfo[] }
    assert.equal(m.agents.length, 2)
  })
})

test('batch 校验：count 非法 / queueId 空 → 400', async () => {
  await withServer(fakeSpawn(), ['a1', 'a2', 'a3'], async (base) => {
    const badCount = await fetch(`${base}/api/agents/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 5, queueId: 'q1' }),
    })
    assert.equal(badCount.status, 400)

    const noQueue = await fetch(`${base}/api/agents/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 1, queueId: '' }),
    })
    assert.equal(noQueue.status, 400)
  })
})

test('batch 部分失败 → 500 且已 spawn 的被清理', async () => {
  await withServer(fakeSpawnFailsOn(['a2']), ['a1', 'a2'], async (base, m) => {
    const res = await fetch(`${base}/api/agents/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 2, queueId: 'q1' }),
    })
    assert.equal(res.status, 500)
    // 已 spawn 的 a1 被清理；a2 失败不残留
    assert.equal(m.list().length, 0)
  })
})

test('POST /api/dispose 清空全部', async () => {
  await withServer(fakeSpawn(), ['a1', 'a2'], async (base, m) => {
    await fetch(`${base}/api/agents/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 2, queueId: 'q1' }),
    })
    const res = await fetch(`${base}/api/dispose`, { method: 'POST' })
    assert.equal(res.status, 200)
    assert.equal(m.list().length, 0)
  })
})

test('未匹配路由 → 404', async () => {
  await withServer(fakeSpawn(), ['a1'], async (base) => {
    const res = await fetch(`${base}/api/nope`)
    assert.equal(res.status, 404)
  })
})
