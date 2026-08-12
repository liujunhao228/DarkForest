/**
 * 游戏 Agent 管理器配置，从环境变量读取。
 *
 * 无 .env 自动加载，需由宿主进程注入或手动导出。
 * 字段与 gameagent/.env.example 一一对应。
 */

/** 从环境变量读取全部配置。 */
export function loadConfig(): AppConfig {
  return {
    mcpUrl: requireEnv("MCP_URL", "http://localhost:9090/mcp"),
    managerPort: parseInt(requireEnv("MANAGER_PORT", "9091"), 10),
    modelProvider: requireEnv("MODEL_PROVIDER", "deepseek"),
    modelId: requireEnv("MODEL_ID", "deepseek-v4-flash"),
    deepseekApiKey: requireEnv("DEEPSEEK_API_KEY", ""),
    agentSeedNames: parseAgentSeedNames(requireEnv("AGENT_SEED_NAMES", "ai1:AgentAlpha,ai2:AgentBeta")),
    maxGameTimeoutMs: parseInt(requireEnv("MAX_GAME_TIMEOUT_MS", "1800000"), 10),
    memoryDbPath: requireEnv("MEMORY_DB_PATH", "./data/memories.json"),
  };
}

/** 应用配置 */
export interface AppConfig {
  /** mcpserver Streamable HTTP MCP 端点 */
  mcpUrl: string;
  /** Agent 管理器 HTTP API 监听端口 */
  managerPort: number;
  /** LLM 模型提供方（prime-agent ModelRegistry 按 provider 查模型） */
  modelProvider: string;
  /** 模型 ID */
  modelId: string;
  /** DeepSeek API Key */
  deepseekApiKey: string;
  /** 种子 Agent 名单 */
  agentSeedNames: AgentSeedEntry[];
  /** 单局最大时长（毫秒），超过则强制回收子 Agent */
  maxGameTimeoutMs: number;
  /** rlm.harness 分层记忆持久化路径 */
  memoryDbPath: string;
}

/** 种子 Agent 条目 */
export interface AgentSeedEntry {
  /** Agent sid（mcpserver 账户池标识） */
  sid: string;
  /** Agent 昵称（可选，默认同 sid） */
  nickname: string;
}

/** 读取环境变量，缺失时返回默认值。 */
function requireEnv(key: string, defaultValue: string): string {
  const value = process.env[key];
  if (value !== undefined && value !== "") {
    return value;
  }
  return defaultValue;
}

/** 解析 AGENT_SEED_NAMES：逗号分隔，每项为 sid 或 sid:昵称。 */
function parseAgentSeedNames(raw: string): AgentSeedEntry[] {
  if (!raw.trim()) {
    return [];
  }
  return raw.split(",").map((item) => {
    const trimmed = item.trim();
    if (!trimmed) {
      return { sid: "", nickname: "" };
    }
    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) {
      return { sid: trimmed, nickname: trimmed };
    }
    return {
      sid: trimmed.slice(0, colonIndex),
      nickname: trimmed.slice(colonIndex + 1) || trimmed.slice(0, colonIndex),
    };
  }).filter((e) => e.sid !== "");
}