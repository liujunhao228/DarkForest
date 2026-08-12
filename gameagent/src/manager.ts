/**
 * GameAgentManager — 游戏 AI Agent 管理器核心。
 *
 * 创建 prime-agent 常驻 session 作为「管理器 session」，
 * 维护 RLM 子 Agent 池（Map<childId, ChildAgentEntry>），
 * 通过实现 SubagentRuntimeHost 接口接管子 session 创建流程，
 * 使子 Agent 获得 autonomous 模式 + 游戏系统提示。
 */

import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { MetricsCollector } from "./metrics.js";
import {
  createInMemoryAgentMessageController,
  type InMemoryFamilyMember,
} from "./agent-message-controller.js";
import {
  AgentSession,
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  type AgentSessionEvent,
  type CreateAgentSessionResult,
  type CreateRlmSubagentRuntimeOptions,
  type RlmSubagentRuntime,
  type SubagentRuntimeHost,
} from "@earendil-works/pi-coding-agent";
import type { AppConfig } from "./config.js";
import {
  buildCoordinatorSystemPrompt,
  buildGameAgentTaskPrompt,
} from "./system-prompt.js";
import { createChildSession, type ChildActivity } from "./child-agent.js";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 子 Agent 状态 */
export type ChildAgentStatus = "queued" | "running" | "done" | "error" | "cancelled" | "terminated";

/** 稳定性异常事件 */
export interface StabilityIncident {
  type: "timeout" | "crash" | "loop" | "error";
  timestamp: number;
  details: string;
}

/** 子 Agent 对局指标 */
export interface ChildAgentMetrics {
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  timeouts: number;
  crashes: number;
  totalDecisionTime: number;
  decisionCount: number;
  memoryCount: number;
  stabilityIncidents: StabilityIncident[];
}

/** 子 Agent 池条目 */
export interface ChildAgentEntry {
  /** RLM 子 Agent 唯一 ID（childNodeId） */
  childId: string;
  /** Agent 名称（mcpserver sid） */
  agentName: string;
  /** 子 Agent session（就绪后填充） */
  session: AgentSession | null;
  /** 启动时间戳 */
  startTime: number;
  /** 当前状态 */
  status: ChildAgentStatus;
  /** 对局指标 */
  metrics: ChildAgentMetrics;
  /** 当前对局 ID（有对局时填充） */
  currentMatchId: string | null;
  /** 子 Agent 活动流水（最近 CHILD_ACTIVITY_LIMIT 条，可观测性） */
  activity: ChildActivity[];
}

/** 管理器级聚合指标 */
export interface ManagerMetrics {
  totalAgents: number;
  runningAgents: number;
  totalMatches: number;
  totalWins: number;
  totalLosses: number;
  agentMetrics: Record<string, ChildAgentMetrics>;
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 默认 prime-agent agentDir（管理器 session 内部使用） */
const MANAGER_AGENT_DIR = ".prime-agent";

/** 子 Agent 清理超时（毫秒） */
const CHILD_CLEANUP_TIMEOUT_MS = 3000;

/** 子 Agent 活动流水上限（环形缓冲，超出丢弃最旧） */
const CHILD_ACTIVITY_LIMIT = 200;

/** 打点用本地时间戳（HH:MM:SS.mmm） */
function ts(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

/** 空指标 */
function emptyMetrics(): ChildAgentMetrics {
  return {
    matches: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    timeouts: 0,
    crashes: 0,
    totalDecisionTime: 0,
    decisionCount: 0,
    memoryCount: 0,
    stabilityIncidents: [],
  };
}

// ---------------------------------------------------------------------------
// GameAgentManager
// ---------------------------------------------------------------------------

export class GameAgentManager implements SubagentRuntimeHost {
  private session: AgentSession;
  private authStorage: AuthStorage;
  private modelRegistry: ModelRegistry;
  private gameagentDir: string;
  private config: AppConfig;
  private children: Map<string, ChildAgentEntry> = new Map();
  private metricsCollector: MetricsCollector;
  private unsubscribe: (() => void) | null = null;
  /** 已结算对局去重集合（childId:matchId），防止子 Agent 重复上报 game_ended */
  private settledMatches: Set<string> = new Set();
  /** 超时轮询定时器 */
  private timeoutTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  private constructor(
    session: AgentSession,
    config: AppConfig,
    authStorage: AuthStorage,
    modelRegistry: ModelRegistry,
    gameagentDir: string,
    metricsCollector: MetricsCollector,
  ) {
    this.session = session;
    this.config = config;
    this.authStorage = authStorage;
    this.modelRegistry = modelRegistry;
    this.gameagentDir = gameagentDir;
    this.metricsCollector = metricsCollector;
    // 注册为 SubagentRuntimeHost，使 rlm.run() 时由管理器接管子 session 创建
    this.session.setSubagentRuntimeHost(this);
    this.setupEventListeners();
    // 启动超时轮询（每 60 秒）
    this.timeoutTimer = setInterval(() => this.checkTimeouts(), 60_000);
  }

  // -----------------------------------------------------------------------
  // 工厂方法
  // -----------------------------------------------------------------------

  /**
   * 创建 GameAgentManager 实例。
   *
   * 1. 用 AuthStorage.inMemory + setRuntimeApiKey 注入 DeepSeek API Key
   * 2. 用 ModelRegistry.inMemory 查找指定模型
   * 3. 用 DefaultResourceLoader 加载 gameagent/skills/ 中的 darkforest skill
   * 4. 调用 createAgentSession 创建管理器 session
   */
  static async create(config: AppConfig): Promise<GameAgentManager> {
    const gameagentDir = resolveGameagentDir();

    // 0. 初始化指标采集器
    const metricsCollector = new MetricsCollector(join(gameagentDir, "data", "metrics.json"));
    await metricsCollector.init();

    // 1. 认证存储
    const authStorage = AuthStorage.inMemory();
    if (config.deepseekApiKey) {
      authStorage.setRuntimeApiKey(config.modelProvider, config.deepseekApiKey);
    }

    // 2. 模型注册表 + 查找模型
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    let model = modelRegistry.find(config.modelProvider, config.modelId);
    if (!model) {
      const available = modelRegistry
        .getAll()
        .map((m) => `${m.provider}/${m.id}`)
        .join(", ");
      throw new Error(
        `未找到模型 ${config.modelProvider}/${config.modelId}。可用模型: ${available || "（无）"}`,
      );
    }

    // 可选：覆盖模型 endpoint / 请求模型名（如接入 SiliconFlow 等 OpenAI 兼容网关）
    if (config.modelBaseUrl) {
      model = { ...model, baseUrl: config.modelBaseUrl };
    }
    if (config.modelRequestModel) {
      model = { ...model, id: config.modelRequestModel };
    }

    // 3. 资源加载器（加载 skills 目录）
    const resourceLoader = new DefaultResourceLoader({
      cwd: gameagentDir,
      agentDir: join(gameagentDir, MANAGER_AGENT_DIR),
      additionalSkillPaths: [join(gameagentDir, "skills")],
      systemPromptOverride: () => buildCoordinatorSystemPrompt(),
      noContextFiles: true,
      noExtensions: true,
      noPromptTemplates: true,
      noThemes: true,
    });
    await resourceLoader.reload();

    // 4. 创建管理器 session（不传 subagentRuntimeHost，构造函数中会 set）
    //    agentMessageController：管理器是家庭图谱 root（depth 0），提供
    //    roster（子 Agent 的 parent 锚点）。管理器侧不主动发消息，onMessage
    //    为 no-op；子 Agent 经各自 controller 直接回调管理器处理事件。
    const managerController = createInMemoryAgentMessageController({
      selfName: "manager",
      selfId: "manager",
      selfDepth: 0,
      family: [],
      onMessage: () => undefined,
    });
    const result: CreateAgentSessionResult = await createAgentSession({
      cwd: gameagentDir,
      agentDir: join(gameagentDir, MANAGER_AGENT_DIR),
      authStorage,
      modelRegistry,
      model,
      thinkingLevel: "medium",
      tools: ["ipython"],
      resourceLoader,
      sessionManager: SessionManager.inMemory(gameagentDir),
      agentMessageController: managerController,
      autonomous: {
        enabled: true,
        maxContinuations: 100,
        maxTurns: 500,
        maxTokens: 1_000_000,
        timeoutMs: config.maxGameTimeoutMs,
      },
      serializedRefine: true,
    });

    // 构造函数中会调 setSubagentRuntimeHost(this)
    return new GameAgentManager(result.session, config, authStorage, modelRegistry, gameagentDir, metricsCollector);
  }

  // -----------------------------------------------------------------------
  // SubagentRuntimeHost 实现
  // -----------------------------------------------------------------------

  /**
   * 创建 RLM 子 Agent 运行时。
   *
   * RLM 运行时在 `rlm.run()` 被调用时自动触发此方法。
   * 管理器通过此方法接管子 session 创建流程：
   * 1. 调 createChildSession 创建子 session（autonomous + 游戏系统提示）
   * 2. 通过 onSessionPublished 将子 session 关联到现有 ChildAgentEntry
   * 3. 更新 entry.status = "running"
   */
  async createRlmSubagentRuntime(
    options: CreateRlmSubagentRuntimeOptions,
  ): Promise<RlmSubagentRuntime> {
    const { id, sessionName, onSessionPublished } = options;
    const t0 = Date.now();
    console.log(
      `[manager][rlm] createRlmSubagentRuntime 进入 child=${id} name=${sessionName} ${ts()}`,
    );

    // 子 Agent 的 agentMessageController：把 agent-message skill 暴露给子
    // session（python 包才会装入内核），并让 `agent_message.send(..., 
    // receiver_role="parent")` 直接回调到管理器的事件处理（等价 daemon 转发）。
    // senderName=sessionName（agentName）用于管理器按 agentName 匹配条目。
    const family: InMemoryFamilyMember[] = [
      {
        relationship: "parent",
        name: this.session.sessionName ?? "manager",
        id: this.session.sessionId,
        depth: 0,
        status: "idle",
      },
    ];
    const childController = createInMemoryAgentMessageController({
      selfName: sessionName,
      selfId: id,
      selfDepth: 1,
      family,
      onMessage: ({ message }) => this.handleChildAgentMessage(sessionName, message),
    });

    // 创建子 session
    const session = await createChildSession({
      parentSession: this.session,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      gameagentDir: this.gameagentDir,
      maxGameTimeoutMs: this.config.maxGameTimeoutMs,
      childId: id,
      sessionName,
      sessionDir: options.sessionDir,
      model: options.model,
      thinkingLevel: options.thinkingLevel,
      serviceTier: options.serviceTier,
      activeToolNames: options.activeToolNames,
      rlmDepth: options.rlmDepth,
      rlmMaxDepth: options.rlmMaxDepth,
      rlmParentNodeId: options.rlmParentNodeId,
      agentMessageController: childController,
      onChildActivity: (childId, sessionName, activity) =>
        this.recordChildActivity(childId, sessionName, activity),
    });
    console.log(
      `[manager][rlm] 子 session 已创建 child=${id} name=${sessionName} 耗时=${Date.now() - t0}ms ${ts()}`,
    );

    // 通过 onSessionPublished 回调将子 session 关联到本地条目
    if (onSessionPublished) {
      onSessionPublished(session);
    }

    // 更新本地条目
    for (const [, entry] of this.children) {
      if (entry.childId === id || entry.agentName === sessionName) {
        entry.session = session;
        entry.status = "running";
        console.log(
          `[manager][rlm] 子 Agent 已标记 running child=${id} name=${sessionName} ${ts()}`,
        );
        break;
      }
    }

    return { session };
  }

  /**
   * 删除 RLM 子 Agent 运行时。
   */
  async deleteRlmSubagentRuntime(childId: string, session?: AgentSession): Promise<void> {
    if (session) {
      await this.cleanupSession(session);
    }
    // 从本地条目移除
    this.children.delete(childId);
  }

  /**
   * 批量清理所有 RLM 子 Agent 运行时。
   */
  async disposeRlmSubagentRuntimes(): Promise<void> {
    const childIds = [...this.children.keys()];
    await Promise.allSettled(childIds.map(async (childId) => {
      const entry = this.children.get(childId);
      if (entry?.session) {
        await this.cleanupSession(entry.session);
      }
    }));
  }

  // -----------------------------------------------------------------------
  // 公开 API
  // -----------------------------------------------------------------------

  /** 获取管理器 session（供 HTTP API 等外部使用） */
  getSession(): AgentSession {
    return this.session;
  }

  /**
   * 生成子 Agent。
   *
   * 向管理器 session 发送 prompt，触发 LLM 在 IPython 中调用
   * `rlm.run(task_prompt, name=agentName)` 创建子 Agent。
   * 返回 childId 供后续跟踪。
   */
  async spawnAgent(agentName: string, gameMode: string): Promise<string> {
    if (this.disposed) {
      throw new Error("管理器已销毁，无法生成子 Agent");
    }

    const childId = `child-${randomUUID()}`;
    const taskPrompt = buildGameAgentTaskPrompt(agentName, gameMode);
    const prompt = this.buildSpawnPrompt(agentName, taskPrompt);

    // 注册占位条目（session 为 null，等待 createRlmSubagentRuntime 填充）
    const entry: ChildAgentEntry = {
      childId,
      agentName,
      session: null,
      startTime: Date.now(),
      status: "queued",
      metrics: emptyMetrics(),
      currentMatchId: null,
      activity: [],
    };
    this.children.set(childId, entry);

    // 向管理器 session 发送 prompt，触发 RLM 子 Agent 创建。
    // promptUntilAccepted 在消息被接受后即返回，不阻塞到 LLM 回合结束，
    // 避免 spawn 请求挂起数分钟（客户端 5s/5min 超时）。queueIfBusy +
    // streamingBehavior: followUp 让并发 spawn 排队而非抛
    // "Agent is already processing"。suppressAutonomousContinuation 防止
    // 管理器在处理 spawn 后自动续跑烧 token。
    try {
      await this.session.promptUntilAccepted(prompt, {
        queueIfBusy: true,
        streamingBehavior: "followUp",
        suppressAutonomousContinuation: true,
      });
    } catch (err) {
      // 提交失败时回滚占位条目，避免遗留 queued 假 Agent
      this.children.delete(childId);
      throw err;
    }

    return childId;
  }

  /** 列出所有子 Agent */
  listAgents(): ChildAgentEntry[] {
    return [...this.children.values()];
  }

  /** 获取单个子 Agent */
  getAgent(childId: string): ChildAgentEntry | undefined {
    return this.children.get(childId);
  }

  /**
   * 删除（回收）子 Agent。
   *
   * 先尝试通过管理器 session 删除 RLM 子 Agent，
   * 再清理子 session，最后标记为 terminated（不从池中移除，保留 metrics）。
   * 不允许 spawn 新 Agent 接管同一局。
   */
  async deleteAgent(childId: string): Promise<boolean> {
    const entry = this.children.get(childId);
    if (!entry) {
      return false;
    }

    try {
      // 通过管理器 session 删除 RLM 子 Agent
      await this.session.deleteRlmSubagent(childId);
    } catch {
      // 即使 RLM 删除失败也继续清理
    }

    // 如果子 Agent session 还存在，尝试 dispose
    if (entry.session) {
      await this.cleanupSession(entry.session);
    }

    // 标记为 terminated，不从池中移除（保留 metrics 供后续分析）
    entry.status = "terminated";
    entry.session = null;
    return true;
  }

  /** 获取聚合指标 */
  getMetrics(): ManagerMetrics {
    const agentMetrics: Record<string, ChildAgentMetrics> = {};
    let totalMatches = 0;
    let totalWins = 0;
    let totalLosses = 0;
    let runningAgents = 0;

    for (const [childId, entry] of this.children) {
      agentMetrics[childId] = { ...entry.metrics };
      totalMatches += entry.metrics.matches;
      totalWins += entry.metrics.wins;
      totalLosses += entry.metrics.losses;
      if (entry.status === "running" || entry.status === "queued") {
        runningAgents++;
      }
    }

    return {
      totalAgents: this.children.size,
      runningAgents,
      totalMatches,
      totalWins,
      totalLosses,
      agentMetrics,
    };
  }

  /** 更新子 Agent 指标 */
  updateMetrics(childId: string, patch: Partial<ChildAgentMetrics>): void {
    const entry = this.children.get(childId);
    if (!entry) return;
    Object.assign(entry.metrics, patch);
  }

  /** 记录稳定性异常 */
  recordStabilityIncident(
    childId: string,
    type: StabilityIncident["type"],
    details: string,
  ): void {
    const entry = this.children.get(childId);
    if (!entry) return;
    entry.metrics.stabilityIncidents.push({
      type,
      timestamp: Date.now(),
      details,
    });
    // 持久化到 MetricsCollector
    this.metricsCollector.recordStabilityIncident(childId, type, details);
  }

  /**
   * 记录子 Agent 活动流水（可观测性）。
   *
   * 环形缓冲（上限 CHILD_ACTIVITY_LIMIT），同时打到日志，
   * 用于确认子 Agent 是否卡在 connect / 反复 join→wait→rejoin / 跑偏。
   */
  private recordChildActivity(
    childId: string,
    sessionName: string,
    activity: ChildActivity,
  ): void {
    let entry: ChildAgentEntry | undefined;
    for (const [, e] of this.children) {
      if (e.childId === childId || e.agentName === sessionName) {
        entry = e;
        break;
      }
    }
    if (!entry) return;
    entry.activity.push(activity);
    if (entry.activity.length > CHILD_ACTIVITY_LIMIT) {
      entry.activity.splice(0, entry.activity.length - CHILD_ACTIVITY_LIMIT);
    }
    console.log(`[child:${entry.agentName}] ${activity.ts} ${activity.type}: ${activity.detail}`);
  }

  /**
   * 销毁管理器。
   *
   * 先清理所有子 Agent，再 dispose 管理器 session。
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    // 停止超时轮询
    if (this.timeoutTimer) {
      clearInterval(this.timeoutTimer);
      this.timeoutTimer = null;
    }

    // 取消事件订阅
    this.unsubscribe?.();
    this.unsubscribe = null;

    // 清理所有子 Agent
    await this.disposeRlmSubagentRuntimes();

    // 关闭指标采集器
    try {
      await this.metricsCollector.dispose();
    } catch {
      // 忽略关闭错误
    }

    // 销毁管理器 session
    try {
      await this.session.disposeAsync();
    } catch {
      // 忽略 dispose 错误
    }
  }

  // -----------------------------------------------------------------------
  // 内部方法
  // -----------------------------------------------------------------------

  /** 注册事件监听 */
  private setupEventListeners(): void {
    this.unsubscribe = this.session.subscribe((event: AgentSessionEvent) => {
      this.handleSessionEvent(event);
    });
  }

  /** 处理管理器 session 事件 */
  private handleSessionEvent(event: AgentSessionEvent): void {
    // 管理器 LLM 回合节奏打点：确认 rlm.run 是否被触发、回合是否在正常流转
    if (event.type === "agent_start") {
      console.log(`[manager][turn] agent_start ${ts()}`);
    } else if (event.type === "agent_end") {
      console.log(`[manager][turn] agent_end ${ts()}`);
    } else if (event.type === "message_end" && event.message.role === "assistant") {
      const stopReason = (event.message as { stopReason?: string }).stopReason;
      console.log(`[manager][turn] message_end stopReason=${stopReason ?? "-"} ${ts()}`);
    }
    // 监听 RLM 子 Agent 状态更新
    if (event.type === "rlm_child_update") {
      this.handleRlmChildUpdate(event);
    }
    // 监听 agent_message（子 Agent 向管理器汇报结果）
    if (event.type === "ipython_sent_agent_message") {
      this.handleAgentMessage(event);
    }
    // 监听子 Agent 结束事件（捕获异常 stopReason）
    if (event.type === "agent_end") {
      this.handleAgentEnd(event);
    }
  }

  /** 处理 rlm_child_update 事件 */
  private handleRlmChildUpdate(event: Extract<AgentSessionEvent, { type: "rlm_child_update" }>): void {
    const { child } = event;

    // 查找匹配的子 Agent 条目
    for (const [childId, entry] of this.children) {
      // 匹配 childId 或 sessionName
      if (
        child.id === childId ||
        child.id === entry.childId ||
        (child.sessionName && entry.agentName && child.sessionName.includes(entry.agentName))
      ) {
        // 更新状态
        entry.status = mapRlmStatus(child.status);
        if (child.error) {
          entry.metrics.stabilityIncidents.push({
            type: "error",
            timestamp: Date.now(),
            details: child.error,
          });
        }
        return;
      }
    }

    // 新子 Agent（通过 rlm_child_update 首次发现）
    // 尝试匹配已有的占位条目
    for (const [childId, entry] of this.children) {
      if (entry.session === null && child.id === childId) {
        entry.status = mapRlmStatus(child.status);
        if (child.error) {
          entry.metrics.stabilityIncidents.push({
            type: "error",
            timestamp: Date.now(),
            details: child.error,
          });
        }
        return;
      }
    }
  }

  /** 处理子 Agent 发来的 agent_message */
  private handleAgentMessage(
    event: Extract<AgentSessionEvent, { type: "ipython_sent_agent_message" }>,
  ): void {
    // 子 Agent 通过 agent_message.send 向管理器汇报对局事件。
    // 消息格式（JSON 字符串）:
    //   { event: "match_found", matchId }
    //   { event: "game_ended", matchId, result, memories_created }
    try {
      const payload = JSON.parse(event.message.message);
      // 找到发送消息的子 Agent
      const targetSessionId = event.message.target?.activeSessionId;
      this.applyAgentMessagePayload(payload, targetSessionId);
    } catch {
      // 非 JSON 消息，忽略
    }
  }

  /**
   * 处理子 Agent 经 in-memory agentMessageController 回调上报的消息。
   *
   * 与 handleAgentMessage 的事件路径等价，但按 agentName（sessionName）
   * 匹配条目——controller 回调发生在子 session 创建时，当时尚无
   * activeSessionId，用 name 匹配最可靠。
   */
  private handleChildAgentMessage(senderName: string, message: string): void {
    try {
      const payload = JSON.parse(message);
      this.applyAgentMessagePayload(payload, undefined, senderName);
    } catch {
      // 非 JSON 消息，忽略
    }
  }

  /**
   * 解析 agent_message 载荷并更新子 Agent 条目（currentMatchId / metrics）。
   * 按 sessionId 或 agentName 匹配条目（二者取其一）。
   */
  private applyAgentMessagePayload(
    payload: Record<string, unknown>,
    sessionId?: string,
    agentName?: string,
  ): void {
    const findEntry = (): ChildAgentEntry | undefined => {
      for (const [, entry] of this.children) {
        if (
          (sessionId && entry.session?.sessionId === sessionId) ||
          (agentName && entry.agentName === agentName)
        ) {
          return entry;
        }
      }
      return undefined;
    };

    if (payload.event === "match_found") {
      // 子 Agent 已进入对局 → 记录 currentMatchId（bot .playai 轮询据此判定）。
      // match:found 载荷只有 roomId/roomCode（后端从不下发 matchId），回退到 roomId。
      const matchId = typeof payload.matchId === "string" ? payload.matchId : "";
      const roomId = typeof payload.roomId === "string" ? payload.roomId : "";
      const entry = findEntry();
      if (entry) {
        entry.currentMatchId = matchId || roomId || entry.currentMatchId;
      }
      return;
    }

    if (payload.event === "game_ended") {
      // 更新对应子 Agent 的指标
      const entry = findEntry();
      if (!entry) return;
      // 去重：同一子 Agent 同一对局只结算一次（LLM 可能反复上报 game_ended，
      // 例如先报 loss 后又改判 win —— 重复计数会污染 matches/wins/losses）。
      const matchId = typeof payload.matchId === "string" ? payload.matchId : "";
      const matchKey = `${entry.childId}:${matchId || entry.currentMatchId || "unknown"}`;
      if (this.settledMatches.has(matchKey)) {
        console.log(
          `[manager] 忽略重复 game_ended 上报 child=${entry.agentName} match=${matchId || "unknown"} (${payload.result})`,
        );
        return;
      }
      this.settledMatches.add(matchKey);
      entry.currentMatchId = null;
      entry.metrics.matches++;
      if (payload.result === "win") entry.metrics.wins++;
      else if (payload.result === "loss") entry.metrics.losses++;
      else if (payload.result === "draw") entry.metrics.draws++;
      else if (payload.result === "timeout") entry.metrics.timeouts++;
      else if (payload.result === "crash") entry.metrics.crashes++;
      entry.metrics.memoryCount +=
        typeof payload.memories_created === "number" ? payload.memories_created : 0;
      // 持久化到 MetricsCollector（result 未知时按 crash 记录，保留计数一致性）
      const result =
        payload.result === "win" ||
        payload.result === "loss" ||
        payload.result === "draw" ||
        payload.result === "timeout" ||
        payload.result === "crash"
          ? payload.result
          : "crash";
      this.metricsCollector.recordMatch(
        entry.childId,
        result,
        typeof payload.matchId === "string" ? payload.matchId : "",
        typeof payload.durationMs === "number" ? payload.durationMs : 0,
      );
      // 权威结算完成：强制回收子 Agent（不再等待超时/手动回收）。
      // deleteAgent 使 entry.status 变为 terminated、session 置空，但 entry 保留
      // 在池中，后续 getMetrics 仍能读到已结算指标。
      console.log(
        `[manager] 权威结算 child=${entry.agentName} result=${payload.result} 强制回收`,
      );
      this.deleteAgent(entry.childId).catch(() => {});
    }
  }

  /** 构建 spawn 提示词 */
  private buildSpawnPrompt(agentName: string, taskPrompt: string): string {
    return `请在 IPython 中执行以下代码，生成一个 RLM 子 Agent：

\`\`\`python
await rlm.run(
    """${taskPrompt.replace(/"/g, '\\"')}""",
    name="${agentName}"
)
\`\`\`

子 Agent 将自动执行游戏循环：connect → wait_for_match（入队 + keep-alive 等待匹配）→ wait_for_event → 决策 → end_turn → 循环直到对局结束。`;
  }

  // -----------------------------------------------------------------------
  // 超时监控
  // -----------------------------------------------------------------------

  /**
   * 超时检查：轮询所有子 Agent，超时则强制回收。
   *
   * 跳过已结束（done/terminated/cancelled）的子 Agent，
   * 对超时的子 Agent 记录 stability_incident 并异步回收。
   * 此方法公开供外部监控工具调用，也由内部定时器自动触发。
   */
  checkTimeouts(): void {
    const now = Date.now();
    const timeoutMs = this.config.maxGameTimeoutMs;
    for (const [childId, entry] of this.children) {
      // 跳过已结束、已终止、已取消的子 Agent
      if (entry.status === "done" || entry.status === "terminated" || entry.status === "cancelled") {
        continue;
      }
      if (now - entry.startTime > timeoutMs) {
        this.recordStabilityIncident(
          childId,
          "timeout",
          `超时 ${now - entry.startTime}ms > ${timeoutMs}ms`,
        );
        // 异步回收，不阻塞轮询
        this.deleteAgent(childId).catch(() => {});
      }
    }
  }

  /** 处理子 Agent 结束事件（捕获异常 stopReason） */
  private handleAgentEnd(event: Record<string, unknown>): void {
    const sessionId = event.sessionId as string | undefined;
    if (!sessionId) return;

    for (const [, entry] of this.children) {
      if (entry.session?.sessionId === sessionId) {
        const error = event.error as string | undefined;
        const stopReason = event.stopReason as string | undefined;
        const reason = error || stopReason;
        if (reason) {
          let type: StabilityIncident["type"] = "error";
          const lower = reason.toLowerCase();
          if (lower.includes("timeout")) type = "timeout";
          else if (lower.includes("crash")) type = "crash";
          else if (lower.includes("loop")) type = "loop";
          this.recordStabilityIncident(entry.childId, type, reason);
        }
        return;
      }
    }
  }

  /** 安全清理子 session */
  private async cleanupSession(session: AgentSession): Promise<void> {
    try {
      const timeout = new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error("超时")), CHILD_CLEANUP_TIMEOUT_MS),
      );
      await Promise.race([session.disposeAsync(), timeout]);
    } catch {
      // 忽略 dispose 错误
    }
  }
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/** 解析 gameagent 目录的绝对路径 */
function resolveGameagentDir(): string {
  // 在 ESM 环境下，用 import.meta.url 推导当前文件所在包的根目录
  const currentFile = fileURLToPath(import.meta.url);
  return join(dirname(currentFile), "..");
}

/** 将 RLM 子 Agent 状态映射为 ChildAgentStatus */
function mapRlmStatus(
  status: string,
): ChildAgentStatus {
  switch (status) {
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "done":
    case "completed":
      return "done";
    case "error":
      return "error";
    case "cancelled":
      return "cancelled";
    default:
      return "queued";
  }
}