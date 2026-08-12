/**
 * HTTP API 服务器 — 纯 Node.js `http` 模块，不引入外部框架依赖。
 *
 * 路由：
 *   POST /api/spawn-agent     → spawnAgent
 *   GET  /api/agents          → listAgents
 *   GET  /api/agents/:childId → getAgent（单查状态，bot .playai 轮询用）
 *   DELETE /api/agents/:childId → deleteAgent
 *   GET  /api/metrics         → getMetrics
 *   GET  /health              → 健康检查
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { GameAgentManager } from "./manager.js";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface HttpApiServer {
  /** 启动监听 */
  start(): Promise<void>;
  /** 关闭服务器 */
  close(): Promise<void>;
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

  if (!agentName) {
    error(res, 400, "缺少必填字段 agentName");
    return;
  }

  try {
    const childId = await manager.spawnAgent(agentName, gameMode);
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

/** GET /api/metrics */
const handleGetMetrics: RouteHandler = async (_req, res, manager) => {
  const allMetrics = manager.getMetrics();
  const agentMetrics = Object.entries(allMetrics.agentMetrics).map(([childId, m]) => ({
    childId,
    matches: m.matches,
    wins: m.wins,
    losses: m.losses,
    avgDecisionTime:
      m.decisionCount > 0
        ? Math.round(m.totalDecisionTime / m.decisionCount)
        : 0,
    memoryCount: m.memoryCount,
    stabilityIncidents: m.stabilityIncidents.length,
  }));
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
    { method: "GET", prefix: "/api/metrics", handler: handleGetMetrics },
    { method: "GET", prefix: "/health", handler: handleHealth },
  ];

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = req.method ?? "GET";
    const pathname = url.pathname;

    for (const route of routes) {
      if (method !== route.method) continue;

      // /api/agents/:childId 特殊处理（GET 单查 / DELETE 删除）
      if (
        (route.prefix === "/api/agents/" && method === "DELETE") ||
        (route.prefix === "/api/agents/" && method === "GET")
      ) {
        const childId = extractChildId(pathname);
        if (childId) {
          await route.handler(req, res, manager, childId);
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
  };
}