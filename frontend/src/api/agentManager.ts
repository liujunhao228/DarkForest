// gameagent manager HTTP API 客户端。
// 用于"创建一局"（spawn agent）与"旁观"（枚举正在打牌的 agent）。
// 编排壳对 agent 大脑实现无感知（brain-agnostic）：只负责拉起/枚举一个
// 以 sid 为标识、能连后端打牌的进程。

const BASE = import.meta.env.VITE_AGENT_MANAGER_URL || 'http://localhost:9091';

export interface AgentInfo {
  childId: string;
  /** 子 Agent 在 mcpserver 账户池中的 sid（即 backend 的 agent:<sid>） */
  agentName: string;
  status: string;
  currentMatchId: string | null;
}

export interface SpawnAgentParams {
  agentName: string;
  gameMode?: string;
  preferredCount?: number;
}

export interface SpawnAgentResult {
  childId: string;
  status?: string;
}

export async function listAgents(): Promise<AgentInfo[]> {
  const res = await fetch(`${BASE}/api/agents`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<AgentInfo[]>;
}

export async function spawnAgent(params: SpawnAgentParams): Promise<SpawnAgentResult> {
  const res = await fetch(`${BASE}/api/spawn-agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentName: params.agentName,
      gameMode: params.gameMode ?? 'classic',
      preferredCount: params.preferredCount ?? 2,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<SpawnAgentResult>;
}