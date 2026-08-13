/**
 * MetricsCollector 指标聚合计算测试。
 *
 * 测试 getAgentMetrics 的聚合计算正确性：
 * 1. 胜率计算
 * 2. 平均决策时间计算
 * 3. 非法动作计数
 * 4. 记忆计数
 * 5. 异常事件统计
 * 6. 空数据默认值
 * 7. 多子 Agent 隔离
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MetricsCollector } from "../src/metrics.js";

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

interface TestCollector {
  collector: MetricsCollector;
  cleanup: () => void;
}

function createCollector(): TestCollector {
  const tmpDir = mkdtempSync(join(tmpdir(), "metrics-test-"));
  const collector = new MetricsCollector(join(tmpDir, "metrics.json"));
  return {
    collector,
    cleanup: async () => {
      // 必须先等 fire-and-forget 的异步写盘完成，否则 Windows 删除
      // 被占用文件会 EPERM（rmSync 残留用 try/catch 容忍，不掩盖断言结果）。
      await collector.dispose();
      try {
        rmSync(tmpDir, { recursive: true });
      } catch {
        // 残留容忍：偶发句柄占用时留给系统清理
      }
    },
  };
}

// ---------------------------------------------------------------------------
// 测试用例
// ---------------------------------------------------------------------------

describe("MetricsCollector 聚合计算", () => {
  it("空数据应返回默认值", async () => {
    const { collector, cleanup } = createCollector();
    const metrics = collector.getAgentMetrics("nonexistent");
    assert.strictEqual(metrics.matches, 0);
    assert.strictEqual(metrics.wins, 0);
    assert.strictEqual(metrics.winRate, 0);
    assert.strictEqual(metrics.avgDecisionTime, 0);
    assert.strictEqual(metrics.decisionCount, 0);
    assert.strictEqual(metrics.memoryCount, 0);
    assert.strictEqual(metrics.incidentCount, 0);
    assert.strictEqual(metrics.decisionAlignment, 1, "无决策时决策吻合度应为 1");
    await cleanup();
  });

  it("应正确计算胜率", async () => {
    const { collector, cleanup } = createCollector();
    collector.recordMatch("agent-1", "win", "match-1", 100000);
    collector.recordMatch("agent-1", "win", "match-2", 120000);
    collector.recordMatch("agent-1", "loss", "match-3", 90000);

    const metrics = collector.getAgentMetrics("agent-1");
    assert.strictEqual(metrics.matches, 3);
    assert.strictEqual(metrics.wins, 2);
    assert.strictEqual(metrics.losses, 1);
    assert.strictEqual(metrics.winRate, 2 / 3);
    await cleanup();
  });

  it("应正确计算平均决策时间", async () => {
    const { collector, cleanup } = createCollector();
    collector.recordDecision("agent-1", "play_card", true, 5000);
    collector.recordDecision("agent-1", "strike", true, 3000);
    collector.recordDecision("agent-1", "end_turn", true, 1000);

    const metrics = collector.getAgentMetrics("agent-1");
    assert.strictEqual(metrics.decisionCount, 3);
    assert.strictEqual(metrics.avgDecisionTime, (5000 + 3000 + 1000) / 3);
    await cleanup();
  });

  it("应正确统计非法动作", async () => {
    const { collector, cleanup } = createCollector();
    collector.recordDecision("agent-1", "play_card", true, 5000);
    collector.recordDecision("agent-1", "strike", false, 2000);
    collector.recordDecision("agent-1", "broadcast", false, 1500);

    const metrics = collector.getAgentMetrics("agent-1");
    assert.strictEqual(metrics.decisionCount, 3);
    assert.strictEqual(metrics.illegalActionCount, 2);
    assert.strictEqual(metrics.decisionAlignment, 1 / 3);
    await cleanup();
  });

  it("应正确统计记忆创建", async () => {
    const { collector, cleanup } = createCollector();
    collector.recordMemory("agent-1", "局内记忆", false);
    collector.recordMemory("agent-1", "局内记忆2", false);
    collector.recordMemory("agent-1", "全局技巧", true);

    const metrics = collector.getAgentMetrics("agent-1");
    assert.strictEqual(metrics.memoryCount, 3);
    assert.strictEqual(metrics.globalMemoryCount, 1);
    await cleanup();
  });

  it("应正确统计异常事件", async () => {
    const { collector, cleanup } = createCollector();
    collector.recordStabilityIncident("agent-1", "timeout", "超时 300000ms");
    collector.recordStabilityIncident("agent-1", "crash", "进程崩溃");
    collector.recordStabilityIncident("agent-1", "error", "未知错误");

    const metrics = collector.getAgentMetrics("agent-1");
    assert.strictEqual(metrics.incidentCount, 3);
    assert.strictEqual(metrics.stabilityIncidents.length, 3);
    assert.strictEqual(metrics.stabilityIncidents[0].type, "timeout");
    await cleanup();
  });

  it("应隔离不同子 Agent 的指标", async () => {
    const { collector, cleanup } = createCollector();
    collector.recordMatch("agent-1", "win", "m1", 100000);
    collector.recordMatch("agent-2", "loss", "m2", 90000);
    collector.recordDecision("agent-1", "play_card", true, 5000);
    collector.recordMemory("agent-2", "记忆", false);

    const m1 = collector.getAgentMetrics("agent-1");
    const m2 = collector.getAgentMetrics("agent-2");

    assert.strictEqual(m1.matches, 1);
    assert.strictEqual(m1.wins, 1);
    assert.strictEqual(m1.decisionCount, 1);
    assert.strictEqual(m1.memoryCount, 0);

    assert.strictEqual(m2.matches, 1);
    assert.strictEqual(m2.losses, 1);
    assert.strictEqual(m2.decisionCount, 0);
    assert.strictEqual(m2.memoryCount, 1);
    await cleanup();
  });

  it("should return all agents metrics", async () => {
    const { collector, cleanup } = createCollector();
    collector.recordMatch("agent-1", "win", "m1", 100000);
    collector.recordMatch("agent-2", "loss", "m2", 90000);
    collector.recordDecision("agent-1", "play_card", true, 5000);
    collector.recordMemory("agent-2", "记忆", false);

    const all = collector.getAllMetrics();
    const agentIds = Object.keys(all);
    assert.strictEqual(agentIds.length, 2, "应返回两个子 Agent 的指标");
    assert.ok(agentIds.includes("agent-1"));
    assert.ok(agentIds.includes("agent-2"));
    await cleanup();
  });

  it("应正确计算全部结果类型（win/loss/draw/timeout/crash）", async () => {
    const { collector, cleanup } = createCollector();
    collector.recordMatch("agent-1", "win", "m1", 100000);
    collector.recordMatch("agent-1", "loss", "m2", 90000);
    collector.recordMatch("agent-1", "draw", "m3", 110000);
    collector.recordMatch("agent-1", "timeout", "m4", 300000);
    collector.recordMatch("agent-1", "crash", "m5", 50000);

    const metrics = collector.getAgentMetrics("agent-1");
    assert.strictEqual(metrics.matches, 5);
    assert.strictEqual(metrics.wins, 1);
    assert.strictEqual(metrics.losses, 1);
    assert.strictEqual(metrics.draws, 1);
    assert.strictEqual(metrics.timeouts, 1);
    assert.strictEqual(metrics.crashes, 1);
    assert.strictEqual(metrics.winRate, 1 / 5);
    await cleanup();
  });
});

// ---------------------------------------------------------------------------
// Step 11 metrics 扩展：executor / scriptVersion / driverStatus / batch / driver_failed
// ---------------------------------------------------------------------------

describe("MetricsCollector Step 11 扩展", () => {
  it("空数据的新增字段应返回默认值", async () => {
    const { collector, cleanup } = createCollector();
    const metrics = collector.getAgentMetrics("nonexistent");
    assert.strictEqual(metrics.driverMatches, 0);
    assert.strictEqual(metrics.llmMatches, 0);
    assert.strictEqual(metrics.batchCount, 0);
    assert.strictEqual(metrics.batchGames, 0);
    assert.strictEqual(metrics.driverFailures, 0);
    assert.strictEqual(metrics.latestScriptVersion, null);
    assert.strictEqual(metrics.latestDriverStatus, null);
    await cleanup();
  });

  it("recordMatch 按 executor 区分 driver / llm 归属", async () => {
    const { collector, cleanup } = createCollector();
    collector.recordMatch("agent-1", "win", "d1", 100000, { executor: "driver" });
    collector.recordMatch("agent-1", "loss", "d2", 90000, { executor: "driver" });
    collector.recordMatch("agent-1", "win", "l1", 80000, { executor: "llm" });
    // 无 executor（历史数据）语义上归入 llmMatches
    collector.recordMatch("agent-1", "loss", "legacy-1", 70000);

    const metrics = collector.getAgentMetrics("agent-1");
    assert.strictEqual(metrics.matches, 4);
    assert.strictEqual(metrics.driverMatches, 2);
    assert.strictEqual(metrics.llmMatches, 2);
    // matches 语义不变（不含 batch 局数），winRate 仍按 match 事件算
    assert.strictEqual(metrics.winRate, 2 / 4);
    await cleanup();
  });

  it("recordBatch 应聚合 batchCount / batchGames 且不并入 matches", async () => {
    const { collector, cleanup } = createCollector();
    collector.recordBatch("agent-1", {
      scriptName: "s1",
      scriptVersion: "v1",
      gamesPlayed: 10,
      wins: 6,
      losses: 3,
      draws: 1,
      matchIds: ["m1", "m2"],
      driverErrors: ["局1: 非法动作"],
    });
    collector.recordBatch("agent-1", {
      scriptName: "s1",
      scriptVersion: "v2",
      gamesPlayed: 5,
      wins: 3,
      losses: 2,
      draws: 0,
      matchIds: ["m3"],
      driverErrors: [],
    });

    const metrics = collector.getAgentMetrics("agent-1");
    assert.strictEqual(metrics.batchCount, 2);
    assert.strictEqual(metrics.batchGames, 15);
    // batch 局数不并入 matches（match 事件数语义不变）
    assert.strictEqual(metrics.matches, 0);
    assert.strictEqual(metrics.wins, 0);
    assert.strictEqual(metrics.driverMatches, 0);

    // 原始事件留痕完整
    const batches = collector.getRawEvents().filter((e) => e.type === "batch");
    assert.strictEqual(batches.length, 2);
    const first = batches[0];
    assert.ok(first.type === "batch");
    if (first.type === "batch") {
      assert.strictEqual(first.executor, "driver");
      assert.strictEqual(first.scriptVersion, "v1");
      assert.deepStrictEqual(first.matchIds, ["m1", "m2"]);
      assert.deepStrictEqual(first.driverErrors, ["局1: 非法动作"]);
    }
    await cleanup();
  });

  it("driver_failed incident 应计数并带扩展字段", async () => {
    const { collector, cleanup } = createCollector();
    collector.recordStabilityIncident("agent-1", "timeout", "空闲超时");
    collector.recordStabilityIncident("agent-1", "driver_failed", "driver 进程异常退出", {
      executor: "driver",
      driverStatus: "failed",
      scriptVersion: "s1:v1",
    });

    const metrics = collector.getAgentMetrics("agent-1");
    assert.strictEqual(metrics.incidentCount, 2);
    assert.strictEqual(metrics.driverFailures, 1);
    const failed = metrics.stabilityIncidents.find((i) => i.type === "driver_failed");
    assert.ok(failed, "应包含 driver_failed incident");
    assert.strictEqual(failed?.executor, "driver");
    assert.strictEqual(failed?.driverStatus, "failed");
    await cleanup();
  });

  it("latestScriptVersion / latestDriverStatus 取最近事件", async () => {
    const { collector, cleanup } = createCollector();
    collector.recordBatch("agent-1", {
      scriptName: "s1",
      scriptVersion: "v1",
      gamesPlayed: 3,
      wins: 2,
      losses: 1,
      draws: 0,
      matchIds: ["m1"],
      driverErrors: [],
    });
    collector.recordMatch("agent-1", "win", "m2", 100000, {
      executor: "driver",
      scriptVersion: "s1:v2",
      driverStatus: "running",
    });
    collector.recordStabilityIncident("agent-1", "driver_failed", "崩溃", {
      executor: "driver",
      driverStatus: "failed",
      scriptVersion: "s1:v2",
    });

    const metrics = collector.getAgentMetrics("agent-1");
    assert.strictEqual(metrics.latestScriptVersion, "s1:v2");
    assert.strictEqual(metrics.latestDriverStatus, "failed");
    await cleanup();
  });

  it("旧 NDJSON 数据（无新字段）加载与聚合兼容", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "metrics-legacy-"));
    const filePath = join(tmpDir, "metrics.json");
    // 手写旧格式行：无 executor / scriptVersion / driverStatus / batch
    const legacy = [
      { type: "match", childId: "agent-1", result: "win", matchId: "m1", durationMs: 100000, timestamp: 1000 },
      { type: "match", childId: "agent-1", result: "loss", matchId: "m2", durationMs: 90000, timestamp: 2000 },
      { type: "incident", childId: "agent-1", incidentType: "timeout", details: "超时", timestamp: 3000 },
      { type: "decision", childId: "agent-1", action: "play_card", isLegal: true, decisionTimeMs: 5000, timestamp: 4000 },
      { type: "memory", childId: "agent-1", content: "旧记忆", isGlobal: false, timestamp: 5000 },
    ];
    await writeFile(filePath, legacy.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf-8");

    const collector = new MetricsCollector(filePath);
    await collector.init();
    const metrics = collector.getAgentMetrics("agent-1");

    // 旧字段聚合不变
    assert.strictEqual(metrics.matches, 2);
    assert.strictEqual(metrics.wins, 1);
    assert.strictEqual(metrics.decisionCount, 1);
    assert.strictEqual(metrics.incidentCount, 1);
    assert.strictEqual(metrics.memoryCount, 1);
    // 新字段对旧数据向后兼容：driver 局数 0，历史 match 归入 llmMatches
    assert.strictEqual(metrics.driverMatches, 0);
    assert.strictEqual(metrics.llmMatches, 2);
    assert.strictEqual(metrics.batchCount, 0);
    assert.strictEqual(metrics.batchGames, 0);
    assert.strictEqual(metrics.driverFailures, 0);
    assert.strictEqual(metrics.latestScriptVersion, null);
    assert.strictEqual(metrics.latestDriverStatus, null);
    rmSync(tmpDir, { recursive: true });
  });

  it("recordMatch 带 driverStatus 时最新状态更新", async () => {
    const { collector, cleanup } = createCollector();
    collector.recordMatch("agent-1", "win", "m1", 100000, {
      executor: "driver",
      driverStatus: "running",
    });
    const metrics = collector.getAgentMetrics("agent-1");
    assert.strictEqual(metrics.driverMatches, 1);
    assert.strictEqual(metrics.latestDriverStatus, "running");
    await cleanup();
  });
});