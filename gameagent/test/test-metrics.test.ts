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
  return { collector, cleanup: () => rmSync(tmpDir, { recursive: true }) };
}

// ---------------------------------------------------------------------------
// 测试用例
// ---------------------------------------------------------------------------

describe("MetricsCollector 聚合计算", () => {
  it("空数据应返回默认值", () => {
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
    cleanup();
  });

  it("应正确计算胜率", () => {
    const { collector, cleanup } = createCollector();
    collector.recordMatch("agent-1", "win", "match-1", 100000);
    collector.recordMatch("agent-1", "win", "match-2", 120000);
    collector.recordMatch("agent-1", "loss", "match-3", 90000);

    const metrics = collector.getAgentMetrics("agent-1");
    assert.strictEqual(metrics.matches, 3);
    assert.strictEqual(metrics.wins, 2);
    assert.strictEqual(metrics.losses, 1);
    assert.strictEqual(metrics.winRate, 2 / 3);
    cleanup();
  });

  it("应正确计算平均决策时间", () => {
    const { collector, cleanup } = createCollector();
    collector.recordDecision("agent-1", "play_card", true, 5000);
    collector.recordDecision("agent-1", "strike", true, 3000);
    collector.recordDecision("agent-1", "end_turn", true, 1000);

    const metrics = collector.getAgentMetrics("agent-1");
    assert.strictEqual(metrics.decisionCount, 3);
    assert.strictEqual(metrics.avgDecisionTime, (5000 + 3000 + 1000) / 3);
    cleanup();
  });

  it("应正确统计非法动作", () => {
    const { collector, cleanup } = createCollector();
    collector.recordDecision("agent-1", "play_card", true, 5000);
    collector.recordDecision("agent-1", "strike", false, 2000);
    collector.recordDecision("agent-1", "broadcast", false, 1500);

    const metrics = collector.getAgentMetrics("agent-1");
    assert.strictEqual(metrics.decisionCount, 3);
    assert.strictEqual(metrics.illegalActionCount, 2);
    assert.strictEqual(metrics.decisionAlignment, 1 / 3);
    cleanup();
  });

  it("应正确统计记忆创建", () => {
    const { collector, cleanup } = createCollector();
    collector.recordMemory("agent-1", "局内记忆", false);
    collector.recordMemory("agent-1", "局内记忆2", false);
    collector.recordMemory("agent-1", "全局技巧", true);

    const metrics = collector.getAgentMetrics("agent-1");
    assert.strictEqual(metrics.memoryCount, 3);
    assert.strictEqual(metrics.globalMemoryCount, 1);
    cleanup();
  });

  it("应正确统计异常事件", () => {
    const { collector, cleanup } = createCollector();
    collector.recordStabilityIncident("agent-1", "timeout", "超时 300000ms");
    collector.recordStabilityIncident("agent-1", "crash", "进程崩溃");
    collector.recordStabilityIncident("agent-1", "error", "未知错误");

    const metrics = collector.getAgentMetrics("agent-1");
    assert.strictEqual(metrics.incidentCount, 3);
    assert.strictEqual(metrics.stabilityIncidents.length, 3);
    assert.strictEqual(metrics.stabilityIncidents[0].type, "timeout");
    cleanup();
  });

  it("应隔离不同子 Agent 的指标", () => {
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
    cleanup();
  });

  it("should return all agents metrics", () => {
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
    cleanup();
  });

  it("应正确计算全部结果类型（win/loss/draw/timeout/crash）", () => {
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
    cleanup();
  });
});