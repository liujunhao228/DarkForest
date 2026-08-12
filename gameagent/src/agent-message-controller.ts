/**
 * 进程内 AgentSessionMessageController 实现。
 *
 * prime-agent 的 agent-message skill（内核侧 python 包 `agent_message`）
 * 仅在 session 提供 agentMessageController 时才被纳入 model-visible skills，
 * 其 python 包才会被装入 kernel-venv（getPythonSkillRuntimeInfo 只收集
 * model-visible skills）。gameagent 不跑 daemon（SessionManager.inMemory），
 * 因此提供一个进程内最小实现：roster 返回父子关系，sendAgentMessage 直接把
 * 消息投递给管理器回调——等价 daemon 的转发路径，使子 Agent 能用
 * `agent_message.send(..., receiver_role="parent")` 上报对局事件
 * （match_found / game_ended），管理器据此更新 currentMatchId 与 metrics。
 *
 * 修复前（无 controller）：agent-message skill 被过滤 → python 包不安装 →
 * 子 Agent 内核 `import agent_message` 失败 → 大量轮次在找通信方式 →
 * 对局事件从未上报 → E2E 指标断言必然失败。
 *
 * 类型说明：AgentSessionMessageController 等类型未从
 * `@earendil-works/pi-coding-agent` 入口导出，这里定义结构对齐的本地接口
 * （TS 结构类型兼容），避免深层导入 dist 内部路径。
 */

/** 家庭关系（对齐 prime-agent AgentFamilyRelationship） */
export type AgentFamilyRelationship = "parent" | "sibling" | "child";

/** 家庭状态（对齐 prime-agent AgentFamilyStatus） */
export type AgentFamilyStatus = "running" | "idle" | "inactive";

/** roster 成员（对齐 AgentFamilyRosterEntry） */
export interface AgentFamilyRosterEntry {
  relationship: AgentFamilyRelationship;
  name: string;
  id: string;
  depth: number;
  status: AgentFamilyStatus;
}

/** roster 结果（对齐 AgentFamilyRosterResult） */
export interface AgentFamilyRosterResult {
  current: { name: string; id: string; depth: number };
  entries: AgentFamilyRosterEntry[];
}

/** 消息端点（对齐 AgentSessionMessageEndpoint） */
export interface AgentSessionMessageEndpoint {
  activeSessionId: string;
  sessionId: string;
  sessionName?: string;
}

/** list_agents 结果（对齐 AgentSessionMessageListResult） */
export interface AgentSessionMessageListResult {
  current?: AgentSessionMessageEndpoint;
  agents: Array<{
    activeSessionId: string;
    sessionId: string;
    sessionName?: string;
    cwd: string;
    isStreaming: boolean;
    unfinishedActionCount: number;
    depth: number;
    status?: AgentFamilyStatus;
  }>;
}

/** sendAgentMessage 入参（对齐 AgentSessionMessageSendInput） */
export interface AgentSessionMessageSendInput {
  target: string;
  message: string;
  receiverRole?: AgentFamilyRelationship;
}

/** sendAgentMessage 回执（对齐 AgentSessionMessageReceipt） */
export interface AgentSessionMessageReceipt {
  id: string;
  source: "agent_message";
  target: AgentSessionMessageEndpoint;
  message: string;
  deliveryStatus: "delivered" | "queued";
  deliveredAt?: string;
  deliveryMode?: "steer";
}

/** 进程内 controller（结构对齐 AgentSessionMessageController） */
export interface AgentSessionMessageController {
  listAgents(): AgentSessionMessageListResult | Promise<AgentSessionMessageListResult>;
  roster?(): AgentFamilyRosterResult | Promise<AgentFamilyRosterResult>;
  awaitPendingChildPublication?(selector: string): Promise<string | undefined>;
  assertSessionNameAvailable?(input: unknown): void | Promise<void>;
  setSessionName?(name: string): void | Promise<void>;
  sendAgentMessage(input: AgentSessionMessageSendInput): Promise<AgentSessionMessageReceipt>;
}

/** 进程内家庭图谱中的单个成员（roster 用） */
export interface InMemoryFamilyMember {
  relationship: AgentFamilyRelationship;
  name: string;
  id: string;
  depth: number;
  status: AgentFamilyStatus;
}

/** 进程内 controller 的构建选项 */
export interface InMemoryAgentMessageControllerOptions {
  /** 本 session 名称（子 Agent 为 agentName，管理器为固定标识） */
  selfName: string;
  /** 本 session id（子 Agent 为 RLM childId，管理器为固定标识） */
  selfId: string;
  /** 本 session 深度：管理器 0，子 Agent 1 */
  selfDepth: number;
  /** 家庭图谱（不含自己） */
  family: InMemoryFamilyMember[];
  /** 收到消息时的回调（游戏场景：转发给管理器处理对局事件） */
  onMessage: (input: {
    senderName: string;
    target: string;
    message: string;
    receiverRole?: AgentFamilyRelationship;
  }) => void | Promise<void>;
}

/**
 * 构建进程内 AgentSessionMessageController。
 *
 * roster / listAgents 直接返回内存中的家庭图谱；sendAgentMessage 不投递到
 * 任何外部 daemon，而是把消息内容（JSON 字符串）回传给 onMessage 回调，
 * 由管理器侧按 agent_message 协议解析（match_found / game_ended）。
 */
export function createInMemoryAgentMessageController(
  options: InMemoryAgentMessageControllerOptions,
): AgentSessionMessageController {
  const { selfName, selfId, selfDepth, family, onMessage } = options;

  return {
    listAgents(): AgentSessionMessageListResult {
      return {
        current: { activeSessionId: selfId, sessionId: selfId, sessionName: selfName },
        agents: family.map((m) => ({
          activeSessionId: m.id,
          sessionId: m.id,
          sessionName: m.name,
          cwd: "",
          isStreaming: false,
          unfinishedActionCount: 0,
          depth: m.depth,
          status: m.status,
        })),
      };
    },

    roster(): AgentFamilyRosterResult {
      return {
        current: { name: selfName, id: selfId, depth: selfDepth },
        entries: family.map((m) => ({
          relationship: m.relationship,
          name: m.name,
          id: m.id,
          depth: m.depth,
          status: m.status,
        })),
      };
    },

    async sendAgentMessage(
      input: AgentSessionMessageSendInput,
    ): Promise<AgentSessionMessageReceipt> {
      await onMessage({
        senderName: selfName,
        target: input.target,
        message: input.message,
        receiverRole: input.receiverRole,
      });
      return {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        source: "agent_message",
        target: { activeSessionId: input.target, sessionId: input.target },
        message: input.message,
        deliveryStatus: "delivered",
        deliveredAt: new Date().toISOString(),
        deliveryMode: "steer",
      };
    },
  };
}
