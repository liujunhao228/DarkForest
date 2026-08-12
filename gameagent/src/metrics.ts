/**
 * 评估指标采集器（MetricsCollector）。
 *
 * 以 NDJSON 格式持久化 match / decision / memory / incident 事件
 * 到 data/metrics.json，启动时加载历史数据，支持按子 Agent 聚合计算。
 */

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";

// ---------------------------------------------------------------------------
// NDJSON 事件类型
// ---------------------------------------------------------------------------

/** 对局结果事件 */
export interface MatchRecord {
  type: "match";
  childId: string;
  result: "win" | "loss" | "draw" | "timeout" | "crash";
  matchId: string;
  durationMs: number;
  timestamp: number;
}

/** 决策事件 */
export interface DecisionRecord {
  type: "decision";
  childId: string;
  action: string;
  isLegal: boolean;
  decisionTimeMs: number;
  affordanceOptimalAction?: string;
  timestamp: number;
}

/** 记忆创建事件 */
export interface MemoryRecord {
  type: "memory";
  childId: string;
  content: string;
  isGlobal: boolean;
  timestamp: number;
}

/** 稳定性异常事件 */
export interface IncidentRecord {
  type: "incident";
  childId: string;
  incidentType: string;
  details: string;
  timestamp: number;
}

/** 所有 NDJSON 事件类型的联合 */
export type MetricEvent = MatchRecord | DecisionRecord | MemoryRecord | IncidentRecord;

// ---------------------------------------------------------------------------
// 聚合指标类型
// ---------------------------------------------------------------------------

/** 按子 Agent 聚合后的评估指标 */
export interface AgentMetrics {
  /** 总对局数 */
  matches: number;
  /** 胜场 */
  wins: number;
  /** 负场 */
  losses: number;
  /** 平局 */
  draws: number;
  /** 超时次数 */
  timeouts: number;
  /** 崩溃次数 */
  crashes: number;
  /** 胜率（0-1，无对局时返回 0） */
  winRate: number;
  /** 平均决策时间（毫秒，无决策时返回 0） */
  avgDecisionTime: number;
  /** 决策次数 */
  decisionCount: number;
  /** 非法动作次数 */
  illegalActionCount: number;
  /** 记忆创建数 */
  memoryCount: number;
  /** 全局记忆数 */
  globalMemoryCount: number;
  /** 异常事件数 */
  incidentCount: number;
  /** 异常事件列表 */
  stabilityIncidents: Array<{ type: string; timestamp: number; details: string }>;
  /** 决策吻合度（0-1，合法动作占比，无决策时返回 1） */
  decisionAlignment: number;
}

// ---------------------------------------------------------------------------
// MetricsCollector
// ---------------------------------------------------------------------------

export class MetricsCollector {
  private events: MetricEvent[] = [];
  private filePath: string;

  /**
   * @param filePath NDJSON 文件路径（默认 data/metrics.json）
   */
  constructor(filePath: string) {
    this.filePath = filePath;
  }

  // -----------------------------------------------------------------------
  // 初始化与持久化
  // -----------------------------------------------------------------------

  /**
   * 初始化：确保目录存在，加载历史 NDJSON 数据。
   * 启动时调用一次，调用前不要调用 record* 方法。
   */
  async init(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });

    if (existsSync(this.filePath)) {
      const raw = await readFile(this.filePath, "utf-8");
      const lines = raw.split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const event = JSON.parse(line) as MetricEvent;
          this.events.push(event);
        } catch {
          // 跳过损坏的行
        }
      }
    }
  }

  /**
   * 销毁：刷新所有待写入数据。
   * 当前实现为同步追加写入，无需 flush；保留此方法供未来扩展。
   */
  async dispose(): Promise<void> {
    // No-op: 每次 record* 已同步追加写入
  }

  // -----------------------------------------------------------------------
  // 记录方法
  // -----------------------------------------------------------------------

  /** 记录对局结果 */
  recordMatch(
    childId: string,
    result: MatchRecord["result"],
    matchId: string,
    durationMs: number,
  ): void {
    const event: MatchRecord = {
      type: "match",
      childId,
      result,
      matchId,
      durationMs,
      timestamp: Date.now(),
    };
    this.events.push(event);
    this.persistOne(event);
  }

  /** 记录决策 */
  recordDecision(
    childId: string,
    action: string,
    isLegal: boolean,
    decisionTimeMs: number,
    affordanceOptimalAction?: string,
  ): void {
    const event: DecisionRecord = {
      type: "decision",
      childId,
      action,
      isLegal,
      decisionTimeMs,
      affordanceOptimalAction,
      timestamp: Date.now(),
    };
    this.events.push(event);
    this.persistOne(event);
  }

  /** 记录记忆创建 */
  recordMemory(childId: string, content: string, isGlobal: boolean): void {
    const event: MemoryRecord = {
      type: "memory",
      childId,
      content,
      isGlobal,
      timestamp: Date.now(),
    };
    this.events.push(event);
    this.persistOne(event);
  }

  /** 记录稳定性异常 */
  recordStabilityIncident(childId: string, incidentType: string, details: string): void {
    const event: IncidentRecord = {
      type: "incident",
      childId,
      incidentType,
      details,
      timestamp: Date.now(),
    };
    this.events.push(event);
    this.persistOne(event);
  }

  // -----------------------------------------------------------------------
  // 查询方法
  // -----------------------------------------------------------------------

  /** 获取指定子 Agent 的聚合指标 */
  getAgentMetrics(childId: string): AgentMetrics {
    const childEvents = this.events.filter((e) => e.childId === childId);

    const matchEvents = childEvents.filter((e): e is MatchRecord => e.type === "match");
    const decisionEvents = childEvents.filter((e): e is DecisionRecord => e.type === "decision");
    const memoryEvents = childEvents.filter((e): e is MemoryRecord => e.type === "memory");
    const incidentEvents = childEvents.filter((e): e is IncidentRecord => e.type === "incident");

    const matches = matchEvents.length;
    const wins = matchEvents.filter((m) => m.result === "win").length;
    const losses = matchEvents.filter((m) => m.result === "loss").length;
    const draws = matchEvents.filter((m) => m.result === "draw").length;
    const timeouts = matchEvents.filter((m) => m.result === "timeout").length;
    const crashes = matchEvents.filter((m) => m.result === "crash").length;

    const winRate = matches > 0 ? wins / matches : 0;
    const decisionCount = decisionEvents.length;
    const illegalActionCount = decisionEvents.filter((d) => !d.isLegal).length;
    const totalDecisionTime = decisionEvents.reduce((sum, d) => sum + d.decisionTimeMs, 0);
    const avgDecisionTime = decisionCount > 0 ? totalDecisionTime / decisionCount : 0;
    const memoryCount = memoryEvents.length;
    const globalMemoryCount = memoryEvents.filter((m) => m.isGlobal).length;
    const incidentCount = incidentEvents.length;
    const decisionAlignment = decisionCount > 0 ? (decisionCount - illegalActionCount) / decisionCount : 1;

    return {
      matches,
      wins,
      losses,
      draws,
      timeouts,
      crashes,
      winRate,
      avgDecisionTime,
      decisionCount,
      illegalActionCount,
      memoryCount,
      globalMemoryCount,
      incidentCount,
      stabilityIncidents: incidentEvents.map((i) => ({
        type: i.incidentType,
        timestamp: i.timestamp,
        details: i.details,
      })),
      decisionAlignment,
    };
  }

  /** 获取全部子 Agent 的聚合指标 */
  getAllMetrics(): Record<string, AgentMetrics> {
    const childIds = [...new Set(this.events.map((e) => e.childId))];
    const result: Record<string, AgentMetrics> = {};
    for (const childId of childIds) {
      result[childId] = this.getAgentMetrics(childId);
    }
    return result;
  }

  /** 获取原始事件列表（调试用） */
  getRawEvents(): MetricEvent[] {
    return [...this.events];
  }

  // -----------------------------------------------------------------------
  // 内部方法
  // -----------------------------------------------------------------------

  /** 追加一行 NDJSON 到文件 */
  private async persistOne(event: MetricEvent): Promise<void> {
    try {
      await appendFile(this.filePath, JSON.stringify(event) + "\n", "utf-8");
    } catch {
      // 持久化失败静默处理（不阻塞游戏逻辑）
    }
  }
}