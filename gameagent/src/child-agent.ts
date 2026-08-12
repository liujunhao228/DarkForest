/**
 * 子 Agent session 创建逻辑。
 *
 * 与 manager.ts 解耦：接收父 session 的依赖服务与 RLM 提供的子 session 参数，
 * 通过 `createAgentSession()` 创建子 session 并注入游戏系统提示。
 * 任务提示由 prime-agent RLM 运行时注入，此处不重复处理。
 */

import { join } from "node:path";
import {
  AgentSession,
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  type CreateRlmSubagentRuntimeOptions,
} from "@earendil-works/pi-coding-agent";
import type { AgentSessionMessageController } from "./agent-message-controller.js";
import { buildGameAgentSystemPrompt } from "./system-prompt.js";

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/** 打点用本地时间戳（HH:MM:SS.mmm） */
function ts(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

/** 截断字符串到最大长度 */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 子 Agent 活动记录（可观测性：LLM 回合 / 工具执行流水） */
export interface ChildActivity {
  /** 活动时间戳（HH:MM:SS.mmm） */
  ts: string;
  /** 活动类型 */
  type: string;
  /** 活动详情 */
  detail: string;
}

/** 子 Agent 活动回调：childId 与 sessionName（agentName）用于管理器匹配条目 */
export type ChildActivityCallback = (
  childId: string,
  sessionName: string,
  activity: ChildActivity,
) => void;

/** createChildSession 的选项 */
export interface CreateChildSessionOptions {
  /** 父 session */
  parentSession: AgentSession;
  /** 认证存储（复用父 session 的 API Key） */
  authStorage: AuthStorage;
  /** 模型注册表 */
  modelRegistry: ModelRegistry;
  /** gameagent 包根目录 */
  gameagentDir: string;
  /** 单局超时（毫秒） */
  maxGameTimeoutMs: number;

  // 以下来自 CreateRlmSubagentRuntimeOptions
  /** RLM 分配的 child ID */
  childId: string;
  /** 子 session 名称（agentName） */
  sessionName: string;
  /** RLM 分配的 session 目录 */
  sessionDir: string;
  /** 继承的模型 */
  model: CreateRlmSubagentRuntimeOptions["model"];
  /** 思考级别 */
  thinkingLevel: CreateRlmSubagentRuntimeOptions["thinkingLevel"];
  /** 服务层级 */
  serviceTier: CreateRlmSubagentRuntimeOptions["serviceTier"];
  /** 活跃工具列表 */
  activeToolNames: string[];
  /** RLM 深度 */
  rlmDepth: number;
  /** RLM 最大深度 */
  rlmMaxDepth: number;
  /** 父节点 ID */
  rlmParentNodeId: string;
  /** 子 Agent 的 agentMessageController（agent-message skill 可见性 + 上报回调） */
  agentMessageController: AgentSessionMessageController;
  /** 子 Agent 活动回调（可观测性；在交给 RLM 运行前订阅，勿漏首个回合） */
  onChildActivity?: ChildActivityCallback;
}

// ---------------------------------------------------------------------------
// 创建子 session
// ---------------------------------------------------------------------------

/**
 * 创建子 Agent session。
 *
 * 1. 复用父 session 的 authStorage 和 modelRegistry
 * 2. 新建 DefaultResourceLoader（同 skillsDir 路径）
 * 3. 通过 systemPromptOverride 注入游戏系统提示
 * 4. 启用 autonomous 模式（自主运行游戏循环）
 *
 * 注意：任务提示不在此处注入。prime-agent RLM 运行时会在
 * `createRlmSubagentRuntime` 返回后，通过 `child.promptAndWait("[task from
 * parent]\n\n" + prompt)` 注入任务（agent-session.ts），此处重复注入会导致
 * 同一任务提示进入子 Agent 两次，可能启动两条游戏循环，且 `session.prompt()`
 * 会阻塞至子 Agent 首个回合结束（即整场对局），使 entry.status 一直停在
 * queued。
 */
export async function createChildSession(
  options: CreateChildSessionOptions,
): Promise<AgentSession> {
  const {
    parentSession,
    authStorage,
    modelRegistry,
    gameagentDir,
    maxGameTimeoutMs,
    sessionDir,
    model,
    thinkingLevel,
    serviceTier,
    activeToolNames,
    rlmDepth,
    rlmMaxDepth,
    rlmParentNodeId,
    agentMessageController,
    onChildActivity,
  } = options;

  // 资源加载器（加载 skills 目录中的 darkforest skill）
  const resourceLoader = new DefaultResourceLoader({
    cwd: gameagentDir,
    agentDir: join(gameagentDir, ".prime-agent"),
    additionalSkillPaths: [join(gameagentDir, "skills")],
    systemPromptOverride: () => buildGameAgentSystemPrompt(),
    noContextFiles: true,
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
  });
  await resourceLoader.reload();

  // 创建子 session
  const { session } = await createAgentSession({
    cwd: gameagentDir,
    agentDir: join(gameagentDir, ".prime-agent"),
    authStorage,
    modelRegistry,
    model,
    thinkingLevel,
    serviceTier,
    scopedModels: parentSession.scopedModels as
      | Array<{ model: typeof model; thinkingLevel?: typeof thinkingLevel }>
      | undefined,
    tools: activeToolNames,
    resourceLoader,
    sessionManager: SessionManager.inMemory(gameagentDir),
    agentMessageController,
    autonomous: {
      enabled: true,
      maxContinuations: 200,
      maxTurns: 1000,
      maxTokens: 1_000_000,
      timeoutMs: maxGameTimeoutMs,
    },
    serializedRefine: true,
    rlmDepth,
    rlmMaxDepth,
    rlmSessionDir: sessionDir,
    rlmParentNodeId,
    rlmParentAgent: parentSession.sessionName,
  });

  // 任务提示由 prime-agent RLM 运行时经 promptAndWait 注入，此处不重复注入。
  // 子 session 创建完即返回，createRlmSubagentRuntime 随即标记 running，
  // 子 Agent 由 RLM 运行时在后台 promptAndWait 后自主开打。
  // 可观测性：在交给 RLM 运行前订阅子 session 事件，把 LLM 回合与工具执行
  // 流水转发给管理器（childId + sessionName 用于匹配本地条目）。
  if (onChildActivity) {
    const emit = (type: string, detail: string) =>
      onChildActivity(options.childId, options.sessionName, { ts: ts(), type, detail });
    session.subscribe((event) => {
      if (event.type === "turn_start") {
        emit("turn_start", "LLM 回合开始");
      } else if (event.type === "turn_end") {
        emit("turn_end", "LLM 回合结束");
      } else if (event.type === "tool_execution_start") {
        emit(
          "tool_execution_start",
          `${event.toolName} args=${truncate(JSON.stringify(event.args), 300)}`,
        );
      } else if (event.type === "tool_execution_end") {
        emit(
          "tool_execution_end",
          `${event.toolName} isError=${event.isError} result=${truncate(JSON.stringify(event.result), 200)}`,
        );
      } else if (event.type === "message_end") {
        if (event.message.role === "assistant") {
          const stopReason = (event.message as { stopReason?: string }).stopReason;
          emit("message_end", `assistant stopReason=${stopReason ?? "-"}`);
        }
      } else if (event.type === "ipython_sent_agent_message") {
        emit("ipython_sent_agent_message", event.message.message);
      }
    });
  }

  console.log(
    `[child-agent] 子 session 创建完成 childId=${options.childId} name=${options.sessionName} ${ts()}`,
  );

  return session;
}