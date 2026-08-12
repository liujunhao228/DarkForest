/**
 * 超时强制回收与异常记录测试。
 *
 * 用 mock AgentSession 测试 GameAgentManager 的 checkTimeouts 路径：
 * 1. 超时子 Agent 被标记为 terminated
 * 2. stability_incident（类型 timeout）被记录到 metrics
 * 3. 已 terminated 的子 Agent 不从池中移除
 */

import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { GameAgentManager } from "../src/manager.js";
import { MetricsCollector } from "../src/metrics.js";
import type { AgentSession, AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { AppConfig } from "../src/config.js";

// ---------------------------------------------------------------------------
// 测试常量
// ---------------------------------------------------------------------------

const TEST_TIMEOUT_MS = 50;
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
  maxGameTimeoutMs: TEST_TIMEOUT_MS,
  memoryDbPath: "./data/test-memories.json",
};

// ---------------------------------------------------------------------------
// Mock 工厂
// ---------------------------------------------------------------------------

function createMockSession(): AgentSession {
  return {
    setSubagentRuntimeHost: mock.fn(),
    subscribe: mock.fn(() => () => {}),
    prompt: mock.fn(() => Promise.resolve()),
    promptUntilAccepted: mock.fn(() => Promise.resolve()),
    deleteRlmSubagent: mock.fn(() => Promise.resolve()),
    disposeAsync: mock.fn(() => Promise.resolve()),
    sessionId: "mock-session",
    scopedModels: undefined,
    sessionName: "mock-manager",
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

async function createTestManager(): Promise<GameAgentManager> {
  const session = createMockSession();
  const authStorage = createMockAuthStorage();
  const modelRegistry = createMockModelRegistry();
  const mockMetricsCollector = {
    recordStabilityIncident: mock.fn(),
    recordMatch: mock.fn(),
    dispose: mock.fn(() => Promise.resolve()),
  } as unknown as MetricsCollector;
  // @ts-expect-error - 绕过 private 构造函数，单元测试专用
  return new GameAgentManager(session, TEST_CONFIG, authStorage, modelRegistry, TEST_AGENT_DIR, mockMetricsCollector);
}

// ---------------------------------------------------------------------------
// 辅助：等待 checkTimeouts 触发的异步 deleteAgent 完成
// ---------------------------------------------------------------------------

/** flush 微任务，让 checkTimeouts 内异步触发的 deleteAgent 完成状态变更。 */
async function flushAsync(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

// ---------------------------------------------------------------------------
// 测试用例
// ---------------------------------------------------------------------------

describe("GameAgentManager timeout", () => {
  it("应将超时子 Agent 标记为 terminated", async () => {
    const manager = await createTestManager();

    // spawnAgent 使用 mock session，prompt 立即 resolve
    const childId = await manager.spawnAgent("test-agent", "classic");

    // 等待超时到期
    await new Promise((r) => setTimeout(r, TEST_TIMEOUT_MS + 50));

    // 触发超时检查
    manager.checkTimeouts();

    // 等待异步回收完成（deleteAgent 内部 await session.deleteRlmSubagent）
    await flushAsync();

    // 验证：子 Agent 被标记为 terminated，仍留在池中
    const agent = manager.getAgent(childId);
    assert.ok(agent, "超时后子 Agent 不应从池中移除");
    assert.strictEqual(agent?.status, "terminated", "子 Agent 应被标记为 terminated");
    assert.strictEqual(agent?.session, null, "terminated 后 session 应清空");

    await manager.dispose();
  });

  it("应记录超时 stability_incident", async () => {
    const manager = await createTestManager();

    const childId = await manager.spawnAgent("test-agent", "classic");
    await new Promise((r) => setTimeout(r, TEST_TIMEOUT_MS + 50));
    manager.checkTimeouts();

    // 验证：metrics 中有 timeout 类型的 stability_incident
    const agent = manager.getAgent(childId);
    assert.ok(agent, "子 Agent 应仍在池中");
    assert.ok(agent!.metrics.stabilityIncidents.length > 0, "应有 stability_incident 记录");
    assert.strictEqual(
      agent!.metrics.stabilityIncidents[0].type,
      "timeout",
      "incident 类型应为 timeout",
    );
    assert.ok(
      agent!.metrics.stabilityIncidents[0].details.includes("超时"),
      "incident details 应包含超时信息",
    );

    await manager.dispose();
  });

  it("不应从池中移除已 terminated 的子 Agent", async () => {
    const manager = await createTestManager();

    const childId = await manager.spawnAgent("test-agent", "classic");
    await new Promise((r) => setTimeout(r, TEST_TIMEOUT_MS + 50));
    manager.checkTimeouts();
    await flushAsync();

    // 验证：listAgents 仍包含该子 Agent
    const agents = manager.listAgents();
    const found = agents.find((a) => a.childId === childId);
    assert.ok(found, "terminated 子 Agent 应仍可通过 listAgents 查到");

    await manager.dispose();
  });

  it("不应重复回收已 terminated 的子 Agent", async () => {
    const manager = await createTestManager();

    const childId = await manager.spawnAgent("test-agent", "classic");
    await new Promise((r) => setTimeout(r, TEST_TIMEOUT_MS + 50));

    // 第一次 checkTimeouts：应触发回收
    manager.checkTimeouts();
    await flushAsync();

    // 第二次 checkTimeouts：不应再触发（已 terminated）
    const incidentCountBefore = manager.getAgent(childId)!.metrics.stabilityIncidents.length;
    manager.checkTimeouts();
    const incidentCountAfter = manager.getAgent(childId)!.metrics.stabilityIncidents.length;

    // stability_incident 不应增加
    assert.strictEqual(
      incidentCountAfter,
      incidentCountBefore,
      "已 terminated 的子 Agent 不应重复触发超时回收",
    );

    await manager.dispose();
  });
});