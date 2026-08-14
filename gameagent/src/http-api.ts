/**
 * HTTP API 服务器 — 纯 Node.js `http` 模块，不引入外部框架依赖。
 *
 * 路由：
 *   POST /api/spawn-agent     → spawnAgent
 *   GET  /api/agents          → listAgents（Step 12：响应带 driver 状态）
 *   GET  /api/agents/:childId → getAgent（单查状态含 driver，bot .playai 轮询用）
 *   DELETE /api/agents/:childId → deleteAgent
 *   POST /api/agents/:childId/task → sendTask（Step 16 前置：run_cycle / stop 任务投递）
 *   GET  /api/metrics         → getMetrics
 *   GET  /health              → 健康检查
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { GameAgentManager, ChildAgentEntry, TaskMessage } from "./manager.js";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface HttpApiServer {
  /** 启动监听 */
  start(): Promise<void>;
  /** 关闭服务器 */
  close(): Promise<void>;
  /** 实际监听端口（start 后有效；传入 0 随机端口时用于取回实际端口） */
  port(): number;
}

// ---------------------------------------------------------------------------
// 路由分发
// ---------------------------------------------------------------------------

/** 路由处理函数 */
type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  manager: GameAgentManager,
  /** 路径中提取的 childId（仅 DELETE /api/agents/:childId） */
  childId?: string,
) => Promise<void>;

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/** 解析请求体为 JSON */
function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("无效的 JSON 请求体"));
      }
    });
    req.on("error", reject);
  });
}

/** 发送 JSON 响应 */
function json(
  res: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** 发送错误响应 */
function error(
  res: ServerResponse,
  statusCode: number,
  message: string,
): void {
  json(res, statusCode, { error: message });
}

/** 从 URL 中提取 childId（DELETE /api/agents/:childId） */
function extractChildId(pathname: string): string | undefined {
  const prefix = "/api/agents/";
  if (!pathname.startsWith(prefix)) return undefined;
  const id = pathname.slice(prefix.length);
  return id || undefined;
}

/** 从 URL 中提取任务端点 childId（POST /api/agents/:childId/task） */
function extractTaskChildId(pathname: string): string | undefined {
  const match = /^\/api\/agents\/([^/]+)\/task$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

/**
 * 序列化 driver 状态（Step 12：/api/agents 响应扩展）。
 *
 * 映射 ChildAgentDriverState 全量字段：状态机（idle/running/failed/done）、
 * 当前对局、批次计数、最近失败原因、脚本名与版本。
 */
function driverJson(entry: ChildAgentEntry): {
  status: string;
  currentMatchId: string | null;
  batchMatches: number;
  batchWins: number;
  batchLosses: number;
  batchDraws: number;
  lastError: string | null;
  scriptName: string | null;
  scriptVersion: string | null;
} {
  return {
    status: entry.driver.status,
    currentMatchId: entry.driver.currentMatchId,
    batchMatches: entry.driver.batchMatches,
    batchWins: entry.driver.batchWins,
    batchLosses: entry.driver.batchLosses,
    batchDraws: entry.driver.batchDraws,
    lastError: entry.driver.lastError,
    scriptName: entry.driver.scriptName,
    scriptVersion: entry.driver.scriptVersion,
  };
}

// ---------------------------------------------------------------------------
// 路由处理器
// ---------------------------------------------------------------------------

/** POST /api/spawn-agent */
const handleSpawnAgent: RouteHandler = async (req, res, manager) => {
  let body: Record<string, unknown>;
  try {
    body = (await readBody(req)) as Record<string, unknown>;
  } catch {
    error(res, 400, "无效的 JSON 请求体");
    return;
  }

  const agentName = typeof body.agentName === "string" ? body.agentName.trim() : "";
  const gameMode = typeof body.gameMode === "string" ? body.gameMode.trim() : "classic";
  const preferredCount = typeof body.preferredCount === "number" ? Math.round(body.preferredCount) : 2;

  if (!agentName) {
    error(res, 400, "缺少必填字段 agentName");
    return;
  }
  // 校验 preferredCount 范围 2-5（对齐 mcpserver join_match_queue 人数校验）
  if (preferredCount < 2 || preferredCount > 5) {
    error(res, 400, "preferredCount 必须在 2-5 范围内");
    return;
  }

  try {
    const childId = await manager.spawnAgent(agentName, gameMode, preferredCount);
    const entry = manager.getAgent(childId);
    json(res, 201, { childId, status: entry?.status ?? "queued" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "生成子 Agent 失败";
    error(res, 500, message);
  }
};

/** GET /api/agents */
const handleListAgents: RouteHandler = async (_req, res, manager) => {
  const agents = manager.listAgents().map((entry) => ({
    childId: entry.childId,
    agentName: entry.agentName,
    status: entry.status,
    startTime: entry.startTime,
    currentMatchId: entry.currentMatchId,
    // Step 12：driver 状态透传（child × driver 双维度）
    driver: driverJson(entry),
  }));
  json(res, 200, agents);
};

/** GET /api/agents/:childId — 单查子 Agent 状态（bot .playai 轮询用） */
const handleGetAgent: RouteHandler = async (_req, res, manager, childId) => {
  if (!childId) {
    error(res, 400, "缺少 childId");
    return;
  }
  const entry = manager.getAgent(childId);
  if (!entry) {
    error(res, 404, `未找到子 Agent: ${childId}`);
    return;
  }
  json(res, 200, {
    childId: entry.childId,
    agentName: entry.agentName,
    status: entry.status,
    startTime: entry.startTime,
    currentMatchId: entry.currentMatchId,
    // Step 12：driver 状态透传（bot .playai 轮询可按 driver.status 判定批量进度）
    driver: driverJson(entry),
    activity: entry.activity.slice(-100),
  });
};

/** DELETE /api/agents/:childId */
const handleDeleteAgent: RouteHandler = async (_req, res, manager, childId) => {
  if (!childId) {
    error(res, 400, "缺少 childId");
    return;
  }

  try {
    const deleted = await manager.deleteAgent(childId);
    json(res, 200, { success: deleted });
  } catch (err) {
    const message = err instanceof Error ? err.message : "删除子 Agent 失败";
    error(res, 500, message);
  }
};

/** POST /api/agents/:childId/task — run_cycle / stop 任务投递（Step 16 前置：暴露 manager.sendTask）。 */
const handleSendTask: RouteHandler = async (req, res, manager, childId) => {
  if (!childId) {
    error(res, 400, "缺少 childId");
    return;
  }

  let body: Record<string, unknown>;
  try {
    body = (await readBody(req)) as Record<string, unknown>;
  } catch {
    error(res, 400, "无效的 JSON 请求体");
    return;
  }

  const action = typeof body.action === "string" ? body.action : "";
  if (action !== "run_cycle" && action !== "stop") {
    error(res, 400, "缺少必填字段 action（run_cycle | stop）");
    return;
  }

  const task: TaskMessage = { type: "task", action };
  if (action === "run_cycle") {
    if (body.script_name !== undefined) {
      if (typeof body.script_name !== "string" || !body.script_name.trim()) {
        error(res, 400, "script_name 必须是非空字符串");
        return;
      }
      task.script_name = body.script_name.trim();
    }
    if (body.games !== undefined) {
      if (typeof body.games !== "number" || !Number.isInteger(body.games) || body.games < 1) {
        error(res, 400, "games 必须是 ≥1 的整数");
        return;
      }
      task.games = body.games;
    }
    if (body.review_every !== undefined) {
      if (
        typeof body.review_every !== "number" ||
        !Number.isInteger(body.review_every) ||
        body.review_every < 1
      ) {
        error(res, 400, "review_every 必须是 ≥1 的整数");
        return;
      }
      task.review_every = body.review_every;
    }
  }

  if (!manager.getAgent(childId)) {
    error(res, 404, `未找到子 Agent: ${childId}`);
    return;
  }

  try {
    const ok = await manager.sendTask(childId, task);
    if (!ok) {
      error(res, 409, "子 Agent 未就绪，无法投递任务（controller/session 未注册）");
      return;
    }
    json(res, 200, { success: true, childId, task });
  } catch (err) {
    const message = err instanceof Error ? err.message : "投递任务失败";
    error(res, 500, message);
  }
};

/** GET /api/metrics — 含完整评估指标（E2E 双 AI 对局断言依赖） */
const handleGetMetrics: RouteHandler = async (_req, res, manager) => {
  const allMetrics = manager.getMetrics();
  const agentMetrics = Object.entries(allMetrics.agentMetrics).map(([childId, m]) => {
    const matches = m.matches;
  return {
      childId,
      matches,
      wins: m.wins,
      losses: m.losses,
      draws: m.draws,
      timeouts: m.timeouts,
      crashes: m.crashes,
      decisionCount: m.decisionCount,
      totalDecisionTime: m.totalDecisionTime,
      avgDecisionTime:
        m.decisionCount > 0
          ? Math.round(m.totalDecisionTime / m.decisionCount)
          : 0,
      winRate: matches > 0 ? Math.round((m.wins / matches) * 1000) / 1000 : 0,
      memoryCount: m.memoryCount,
      stabilityIncidents: m.stabilityIncidents.map((i) => ({
        type: i.type,
        timestamp: i.timestamp,
        details: i.details,
      })),
    };
  });
  json(res, 200, agentMetrics);
};

// ---------------------------------------------------------------------------
// 工厂函数
// ---------------------------------------------------------------------------

/**
 * 创建 HTTP API 服务器。
 *
 * @param manager GameAgentManager 实例
 * @param port    监听端口
 * @returns       可启动/关闭的 HTTP 服务器句柄
 */
export function createHttpApiServer(
  manager: GameAgentManager,
  port: number,
): HttpApiServer {
  const startTime = Date.now();

  /** GET /health（通过闭包捕获 startTime） */
  const handleHealth: RouteHandler = async (_req, res) => {
    const uptime = Date.now() - startTime;
    json(res, 200, { ok: true, uptime });
  };

  // 路由表
  const routes: { method: string; prefix: string; handler: RouteHandler }[] = [
    { method: "POST", prefix: "/api/spawn-agent", handler: handleSpawnAgent },
    { method: "GET", prefix: "/api/agents", handler: handleListAgents },
    { method: "GET", prefix: "/api/agents/", handler: handleGetAgent },
    { method: "DELETE", prefix: "/api/agents/", handler: handleDeleteAgent },
    { method: "POST", prefix: "/api/agents/", handler: handleSendTask },
    { method: "GET", prefix: "/api/metrics", handler: handleGetMetrics },
    { method: "GET", prefix: "/health", handler: handleHealth },
  ];

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = req.method ?? "GET";
    const pathname = url.pathname;

    for (const route of routes) {
      if (method !== route.method) continue;

      // /api/agents/:childId（GET 单查 / DELETE 删除）与
      // /api/agents/:childId/task（POST 任务投递）特殊处理
      if (
        route.prefix === "/api/agents/" &&
        (method === "GET" || method === "DELETE" || method === "POST")
      ) {
        if (method === "POST") {
          const taskChildId = extractTaskChildId(pathname);
          if (taskChildId) {
            await route.handler(req, res, manager, taskChildId);
            return;
          }
        } else {
          const childId = extractChildId(pathname);
          if (childId) {
            await route.handler(req, res, manager, childId);
            return;
          }
        }
        // 空 childId 仅当请求路径就是 /api/agents/（真正缺 childId）时才交给
        // handler 走 400 分支；其余路径（/health、/api/metrics 等）继续匹配后续
        // route。此前无条件 continue 跳过了精确匹配 fallback，导致 /api/agents/
        // 错误落 404，handler 的 `!childId → 400` 分支成为死代码。
        if (pathname === "/api/agents/") {
          await route.handler(req, res, manager, undefined);
          return;
        }
        continue;
      }

      // 精确前缀匹配
      if (pathname === route.prefix) {
        await route.handler(req, res, manager);
        return;
      }
    }

    // 404
    error(res, 404, `未找到路由: ${method} ${pathname}`);
  });

  // 关掉默认 300s 的 requestTimeout（长处理的 handler 连接被 Node 销毁时，
  // 客户端 fetch 会报 "This operation was aborted"）
  server.requestTimeout = 0;

  return {
    start(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, () => {
          console.log(`[http-api] Agent 管理器 HTTP API 已启动，端口 ${port}`);
          resolve();
        });
      });
    },

    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },

    port(): number {
      const addr = server.address();
      return typeof addr === "object" && addr !== null ? addr.port : 0;
    },
  };
}