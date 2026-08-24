/**
 * Agent 进程编排：进程表 + sid 池分配。
 *
 * spawn 注入化（SpawnFn），AgentProcessManager 只维护进程表与 sid 池，
 * 不关心具体如何起进程。真实实现见 `./spawn.ts`，测试用桩注入。
 *
 * @module
 */

import type { ChildProcess } from 'node:child_process'
import type { SpawnDshOptions } from './spawn.js'

/** Agent 进程生命周期状态。 */
export type AgentStatus = 'running' | 'done' | 'error'

/** 一个被跟踪的 agent 进程的公开视图。 */
export interface AgentInfo {
  /** 进程唯一标识（注入的 DF_AGENT_SID）。 */
  sid: string
  /** 当前状态：running / done / error。 */
  status: AgentStatus
  /** 子进程 pid；未产生为 null。 */
  pid: number | null
  /** 进程启动时间戳（ms）。 */
  startedAt: number
  /** 退出码；未退出为 null。 */
  exitCode: number | null
  /** 最近收集的 stdout/stderr 尾部（最多保留 LOG_TAIL_LIMIT 行）。 */
  logTail: string[]
}

/** 起一个 agent 进程的函数签名（注入化 seam）。 */
export type SpawnFn = (opts: SpawnDshOptions) => ChildProcess

/** 进程表内部条目：公开视图 + 底层子进程句柄。 */
interface ManagedAgent extends AgentInfo {
  child: ChildProcess
}

/** logTail 行数上限。 */
const LOG_TAIL_LIMIT = 200

/**
 * Agent 进程表 + sid 池：从 seedSids 顺序分配 sid，spawn/list/get/kill/dispose，
 * 进程退出或 kill 后 sid 释放回池（可复用）。
 */
export class AgentProcessManager {
  /** 全部在册进程（sid → ManagedAgent）。 */
  private readonly agents = new Map<string, ManagedAgent>()
  /** 当前占用中的 sid。 */
  private readonly busy = new Set<string>()
  /** sid 池（可复用轮转）。 */
  private readonly pool: string[]
  /** 轮转游标。 */
  private poolIdx = 0

  constructor(
    private readonly spawnFn: SpawnFn,
    private readonly opts: { dshRoot: string; profile: string; seedSids: string[] },
  ) {
    this.pool = [...opts.seedSids]
  }

  /**
   * 从池中分配一个未被占用的 sid。
   * @returns 可用 sid；池耗尽返回 null。
   */
  allocateSid(): string | null {
    for (let i = 0; i < this.pool.length; i++) {
      const idx = (this.poolIdx + i) % this.pool.length
      const sid = this.pool[idx]
      if (!this.busy.has(sid)) {
        this.poolIdx = (idx + 1) % this.pool.length
        this.busy.add(sid)
        return sid
      }
    }
    return null
  }

  /**
   * 从池分配 sid 并 spawn 一个 agent。
   * @throws 池耗尽时抛错。
   */
  spawnFromPool(task: string): AgentInfo {
    const sid = this.allocateSid()
    if (sid === null) {
      throw new Error('Agent sid 池耗尽，请检查 ORCHESTRATOR_SEED_SIDS 与 mcpserver AGENT_SEED_NAME 播种量')
    }
    return this.spawnWithSid(sid, task)
  }

  /**
   * 以显式 sid spawn 一个 agent（不入池分配；可用于已播种但未纳入池的 sid）。
   */
  spawnWithSid(sid: string, task: string): AgentInfo {
    const child = this.spawnFn({
      sid,
      dshRoot: this.opts.dshRoot,
      profile: this.opts.profile,
      task,
    })

    const entry: ManagedAgent = {
      sid,
      status: 'running',
      pid: child.pid ?? null,
      startedAt: Date.now(),
      exitCode: null,
      logTail: [],
      child,
    }

    child.stdout?.on('data', (d: Buffer) => appendLog(entry, d.toString()))
    child.stderr?.on('data', (d: Buffer) => appendLog(entry, d.toString()))

    child.on('exit', (code) => {
      entry.exitCode = code
      entry.status = code === 0 ? 'done' : 'error'
      // 进程退出即释放 sid 回池（可复用）
      this.busy.delete(sid)
    })

    this.agents.set(sid, entry)
    return entry
  }

  /** 返回全部在册进程（快照数组，公开视图）。 */
  list(): AgentInfo[] {
    return [...this.agents.values()]
  }

  /** 按 sid 取进程视图；未在册返回 undefined。 */
  get(sid: string): AgentInfo | undefined {
    return this.agents.get(sid)
  }

  /**
   * 终止并移除一个进程。
   * @returns 是否命中（命中并移除为 true，缺省为 false）。
   */
  kill(sid: string): boolean {
    const entry = this.agents.get(sid)
    if (entry === undefined) return false
    entry.child.kill()
    this.agents.delete(sid)
    this.busy.delete(sid)
    return true
  }

  /** 终止全部在册进程并清空进程表。 */
  disposeAll(): void {
    for (const entry of this.agents.values()) entry.child.kill()
    this.agents.clear()
    this.busy.clear()
  }
}

function appendLog(entry: ManagedAgent, chunk: string): void {
  const lines = chunk.split(/\r?\n/)
  for (const line of lines) {
    if (line.length === 0) continue
    entry.logTail.push(line)
    if (entry.logTail.length > LOG_TAIL_LIMIT) entry.logTail.shift()
  }
}
