// ============================
// AI 模块统一导出（仅保留钩子和工具）
// ============================
// AI决策逻辑已移除，仅保留钩子用于测试
// ============================

// 触发钩子
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
