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

/**
 * 事件执行者（Step 11 metrics 扩展）。
 *
 * - "driver"：对局/批量由 Python 驾驶器（确定性脚本）执行——Swarm 主路径。
 * - "llm"：旧路径子 Agent LLM 每回合决策执行（Step 13 退役，历史数据兼容）。
 */
export type Executor = "driver" | "llm";

/** driver 状态机（镜像 manager.ts ChildDriverStatus，独立声明避免循环依赖） */
export type DriverStatus = "idle" | "running" | "failed" | "done";

/**
 * 事件通用扩展字段（Step 11 metrics 扩展，全部可选、向后兼容）。
 * 旧 NDJSON 数据（无这些字段）读取与聚合不受影响。
 */
export interface MetricEventExt {
  /** 执行者（driver=驾驶器批量 / llm=旧 LLM 路径；缺省视为历史数据） */
  executor?: Executor;
  /** 关联脚本版本（格式 "script_name:vN"，仅 driver 执行时有） */
  scriptVersion?: string;
  /** 事件发生时 driver 状态机状态（仅 driver 相关事件带） */
  driverStatus?: DriverStatus;
}

/** 对局结果事件（LLM 路径单局 / 历史数据；driver 批量对局见 BatchRecord） */
export interface MatchRecord extends MetricEventExt {
  type: "match";
  childId: string;
  result: "win" | "loss" | "draw" | "timeout" | "crash";
  matchId: string;
  durationMs: number;
  timestamp: number;
}

/**
 * 批量汇总事件（Step 11 新增）。
 *
 * driver 跑完一批 N 局后由编排器经 batch_end 上报持久化：整批计数 +
 * match_ids 全量留痕 + 局级错误。executor 固定为 "driver"。
 */
export interface BatchRecord {
  type: "batch";
  childId: string;
  executor: "driver";
  scriptName: string;
  /** 纯版本号（如 "v1"）；聚合端 latestScriptVersion 会补 scriptName 前缀统一为 "script_name:vN" */
  scriptVersion: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  matchIds: string[];
  driverErrors: string[];
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

/** 稳定性异常事件（incidentType 含 "driver_failed"，Step 11 正式成员） */
export interface IncidentRecord extends MetricEventExt {
  type: "incident";
  childId: string;
  incidentType: string;
  details: string;
  timestamp: number;
}

/** 所有 NDJSON 事件类型的联合 */
export type MetricEvent = MatchRecord | DecisionRecord | MemoryRecord | IncidentRecord | BatchRecord;

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
  stabilityIncidents: Array<{
    type: string;
    timestamp: number;
    details: string;
    executor?: Executor;
    driverStatus?: DriverStatus;
  }>;
  /** 决策吻合度（0-1，合法动作占比，无决策时返回 1） */
  decisionAlignment: number;
  // --- Step 11 metrics 扩展（向后兼容新增字段） ---
  /** driver 执行局数（executor="driver" 的 match 事件数；批量对局见 batchGames） */
  driverMatches: number;
  /** LLM 路径局数（executor="llm" 或旧数据无 executor 的 match 事件数） */
  llmMatches: number;
  /** 批量次数（batch 事件数） */
  batchCount: number;
  /** 批量总局数（batch gamesPlayed 累加） */
  batchGames: number;
  /** driver 失败次数（incidentType="driver_failed" 的 incident 数） */
  driverFailures: number;
  /** 最近脚本版本（格式 "script_name:vN"，无则 null） */
  latestScriptVersion: string | null;
  /** 最近 driver 状态（idle/running/failed/done，无则 null） */
  latestDriverStatus: DriverStatus | null;
}

// ---------------------------------------------------------------------------
// MetricsCollector
// ---------------------------------------------------------------------------

export class MetricsCollector {
  private events: MetricEvent[] = [];
  private filePath: string;
  /** 未完成的持久化写盘（persistOne 登记；dispose 前必须等全部落盘） */
  private pendingPersists: Promise<void>[] = [];

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
   * 销毁：等待所有未完成的持久化写盘完成后返回（数据落盘确认）。
   *
   * record* 是 fire-and-forget 异步追加（persistOne），dispose 语义 =
   * 全部写盘完成——manager 退出前调用可保证 metrics.json 不丢行；
   * 测试清理临时目录前也必须先 dispose，否则 Windows 上删除被占用
   * 的写盘文件会 EPERM。
   */
  async dispose(): Promise<void> {
    await Promise.allSettled(this.pendingPersists);
  }

  // -----------------------------------------------------------------------
  // 记录方法
  // -----------------------------------------------------------------------

  /**
   * 记录对局结果（LLM 路径单局；driver 批量对局请用 recordBatch）。
   *
   * @param opts 可选扩展字段（Step 11）：executor / scriptVersion / driverStatus，
   *             缺省不写入 NDJSON（旧数据兼容）。
   */
  recordMatch(
    childId: string,
    result: MatchRecord["result"],
    matchId: string,
    durationMs: number,
    opts?: MetricEventExt,
  ): void {
    const event: MatchRecord = {
      type: "match",
      childId,
      result,
      matchId,
      durationMs,
      timestamp: Date.now(),
    };
    this.applyExt(event, opts);
    this.events.push(event);
    this.persistOne(event);
  }

  /**
   * 记录 driver 批量汇总事件（Step 11）。
   *
   * driver 跑完一批 N 局后调用一次：整批计数 + match_ids 全量留痕 +
   * 局级错误。executor 固定为 "driver"。
   */
  recordBatch(
    childId: string,
    batch: {
      scriptName: string;
      scriptVersion: string;
      gamesPlayed: number;
      wins: number;
      losses: number;
      draws: number;
      matchIds: string[];
      driverErrors: string[];
    },
  ): void {
    const event: BatchRecord = {
      type: "batch",
      childId,
      executor: "driver",
      scriptName: batch.scriptName,
      scriptVersion: batch.scriptVersion,
      gamesPlayed: batch.gamesPlayed,
      wins: batch.wins,
      losses: batch.losses,
      draws: batch.draws,
      matchIds: batch.matchIds,
      driverErrors: batch.driverErrors,
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

  /**
   * 记录稳定性异常。
   *
   * incidentType 含 Step 11 正式成员 "driver_failed"（driver 崩溃）。
   * @param opts 可选扩展字段（Step 11）：executor / scriptVersion / driverStatus。
   */
  recordStabilityIncident(
    childId: string,
    incidentType: string,
    details: string,
    opts?: MetricEventExt,
  ): void {
    const event: IncidentRecord = {
      type: "incident",
      childId,
      incidentType,
      details,
      timestamp: Date.now(),
    };
    this.applyExt(event, opts);
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
    const batchEvents = childEvents.filter((e): e is BatchRecord => e.type === "batch");

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

    // --- Step 11 扩展聚合 ---
    // 执行者归属：executor="driver" → driverMatches；"llm" 或无 executor 的
    // 历史数据 → llmMatches（旧 metrics.json 都是 LLM 路径产生，语义一致）。
    const driverMatches = matchEvents.filter((m) => m.executor === "driver").length;
    const llmMatches = matches - driverMatches;
    const batchCount = batchEvents.length;
    const batchGames = batchEvents.reduce((sum, b) => sum + b.gamesPlayed, 0);
    const driverFailures = incidentEvents.filter((i) => i.incidentType === "driver_failed").length;

    // 最近脚本版本：扫带 scriptVersion 的事件（batch / match / incident），按时间取最新
    let latestScriptVersion: string | null = null;
    let latestVersionTs = -1;
    for (const e of childEvents) {
      const v = scriptVersionOf(e);
      if (v && e.timestamp >= latestVersionTs) {
        latestScriptVersion = v;
        latestVersionTs = e.timestamp;
      }
    }
    // 最近 driver 状态：扫带 driverStatus 的事件，按时间取最新
    let latestDriverStatus: DriverStatus | null = null;
    let latestStatusTs = -1;
    for (const e of childEvents) {
      const s = driverStatusOf(e);
      if (s && e.timestamp >= latestStatusTs) {
        latestDriverStatus = s;
        latestStatusTs = e.timestamp;
      }
    }

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
        ...(i.executor !== undefined ? { executor: i.executor } : {}),
        ...(i.driverStatus !== undefined ? { driverStatus: i.driverStatus } : {}),
      })),
      decisionAlignment,
      driverMatches,
      llmMatches,
      batchCount,
      batchGames,
      driverFailures,
      latestScriptVersion,
      latestDriverStatus,
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

  /** 把可选扩展字段写入事件对象（undefined 不写入，保持 NDJSON 向后兼容） */
  private applyExt(
    event: MatchRecord | IncidentRecord,
    ext?: MetricEventExt,
  ): void {
    if (!ext) return;
    if (ext.executor !== undefined) event.executor = ext.executor;
    if (ext.scriptVersion !== undefined) event.scriptVersion = ext.scriptVersion;
    if (ext.driverStatus !== undefined) event.driverStatus = ext.driverStatus;
  }

  /** 追加一行 NDJSON 到文件（fire-and-forget 由调用方异步触发） */
  private async persistOne(event: MetricEvent): Promise<void> {
    const write = (async () => {
      try {
        await appendFile(this.filePath, JSON.stringify(event) + "\n", "utf-8");
      } catch {
        // 持久化失败静默处理（不阻塞游戏逻辑）
      }
    })();
    // 登记未完成写盘，供 dispose() 统一等待（保证落盘 + 目录可删除）
    this.pendingPersists.push(write);
    try {
      await write;
    } finally {
      const idx = this.pendingPersists.indexOf(write);
      if (idx >= 0) this.pendingPersists.splice(idx, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Step 11 扩展辅助：从联合事件中提取 scriptVersion / driverStatus
// ---------------------------------------------------------------------------

/** 从事件提取 scriptVersion（无则 null）。统一输出 "script_name:vN" 格式。 */
function scriptVersionOf(e: MetricEvent): string | null {
  if (e.type === "batch") {
    // batch 事件存储为纯版本号（scriptVersion 字段），聚合时补 scriptName
    // 前缀，与 incident/match 的 "script_name:vN" 格式对齐——latestScriptVersion
    // 是两种来源混扫，格式不统一会导致输出交替（纯 "v1" 与 "s1:v1"）。
    return e.scriptVersion ? `${e.scriptName}:${e.scriptVersion}` : null;
  }
  const v = (e as { scriptVersion?: unknown }).scriptVersion;
  return typeof v === "string" && v !== "" ? v : null;
}

/** 从事件提取 driverStatus（batch 事件隐含 driver=done；无则 null） */
function driverStatusOf(e: MetricEvent): DriverStatus | null {
  if (e.type === "batch") return "done";
  const s = (e as { driverStatus?: unknown }).driverStatus;
  return s === "idle" || s === "running" || s === "failed" || s === "done" ? s : null;
}