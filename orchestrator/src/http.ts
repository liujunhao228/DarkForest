/**
 * orchestrator 控制面 HTTP API（node:http，零框架）。
 *
 * 路由（前缀 /api）：
 * - POST   /api/agents         { task, sid? } → 单 spawn（指定 sid 或从池分配）
 * - POST   /api/agents/batch   { count, queueId, gameMode? } → 组局 spawn N 个 AI（任务文本自动生成）
 * - GET    /api/agents         列出全部 agent 状态（不含 logTail）
 * - GET    /api/agents/:sid    单 agent 详情（含 logTail）
 * - DELETE /api/agents/:sid    kill 一个 agent
 * - POST   /api/dispose        终止并清空全部（up.ps1 -Down 用）
 *
 * 只报进程状态与日志；游戏私有视野由 backend observer 通道负责。
 * 自起 node:http server（独立服务，非宿主插件路由）。
 *
 * @module
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AgentProcessManager } from './manager.js'
import { buildMatchTask } from './taskText.js'

/** batch 一次拉起 AI 数量的上限（specific queue 限 3-5 人，人机局最多 1+4）。 */
const MAX_BATCH_COUNT = 4
/** 请求体大小上限（防误用）。 */
const MAX_BODY_BYTES = 1024 * 1024

/** 带状态码的错误（handler 统一转 JSON 响应）。 */
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/** 读取并解析 JSON 请求体；空体或非法 JSON 返回 null。 */
async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buf.length
    if (size > MAX_BODY_BYTES) throw new HttpError(413, '请求体过大')
    chunks.push(buf)
  }
  const body = Buffer.concat(chunks).toString('utf8')
  if (body === '') return null
  try {
    const parsed = JSON.parse(body) as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/** 发送 JSON 响应。 */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 处理单个请求并写出响应。
 * @param req - node:http 请求。
 * @param res - node:http 响应。
 * @param manager - AgentProcessManager（承接 spawn/list/get/kill/dispose）。
 */
async function handleRequest(req: IncomingMessage, res: ServerResponse, manager: AgentProcessManager): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://orchestrator.local')
  const rest = url.pathname.split('/').filter(Boolean)

  // 统一前缀 /api
  if (rest[0] !== 'api') {
    sendJson(res, 404, { error: 'not found' })
    return
  }
  const seg = rest.slice(1)

  // POST /api/agents：单 spawn
  if (req.method === 'POST' && seg.length === 1 && seg[0] === 'agents') {
    const body = await readJson(req)
    const task = body?.task
    if (typeof task !== 'string' || task === '') {
      sendJson(res, 400, { error: 'task 必填且须为非空字符串' })
      return
    }
    const sid = body?.sid
    let info
    if (typeof sid === 'string' && sid !== '') {
      info = manager.spawnWithSid(sid, task)
    } else {
      try {
        info = manager.spawnFromPool(task)
      } catch (err) {
        sendJson(res, 500, { error: errorMessage(err) })
        return
      }
    }
    sendJson(res, 200, { sid: info.sid })
    return
  }

  // POST /api/agents/batch：组局 spawn N 个 AI
  if (req.method === 'POST' && seg.length === 2 && seg[0] === 'agents' && seg[1] === 'batch') {
    const body = await readJson(req)
    const count = body?.count
    const queueId = body?.queueId
    const gameMode = typeof body?.gameMode === 'string' && body.gameMode !== '' ? body.gameMode : undefined
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_BATCH_COUNT) {
      sendJson(res, 400, { error: `count 需为 1-${MAX_BATCH_COUNT} 的整数` })
      return
    }
    if (typeof queueId !== 'string' || queueId === '') {
      sendJson(res, 400, { error: 'queueId 必填且须为非空字符串' })
      return
    }

    const task = buildMatchTask({ queueId, gameMode })
    const sids: string[] = []
    for (let i = 0; i < count; i++) {
      try {
        sids.push(manager.spawnFromPool(task).sid)
      } catch (err) {
        // 部分失败：清理已 spawn 的进程后返回 500（调用方应回滚队列）
        for (const s of sids) manager.kill(s)
        sendJson(res, 500, { error: `spawn AI 失败：${errorMessage(err)}` })
        return
      }
    }
    sendJson(res, 200, { sids })
    return
  }

  // GET /api/agents：列表（不含 logTail）
  if (req.method === 'GET' && seg.length === 1 && seg[0] === 'agents') {
    const agents = manager.list().map((a) => ({
      sid: a.sid,
      status: a.status,
      exitCode: a.exitCode,
      startedAt: a.startedAt,
    }))
    sendJson(res, 200, { agents })
    return
  }

  // GET/DELETE /api/agents/:sid
  if (seg.length === 2 && seg[0] === 'agents') {
    const sid = seg[1]
    if (req.method === 'GET') {
      const info = manager.get(sid)
      if (info === undefined) {
        sendJson(res, 404, { error: 'agent not found' })
        return
      }
      sendJson(res, 200, { ...info })
      return
    }
    if (req.method === 'DELETE') {
      const ok = manager.kill(sid)
      if (!ok) {
        sendJson(res, 404, { error: 'agent not found' })
        return
      }
      sendJson(res, 200, { success: true })
      return
    }
  }

  // POST /api/dispose
  if (req.method === 'POST' && seg.length === 1 && seg[0] === 'dispose') {
    manager.disposeAll()
    sendJson(res, 200, { success: true })
    return
  }

  sendJson(res, 404, { error: 'not found' })
}

/** CORS 头：orchestrator 是独立 origin（:9092），供前端（:5173）跨源调用。 */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

/**
 * 创建 orchestrator HTTP server。
 * @param manager - AgentProcessManager 实例。
 * @returns node:http Server（未监听，由调用方 listen）。
 */
export function createHttpServer(manager: AgentProcessManager): Server {
  return createServer((req, res) => {
    // 跨源（前端 SPA → :9092）与浏览器预检（OPTIONS）统一放行
    for (const [k, v] of Object.entries(CORS_HEADERS)) {
      res.setHeader(k, v)
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    handleRequest(req, res, manager).catch((err) => {
      const status = err instanceof HttpError ? err.status : 500
      sendJson(res, status, { error: errorMessage(err) })
    })
  })
}
