/**
 * HTTP API 测试（Step 12: swarm-autopilot）。
 *
 * /api/agents 与 /api/agents/:childId 响应扩展 driver 状态（child × driver
 * 双维度），断言：
 * - 默认（spawn 后未上报）：driver 全字段存在且为 idle / null / 0
 * - 完整 run_cycle 生命周期（script_ready → batch_start → batch_end）后：
 *   driver.status=running→done、批次计数、scriptName/scriptVersion
 * - driver_failed 后：status=failed + lastError + 稳定性异常
 * - 既有字段（childId/agentName/status/currentMatchId/activity）不破坏
 * - 404 语义不变
 */

import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { GameAgentManager } from "../src/manager.js";
import { MetricsCollector } from "../src/metrics.js";
import { createHttpApiServer, type HttpApiServer } from "../src/http-api.js";
import type {
  AgentSessionMessageController,
} from "../src/agent-message-controller.js";
import type {
  AgentSession,
  AuthStorage,
  ModelRegistry,
} from "@earendil-works/pi-coding-agent";
import type { AppConfig } from "../src/config.js";

// ---------------------------------------------------------------------------
// 测试常量
// ---------------------------------------------------------------------------

const TEST_CONFIG: AppConfig = {
  mcpUrl: "http://localhost:9090/mcp",
  managerPort: 9091,
  modelProvider: "deepseek",
  modelId: "deepseek-v4-flash",
  modelBaseUrl: "",
  modelRequestModel: "",
  deepseekApiKey: "test-key",
  agentSeedNames: [],
  maxGameTimeoutMs: 60_000,
  childIdleTimeoutMs: 60_000,
  cycleTimeoutMs: 60_000,
  memoryDbPath: "./data/test-memories.json",
};

// ---------------------------------------------------------------------------
// Mock 工厂（与 test-agent-message.test.ts 同构）
// ---------------------------------------------------------------------------

function createMockSession(sessionName: string): AgentSession {
  return {
    setSubagentRuntimeHost: mock.fn(),
    subscribe: mock.fn(() => () => {}),
    prompt: mock.fn(() => Promise.resolve()),
    promptUntilAccepted: mock.fn(() => Promise.resolve()),
    runRlmChild: mock.fn(() =>
      Promise.resolve({
        rlm_child_id: `mock-rlm-${sessionName}`,
        name: sessionName,
        session_dir: ".",
        model: "deepseek/deepseek-v4-flash",
      }),
    ),
    deleteRlmSubagent: mock.fn(() => Promise.resolve()),
    disposeAsync: mock.fn(() => Promise.resolve()),
    sessionId: `mock-session-${sessionName}`,
    scopedModels: undefined,
    sessionName,
  } as unknown as AgentSession;
}

function createMockAuthStorage(): AuthStorage {
  return {
    setRuntimeApiKey: mock.fn(),
    getApiKey: mock.fn(() => undefined),
    getRuntimeApiKey: mock.fn(() => undefined),
  } as unknown as AuthStorage;
}

function createMockModelRegistry(): ModelRegistry {
  return {
    find: mock.fn(() => undefined),
    getAll: mock.fn(() => []),
  } as unknown as ModelRegistry;
}

async function createTestManager(): Promise<GameAgentManager> {
  const session = createMockSession("mock-manager");
  const authStorage = createMockAuthStorage();
  const modelRegistry = createMockModelRegistry();
  const metricsCollector = {
    recordStabilityIncident: mock.fn(),
    recordMatch: mock.fn(),
    recordBatch: mock.fn(),
    dispose: mock.fn(() => Promise.resolve()),
  } as unknown as MetricsCollector;
  // @ts-expect-error - 绕过 private 构造函数，单元测试专用
  return new GameAgentManager(
    session,
    TEST_CONFIG,
    authStorage,
    modelRegistry,
    ".",
    metricsCollector,
  );
}

// ---------------------------------------------------------------------------
// 辅助：spawn + 关联 mock session + 注册 controller（同 test-agent-message）
// ---------------------------------------------------------------------------

async function setupChild(
  manager: GameAgentManager,
  agentName: string,
): Promise<AgentSessionMessageController> {
  const childId = await manager.spawnAgent(agentName, "classic");
  const entry = manager.getAgent(childId);
  assert.ok(entry, "spawn 后应有占位条目");
  // 模拟 onSessionPublished：子 session 关联到占位条目
  entry!.session = createMockSession(agentName);
  // @ts-expect-error - 测试访问 private 方法（绕过真实 createChildSession）
  const controller = manager.createChildAgentController(`mock-rlm-${agentName}`, agentName);
  // @ts-expect-error - 测试访问 private 方法（模拟 createRlmSubagentRuntime 注册）
  manager.registerChildController(agentName, controller);
  return controller;
}

/** 经 controller 的 onMessage 上报事件（等价子 Agent agent_message.send 路径）。 */
async function reportEvent(
  controller: AgentSessionMessageController,
  payload: Record<string, unknown>,
): Promise<void> {
  await controller.sendAgentMessage({
    target: "manager",
    message: JSON.stringify(payload),
  });
}

interface HttpHarness {
  manager: GameAgentManager;
  server: HttpApiServer;
  baseUrl: string;
}

/** 创建 manager + 随机端口 http server（start 后取回实际端口）。 */
async function createHarness(): Promise<HttpHarness> {
  const manager = await createTestManager();
  const server = createHttpApiServer(manager, 0);
  await server.start();
  return { manager, server, baseUrl: `http://127.0.0.1:${server.port()}` };
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  const body = await res.json();
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
// 测试用例
// ---------------------------------------------------------------------------

describe("HTTP API driver 状态透传（Step 12）", () => {
  it("GET /api/agents：spawn 后 driver 全字段默认值 + 既有字段不破坏", async () => {
    const { manager, server, baseUrl } = await createHarness();
    try {
      await setupChild(manager, "list-agent");

      const { status, body } = (await fetchJson(`${baseUrl}/api/agents`)) as {
        status: number;
        body: Array<Record<string, unknown>>;
      };
      assert.strictEqual(status, 200);
      assert.strictEqual(body.length, 1);

      const agent = body[0];
      // 既有字段仍在
      assert.strictEqual(agent.childId, manager.listAgents()[0].childId);
      assert.strictEqual(agent.agentName, "list-agent");
      assert.strictEqual(agent.status, "queued");
      assert.strictEqual(typeof agent.startTime, "number");

      // driver 状态对象（默认 idle）
      const driver = agent.driver as Record<string, unknown>;
      assert.ok(driver, "响应应带 driver 对象");
      assert.strictEqual(driver.status, "idle");
      assert.strictEqual(driver.currentMatchId, null);
      assert.strictEqual(driver.batchMatches, 0);
      assert.strictEqual(driver.batchWins, 0);
      assert.strictEqual(driver.batchLosses, 0);
      assert.strictEqual(driver.batchDraws, 0);
      assert.strictEqual(driver.lastError, null);
      assert.strictEqual(driver.scriptName, null);
      assert.strictEqual(driver.scriptVersion, null);
    } finally {
      await server.close();
      await manager.dispose();
    }
  });

  it("GET /api/agents/:childId：run_cycle 生命周期后 driver 反映 running→done 与批次计数", async () => {
    const { manager, server, baseUrl } = await createHarness();
    try {
      const controller = await setupChild(manager, "cycle-agent");
      const childId = manager.listAgents()[0].childId;

      await reportEvent(controller, { event: "script_ready", script_name: "s1", version: "v1" });
      await reportEvent(controller, { event: "batch_start", script_name: "s1", version: "v1", plan_games: 3 });

      // batch_start 后：running
      let res = (await fetchJson(`${baseUrl}/api/agents/${childId}`)) as {
        status: number;
        body: { driver: Record<string, unknown> };
      };
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.driver.status, "running");
      assert.strictEqual(res.body.driver.scriptName, "s1");
      assert.strictEqual(res.body.driver.scriptVersion, "v1");

      await reportEvent(controller, {
        event: "batch_end",
        script_name: "s1",
        version: "v1",
        games_played: 3,
        wins: 2,
        losses: 1,
        draws: 0,
        match_ids: ["m1", "m2", "m3"],
        driver_errors: [],
      });

      // batch_end 后：done + 批次计数
      res = (await fetchJson(`${baseUrl}/api/agents/${childId}`)) as {
        status: number;
        body: { driver: Record<string, unknown> };
      };
      assert.strictEqual(res.body.driver.status, "done");
      assert.strictEqual(res.body.driver.batchMatches, 3);
      assert.strictEqual(res.body.driver.batchWins, 2);
      assert.strictEqual(res.body.driver.batchLosses, 1);
      assert.strictEqual(res.body.driver.batchDraws, 0);
      assert.strictEqual(res.body.driver.lastError, null);
      assert.strictEqual(res.body.driver.scriptVersion, "v1");
    } finally {
      await server.close();
      await manager.dispose();
    }
  });

  it("GET /api/agents/:childId：driver_failed 后 status=failed + lastError 留痕", async () => {
    const { manager, server, baseUrl } = await createHarness();
    try {
      const controller = await setupChild(manager, "fail-agent");
      const childId = manager.listAgents()[0].childId;

      await reportEvent(controller, { event: "script_ready", script_name: "s1", version: "v1" });
      await reportEvent(controller, { event: "driver_failed", script_name: "s1", reason: "崩溃: 决策异常" });

      const res = (await fetchJson(`${baseUrl}/api/agents/${childId}`)) as {
        status: number;
        body: { driver: Record<string, unknown>; activity: unknown[] };
      };
      assert.strictEqual(res.body.driver.status, "failed");
      assert.strictEqual(res.body.driver.lastError, "崩溃: 决策异常");
      assert.strictEqual(res.body.driver.scriptName, "s1");
      // 既有字段仍在
      assert.ok(Array.isArray(res.body.activity), "activity 字段应保留");
    } finally {
      await server.close();
      await manager.dispose();
    }
  });

  it("GET /api/agents/:childId：未知 childId 返回 404（既有语义不变）", async () => {
    const { manager, server, baseUrl } = await createHarness();
    try {
      const { status } = (await fetchJson(`${baseUrl}/api/agents/nonexistent-child`)) as {
        status: number;
      };
      assert.strictEqual(status, 404);
    } finally {
      await server.close();
      await manager.dispose();
    }
  });
});
