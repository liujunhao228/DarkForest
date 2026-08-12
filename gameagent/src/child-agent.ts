/**
 * 子 Agent session 创建逻辑。
 *
 * 与 manager.ts 解耦：接收父 session 的依赖服务与 RLM 提供的子 session 参数，
 * 通过 `createAgentSession()` 创建子 session 并注入游戏系统提示与任务提示。
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
import { buildGameAgentSystemPrompt } from "./system-prompt.js";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

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
  /** 任务提示（由 rlm.run() 传入） */
  prompt: string;
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
 * 5. 创建后用 session.prompt() 注入任务提示作为首条消息
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
    prompt,
    sessionDir,
    model,
    thinkingLevel,
    serviceTier,
    activeToolNames,
    rlmDepth,
    rlmMaxDepth,
    rlmParentNodeId,
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

  // 注入任务提示作为首条消息
  await session.prompt(prompt, { internalPrompt: true });

  return session;
}