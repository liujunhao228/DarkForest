/**
 * agent_message 任务下发协议 + child×driver 双维度状态机测试（Step 5:
 * swarm-autopilot）。
 *
 * 覆盖：
 * - sendTask 经子 Agent 的 agentMessageController 反推投递 JSON 任务消息，
 *   触发子 session 的 autonomous continuation（promptUntilAccepted + followUp）
 * - 新阶段汇报事件解析：script_ready / batch_start / batch_end / driver_failed
 *   / review_done / v_published → entry.driver 状态机与 metrics 更新
 * - batch_end / v_published 重复上报去重
 * - 未知事件忽略
 */

import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { GameAgentManager } from "../src/manager.js";
import { MetricsCollector } from "../src/metrics.js";
import type {
  AgentSessionMessageController,
} from "../src/agent-message-controller.js";
import type {
  AgentSession,
  AuthStorage,
  CreateRlmSubagentRuntimeOptions,
  ModelRegistry,
  RlmSubagentRuntime,
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
// Mock 工厂
// ---------------------------------------------------------------------------

interface MockSessionBundle {
  session: AgentSession;
  /** promptUntilAccepted 的 mock 引用（断言 sendTask 投递） */
  promptUntilAcceptedMock: {
    mock: { calls: Array<{ arguments: unknown[] }> };
  };
}

function createMockSession(sessionName: string): MockSessionBundle {
  const promptUntilAcceptedMock = mock.fn(() => Promise.resolve());
  const session = {
    setSubagentRuntimeHost: mock.fn(),
    subscribe: mock.fn(() => () => {}),
    prompt: mock.fn(() => Promise.resolve()),
    promptUntilAccepted: promptUntilAcceptedMock,
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
  return {
    session,
    promptUntilAcceptedMock: promptUntilAcceptedMock as unknown as {
      mock: { calls: Array<{ arguments: unknown[] }> };
    },
  };
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

interface TestManagerBundle {
  manager: GameAgentManager;
  metricsCollector: {
    recordStabilityIncident: { mock: { calls: Array<{ arguments: unknown[] }> } };
    recordMatch: { mock: { calls: Array<{ arguments: unknown[] }> } };
    recordBatch: { mock: { calls: Array<{ arguments: unknown[] }> } };
    dispose: () => Promise<void>;
  };
}

async function createTestManager(): Promise<TestManagerBundle> {
  const session = createMockSession("mock-manager").session;
  const authStorage = createMockAuthStorage();
  const modelRegistry = createMockModelRegistry();
  const metricsCollector = {
    recordStabilityIncident: mock.fn(),
    recordMatch: mock.fn(),
    recordBatch: mock.fn(),
    dispose: mock.fn(() => Promise.resolve()),
  } as unknown as MetricsCollector;
  // @ts-expect-error - 绕过 private 构造函数，单元测试专用
  const manager = new GameAgentManager(
    session,
    TEST_CONFIG,
    authStorage,
    modelRegistry,
    ".",
    metricsCollector,
  );
  return {
    manager,
    metricsCollector: metricsCollector as unknown as TestManagerBundle["metricsCollector"],
  };
}

// ---------------------------------------------------------------------------
// 辅助：spawn + 关联 mock session + 创建并注册 controller
// ---------------------------------------------------------------------------

interface SetupChildResult {
  childId: string;
  controller: AgentSessionMessageController;
  promptUntilAcceptedMock: {
    mock: { calls: Array<{ arguments: unknown[] }> };
  };
}

/** 模拟 createRlmSubagentRuntime 的关联效果（controller + session 就绪）。 */
async function setupChild(
  manager: GameAgentManager,
  agentName: string,
): Promise<SetupChildResult> {
  const childId = await manager.spawnAgent(agentName, "classic");
  const entry = manager.getAgent(childId);
  assert.ok(entry, "spawn 后应有占位条目");
  const { session, promptUntilAcceptedMock } = createMockSession(agentName);
  // 模拟 onSessionPublished：子 session 关联到占位条目
  entry!.session = session;
  // @ts-expect-error - 测试访问 private 方法（绕过真实 createChildSession）
  const controller = manager.createChildAgentController(`mock-rlm-${agentName}`, agentName);
  // @ts-expect-error - 测试访问 private 方法（模拟 createRlmSubagentRuntime 注册）
  manager.registerChildController(agentName, controller);
  return { childId, controller, promptUntilAcceptedMock };
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

describe("GameAgentManager sendTask 任务下发", () => {
  it("sendTask 经 controller 反推投递 JSON 任务消息并触发子 session continuation", async () => {
    const { manager } = await createTestManager();
    try {
      const { childId, promptUntilAcceptedMock } = await setupChild(manager, "task-agent");
      const task = {
        type: "task",
        action: "run_cycle",
        script_name: "s1",
        games: 3,
        review_every: 3,
      } as const;

      const ok = await manager.sendTask(childId, task);

      assert.strictEqual(ok, true, "sendTask 应投递成功");
      const calls = promptUntilAcceptedMock.mock.calls;
      assert.strictEqual(calls.length, 1, "promptUntilAccepted 应被调用一次");
      const [message, options] = calls[0].arguments as [string, Record<string, unknown>];
      assert.deepStrictEqual(
        JSON.parse(message),
        task,
        "投递的消息应为 JSON 序列化的任务消息",
      );
      assert.strictEqual(options.streamingBehavior, "followUp", "忙碌时应 followUp 排队");
      assert.strictEqual(options.expandPromptTemplates, false, "任务 JSON 不应被模板展开");

      // lastTask 留痕
      const entry = manager.getAgent(childId);
      assert.deepStrictEqual(entry?.lastTask, task, "entry.lastTask 应记录最近任务");

      // Step 6: run_cycle 投递成功 → 开启周期计时（cycle 超时基准）+ 刷新 idle 心跳
      assert.notStrictEqual(entry?.cycleStartedAt, null, "run_cycle 投递后应开启周期计时");
      assert.ok(
        entry!.cycleStartedAt !== null && entry!.cycleStartedAt <= Date.now(),
        "周期起点不应晚于当前时刻",
      );
      assert.ok(
        entry!.lastActivityAt >= entry!.startTime,
        "投递任务应刷新 lastActivityAt（心跳）",
      );
    } finally {
      await manager.dispose();
    }
  });

  it("stop 任务投递后清空周期计时（终止 run_cycle）", async () => {
    const { manager } = await createTestManager();
    try {
      const { childId } = await setupChild(manager, "stop-agent");

      // 先开启一个周期
      const okRun = await manager.sendTask(childId, {
        type: "task",
        action: "run_cycle",
        script_name: "s1",
        games: 3,
      });
      assert.strictEqual(okRun, true, "run_cycle 应投递成功");
      assert.notStrictEqual(manager.getAgent(childId)!.cycleStartedAt, null);

      // stop 终止周期
      const okStop = await manager.sendTask(childId, {
        type: "task",
        action: "stop",
      });
      assert.strictEqual(okStop, true, "stop 应投递成功");
      assert.strictEqual(
        manager.getAgent(childId)!.cycleStartedAt,
        null,
        "stop 投递后应清空周期计时",
      );
    } finally {
      await manager.dispose();
    }
  });

  it("sendTask 在 controller 未注册或子 Agent 不存在时返回 false", async () => {
    const { manager } = await createTestManager();
    try {
      // 未注册 controller（仅 spawn 占位）
      const childId = await manager.spawnAgent("unregistered-agent", "classic");
      const ok = await manager.sendTask(childId, {
        type: "task",
        action: "run_cycle",
        script_name: "s1",
        games: 1,
      });
      assert.strictEqual(ok, false, "controller 未注册时 sendTask 应返回 false");

      // 不存在的 childId
      const okMissing = await manager.sendTask("child-does-not-exist", {
        type: "task",
        action: "stop",
      });
      assert.strictEqual(okMissing, false, "childId 不存在时 sendTask 应返回 false");
    } finally {
      await manager.dispose();
    }
  });

  it("controller 未实现入站投递时 sendTask 返回 false", async () => {
    const { manager } = await createTestManager();
    try {
      // 手动构造无 deliverInboundMessage 的 controller（结构兼容，但投递不可用），
      // sendTask 应检测到不支持入站投递并返回 false 而非抛错。
      const bareController: AgentSessionMessageController = {
        listAgents: () => ({ current: undefined, agents: [] }),
        sendAgentMessage: () => Promise.resolve({
          id: "m",
          source: "agent_message",
          target: { activeSessionId: "x", sessionId: "x" },
          message: "",
          deliveryStatus: "delivered",
        }),
      };
      const childId = await manager.spawnAgent("bare-agent", "classic");
      // @ts-expect-error - 测试访问 private 方法
      manager.registerChildController("bare-agent", bareController);

      const ok = await manager.sendTask(childId, {
        type: "task",
        action: "run_cycle",
        script_name: "s1",
        games: 1,
      });
      assert.strictEqual(ok, false, "controller 未实现入站投递时 sendTask 应返回 false");
    } finally {
      await manager.dispose();
    }
  });

  it("子 session 未就绪（entry.session 为空）时 sendTask 返回 false", async () => {
    const { manager } = await createTestManager();
    try {
      const childId = await manager.spawnAgent("not-ready-agent", "classic");
      // 仅注册 controller，不关联子 session（模拟 createRlmSubagentRuntime 尚未
      // 完成 onSessionPublished 关联）
      // @ts-expect-error - 测试访问 private 方法
      const controller = manager.createChildAgentController("mock-rlm-not-ready", "not-ready-agent");
      // @ts-expect-error - 测试访问 private 方法
      manager.registerChildController("not-ready-agent", controller);

      const ok = await manager.sendTask(childId, {
        type: "task",
        action: "run_cycle",
        script_name: "s1",
        games: 1,
      });
      assert.strictEqual(ok, false, "子 session 未就绪时 sendTask 应返回 false");
    } finally {
      await manager.dispose();
    }
  });

  it("deleteRlmSubagentRuntime（RLM childNodeId）后条目标记 terminated，sendTask 不再误报 controller 未注册", async () => {
    const { manager } = await createTestManager();
    try {
      const agentName = "ghost-agent";
      const { childId } = await setupChild(manager, agentName);
      // 基线：就绪态 sendTask 应投递成功
      const okBefore = await manager.sendTask(childId, { type: "task", action: "stop" });
      assert.strictEqual(okBefore, true, "子 Agent 就绪时 sendTask 应投递成功");

      // 模拟 RLM 引擎在子 run 结束时以 childNodeId（sub-<hash>，非占位 key）
      // 调用 deleteRlmSubagentRuntime——回归：此前 children.delete(childId) 用
      // RLM childNodeId 删不掉占位条目（child-<uuid>），留下 controller 已注销
      // 但条目仍 running 的幽灵条目，sendTask 误报"controller 未注册或未就绪"。
      const { session } = createMockSession(agentName);
      await manager.deleteRlmSubagentRuntime(`sub-${agentName}`, session);

      const entry = manager.getAgent(childId);
      assert.ok(entry, "占位条目应保留（terminated 语义，metrics 不丢）");
      assert.strictEqual(entry!.status, "terminated", "RLM 子 run 结束后条目应标记 terminated");

      // sendTask 命中 terminated 条目 → 走"已回收"分支返回 false（而非误报）
      const okAfter = await manager.sendTask(childId, { type: "task", action: "stop" });
      assert.strictEqual(okAfter, false, "terminated 条目 sendTask 应返回 false（已回收）");

      // 幂等：重复 delete 不抛错、条目状态不变
      await manager.deleteRlmSubagentRuntime(`sub-${agentName}`, session);
      const entry2 = manager.getAgent(childId);
      assert.strictEqual(entry2!.status, "terminated", "重复 deleteRlmSubagentRuntime 应幂等");
    } finally {
      await manager.dispose();
    }
  });

  it("releaseRlmSubagentRuntime（initial task settle 接管）后子 Agent 保留常驻，sendTask 仍可投递", async () => {
    const { manager } = await createTestManager();
    try {
      const agentName = "release-agent";
      const { childId, promptUntilAcceptedMock } = await setupChild(manager, agentName);

      // 模拟引擎在 detached initial task settle 后调用 release 钩子（host 接管）
      await manager.releaseRlmSubagentRuntime(
        { session: manager.getAgent(childId)!.session! } as unknown as RlmSubagentRuntime,
        {} as CreateRlmSubagentRuntimeOptions,
        "done",
      );

      const entry = manager.getAgent(childId);
      assert.ok(entry, "release 后条目应保留（常驻）");
      assert.notStrictEqual(entry!.status, "terminated", "release 后条目不应被标记 terminated");

      // 回归：release 前（未实现钩子时引擎走 delete 路径）sendTask 报"已回收"，
      // controller 已注销；release 实现后 controller 保留，任务应投递成功。
      const ok = await manager.sendTask(childId, {
        type: "task",
        action: "run_cycle",
        script_name: "s1",
        games: 1,
      });
      assert.strictEqual(ok, true, "release 常驻后 sendTask 应投递成功");
      assert.strictEqual(promptUntilAcceptedMock.mock.calls.length, 1, "promptUntilAccepted 应被调用一次");
    } finally {
      await manager.dispose();
    }
  });
});

describe("GameAgentManager driver 状态机事件解析", () => {
  it("script_ready 记录脚本名与版本", async () => {
    const { manager } = await createTestManager();
    try {
      const { controller } = await setupChild(manager, "script-agent");

      await reportEvent(controller, {
        event: "script_ready",
        script_name: "s1",
        version: "v1",
      });

      const entry = manager.listAgents()[0];
      assert.strictEqual(entry.driver.scriptName, "s1");
      assert.strictEqual(entry.driver.scriptVersion, "v1");
      assert.strictEqual(entry.driver.status, "idle", "script_ready 不改变 driver 状态");
      assert.strictEqual(entry.driver.lastError, null);
    } finally {
      await manager.dispose();
    }
  });

  it("batch_start 置 driver 为 running 并清零批次计数", async () => {
    const { manager } = await createTestManager();
    try {
      const { controller } = await setupChild(manager, "batch-agent");

      await reportEvent(controller, { event: "script_ready", script_name: "s1", version: "v1" });
      // 预置上一批残留计数，验证 batch_start 清零隔离
      const entry = manager.listAgents()[0];
      entry.driver.batchMatches = 5;
      entry.driver.batchWins = 4;
      entry.driver.batchLosses = 1;

      await reportEvent(controller, {
        event: "batch_start",
        script_name: "s1",
        version: "v1",
        plan_games: 3,
      });

      assert.strictEqual(entry.driver.status, "running");
      assert.strictEqual(entry.driver.batchMatches, 0, "新一批 batchMatches 应清零");
      assert.strictEqual(entry.driver.batchWins, 0);
      assert.strictEqual(entry.driver.batchLosses, 0);
      assert.strictEqual(entry.driver.batchDraws, 0);
      assert.strictEqual(entry.driver.currentMatchId, null);
      assert.strictEqual(entry.driver.lastError, null);
    } finally {
      await manager.dispose();
    }
  });

  it("batch_end 更新 driver 计数并并入全局 metrics", async () => {
    const { manager } = await createTestManager();
    try {
      const { controller } = await setupChild(manager, "batch-end-agent");

      await reportEvent(controller, { event: "batch_start", script_name: "s1", version: "v1" });
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

      const entry = manager.listAgents()[0];
      assert.strictEqual(entry.driver.status, "done", "batch_end 后 driver 应为 done");
      assert.strictEqual(entry.driver.batchMatches, 3);
      assert.strictEqual(entry.driver.batchWins, 2);
      assert.strictEqual(entry.driver.batchLosses, 1);
      assert.strictEqual(entry.driver.batchDraws, 0);
      assert.strictEqual(entry.driver.lastError, null, "无 driver_errors 时 lastError 应为 null");

      // 并入全局 metrics
      assert.strictEqual(entry.metrics.matches, 3, "metrics.matches 应并入整批局数");
      assert.strictEqual(entry.metrics.wins, 2);
      assert.strictEqual(entry.metrics.losses, 1);
      assert.strictEqual(entry.metrics.draws, 0);
    } finally {
      await manager.dispose();
    }
  });

  it("batch_end 的 driver_errors 并入 lastError 留痕", async () => {
    const { manager } = await createTestManager();
    try {
      const { controller } = await setupChild(manager, "batch-err-agent");

      await reportEvent(controller, { event: "batch_start", script_name: "s1", version: "v1" });
      await reportEvent(controller, {
        event: "batch_end",
        script_name: "s1",
        version: "v1",
        games_played: 2,
        wins: 1,
        losses: 1,
        draws: 0,
        match_ids: ["m1", "m2"],
        driver_errors: ["m2 超时无动作被踢"],
      });

      const entry = manager.listAgents()[0];
      assert.strictEqual(entry.driver.status, "done");
      assert.strictEqual(entry.driver.lastError, "m2 超时无动作被踢");
    } finally {
      await manager.dispose();
    }
  });

  it("重复 batch_end 上报被去重（同脚本同版本只结算一次）", async () => {
    const { manager } = await createTestManager();
    try {
      const { controller } = await setupChild(manager, "batch-dup-agent");

      const payload = {
        event: "batch_end",
        script_name: "s1",
        version: "v1",
        games_played: 3,
        wins: 2,
        losses: 1,
        draws: 0,
        match_ids: ["m1", "m2", "m3"],
        driver_errors: [],
      };
      await reportEvent(controller, { event: "batch_start", script_name: "s1", version: "v1" });
      await reportEvent(controller, payload);
      await reportEvent(controller, payload);

      const entry = manager.listAgents()[0];
      assert.strictEqual(entry.metrics.matches, 3, "重复 batch_end 不应重复计数");
      assert.strictEqual(entry.metrics.wins, 2);
    } finally {
      await manager.dispose();
    }
  });

  it("driver_failed 置 failed 并记录 stability_incident(driver_failed)", async () => {
    const { manager, metricsCollector } = await createTestManager();
    try {
      const { controller } = await setupChild(manager, "fail-agent");

      await reportEvent(controller, {
        event: "driver_failed",
        script_name: "s1",
        reason: "driver 进程异常退出 (exit code 1)",
      });

      const entry = manager.listAgents()[0];
      assert.strictEqual(entry.driver.status, "failed");
      assert.strictEqual(entry.driver.lastError, "driver 进程异常退出 (exit code 1)");
      assert.strictEqual(entry.driver.scriptName, "s1");

      // stability_incident 类型 driver_failed 已记录
      const incident = entry.metrics.stabilityIncidents.find(
        (i) => i.type === "driver_failed",
      );
      assert.ok(incident, "应有 driver_failed 类型的 stability_incident");
      assert.strictEqual(incident!.details, "driver 进程异常退出 (exit code 1)");

      // 持久化路径被调用（MetricsCollector.recordStabilityIncident）
      assert.strictEqual(
        metricsCollector.recordStabilityIncident.mock.calls.length,
        1,
        "recordStabilityIncident 应被调用",
      );
    } finally {
      await manager.dispose();
    }
  });

  it("review_done 与 v_published 推进 scriptVersion，v_published 重复上报去重", async () => {
    const { manager } = await createTestManager();
    try {
      const { controller } = await setupChild(manager, "review-agent");

      await reportEvent(controller, { event: "script_ready", script_name: "s1", version: "v1" });
      await reportEvent(controller, {
        event: "review_done",
        script_name: "s1",
        from_version: "v1",
        to_version: "v2",
      });
      assert.strictEqual(
        manager.listAgents()[0].driver.scriptVersion,
        "v2",
        "review_done 应推进 scriptVersion 到 to_version",
      );

      await reportEvent(controller, { event: "v_published", script_name: "s1", version: "v2" });
      assert.strictEqual(
        manager.listAgents()[0].driver.scriptVersion,
        "v2",
        "v_published 应确认 scriptVersion",
      );
      // Step 6: v_published 周期闭环 → cycleStartedAt 清空（进入待命，不再受 cycle 超时约束）
      assert.strictEqual(
        manager.listAgents()[0].cycleStartedAt,
        null,
        "v_published 应清空周期计时",
      );

      // 重复上报 v2 被去重（无副作用，版本不变）
      await reportEvent(controller, { event: "v_published", script_name: "s1", version: "v2" });
      assert.strictEqual(manager.listAgents()[0].driver.scriptVersion, "v2");

      // 新版本 v3 正常推进
      await reportEvent(controller, { event: "v_published", script_name: "s1", version: "v3" });
      assert.strictEqual(manager.listAgents()[0].driver.scriptVersion, "v3");
    } finally {
      await manager.dispose();
    }
  });

  it("match_found 在批量进行中同步 driver.currentMatchId", async () => {
    const { manager } = await createTestManager();
    try {
      const { controller } = await setupChild(manager, "match-agent");

      await reportEvent(controller, { event: "batch_start", script_name: "s1", version: "v1" });
      await reportEvent(controller, { event: "match_found", matchId: "m1", roomId: "r1" });

      const entry = manager.listAgents()[0];
      assert.strictEqual(entry.currentMatchId, "m1", "顶层 currentMatchId 应更新");
      assert.strictEqual(entry.driver.currentMatchId, "m1", "driver.currentMatchId 应同步");
    } finally {
      await manager.dispose();
    }
  });

  it("未知事件被忽略（driver 字段与 metrics 不变）", async () => {
    const { manager } = await createTestManager();
    try {
      const { controller } = await setupChild(manager, "unknown-agent");

      const entry = manager.listAgents()[0];
      const before = JSON.stringify(entry.driver);

      await reportEvent(controller, { event: "some_future_event", foo: 1, bar: "x" });

      const after = JSON.stringify(manager.listAgents()[0].driver);
      assert.strictEqual(after, before, "未知事件不应改动 driver 状态");
      assert.strictEqual(manager.listAgents()[0].metrics.matches, 0);
      assert.strictEqual(manager.listAgents()[0].metrics.stabilityIncidents.length, 0);
    } finally {
      await manager.dispose();
    }
  });

  it("完整 run_cycle 生命周期驱动 driver 状态机", async () => {
    const { manager } = await createTestManager();
    try {
      const { controller } = await setupChild(manager, "cycle-agent");

      // script_ready(v1) → batch_start → batch_end → review_done → v_published(v2)
      await reportEvent(controller, { event: "script_ready", script_name: "s1", version: "v1" });
      assert.strictEqual(manager.listAgents()[0].driver.status, "idle");

      await reportEvent(controller, { event: "batch_start", script_name: "s1", version: "v1", plan_games: 3 });
      assert.strictEqual(manager.listAgents()[0].driver.status, "running");

      await reportEvent(controller, {
        event: "batch_end",
        script_name: "s1",
        version: "v1",
        games_played: 3,
        wins: 1,
        losses: 1,
        draws: 1,
        match_ids: ["m1", "m2", "m3"],
        driver_errors: [],
      });
      assert.strictEqual(manager.listAgents()[0].driver.status, "done");

      await reportEvent(controller, {
        event: "review_done",
        script_name: "s1",
        from_version: "v1",
        to_version: "v2",
      });
      assert.strictEqual(manager.listAgents()[0].driver.scriptVersion, "v2");

      await reportEvent(controller, { event: "v_published", script_name: "s1", version: "v2" });
      const final = manager.listAgents()[0].driver;
      assert.strictEqual(final.status, "done");
      assert.strictEqual(final.scriptVersion, "v2");
      assert.strictEqual(final.batchMatches, 3);
      assert.strictEqual(final.batchWins, 1);
      assert.strictEqual(final.batchLosses, 1);
      assert.strictEqual(final.batchDraws, 1);
    } finally {
      await manager.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// rlm_child_update 日志节流（2026-08-13 修复 4：风暴刷屏）
// ---------------------------------------------------------------------------

describe("GameAgentManager rlm_child_update 日志节流", () => {
  it("同 child 同 status 在 1s 窗口内只打 1 条，状态变化立即打印", async () => {
    const { manager } = await createTestManager();
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      const baseChild = { id: "sub-throttle", sessionName: "ai1" };
      const evt = (status: string) =>
        ({
          type: "rlm_child_update",
          child: { ...baseChild, status },
        }) as never;

      // 同 status=done 连续 5 次（毫秒级间隔）→ 只应打 1 条
      for (let i = 0; i < 5; i++) {
        // @ts-expect-error - 测试访问 private 方法
        manager.handleRlmChildUpdate(evt("done"));
      }
      const doneLogs = logs.filter((l) => l.includes("id=sub-throttle status=done"));
      assert.strictEqual(doneLogs.length, 1, "同 status 1s 窗口内应只打 1 条");

      // 状态变化 running → 立即打 1 条
      // @ts-expect-error - 测试访问 private 方法
      manager.handleRlmChildUpdate(evt("running"));
      const runningLogs = logs.filter((l) => l.includes("id=sub-throttle status=running"));
      assert.strictEqual(runningLogs.length, 1, "状态变化应立即打印");

      // 窗口内同 status 再次高频 → 仍只 1 条
      for (let i = 0; i < 3; i++) {
        // @ts-expect-error - 测试访问 private 方法
        manager.handleRlmChildUpdate(evt("running"));
      }
      const runningLogs2 = logs.filter((l) => l.includes("id=sub-throttle status=running"));
      assert.strictEqual(runningLogs2.length, 1, "窗口内重复同 status 不应新增日志");
    } finally {
      console.log = origLog;
    }
    await manager.dispose();
  });
});
