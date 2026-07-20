/**
 * 游戏内运行时文案集中管理（OnlineBoard / Home 等游戏界面）。
 *
 * 设计原则：
 * - 此处承载对局内的静态 UI 标签（回合阶段、断线提示、结束提示等）
 * - 与 rulesText.ts 分离：rulesText 专管规则面板，gameText 专管游戏对局界面
 */

/** 回合阶段 → 中文标签 */
export const TURN_PHASE_LABELS: Record<string, string> = {
  turnBegin: '回合开始',
  strikeMovement: '打击移动',
  drawPhase: '摸牌阶段',
  actionPhase: '行动阶段',
  turnEnd: '回合结束',
  interrupted: '回合中断',
};

/** 断线原因 → 中文说明 */
export const DISCONNECT_REASON_MESSAGES: Record<string, string> = {
  timeout: '连接超时',
  network_error: '网络异常',
  client_closed: '主动断开',
};

/** 重连失败说明 */
export const RECONNECT_FAILED_DESC = '重连超时，该玩家已离线';

/** 加载失败文案 */
export const LOAD_FAILED = {
  title: '加载失败',
  desc: '无法加载游戏状态，请检查网络连接后重试',
  backToLobby: '返回大厅',
  reconnect: '重新连接',
};

/** 加载中文案 */
export const LOADING_TEXT = {
  default: '加载中...',
  room: '正在加入房间...',
  game: '正在加载游戏...',
  unknownMode: '未知模式',
};

/** 游戏结束文案 */
export const GAME_OVER = {
  win: '胜利',
  lose: '失败',
  winDesc: '你在这场黑暗森林博弈中胜出！',
  loseDesc: '你的文明已被消灭...',
  backToLobby: '返回大厅',
};

/** 顶部栏文案 */
export const HEADER = {
  title: '黑暗森林',
  yourTurn: '你的回合',
  turnBadge: (name: string) => `${name} 的回合`,
  panelModeTooltip: '切换玩家状态栏显示模式',
  pendingAction: '等待操作',
  rulesQuick: '规则速查',
};

/** 打击面板提示文案 */
export const STRIKE_TIPS = {
  arrivingWarn: '警告：你所在星系有待生效打击！',
  flyingTitle: '飞行中的打击',
  standby: '待生效',
  owner: '发射者',
  self: '(你)',
  position: '位置',
  target: '目标',
};

/** 快速参考面板文案 */
export const QUICK_REF = {
  title: '快速参考',
  broadcast: '广播',
  broadcastDesc: '暴露位置获取能量',
  strike: '打击',
  strikeDesc: '消耗能量攻击其他文明',
  defense: '防御',
  defenseDesc: '使用防御卡保护自己',
  facility: '设施',
  facilityDesc: '建造设施获取持续收益',
  bothCoop: '双方合作',
  bothCoopDesc: '双方都选择合作 → 各获得',
  disguiseSuccess: '伪装成功',
  disguiseSuccessDesc: '伪装方获得双倍',
  bothDisguise: '双方伪装',
  bothDisguiseDesc: '→ 双方均无收益',
};

/** 被消灭提示文案 */
export const ELIMINATED = {
  title: '你已被消灭',
  desc: '等待对局结束或退出观战',
};
