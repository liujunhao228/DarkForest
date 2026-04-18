// ============================
// 《代号：黑暗森林》游戏类型定义
// ============================

/** 卡牌类型 */
export type CardType = 'broadcast' | 'strike' | 'defense' | 'facility';

/** 广播子类型 */
export type BroadcastSubtype = 'cooperation' | 'disguise';

/** 游戏阶段 */
export type GamePhase = 'setup' | 'playing' | 'gameOver';

/** 回合阶段 - 严格的状态机枚举 */
export type TurnPhase =
  | 'turnBegin'        // 回合开始: 获得基础能量、设施产出
  | 'strikeMovement'   // 打击移动: 移动飞行中的打击牌
  | 'drawPhase'        // 摸牌阶段: 补牌至4张
  | 'actionPhase'      // 行动阶段: 打牌/换牌
  | 'turnEnd'          // 回合结束: 清理当前玩家状态,准备推进到下一玩家
  | 'interrupted';     // 中断状态: 等待广播响应等跨回合交互

/** 玩家颜色标识 */
export type PlayerColor = 'red' | 'blue' | 'green' | 'amber' | 'purple';

/** 卡牌定义（从 YAML 解析） */
export interface CardDef {
  id: string;
  name: string;
  type: CardType;
  energy: number;
  quantity: number;
  description: string;
  image: string;
  extended: Record<string, number | string | boolean>;
}

/** 手牌实例 */
export interface Card {
  uid: string;       // 唯一实例 ID
  defId: string;     // 对应 CardDef.id
  name: string;
  type: CardType;
  energy: number;
  description: string;
  image: string;
  // 广播特有
  subtype?: BroadcastSubtype;
  range?: number;
  // 打击特有
  level?: number;
  speed?: number;
  effect?: string;
  // 防御特有
  protectionLevel?: number;
  // 设施特有
  energyPerTurn?: number;
  ability?: string;
}

/** 玩家信息 */
export interface Player {
  id: string;
  name: string;
  color: PlayerColor;
  position: number;       // 所在星系 (1-9)
  energy: number;
  hand: Card[];           // 手牌
  faceUpCards: Card[];    // 场上门牌（防御/设施）
  eliminated: boolean;
  broadcastHistory: { systemId: number; turn: number }[]; // 广播记录
}

/** 飞行中的打击牌 */
export interface FlyingStrike {
  uid: string;           // 对应 Card.uid
  defId: string;         // 对应 Card.defId（用于识别光粒/湮灭）
  ownerId: string;       // 发射者
  position: number;      // 当前在星系
  targetSystem: number;  // 目标星系
  targetPlayerId?: string; // 指定目标玩家（科技锁死专用）
  level: number;         // 打击等级
  speed: number;         // 移动速度
  effect?: string;       // 特殊效果
  strikeName: string;
  arrived: boolean;      // 是否已到达目标（用于延迟宣布）
}

/** 广播状态 */
export interface BroadcastState {
  active: boolean;
  broadcasterId: string;
  cardUid: string;       // 打出的广播牌
  card: Card;
  targetSystem: number;
  range: number;
  subtype: BroadcastSubtype;
  responses: BroadcastResponse[];
  phase: 'waiting' | 'select' | 'reveal' | 'resolve' | 'done';
  selectedResponderId?: string;
  responseCard?: Card;   // 被选中回应者的牌
}

export interface BroadcastResponse {
  playerId: string;
  playerName: string;
  canRespond: boolean;
  mustRespond: boolean;  // 被广播目标星系的玩家必须回应
  responded: boolean;
  agreed: boolean;       // 是否选择回应
  responseCard?: Card;
}

/** 游戏日志条目 */
export interface LogEntry {
  id: string;
  turn: number;
  phase: string;
  message: string;
  type: 'info' | 'action' | 'combat' | 'system' | 'broadcast';
}

/** 完整游戏状态 */
export interface GameState {
  // 游戏配置
  phase: GamePhase;
  totalTurn: number;
  playerCount: number;

  // 玩家
  players: Player[];
  currentPlayerIndex: number;
  localPlayerId: string;

  // 牌堆
  drawPile: Card[];
  discardPile: Card[];

  // 飞行中的打击
  flyingStrikes: FlyingStrike[];

  // 广播状态
  broadcast: BroadcastState | null;

  // 回合阶段
  turnPhase: TurnPhase;

  // 需要玩家操作
  pendingAction: PendingAction | null;

  // 日志
  logs: LogEntry[];

  // 被毁灭的恒星（光粒/湮灭打击效果）
  destroyedStars: number[];

  // 胜利者
  winner: string | null;

  // 动画控制
  isProcessing: boolean;

  // 状态版本号（用于在线同步）
  version?: number;
}

/** 待处理操作 */
export type PendingAction =
  | { type: 'strikeMove'; strikeUid: string; validMoves: number[] }
  | { type: 'broadcastResponse'; broadcastState: BroadcastState }
  | { type: 'broadcastSelect'; responders: string[] }
  | { type: 'announceStrike'; strikeUid: string; targetSystem: number; targetPlayerIds: string[] }
  | { type: 'lightspeedEscape'; playerId: string }
  | { type: 'recycleCard'; cardUid: string; refundEnergy: number }
  | { type: 'selectTargetSystem'; card: Card; validTargets: number[] }
  | { type: 'selectBroadcastSystem'; card: Card; validTargets: number[] };

/** 结算结果 */
export interface BroadcastResult {
  broadcasterSubtype: BroadcastSubtype;
  responderSubtype: BroadcastSubtype;
  broadcasterEnergy: number;
  responderEnergy: number;
}

/** 星系节点 */
export interface StarNode {
  id: number;
  x: number;
  y: number;
  name: string;
}

/** 星系间连线 */
export interface StarEdge {
  from: number;
  to: number;
}

/** 游戏初始化配置 */
export interface InitConfig {
  playerCount: number;
  humanName: string;
}
