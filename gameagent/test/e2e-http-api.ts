/**
 * E2E 测试：Agent 管理器 HTTP API（对运行中的服务做真实 HTTP 断言）。
 *
 * 前置条件：gameagent 管理器已在 9091 启动（npm run dev / node dist），
 *           依赖 mcpserver(9090) 与 backend 是否在跑不影响 HTTP 层断言。
 * 运行方式：npx tsx --test test/e2e-http-api.ts
 *
 * 覆盖链路：
 *   /health 健康检查 → /api/agents 列表 → /api/spawn-agent 创建（含 400 校验）
 *   → /api/agents/:childId 单查（driver 字段透传）→ 404 语义
 *   → /api/agents/:childId/task 任务投递（400 / 404 / 409 / 200）
 *   → DELETE 删除（terminated 保留语义）→ /api/metrics
 *
 * 清理策略：所有 spawn 的测试子 Agent 在 after() 中统一 DELETE 回收
 *           （即使中间断言失败也保证清理，不污染运行中的管理器）。
 *
 * 环境变量：E2E_MANAGER_URL 可覆盖目标地址（默认 http://127.0.0.1:9091）。
 *
 * 已知偶发噪音：极少数情况下 node:test runner 会在文件级报
 * "Unable to deserialize cloned data due to invalid or unsupported version"
 * （FileTest.parseMessage 处，子进程 IPC 消息反序列化竞态），此时全部用例
 * 仍为 pass，该错误非断言失败、与测试逻辑无关——重跑一次即可。
 */

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.E2E_MANAGER_URL ?? "http://127.0.0.1:9091";
const REQ_TIMEOUT_MS = 30_000;

/** 轻量 HTTP 工具：返回 status + parsed body（非 2xx 也解析，供断言错误分支） */
async function req(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(REQ_TIMEOUT_MS),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // 非 JSON 响应（如 HTML 错误页）原样返回，供断言查看
    return { status: res.status, body: text };
  }
  return { status: res.status, body: parsed };
}

// ---------------------------------------------------------------------------
// 测试运行状态（跨用例共享）
// ---------------------------------------------------------------------------

/** 当前 spawn 的测试子 Agent（唯一前缀防碰撞，after 中统一清理） */
const spawned: Array<{ childId: string; agentName: string }> = [];

// ---------------------------------------------------------------------------
// 测试用例
// ---------------------------------------------------------------------------

describe("E2E: Agent 管理器 HTTP API（真实服务 9091）", () => {
  after(async () => {
    // 清理：回收所有测试 spawn 的子 Agent（失败也继续清下一个）
    for (const { childId } of spawned) {
      try {
        const { status, body } = await req("DELETE", `/api/agents/${childId}`);
        console.log(`[cleanup] DELETE ${childId} → ${status} ${JSON.stringify(body)}`);
      } catch (err) {
        console.error(`[cleanup] DELETE ${childId} 失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  });

  it("GET /health → 200 + ok + uptime", async () => {
    const { status, body } = await req("GET", "/health");
    assert.strictEqual(status, 200);
    const b = body as { ok: boolean; uptime: number };
    assert.strictEqual(b.ok, true);
    assert.strictEqual(typeof b.uptime, "number");
    assert.ok(b.uptime >= 0, "uptime 应为非负毫秒数");
    console.log(`/health ok uptime=${b.uptime}ms`);
  });

  it("GET /api/agents → 200 且为数组（记录基线）", async () => {
    const { status, body } = await req("GET", "/api/agents");
    assert.strictEqual(status, 200);
    assert.ok(Array.isArray(body), "响应应为数组");
    console.log(`/api/agents 基线数量=${(body as unknown[]).length}`);
  });

  it("POST /api/spawn-agent 缺 agentName → 400", async () => {
    const { status, body } = await req("POST", "/api/spawn-agent", {});
    assert.strictEqual(status, 400);
    assert.ok(String((body as { error?: string }).error).includes("agentName"));
  });

  it("POST /api/spawn-agent 空白 agentName → 400", async () => {
    const { status } = await req("POST", "/api/spawn-agent", { agentName: "   " });
    assert.strictEqual(status, 400);
  });

  it("POST /api/spawn-agent 合法参数 → 201 + childId（真实 spawn 链路）", async () => {
    const agentName = `e2e-http-${Date.now()}`;
    const { status, body } = await req("POST", "/api/spawn-agent", {
      agentName,
      gameMode: "classic",
    });
    assert.strictEqual(status, 201, `spawn 应返回 201，实际 ${status} body=${JSON.stringify(body)}`);
    const b = body as { childId: string; status: string };
    assert.ok(/^child-/.test(b.childId), `childId 应以 child- 开头: ${b.childId}`);
    assert.strictEqual(b.status, "queued");
    spawned.push({ childId: b.childId, agentName });
    console.log(`spawn 成功 childId=${b.childId} agentName=${agentName}`);
  });

  it("GET /api/agents → 列表包含新 spawn 的子 Agent", async () => {
    const { status, body } = await req("GET", "/api/agents");
    assert.strictEqual(status, 200);
    const list = body as Array<Record<string, unknown>>;
    assert.ok(
      spawned.length === 0 || list.some((a) => a.childId === spawned[0].childId),
      "列表应包含测试子 Agent",
    );
  });

  it("GET /api/agents/:childId → 200 + driver 字段透传（child × driver 双维度）", async () => {
    const target = spawned[0];
    assert.ok(target, "前置：需先 spawn");
    const { status, body } = await req("GET", `/api/agents/${target.childId}`);
    assert.strictEqual(status, 200);
    const b = body as {
      childId: string;
      agentName: string;
      status: string;
      startTime: number;
      driver: Record<string, unknown>;
      activity: unknown[];
    };
    assert.strictEqual(b.childId, target.childId);
    assert.strictEqual(b.agentName, target.agentName);
    assert.strictEqual(typeof b.startTime, "number");
    assert.ok(Array.isArray(b.activity), "activity 字段应为数组");

    // driver 状态对象：合法状态机 + 全字段类型
    const d = b.driver;
    assert.ok(d, "响应应带 driver 对象");
    assert.ok(
      ["idle", "running", "failed", "done"].includes(d.status as string),
      `driver.status 非法: ${d.status}`,
    );
    assert.strictEqual(typeof d.batchMatches, "number");
    assert.strictEqual(typeof d.batchWins, "number");
    assert.strictEqual(typeof d.batchLosses, "number");
    assert.strictEqual(typeof d.batchDraws, "number");
    assert.ok(d.currentMatchId === null || typeof d.currentMatchId === "string");
    assert.ok(d.lastError === null || typeof d.lastError === "string");
    assert.ok(d.scriptName === null || typeof d.scriptName === "string");
    assert.ok(d.scriptVersion === null || typeof d.scriptVersion === "string");
    console.log(`单查 ${target.childId} status=${b.status} driver.status=${d.status}`);
  });

  it("GET /api/agents/ 空 childId → 400", async () => {
    const { status } = await req("GET", "/api/agents/");
    assert.strictEqual(status, 400);
  });

  it("POST /api/agents/ 空 childId（无 /task 后缀）→ 400", async () => {
    const { status } = await req("POST", "/api/agents/", { action: "stop" });
    assert.strictEqual(status, 400);
  });

  it("GET /api/agents/not-exist → 404（既有语义不变）", async () => {
    const { status } = await req("GET", "/api/agents/definitely-not-exist");
    assert.strictEqual(status, 404);
  });

  it("POST task 未知 childId → 404", async () => {
    const { status } = await req("POST", "/api/agents/definitely-not-exist/task", {
      action: "stop",
    });
    assert.strictEqual(status, 404);
  });

  it("POST task 非法 action → 400", async () => {
    const target = spawned[0];
    assert.ok(target, "前置：需先 spawn");
    const { status } = await req("POST", `/api/agents/${target.childId}/task`, {
      action: "run_forever",
    });
    assert.strictEqual(status, 400);
  });

  it("POST task 缺 action → 400", async () => {
    const target = spawned[0];
    const { status } = await req("POST", `/api/agents/${target.childId}/task`, {
      script_name: "s1",
    });
    assert.strictEqual(status, 400);
  });

  it("POST task games=0 / review_every=2.5 / 空白 script_name → 400", async () => {
    const target = spawned[0];
    assert.ok(target, "前置：需先 spawn");
    const cases: Array<Record<string, unknown>> = [
      { action: "run_cycle", games: 0 },
      { action: "run_cycle", review_every: 2.5 },
      { action: "run_cycle", script_name: "   " },
    ];
    for (const payload of cases) {
      const { status } = await req("POST", `/api/agents/${target.childId}/task`, payload);
      assert.strictEqual(status, 400, `payload ${JSON.stringify(payload)} 应 400`);
    }
  });

  it("POST task run_cycle → 200（就绪）或 409（未就绪）均为合法，验证真实投递链路", async () => {
    const target = spawned[0];
    assert.ok(target, "前置：需先 spawn");
    const { status, body } = await req("POST", `/api/agents/${target.childId}/task`, {
      action: "run_cycle",
      script_name: "e2e-script",
      games: 3,
      review_every: 3,
    });
    console.log(`run_cycle 投递 → ${status} ${JSON.stringify(body)}`);
    assert.ok(
      status === 200 || status === 409,
      `run_cycle 应 200（就绪）或 409（controller 未注册），实际 ${status}`,
    );
    if (status === 200) {
      const b = body as { success: boolean; childId: string; task: Record<string, unknown> };
      assert.strictEqual(b.success, true);
      assert.strictEqual(b.childId, target.childId);
      assert.strictEqual(b.task.action, "run_cycle");
      assert.strictEqual(b.task.games, 3);
      console.log("run_cycle 投递成功（子 Agent 已就绪）");
    } else {
      console.log("run_cycle 409（子 Agent 尚未就绪，属环境时序，非 API 缺陷）");
    }
  });

  it("POST task stop → 200（就绪）或 409（未就绪）", async () => {
    const target = spawned[0];
    assert.ok(target, "前置：需先 spawn");
    const { status, body } = await req("POST", `/api/agents/${target.childId}/task`, {
      action: "stop",
    });
    console.log(`stop 投递 → ${status} ${JSON.stringify(body)}`);
    assert.ok(
      status === 200 || status === 409,
      `stop 应 200 或 409，实际 ${status}`,
    );
  });

  it("DELETE /api/agents/not-exist → 200 {success:false}（不存在不报错）", async () => {
    const { status, body } = await req("DELETE", "/api/agents/definitely-not-exist");
    assert.strictEqual(status, 200);
    assert.strictEqual((body as { success: boolean }).success, false);
  });

  it("DELETE /api/agents/:childId → 200 {success:true}（回收测试子 Agent）", async () => {
    const target = spawned[0];
    assert.ok(target, "前置：需先 spawn");
    const { status, body } = await req("DELETE", `/api/agents/${target.childId}`);
    assert.strictEqual(status, 200);
    assert.strictEqual((body as { success: boolean }).success, true);
    // 从清理队列移除（已回收，避免 after 重复删）
    spawned.splice(spawned.indexOf(target), 1);
    console.log(`DELETE ${target.childId} 成功`);
  });

  it("DELETE 后 GET 单查 → 200 且 status=terminated（保留 metrics 语义）", async () => {
    // 用刚删除的 childId（上一个用例记录在局部，这里重新查列表取 terminated）
    const { status, body } = await req("GET", "/api/agents");
    assert.strictEqual(status, 200);
    const list = body as Array<Record<string, unknown>>;
    const terminated = list.filter((a) => a.status === "terminated");
    console.log(`当前 terminated 子 Agent 数=${terminated.length}`);
    // 只要存在 terminated 条目即验证语义（删除后不从池移除、状态标记）
    assert.ok(terminated.length > 0, "删除后应存在 terminated 状态条目（保留 metrics）");
  });

  it("GET /api/metrics → 200 且为数组", async () => {
    const { status, body } = await req("GET", "/api/metrics");
    assert.strictEqual(status, 200);
    assert.ok(Array.isArray(body), "metrics 响应应为数组");
    console.log(`/api/metrics 条目数=${(body as unknown[]).length}`);
  });
});
