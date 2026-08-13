/**
 * 编排器 spawn 确定性化测试（Step 4: swarm-autopilot）。
 *
 * spawnAgent 不再经 promptUntilAccepted 触发管理器 LLM 回合（不产生
 * agent_start 等管理器事件），改为直接 await session.runRlmChild 确定性
 * spawn 子 Agent；占位条目先落池、runRlmChild 抛错时回滚。
 */

import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { GameAgentManager } from "../src/manager.js";
import { MetricsCollector } from "../src/metrics.js";
import type {
  AgentSession,
  AgentSessionEvent,
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
// 类型
// ---------------------------------------------------------------------------

/** 事件订阅 spy 的最小结构（node:test mock.fn 的 .mock 兼容子集） */
interface SpyWithCalls {
  mock: { calls: Array<{ arguments: unknown[] }> };
}

// ---------------------------------------------------------------------------
// Mock 工厂
// ---------------------------------------------------------------------------

interface MockSessionBundle {
  session: AgentSession;
  /** subscribe 捕获的事件回调 spy（断言 spawn 不触发事件） */
  getSubscriberSpy: () => SpyWithCalls | null;
}

function createMockSession(): MockSessionBundle {
  let subscriberSpy: SpyWithCalls | null = null;
  const session = {
    setSubagentRuntimeHost: mock.fn(),
    subscribe: mock.fn((cb: (event: AgentSessionEvent) => void) => {
      // 包装为 spy：spawnAgent 确定性流程不应触发任何管理器事件（agent_start）
      subscriberSpy = mock.fn(cb) as unknown as SpyWithCalls;
      return () => {
        subscriberSpy = null;
      };
    }),
    prompt: mock.fn(() => Promise.resolve()),
    runRlmChild: mock.fn(() =>
      Promise.resolve({
        rlm_child_id: "mock-rlm-child-1",
        name: "test-agent",
        session_dir: ".",
        model: "deepseek/deepseek-v4-flash",
      }),
    ),
    deleteRlmSubagent: mock.fn(() => Promise.resolve()),
    disposeAsync: mock.fn(() => Promise.resolve()),
    sessionId: "mock-session",
    scopedModels: undefined,
    sessionName: "mock-manager",
  } as unknown as AgentSession;
  return { session, getSubscriberSpy: () => subscriberSpy };
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
// 辅助
// ---------------------------------------------------------------------------

async function createTestManager(): Promise<{
  manager: GameAgentManager;
  bundle: MockSessionBundle;
}> {
  const bundle = createMockSession();
  const authStorage = createMockAuthStorage();
  const modelRegistry = createMockModelRegistry();
  const mockMetricsCollector = {
    recordStabilityIncident: mock.fn(),
    recordMatch: mock.fn(),
    dispose: mock.fn(() => Promise.resolve()),
  } as unknown as MetricsCollector;
  // @ts-expect-error - 绕过 private 构造函数，单元测试专用
  const manager = new GameAgentManager(
    bundle.session,
    TEST_CONFIG,
    authStorage,
    modelRegistry,
    ".",
    mockMetricsCollector,
  );
  return { manager, bundle };
}

// ---------------------------------------------------------------------------
// 测试用例
// ---------------------------------------------------------------------------

describe("GameAgentManager spawn 确定性", () => {
  it("spawnAgent 直接调用 runRlmChild 且不触发任何管理器事件", async () => {
    const { manager, bundle } = await createTestManager();
    try {
      const agentName = "spawn-test-agent";

      const childId = await manager.spawnAgent(agentName, "classic");

      // 1. runRlmChild 被调用一次，参数正确（taskPrompt + { name }）
      const session = bundle.session as unknown as {
        runRlmChild: { mock: { calls: Array<{ arguments: unknown[] }> } };
      };
      assert.strictEqual(session.runRlmChild.mock.calls.length, 1, "runRlmChild 应恰好调用一次");
      const [prompt, kwargs] = session.runRlmChild.mock.calls[0].arguments;
      assert.strictEqual(typeof prompt, "string");
      assert.ok((prompt as string).includes(agentName), "taskPrompt 应包含 agentName");
      assert.deepStrictEqual(kwargs, { name: agentName }, "kwargs 应仅含 name");

      // 2. 占位条目正确：child-<uuid> key、queued、session 为 null
      const entry = manager.getAgent(childId);
      assert.ok(entry, "spawn 后应存在占位条目");
      assert.ok(childId.startsWith("child-"), "childId 应维持 child-<uuid> 生成逻辑");
      assert.strictEqual(entry!.agentName, agentName);
      assert.strictEqual(entry!.status, "queued", "占位条目初始状态应为 queued");
      assert.strictEqual(entry!.session, null, "占位条目 session 应为 null（等待关联）");

      // 3. 无 agent_start：spawn 过程不产生任何管理器事件（确定性流程）
      const spy = bundle.getSubscriberSpy();
      assert.ok(spy, "事件订阅 spy 应已注册");
      assert.strictEqual(spy!.mock.calls.length, 0, "spawnAgent 不应触发 agent_start 等管理器事件");
    } finally {
      await manager.dispose();
    }
  });

  it("runRlmChild 抛错时回滚占位条目并抛出错误", async () => {
    const { manager, bundle } = await createTestManager();
    try {
      const session = bundle.session as unknown as {
        runRlmChild: { mock: { mockImplementation: (fn: () => Promise<never>) => void } };
      };
      session.runRlmChild.mock.mockImplementation(() => Promise.reject(new Error("spawn 失败")));

      await assert.rejects(
        () => manager.spawnAgent("fail-agent", "classic"),
        /spawn 失败/,
        "runRlmChild 失败时 spawnAgent 应抛错",
      );

      // 占位条目已回滚：池为空
      assert.strictEqual(manager.listAgents().length, 0, "占位条目应被删除");
    } finally {
      await manager.dispose();
    }
  });

  it("spawnAgent 在管理器已销毁时拒绝", async () => {
    const { manager } = await createTestManager();
    await manager.dispose();
    await assert.rejects(
      () => manager.spawnAgent("late-agent", "classic"),
      /已销毁/,
      "已销毁的管理器不应再 spawn",
    );
  });

  it("spawnAgent 保存 RLM childNodeId，deleteAgent 用它删除 RLM 注册表条目", async () => {
    const { manager, bundle } = await createTestManager();
    try {
      const agentName = "del-agent";
      const childId = await manager.spawnAgent(agentName, "classic");

      // 1. runRlmChild 的 handle.rlm_child_id 被回填到条目（B3 修复：占位 key
      //    child-<uuid> 不是 deleteRlmSubagent 的合法 selector，必须用 rlm_child_id）
      const entry = manager.getAgent(childId);
      assert.ok(entry, "spawn 后应存在条目");
      assert.strictEqual(entry!.rlmChildId, "mock-rlm-child-1", "rlmChildId 应从 handle 回填");

      // 2. deleteAgent 调用 deleteRlmSubagent 时传 rlmChildId 而非占位 key
      await manager.deleteAgent(childId);
      const session = bundle.session as unknown as {
        deleteRlmSubagent: { mock: { calls: Array<{ arguments: unknown[] }> } };
      };
      assert.strictEqual(session.deleteRlmSubagent.mock.calls.length, 1);
      const [target] = session.deleteRlmSubagent.mock.calls[0].arguments;
      assert.strictEqual(target, "mock-rlm-child-1", "deleteRlmSubagent 应收到 rlm_child_id");
    } finally {
      await manager.dispose();
    }
  });

  it("deleteRlmSubagent 抛错时 deleteAgent 仍完成清理（容错路径）", async () => {
    const { manager, bundle } = await createTestManager();
    try {
      const childId = await manager.spawnAgent("fault-del-agent", "classic");
      const session = bundle.session as unknown as {
        deleteRlmSubagent: { mock: { mockImplementation: (fn: () => Promise<never>) => void } };
      };
      // mock 恒 resolve 会掩盖 RLM 删除失败的真实容错路径——deleteAgent
      // 内部 catch 吞错后仍应继续清理（dispose session + 标记 terminated）。
      session.deleteRlmSubagent.mock.mockImplementation(() =>
        Promise.reject(new Error("RLM 删除失败")),
      );

      const deleted = await manager.deleteAgent(childId);
      assert.strictEqual(deleted, true, "RLM 删除失败时 deleteAgent 仍应返回 true");
      const entry = manager.getAgent(childId);
      assert.strictEqual(entry!.status, "terminated", "条目标记 terminated 保留 metrics");
    } finally {
      await manager.dispose();
    }
  });
});
