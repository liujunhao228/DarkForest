/**
 * Matchmaking 子模块统一导出。
 *
 * 外部消费方优先从此处导入，避免直接引用内部文件路径。
 */

// 容器与视图
export { MatchmakingShell, type MatchmakingShellProps } from './MatchmakingShell';
export { CreateRoomForm, type CreateRoomFormProps, type CreateRoomFormSubmit } from './CreateRoomForm';
export { JoinQueueForm, type JoinQueueFormProps } from './JoinQueueForm';
export { QueueWaitingView, type QueueWaitingViewProps } from './QueueWaitingView';
export { RoomWaitingView, type RoomWaitingViewProps } from './RoomWaitingView';

// 共享 UI
export { PlayerList, type PlayerListProps } from './PlayerList';
export { CopyableId, type CopyableIdProps } from './CopyableId';

// 规则编辑器
export { CustomRulesEditor, type CustomRulesEditorProps } from './CustomRulesEditor';
export { BaseModeSelector, type BaseModeSelectorProps } from './BaseModeSelector';
export { RuleFieldCard, type RuleFieldCardProps } from './RuleFieldCard';
export { RuleFieldControl, type RuleFieldControlProps } from './RuleFieldControl';

// Hooks
export { useMatchmakingTips } from './useMatchmakingTips';
export { useCountdown } from './useCountdown';
export { useClipboardCopy } from './useClipboardCopy';
export { useMatchFoundTrigger } from './useMatchFoundTrigger';

// 常量与类型
export {
  GAME_TIPS,
  PLAYER_COUNT_OPTIONS,
  TIP_INTERVAL_MS,
  COPY_FEEDBACK_MS,
  COUNTDOWN_TICK_MS,
} from './matchmakingConstants';
export {
  FIELD_METAS,
  CATEGORY_META,
  CATEGORY_ORDER,
  MODE_LABELS,
  type FieldType,
  type FieldCategory,
  type EnumOpt,
  type FieldMeta,
} from './customRulesConstants';
export type {
  RoomInfo,
  CustomQueueInfo,
  RoomPlayer,
  QueuePlayer,
  MatchmakingMode,
} from './types';
