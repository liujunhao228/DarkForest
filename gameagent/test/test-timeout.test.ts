/**
 * 超时强制回收与异常记录测试（Step 6: 双超时配置）。
 *
 * 用 mock AgentSession 测试 GameAgentManager 的 checkTimeouts 路径：
 * 1. idle 超时（childIdleTimeoutMs）：周期进行中无心跳 → 回收
 * 2. cycle 超时（cycleTimeoutMs）：周期总时长超限 → 回收
 * 3. 待命（无周期）子 Agent 不回收
 * 4. v_published 周期闭环后不再受超时约束
 * 5. 活跃心跳（事件上报）重置 idle 计时
 * 6. 已回收（terminated）子 Agent 保留在池中且不重复触发
 */

import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { GameAgentManager } from "../src/manager.js";
import { MetricsCollector } from "../src/metrics.js";
import type { AgentSessionMessageController } from "../src/agent-message-controller.js";
import type { AgentSession, AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { AppConfig } from "../src/config.js";

// ---------------------------------------------------------------------------
// 测试常量
// ---------------------------------------------------------------------------

const TEST_AGENT_DIR = ".";

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

/** 按用例覆盖超时阈值（隔离 idle / cycle 触发条件） */
function makeConfig(overrides: Partial<AppConfig>): AppConfig {
  return { ...TEST_CONFIG, ...overrides };
}

// ---------------------------------------------------------------------------
// Mock 工厂
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

// ---------------------------------------------------------------------------
// 辅助：创建测试用 Manager
// ---------------------------------------------------------------------------

async function createTestManager(config: AppConfig = TEST_CONFIG): Promise<GameAgentManager> {
  const session = createMockSession("mock-manager");
  const authStorage = createMockAuthStorage();
  const modelRegistry = createMockModelRegistry();
  const mockMetricsCollector = {
    recordStabilityIncident: mock.fn(),
    recordMatch: mock.fn(),
    dispose: mock.fn(() => Promise.resolve()),
  } as unknown as MetricsCollector;
  // @ts-expect-error - 绕过 private 构造函数，单元测试专用
  return new GameAgentManager(session, config, authStorage, modelRegistry, TEST_AGENT_DIR, mockMetricsCollector);
}

/** flush 微任务，让 checkTimeouts 内异步触发的 deleteAgent 完成状态变更。 */
async function flushAsync(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

/** 短睡（毫秒） */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 模拟 createRlmSubagentRuntime 的关联效果（controller + session 就绪），供上报事件用。 */
async function setupChild(
  manager: GameAgentManager,
  agentName: string,
): Promise<{ childId: string; controller: AgentSessionMessageController }> {
  const childId = await manager.spawnAgent(agentName, "classic");
  const entry = manager.getAgent(childId);
  assert.ok(entry, "spawn 后应有占位条目");
  entry!.session = createMockSession(agentName);
  // @ts-expect-error - 测试访问 private 方法（绕过真实 createChildSession）
  const controller = manager.createChildAgentController(`mock-rlm-${agentName}`, agentName);
  // @ts-expect-error - 测试访问 private 方法（模拟 createRlmSubagentRuntime 注册）
  manager.registerChildController(agentName, controller);
  return { childId, controller };
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

// ---------------------------------------------------------------------------
// 测试用例
// ---------------------------------------------------------------------------

describe("GameAgentManager 双超时（childIdleTimeoutMs / cycleTimeoutMs）", () => {
  it("idle 超时：周期进行中无心跳的子 Agent 被回收并记录空闲超时 incident", async () => {
    const manager = await createTestManager(
      makeConfig({ childIdleTimeoutMs: 50, cycleTimeoutMs: 60_000 }),
    );

    const childId = await manager.spawnAgent("test-agent", "classic");
    // 模拟 run_cycle 周期开始（sendTask 投递成功后的正常路径），此后无任何心跳
    const entry = manager.getAgent(childId);
    assert.ok(entry);
    entry!.cycleStartedAt = Date.now();

    // 等待超过 childIdleTimeoutMs
    await sleep(50 + 50);
    manager.checkTimeouts();
    await flushAsync();

    const agent = manager.getAgent(childId);
    assert.ok(agent, "超时后子 Agent 不应从池中移除");
    assert.strictEqual(agent?.status, "terminated", "idle 超时后应被标记为 terminated");
    assert.strictEqual(agent?.session, null, "terminated 后 session 应清空");
    assert.ok(agent!.metrics.stabilityIncidents.length > 0, "应有 stability_incident 记录");
    assert.strictEqual(agent!.metrics.stabilityIncidents[0].type, "timeout");
    assert.ok(
      agent!.metrics.stabilityIncidents[0].details.includes("空闲"),
      "incident details 应标识空闲超时",
    );
    assert.ok(
      agent!.metrics.stabilityIncidents[0].details.includes("childIdleTimeoutMs"),
      "incident details 应含 childIdleTimeoutMs 配置值",
    );

    await manager.dispose();
  });

  it("cycle 超时：周期总时长超限的子 Agent 被回收并记录周期超时 incident", async () => {
    const manager = await createTestManager(
      makeConfig({ childIdleTimeoutMs: 60_000, cycleTimeoutMs: 50 }),
    );

    const childId = await manager.spawnAgent("test-agent", "classic");
    const entry = manager.getAgent(childId);
    assert.ok(entry);
    // 周期早已开始（超过 cycleTimeoutMs）；但刚有心跳（idle 未超）
    entry!.cycleStartedAt = Date.now() - 100;
    entry!.lastActivityAt = Date.now();

    manager.checkTimeouts();
    await flushAsync();

    const agent = manager.getAgent(childId);
    assert.ok(agent, "超时后子 Agent 不应从池中移除");
    assert.strictEqual(agent?.status, "terminated", "cycle 超时后应被标记为 terminated");
    assert.ok(agent!.metrics.stabilityIncidents.length > 0, "应有 stability_incident 记录");
    assert.strictEqual(agent!.metrics.stabilityIncidents[0].type, "timeout");
    assert.ok(
      agent!.metrics.stabilityIncidents[0].details.includes("周期"),
      "incident details 应标识周期超时",
    );
    assert.ok(
      agent!.metrics.stabilityIncidents[0].details.includes("cycleTimeoutMs"),
      "incident details 应含 cycleTimeoutMs 配置值",
    );

    await manager.dispose();
  });

  it("待命（无周期）子 Agent 不被回收：等待任务下发的健康待命不误杀", async () => {
    const manager = await createTestManager(
      makeConfig({ childIdleTimeoutMs: 50, cycleTimeoutMs: 50 }),
    );

    const childId = await manager.spawnAgent("test-agent", "classic");
    // cycleStartedAt 保持 null（spawn 后未下发 run_cycle）
    await sleep(100); // 远超两个阈值
    manager.checkTimeouts();

    const agent = manager.getAgent(childId);
    assert.ok(agent, "待命子 Agent 不应被回收");
    assert.notStrictEqual(agent?.status, "terminated", "待命子 Agent 不应被标记 terminated");
    assert.strictEqual(
      agent!.metrics.stabilityIncidents.length,
      0,
      "待命子 Agent 不应产生超时 incident",
    );

    await manager.dispose();
  });

  it("v_published 周期闭环后清空 cycleStartedAt，待命不再受超时约束", async () => {
    const manager = await createTestManager(
      makeConfig({ childIdleTimeoutMs: 60_000, cycleTimeoutMs: 50 }),
    );
    try {
      const { childId, controller } = await setupChild(manager, "done-agent");
      const entry = manager.getAgent(childId);
      assert.ok(entry);
      // 周期早已超过 cycle 上限，但先收到 v_published：周期闭环完成
      entry!.cycleStartedAt = Date.now() - 100;
      entry!.lastActivityAt = Date.now();
      await reportEvent(controller, { event: "v_published", script_name: "s1", version: "v2" });

      assert.strictEqual(
        manager.getAgent(childId)!.cycleStartedAt,
        null,
        "v_published 应清空周期计时",
      );

      manager.checkTimeouts();
      const agent = manager.getAgent(childId);
      assert.ok(agent, "周期完成后的待命子 Agent 不应被回收");
      assert.notStrictEqual(agent?.status, "terminated", "待命子 Agent 不应被标记 terminated");
    } finally {
      await manager.dispose();
    }
  });

  it("活跃心跳（事件上报）重置 idle 计时，超时前有上报则暂不回收", async () => {
    const manager = await createTestManager(
      makeConfig({ childIdleTimeoutMs: 50, cycleTimeoutMs: 60_000 }),
    );
    try {
      const { childId, controller } = await setupChild(manager, "active-agent");
      const entry = manager.getAgent(childId);
      assert.ok(entry);
      entry!.cycleStartedAt = Date.now();

      // idle 即将到期前有上报（match_found）→ 心跳刷新，不回收
      await sleep(40);
      await reportEvent(controller, { event: "match_found", matchId: "m1" });
      manager.checkTimeouts();
      assert.notStrictEqual(
        manager.getAgent(childId)?.status,
        "terminated",
        "心跳后不应触发 idle 回收",
      );

      // 心跳后再无活动，超过 childIdleTimeoutMs → idle 回收
      await sleep(70);
      manager.checkTimeouts();
      await flushAsync();
      assert.strictEqual(
        manager.getAgent(childId)?.status,
        "terminated",
        "长时间无心跳后应触发 idle 回收",
      );
    } finally {
      await manager.dispose();
    }
  });

  it("回收后子 Agent 保留在池中，且不重复触发超时回收", async () => {
    const manager = await createTestManager(
      makeConfig({ childIdleTimeoutMs: 50, cycleTimeoutMs: 60_000 }),
    );

    const childId = await manager.spawnAgent("test-agent", "classic");
    manager.getAgent(childId)!.cycleStartedAt = Date.now();
    await sleep(50 + 50);

    // 第一次 checkTimeouts：应触发回收
    manager.checkTimeouts();
    await flushAsync();
    assert.strictEqual(manager.getAgent(childId)?.status, "terminated");
    assert.ok(
      manager.listAgents().find((a) => a.childId === childId),
      "terminated 子 Agent 应仍可通过 listAgents 查到",
    );

    // 第二次 checkTimeouts：不应再触发（已 terminated）
    const incidentCountBefore = manager.getAgent(childId)!.metrics.stabilityIncidents.length;
    manager.checkTimeouts();
    const incidentCountAfter = manager.getAgent(childId)!.metrics.stabilityIncidents.length;
    assert.strictEqual(
      incidentCountAfter,
      incidentCountBefore,
      "已 terminated 的子 Agent 不应重复触发超时回收",
    );

    await manager.dispose();
  });
});

describe("GameAgentManager driver_failed 兜底回收", () => {
  it("driver_failed 后不自动回收：编排器只标记 failed，修复循环在子 Agent 侧", async () => {
    const manager = await createTestManager();
    try {
      const { childId, controller } = await setupChild(manager, "failed-not-recycled");
      const entry = manager.getAgent(childId);
      assert.ok(entry);
      // 周期进行中 driver 崩溃（cycleStartedAt 已开启）
      entry!.cycleStartedAt = Date.now();

      await reportEvent(controller, {
        event: "driver_failed",
        script_name: "s1",
        reason: "driver 进程异常退出 (exit code 1)",
      });

      // 兜底语义（设计 §9.2）：driver_failed 只标记不自动回收——子 Agent
      // 的 M=3 修复循环属创作面，编排器记录留痕后等待子 Agent 自行修复/
      // 重试；自动回收由 idle/cycle 超时兜底，避免误杀修复中的子 Agent。
      const after = manager.getAgent(childId);
      assert.ok(after, "driver_failed 后子 Agent 不应从池中移除");
      assert.strictEqual(after!.driver.status, "failed", "driver 状态应置 failed");
      assert.strictEqual(after!.driver.lastError, "driver 进程异常退出 (exit code 1)");
      assert.notStrictEqual(after!.status, "terminated", "不自动回收（不应标记 terminated）");
      assert.ok(
        after!.metrics.stabilityIncidents.some((i) => i.type === "driver_failed"),
        "应有 driver_failed stability_incident 留痕",
      );
    } finally {
      await manager.dispose();
    }
  });

  it("driver_failed 后超时兜底仍生效：卡死子 Agent 被 idle 超时回收（failed 不跳过检查）", async () => {
    const manager = await createTestManager(
      makeConfig({ childIdleTimeoutMs: 50, cycleTimeoutMs: 60_000 }),
    );
    try {
      const { childId, controller } = await setupChild(manager, "failed-then-idle");
      const entry = manager.getAgent(childId);
      assert.ok(entry);
      entry!.cycleStartedAt = Date.now();

      // 上报 driver_failed（刷新一次心跳）后子 Agent 卡死：不再有任何上报/事件
      await reportEvent(controller, {
        event: "driver_failed",
        script_name: "s1",
        reason: "driver 崩溃",
      });
      await sleep(50 + 50);
      manager.checkTimeouts();
      await flushAsync();

      // 兜底回收：checkTimeouts 只看 entry.status 与周期/心跳，driver.status=failed
      // 不构成跳过条件——driver 挂了且子 Agent 也不上报时，idle 超时仍兜底回收。
      const after = manager.getAgent(childId);
      assert.ok(after, "超时回收后子 Agent 保留在池中（terminated 标记）");
      assert.strictEqual(
        after!.status,
        "terminated",
        "driver_failed 后的卡死子 Agent 应被 idle 超时兜底回收",
      );
      assert.strictEqual(after!.driver.status, "failed", "driver 状态保持 failed 留痕");
      // 双维度留痕并存：driver_failed incident + idle 超时 incident
      const types = after!.metrics.stabilityIncidents.map((i) => i.type);
      assert.ok(types.includes("driver_failed"), "应有 driver_failed incident");
      assert.ok(types.includes("timeout"), "应有 idle 超时 incident");
    } finally {
      await manager.dispose();
    }
  });

  it("driver_failed 后周期超时同样兜底回收（cycle 路径不因 failed 跳过）", async () => {
    const manager = await createTestManager(
      makeConfig({ childIdleTimeoutMs: 60_000, cycleTimeoutMs: 50 }),
    );
    try {
      const { childId, controller } = await setupChild(manager, "failed-then-cycle");
      const entry = manager.getAgent(childId);
      assert.ok(entry);
      // 周期远超 cycle 上限，但刚上报 driver_failed（idle 未超）
      entry!.cycleStartedAt = Date.now() - 100;
      entry!.lastActivityAt = Date.now();

      await reportEvent(controller, {
        event: "driver_failed",
        script_name: "s1",
        reason: "driver 崩溃",
      });
      manager.checkTimeouts();
      await flushAsync();

      const after = manager.getAgent(childId);
      assert.ok(after);
      assert.strictEqual(
        after!.status,
        "terminated",
        "driver_failed 后周期超限的子 Agent 应被 cycle 超时兜底回收",
      );
      assert.strictEqual(after!.driver.status, "failed", "driver 状态保持 failed 留痕");
    } finally {
      await manager.dispose();
    }
  });
});
