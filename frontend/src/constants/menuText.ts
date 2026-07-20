/**
 * 主菜单 UI 文案集中管理（MainMenu 组件）。
 *
 * 设计原则：仅承载静态 UI 文案；规则文案由后端 API 运行时拉取。
 */

/** 默认文明名 */
export const DEFAULT_DISPLAY_NAME = '地球文明';

/** 顶部标题与引言 */
export const MENU_TITLE = {
  main: '代号：黑暗森林',
  quote: '宇宙就是一座黑暗森林，每个文明都是带枪的猎人',
  quoteAuthor: '— 刘慈欣《三体》',
};

/** 连接状态 */
export const CONNECTION = {
  connected: '已连接',
  disconnected: '未连接',
  connecting: '连接中...',
};

/** 文明身份卡片 */
export const IDENTITY_CARD = {
  title: '文明身份',
  nameLabel: '文明名称',
  namePlaceholder: '输入你的文明名称',
  enterBtn: '进入黑暗森林',
};

/** 在线对战卡片 */
export const ONLINE_CARD = {
  title: '在线对战',
  desc: '随机匹配或创建房间，进入黑暗森林战场',
  quickMatchBtn: '快速匹配',
  createJoinBtn: '创建/加入房间',
};

/** 历史回放卡片 */
export const REPLAY_CARD = {
  title: '历史回放',
  viewHistoryBtn: '查看历史对局',
  shareLabel: '通过分享链接观看',
  sharePlaceholder: '粘贴分享链接或回放 ID',
  watchBtn: '观看',
};

/** 规则按钮默认标签 */
export const RULES_BTN_LABEL = '游戏规则';

/** 底部副标题 */
export const MENU_SUBTITLE = {
  features: '广播博弈 | 打击清理 | 防御生存 | 设施发展',
  tagline: '隐藏自己，做好清理 — 最后的文明获胜',
};
