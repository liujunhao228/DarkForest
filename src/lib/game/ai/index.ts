// ============================
// AI 模块统一导出
// ============================
// 保持向后兼容的 API
// ============================

// 决策逻辑（从原 ai.ts 迁移）
export {
  aiAction,
  aiMoveStrike,
  aiRespondToBroadcast,
} from './decisions';

// 触发钩子（从各模块提取）
export {
  executeAIAction,
  executeAIMoveStrikes,
  processAIResponses,
  triggerAIBroadcastResponse,
  allAiResponded,
  getHumanBroadcastResponders,
} from './hooks';

// 工具函数
export {
  isAIPlayer,
  getAIPlayers,
  getHumanPlayers,
} from './utils';
