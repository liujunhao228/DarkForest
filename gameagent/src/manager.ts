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
  type AgentSessionMessageController,
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
  type: "timeout" | "crash" | "loop" | "error" | "driver_failed";
  timestamp: number;
  details: string;
}

/** driver 状态机（child × driver 双维度中的 driver 维度） */
export type ChildDriverStatus = "idle" | "running" | "failed" | "done";

/** driver 状态（编排器跟踪子 Agent 绑定的 Python driver 子进程） */
export interface ChildAgentDriverState {
  /** driver 状态机：idle（未启动）/ running（批量对局中）/ failed（崩溃）/ done（批次完成） */
  status: ChildDriverStatus;
  /** 当前批量中的进行中对局（无则 null） */
  currentMatchId: string | null;
  /** 当前批次已打完的局数 */
  batchMatches: number;
  /** 当前批次胜场 */
  batchWins: number;
  /** 当前批次负场 */
  batchLosses: number;
  /** 当前批次平局 */
  batchDraws: number;
  /** 最近一次失败原因（driver_failed / batch_end.driver_errors），无则 null */
  lastError: string | null;
  /** 当前脚本名（script_ready / batch_start / v_published 更新） */
  scriptName: string | null;
  /** 当前脚本版本（v1/v2/…） */
  scriptVersion: string | null;
}

/** 编排器 → 子 Agent 的任务消息（agent_message JSON 下发协议） */
export interface TaskMessage {
  type: "task";
  action: "run_cycle" | "stop";
  script_name?: string;
  games?: number;
  review_every?: number;
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
  /** RLM childNodeId（createRlmSubagentRuntime 关联时回填；deleteAgent 删除 RLM 注册表条目用） */
  rlmChildId: string | null;
  /** Agent 名称（mcpserver sid） */
  agentName: string;
  /** 子 Agent session（就绪后填充） */
  session: AgentSession | null;
  /** 启动时间戳 */
  startTime: number;
  /** 最后活跃时间戳（心跳）：子 session 事件 / agent_message 上报 / 任务投递 / RLM 更新均刷新。idle 超时判定基准 */
  lastActivityAt: number;
  /** run_cycle 周期起点时间戳（null=待命/无周期）。cycle 超时判定基准；v_published 或 stop 后清空 */
  cycleStartedAt: number | null;
  /** 当前状态 */
  status: ChildAgentStatus;
  /** 对局指标 */
  metrics: ChildAgentMetrics;
  /** 当前对局 ID（有对局时填充） */
  currentMatchId: string | null;
  /** driver 状态（child × driver 双维度中的 driver 维度） */
  driver: ChildAgentDriverState;
  /** 最近一次下发任务（调试用） */
  lastTask: TaskMessage | null;
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

/** 空 driver 状态（初始 idle） */
function emptyDriver(): ChildAgentDriverState {
  return {
    status: "idle",
    currentMatchId: null,
    batchMatches: 0,
    batchWins: 0,
    batchLosses: 0,
    batchDraws: 0,
    lastError: null,
    scriptName: null,
    scriptVersion: null,
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
  /** 已发布脚本版本去重集合（childId:script_name:version），防止重复上报 v_published */
  private settledVersions: Set<string> = new Set();
  /** 已结算批次去重集合（childId:script_name:version），防止重复上报 batch_end 污染 metrics */
  private settledBatches: Set<string> = new Set();
  /** 子 Agent agentMessageController 注册表（agentName → controller），sendTask 反推用 */
  private childControllers: Map<string, AgentSessionMessageController> = new Map();
  /**
   * rlm_child_update 日志节流表（childId → {status, time}）。
   *
   * 背景（2026-08-13 日志分析）：子 Agent 的 LLM 回合是流式的，引擎每个
   * 事件（message_start/update/end、tool_execution_* 等）都触发一次
   * rlm_child_update 重发，而 run.status 在初始任务 settle 后恒为 "done"——
   * 两个子 Agent 交替生成时每秒可刷 80+ 条 status=done（本次实测 8880 条/
   * 108s），真实事件全被淹没。此处仅节流**打印**：同一 child 同一 status
   * 在节流窗口（1s）内不重复打日志，状态变化立即打。条目标记/心跳等逻辑
   * 不受影响（每次事件仍完整处理）。
   */
  private rlmLogThrottle: Map<string, { status: string; time: number }> = new Map();
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
    const childController = this.createChildAgentController(id, sessionName);
    // 保留 controller 引用（agentName 反推），sendTask 依赖此注册表
    this.registerChildController(sessionName, childController);

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
        // options.id 即 RLM childNodeId：回填权威 rlmChildId（spawnAgent 提取
        // 的 handle.rlm_child_id 与此一致，此处双保险；deleteAgent 优先用它）
        entry.rlmChildId = id;
        console.log(
          `[manager][rlm] 子 Agent 已标记 running child=${id} name=${sessionName} ${ts()}`,
        );
        break;
      }
    }

    return { session };
  }

  /**
   * 子 run 的 detached initial task settle 后的 host 接管钩子（引擎优先于
   * deleteRlmSubagentRuntime 调用）。
   *
   * gameagent 的子 Agent 是常驻设计：spawn 后按 taskPrompt「立即结束回合，
   * 进入待命」，后续由 sendTask 下发 run_cycle / stop 任务。引擎在 initial
   * task settle 后默认调 deleteRlmSubagentRuntime 回收子 Agent（host 未实现
   * 本钩子时），导致 spawn 后子 Agent 立即「已回收」，任务永远投不进——
   * E2E 稳定复现「sendTask 跳过：子 Agent 不存在或已回收」。实现本钩子让
   * 引擎改为「释放」语义：条目 / controller / 子 session 全部保留，子 Agent
   * 继续待命等待 sendTask。
   *
   * status 透传 run 的最终状态（done/error/cancelled）用于可观测性；error
   * 的 run 保留条目，由 idle/cycle 超时或手动 DELETE 兜底回收。
   */
  async releaseRlmSubagentRuntime(
    _runtime: RlmSubagentRuntime,
    _options: CreateRlmSubagentRuntimeOptions,
    status: "done" | "error" | "cancelled",
  ): Promise<void> {
    console.log(
      `[manager][rlm] 子 run 已 settle（release 接管，保留常驻）status=${status} ${ts()}`,
    );
  }

  /**
   * 删除 RLM 子 Agent 运行时。
   */
  async deleteRlmSubagentRuntime(childId: string, session?: AgentSession): Promise<void> {
    console.log(
      `[manager][rlm] deleteRlmSubagentRuntime childId=${childId} sessionName=${session?.sessionName ?? "-"} ${ts()}`,
    );
    if (session) {
      await this.cleanupSession(session);
    }
    // 注销 controller（key=agentName；childId 是 RLM childNodeId，与占位条目
    // 的 child-<uuid> 不同，需按 sessionName / childId 双向匹配条目后反查）
    let matched: ChildAgentEntry | undefined;
    for (const [, entry] of this.children) {
      if (
        entry.childId === childId ||
        entry.agentName === childId ||
        (session?.sessionName && entry.agentName === session.sessionName)
      ) {
        this.unregisterChildController(entry.agentName);
        matched = entry;
        break;
      }
    }
    // 清理本地条目：必须按占位条目 key（entry.childId）操作——childId 参数是
    // RLM childNodeId（sub-<hash>），与占位 key（child-<uuid>）不一致。此前直接
    // children.delete(childId) 删不掉占位条目，留下"controller 已注销但条目仍在"
    // 的幽灵条目：sendTask 命中后误报"controller 未注册或未就绪"，且条目状态
    // 恒为 running 污染 /api/agents 列表。
    if (matched) {
      // 与 deleteAgent 语义一致：标记 terminated 保留 metrics，不从池中移除。
      // sendTask 对 terminated 条目走"子 Agent 不存在或已回收"分支，不再误报。
      matched.status = "terminated";
      matched.session = null;
    } else {
      // 无匹配条目（理论上不发生：占位条目 key 恒为 child-<uuid>），防御性回退
      this.children.delete(childId);
    }
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
   * 生成子 Agent（确定性 spawn）。
   *
   * 直接调用 manager session 的 runRlmChild：底层 _startRlmChildRun 是纯
   * 确定性流程（子 session 创建、发布、agent-loop 启动均不依赖管理器 LLM
   * 回合），因此 spawn 不会触发 agent_start 等管理器事件，也不会烧管理器
   * token。子 session 就绪后由 createRlmSubagentRuntime 经
   * onSessionPublished 关联到占位条目。
   *
   * 返回 childId（占位条目 key，child-<uuid>）供后续跟踪。
   */
  async spawnAgent(agentName: string, gameMode: string, preferredCount: number = 2): Promise<string> {
    if (this.disposed) {
      throw new Error("管理器已销毁，无法生成子 Agent");
    }

    const childId = `child-${randomUUID()}`;
    const taskPrompt = buildGameAgentTaskPrompt(agentName, gameMode, preferredCount);

    // 注册占位条目（session 为 null，等待 createRlmSubagentRuntime 填充）
    const entry: ChildAgentEntry = {
      childId,
      rlmChildId: null,
      agentName,
      session: null,
      startTime: Date.now(),
      lastActivityAt: Date.now(),
      cycleStartedAt: null,
      status: "queued",
      metrics: emptyMetrics(),
      currentMatchId: null,
      driver: emptyDriver(),
      lastTask: null,
      activity: [],
    };
    this.children.set(childId, entry);

    // 确定性 spawn：不经过管理器 LLM 回合（旧实现经 promptUntilAccepted 让
    // 管理器在 IPython 里执行 rlm.run，会触发 agent_start 烧 token）。
    // runRlmChild 在子 agent 受理后即返回 handle（rlm_child_id/name/
    // session_dir/model），不阻塞到子任务完成；占位条目 key 仍用 childId，
    // 子 session 就绪后经 createRlmSubagentRuntime 的 onSessionPublished
    // 按 agentName 关联，关联机制不变。
    try {
      // runRlmChild 返回 RlmSpawnHandle（含 rlm_child_id，即 RLM childNodeId）：
      // 保存到条目供 deleteAgent 精确删除 RLM 注册表条目——占位 key（child-<uuid>）
      // 与 RLM 侧的 rlm_child_id / active_session_id / session_id / session_name
      // 四者均不匹配，直接传占位 key 会让 deleteRlmSubagent 抛
      // "No direct RLM subagent matches" 且被吞掉，注册表条目永久泄漏。
      // 类型注记：RlmSpawnHandle 未从包入口导出，按结构宽兼容提取。
      const handle = await this.session.runRlmChild(taskPrompt, { name: agentName });
      const rlmChildId =
        typeof handle === "object" &&
        handle !== null &&
        typeof (handle as { rlm_child_id?: unknown }).rlm_child_id === "string"
          ? (handle as { rlm_child_id: string }).rlm_child_id
          : null;
      if (rlmChildId) {
        entry.rlmChildId = rlmChildId;
      }
    } catch (err) {
      // 提交失败时回滚占位条目，避免遗留 queued 假 Agent
      this.children.delete(childId);
      throw err;
    }

    return childId;
  }

  /**
   * 向子 Agent 下发任务（agent_message 任务协议）。
   *
   * 经子 Agent 的 agentMessageController（注册表按 agentName 反推）推送 JSON
   * 任务消息：controller 的入站投递回调把它注入子 session（promptUntilAccepted
   * + followUp——空闲直接执行、忙碌排队），触发子 Agent 的 autonomous
   * continuation 处理 run_cycle / stop 任务。
   *
   * @param childId 占位条目 key（child-<uuid>）
   * @param task    任务消息（{ type: "task", action: "run_cycle"|"stop", … }）
   * @returns 是否成功投递（条目存在、controller 已注册、子 session 就绪）
   */
  async sendTask(childId: string, task: TaskMessage): Promise<boolean> {
    const entry = this.children.get(childId);
    if (!entry || entry.status === "terminated") {
      console.log(`[manager] sendTask 跳过：子 Agent 不存在或已回收 childId=${childId}`);
      return false;
    }
    const controller = this.childControllers.get(entry.agentName);
    if (!controller?.deliverInboundMessage) {
      console.log(
        `[manager] sendTask 跳过：controller 未注册或未就绪 name=${entry.agentName} childId=${childId}`,
      );
      return false;
    }
    entry.lastTask = task;
    const message = JSON.stringify(task);
    const delivered = await controller.deliverInboundMessage({
      senderName: "manager",
      message,
    });
    if (delivered) {
      // 任务投递成功 = 一次活跃（刷新 idle 心跳）；并维护周期计时：
      // run_cycle 开启新周期（覆盖旧计时），stop 终止当前周期。
      const now = Date.now();
      entry.lastActivityAt = now;
      if (task.action === "run_cycle") {
        entry.cycleStartedAt = now;
        console.log(
          `[manager] 周期开始 child=${entry.agentName} action=run_cycle script=${task.script_name ?? "-"} games=${task.games ?? "-"} childId=${childId}`,
        );
      } else if (task.action === "stop") {
        entry.cycleStartedAt = null;
        console.log(
          `[manager] 周期终止（stop） child=${entry.agentName} childId=${childId}`,
        );
      }
    }
    console.log(
      `[manager] sendTask ${delivered ? "已投递" : "投递失败"} child=${entry.agentName} action=${task.action} childId=${childId}`,
    );
    return delivered;
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
      // 用 RLM childNodeId 删除注册表条目（rlmChildId 未回填时回退 session_name
      // ——两者都是 deleteRlmSubagent 的合法 selector；占位 key 不是合法 selector）。
      const rlmTarget = entry.rlmChildId ?? entry.agentName;
      await this.session.deleteRlmSubagent(rlmTarget);
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
    // 持久化到 MetricsCollector。
    // Step 11：driver_failed 事件标注 executor="driver"、driverStatus="failed"，
    // 并附带脚本版本（script_name:vN，有则带）供 metrics 归因。
    this.metricsCollector.recordStabilityIncident(childId, type, details, {
      executor: type === "driver_failed" ? "driver" : undefined,
      driverStatus: type === "driver_failed" ? "failed" : undefined,
      scriptVersion:
        type === "driver_failed" && entry.driver.scriptName
          ? `${entry.driver.scriptName}:${entry.driver.scriptVersion ?? "unknown"}`
          : undefined,
    });
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
    // 子 session 事件 = 活跃心跳（LLM 回合/工具执行流转说明未卡死）
    entry.lastActivityAt = Date.now();
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

  /** 注册子 Agent 的 agentMessageController（createRlmSubagentRuntime 调用） */
  private registerChildController(
    agentName: string,
    controller: AgentSessionMessageController,
  ): void {
    this.childControllers.set(agentName, controller);
  }

  /**
   * 创建子 Agent 的 agentMessageController。
   *
   * onMessage：子 → 父 方向——`agent_message.send(..., receiver_role="parent")`
   * 回调到管理器事件处理（等价 daemon 转发）。
   * onInboundMessage：父 → 子 方向——编排器 sendTask 经 controller 反推投递
   * 任务消息，注入子 session 触发 autonomous continuation 处理。
   * 提取为独立方法便于单元测试直连（绕过 createChildSession 真实建会话）。
   */
  private createChildAgentController(
    id: string,
    sessionName: string,
  ): AgentSessionMessageController {
    const family: InMemoryFamilyMember[] = [
      {
        relationship: "parent",
        name: this.session.sessionName ?? "manager",
        id: this.session.sessionId,
        depth: 0,
        status: "idle",
      },
    ];
    return createInMemoryAgentMessageController({
      selfName: sessionName,
      selfId: id,
      selfDepth: 1,
      family,
      onMessage: ({ message }) => this.handleChildAgentMessage(sessionName, message),
      onInboundMessage: ({ message }) => this.deliverTaskToChildSession(sessionName, message),
    });
  }

  /** 注销子 Agent 的 agentMessageController（deleteRlmSubagentRuntime 调用） */
  private unregisterChildController(agentName: string): void {
    this.childControllers.delete(agentName);
  }

  /** 按 agentName 查找子 Agent 条目 */
  private findEntryByAgentName(agentName: string): ChildAgentEntry | undefined {
    for (const [, entry] of this.children) {
      if (entry.agentName === agentName) return entry;
    }
    return undefined;
  }

  /**
   * 向子 session 投递任务消息（controller 入站回调）。
   *
   * 子 session 就绪（entry.session 已填充）时用 promptUntilAccepted 注入：
   * streamingBehavior=followUp——子 Agent 空闲时立即触发一轮 autonomous
   * continuation，忙碌时排队等当前回合结束再处理；expandPromptTemplates=false
   * 防止任务 JSON 被当作提示模板/技能展开。
   *
   * @returns 是否完成投递（子 session 未就绪 / 注入异常返回 false）
   */
  private async deliverTaskToChildSession(
    agentName: string,
    message: string,
  ): Promise<boolean> {
    const entry = this.findEntryByAgentName(agentName);
    const target = entry?.session;
    if (!target) {
      console.log(
        `[manager] deliverTask 跳过：子 session 未就绪 name=${agentName}（任务将不被投递）`,
      );
      return false;
    }
    try {
      await target.promptUntilAccepted(message, {
        streamingBehavior: "followUp",
        expandPromptTemplates: false,
      });
      return true;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.log(`[manager] deliverTask 注入失败 name=${agentName} reason=${reason}`);
      return false;
    }
  }

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
    // 日志节流：同 child 同 status 在 1s 窗口内不重复打印（状态变化立即打）。
    // 子 Agent 流式回合会高频重发 status=done 的 rlm_child_update（见字段注释），
    // 不节流则每秒几十条刷屏淹没真实事件。
    const now = Date.now();
    const throttleKey = child.id;
    const prev = this.rlmLogThrottle.get(throttleKey);
    const throttled = prev !== undefined && prev.status === child.status && now - prev.time < 1000;
    if (!throttled) {
      this.rlmLogThrottle.set(throttleKey, { status: child.status, time: now });
      console.log(
        `[manager][rlm] rlm_child_update id=${child.id} status=${child.status}${child.error ? ` error=${child.error}` : ""} ${ts()}`,
      );
    }

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
        // RLM 状态推进 = 活跃心跳
        entry.lastActivityAt = Date.now();
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
        // RLM 状态推进 = 活跃心跳（占位条目首次关联也视为活跃）
        entry.lastActivityAt = Date.now();
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
   * 解析 agent_message 载荷并更新子 Agent 条目（currentMatchId / metrics /
   * driver 状态机）。按 sessionId 或 agentName 匹配条目（二者取其一）。
   *
   * 事件协议（子 Agent → 编排器，agent_message JSON 字符串）：
   *   match_found    — 已进入对局（顶层 currentMatchId + driver.currentMatchId）
   *   game_ended     — 单局结算（LLM 旧路径，Step 13 已退役：仅兼容残留上报，
   *                    结算 metrics 但不触发强制回收，回收由 batch_end/超时驱动）
   *   script_ready   — 脚本就绪（driver.scriptName/scriptVersion）
   *   batch_start    — 批量开始（driver.status=running、批次计数清零）
   *   batch_end      — 批量结束（并入 metrics、driver.status=done）
   *   driver_failed  — driver 崩溃（driver.status=failed + stability incident）
   *   review_done    — 复盘完成（scriptVersion 更新为 to_version）
   *   v_published    — 新版本发布（scriptVersion 更新，去重；周期闭环清空
   *                    cycleStartedAt，进入待命）
   *   其他           — 未知事件忽略
   *
   * 上述已识别上报均刷新 lastActivityAt（idle 心跳，防止误回收）。
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
    // 刷新心跳：子 Agent 的任意已识别上报都视为活跃（防止 idle 误回收）
    const touch = (entry: ChildAgentEntry): void => {
      entry.lastActivityAt = Date.now();
    };

    if (payload.event === "match_found") {
      // 子 Agent 已进入对局 → 记录 currentMatchId（bot .playai 轮询据此判定）。
      // match:found 载荷只有 roomId/roomCode（后端从不下发 matchId），回退到 roomId。
      const matchId = typeof payload.matchId === "string" ? payload.matchId : "";
      const roomId = typeof payload.roomId === "string" ? payload.roomId : "";
      const entry = findEntry();
      if (entry) {
        touch(entry);
        const resolved = matchId || roomId || entry.currentMatchId;
        entry.currentMatchId = resolved;
        // driver 维度同步：批量进行中显示当前对局
        if (entry.driver.status === "running") {
          entry.driver.currentMatchId = resolved || null;
        }
      }
      return;
    }

    if (payload.event === "game_ended") {
      // Step 13 退役说明：Swarm 下对局结算由 driver 确定性接管（batch_end
      // 汇总上报），LLM 收尾路径（旧 game_ended 上报）已整体退役，新子 Agent
      // 不会再上报本事件。此分支仅保留「指标结算 + 去重」以兼容历史/灰度期
      // 残留上报，**不再触发 deleteAgent 强制回收**——回收改由 batch_end /
      // 双超时 / 手动 delete 驱动（权威结算者已非 LLM）。
      const entry = findEntry();
      if (!entry) return;
      touch(entry);
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
        // Step 11：LLM 旧路径单局标记 executor="llm"（driver 批量见 recordBatch）
        { executor: "llm" },
      );
      console.log(
        `[manager] game_ended（退役路径兼容）child=${entry.agentName} result=${payload.result}（不回收，回收由 batch_end/超时驱动）`,
      );
      return;
    }

    if (payload.event === "script_ready") {
      // 脚本就绪：记录脚本名与版本，进入待命（idle→running 由 batch_start 驱动）
      const entry = findEntry();
      if (!entry) return;
      touch(entry);
      entry.driver.scriptName = strField(payload.script_name) ?? entry.driver.scriptName;
      entry.driver.scriptVersion = strField(payload.version) ?? entry.driver.scriptVersion;
      entry.driver.lastError = null;
      console.log(
        `[manager] script_ready child=${entry.agentName} script=${entry.driver.scriptName} version=${entry.driver.scriptVersion}`,
      );
      return;
    }

    if (payload.event === "batch_start") {
      // 批量开始：driver 进入 running，批次计数清零（新一批与上一批隔离）
      const entry = findEntry();
      if (!entry) return;
      touch(entry);
      entry.driver.status = "running";
      entry.driver.currentMatchId = null;
      entry.driver.scriptName = strField(payload.script_name) ?? entry.driver.scriptName;
      entry.driver.scriptVersion = strField(payload.version) ?? entry.driver.scriptVersion;
      entry.driver.batchMatches = 0;
      entry.driver.batchWins = 0;
      entry.driver.batchLosses = 0;
      entry.driver.batchDraws = 0;
      entry.driver.lastError = null;
      console.log(
        `[manager] batch_start child=${entry.agentName} script=${entry.driver.scriptName} plan_games=${payload.plan_games ?? "-"}`,
      );
      return;
    }

    if (payload.event === "batch_end") {
      // 批量结束：driver 状态 done，把整批结果并入 driver 与全局 metrics
      const entry = findEntry();
      if (!entry) return;
      touch(entry);
      const scriptName = strField(payload.script_name) ?? entry.driver.scriptName ?? "unknown";
      const version = strField(payload.version) ?? entry.driver.scriptVersion ?? "unknown";
      // 去重：同子 Agent 同脚本同版本只结算一次（autonomous continuation 重跑
      // 可能重复上报 batch_end，重复计数会污染 matches/wins/losses）。
      const batchKey = `${entry.childId}:${scriptName}:${version}`;
      if (this.settledBatches.has(batchKey)) {
        console.log(
          `[manager] 忽略重复 batch_end 上报 child=${entry.agentName} script=${scriptName} version=${version}`,
        );
        return;
      }
      this.settledBatches.add(batchKey);

      const matchIds = Array.isArray(payload.match_ids)
        ? payload.match_ids.filter((m): m is string => typeof m === "string")
        : [];
      const gamesPlayed =
        numField(payload.games_played) ?? (matchIds.length > 0 ? matchIds.length : 0);
      const wins = numField(payload.wins) ?? 0;
      const losses = numField(payload.losses) ?? 0;
      const draws = numField(payload.draws) ?? 0;

      entry.driver.status = "done";
      entry.driver.currentMatchId = null;
      if (scriptName) entry.driver.scriptName = scriptName;
      if (version) entry.driver.scriptVersion = version;
      entry.driver.batchMatches = gamesPlayed;
      entry.driver.batchWins = wins;
      entry.driver.batchLosses = losses;
      entry.driver.batchDraws = draws;

      // driver_errors（局级错误数组）并入 lastError 留痕
      const driverErrors = Array.isArray(payload.driver_errors)
        ? payload.driver_errors.map((e) =>
            typeof e === "string" ? e : typeof e === "object" && e !== null ? JSON.stringify(e) : String(e),
          )
        : [];
      entry.driver.lastError = driverErrors.length > 0 ? driverErrors.join("; ") : null;

      // 并入全局指标（batch_end 无逐场 result 映射，只累加计数；
      // MetricsCollector 持久化的 executor/scriptVersion 扩展见 Step 11）
      entry.metrics.matches += gamesPlayed;
      entry.metrics.wins += wins;
      entry.metrics.losses += losses;
      entry.metrics.draws += draws;

      // Step 11：batch 汇总持久化到 MetricsCollector（executor="driver" 固定，
      // 整批计数 + match_ids 全量留痕 + 局级错误）。去重（settledBatches）在
      // 上方完成，此处只记录首次上报。
      this.metricsCollector.recordBatch(entry.childId, {
        scriptName,
        scriptVersion: version,
        gamesPlayed,
        wins,
        losses,
        draws,
        matchIds,
        driverErrors,
      });

      console.log(
        `[manager] batch_end child=${entry.agentName} script=${scriptName} v=${version} ` +
          `games=${gamesPlayed} w/l/d=${wins}/${losses}/${draws} match_ids=${matchIds.length} ` +
          `driver_errors=${driverErrors.length}`,
      );
      return;
    }

    if (payload.event === "driver_failed") {
      // driver 崩溃：状态置 failed，记稳定性异常（stability_incident 新类型）
      const entry = findEntry();
      if (!entry) return;
      touch(entry);
      const reason = strField(payload.reason) ?? "driver 进程异常退出";
      entry.driver.status = "failed";
      entry.driver.lastError = reason;
      if (payload.script_name && typeof payload.script_name === "string") {
        entry.driver.scriptName = payload.script_name;
      }
      this.recordStabilityIncident(entry.childId, "driver_failed", reason);
      console.log(
        `[manager] driver_failed child=${entry.agentName} script=${entry.driver.scriptName} reason=${reason}`,
      );
      return;
    }

    if (payload.event === "review_done") {
      // 复盘完成：scriptVersion 推进到 to_version（v_published 才是权威发布）
      const entry = findEntry();
      if (!entry) return;
      touch(entry);
      if (payload.script_name && typeof payload.script_name === "string") {
        entry.driver.scriptName = payload.script_name;
      }
      const toVersion = strField(payload.to_version);
      if (toVersion) entry.driver.scriptVersion = toVersion;
      console.log(
        `[manager] review_done child=${entry.agentName} from=${payload.from_version ?? "-"} to=${toVersion ?? "-"}`,
      );
      return;
    }

    if (payload.event === "v_published") {
      // 新版本发布：scriptVersion 更新（去重——重复发布同一版本不重复计数）
      const entry = findEntry();
      if (!entry) return;
      touch(entry);
      const scriptName = strField(payload.script_name) ?? entry.driver.scriptName ?? "unknown";
      const version = strField(payload.version);
      if (!version) return;
      const versionKey = `${entry.childId}:${scriptName}:${version}`;
      if (this.settledVersions.has(versionKey)) {
        console.log(
          `[manager] 忽略重复 v_published 上报 child=${entry.agentName} script=${scriptName} version=${version}`,
        );
        return;
      }
      this.settledVersions.add(versionKey);
      entry.driver.scriptName = scriptName;
      entry.driver.scriptVersion = version;
      // 周期闭环完成（写脚本→批量→复盘→发布 vN）：清空周期计时，进入待命。
      // 后续无任务时不再受 cycle/idle 超时约束，等待下一个 run_cycle。
      entry.cycleStartedAt = null;
      console.log(
        `[manager] v_published child=${entry.agentName} script=${scriptName} version=${version} 周期完成`,
      );
      return;
    }

    // 未知事件：忽略（保持静默，不记录噪音）
  }

  // -----------------------------------------------------------------------
  // 超时监控
  // -----------------------------------------------------------------------

  /**
   * 超时检查：轮询所有子 Agent，超时则强制回收（Step 6: 双超时配置）。
   *
   * 语义（对齐 swarm-autopilot 设计 4.2 Decision 15 与 9.3）：
   * - 待命（cycleStartedAt === null，无 run_cycle 周期）：不检查超时，
   *   等待任务下发（健康待命不误杀）。
   * - idle 超时（childIdleTimeoutMs，默认 15min）：周期进行中无任何心跳
   *   （子 session 事件 / agent_message 上报 / 任务投递 / RLM 更新均刷新
   *   lastActivityAt）→ 子 Agent 卡死（LLM 回合挂起）→ 回收。
   * - cycle 超时（cycleTimeoutMs，默认 2h）：周期总时长（写脚本 + 批量对局
   *   + 多轮复盘迭代）→ 单周期超长 → 回收。
   *
   * 跳过已结束（done/terminated/cancelled）的子 Agent，对超时的子 Agent
   * 记录 stability_incident（type=timeout，details 区分空闲/周期）并异步回收。
   * 此方法公开供外部监控工具调用，也由内部定时器自动触发。
   */
  checkTimeouts(): void {
    const now = Date.now();
    const idleMs = this.config.childIdleTimeoutMs;
    const cycleMs = this.config.cycleTimeoutMs;
    for (const [childId, entry] of this.children) {
      // 跳过已结束、已终止、已取消的子 Agent
      if (entry.status === "done" || entry.status === "terminated" || entry.status === "cancelled") {
        continue;
      }
      // 无周期（待命）：不检查超时，等待任务下发
      if (entry.cycleStartedAt === null) {
        continue;
      }
      // idle 超时：周期内无心跳（LLM 回合挂起/卡死）
      const idleSince = now - entry.lastActivityAt;
      if (idleSince > idleMs) {
        this.recordStabilityIncident(
          childId,
          "timeout",
          `子 Agent 空闲超时 ${idleSince}ms > childIdleTimeoutMs=${idleMs}ms（周期内无心跳）`,
        );
        // 异步回收，不阻塞轮询
        this.deleteAgent(childId).catch(() => {});
        continue;
      }
      // cycle 超时：周期总时长（多轮迭代超长）
      const cycleElapsed = now - entry.cycleStartedAt;
      if (cycleElapsed > cycleMs) {
        this.recordStabilityIncident(
          childId,
          "timeout",
          `周期超时 ${cycleElapsed}ms > cycleTimeoutMs=${cycleMs}ms（run_cycle 超长）`,
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
        // agent_end = LLM 回合结束，视为活跃心跳
        entry.lastActivityAt = Date.now();
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

/** 宽容解析字符串字段（string 原样返回；有限 number 转字符串） */
function strField(value: unknown): string | undefined {
  // 子 Agent 常把 version 发成数字（如 version=3）；v_published 分支解析
  // 失败会静默 return，导致周期闭环永不触发（run-duel-cycle 只能等超时）。
  if (typeof value === "string" && value !== "") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

/** 宽容解析数字字段（非 number 返回 undefined） */
function numField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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