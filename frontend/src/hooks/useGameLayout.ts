import { useBreakpoint, useIsMobile, useIsTablet, useIsDesktop, type Breakpoint } from './use-mobile'
import { useDoorCardDisplayMode } from './useDoorCardDisplayMode'

/**
 * 卡牌尺寸档位。
 * - xs: 48×68（小屏手牌区）
 * - sm: 56×80（主流手机）
 * - md: 64×88（平板/原 compact）
 * - lg: 96×128（桌面/原默认）
 */
export type CardSize = 'xs' | 'sm' | 'md' | 'lg'

/**
 * 对手面板布局策略。
 * - scroll: 水平横滚（手机竖屏）
 * - grid: 2 列网格（平板）
 * - sidebar: 桌面侧栏（桌面端）
 */
export type OpponentLayout = 'scroll' | 'grid' | 'sidebar'

/**
 * 侧栏显示策略。
 * - hidden: 隐藏
 * - narrow: 缩窄显示
 * - normal: 正常宽度
 * - folded: 折叠为 <details> 兜底
 */
export type SidebarVisibility = 'hidden' | 'narrow' | 'normal' | 'folded'

/**
 * 星图宽高比。
 */
export type StarMapRatio = '1/1' | '4/3' | '16/10'

/**
 * 玩家状态栏默认模式。
 */
export type PanelModeDefault = 'minimal' | 'brief' | 'detailed'

/**
 * 游戏对局界面布局配置。
 * 由当前断点推导，供 OnlineBoard 与子组件共用。
 */
export interface GameLayout {
  /** 当前断点 */
  breakpoint: Breakpoint
  /** 是否为移动端（< 768px） */
  isMobile: boolean
  /** 是否为平板（768 <= width < 1024） */
  isTablet: boolean
  /** 是否为桌面端（>= 1024） */
  isDesktop: boolean
  /** 推荐的卡牌尺寸 */
  cardSize: CardSize
  /** 对手面板布局策略 */
  opponentLayout: OpponentLayout
  /** 左侧栏显示策略 */
  sidebarLeft: SidebarVisibility
  /** 右侧栏显示策略 */
  sidebarRight: SidebarVisibility
  /** 星图宽高比 */
  starMapRatio: StarMapRatio
  /** 玩家状态栏默认模式（用户未手动切换时） */
  panelModeDefault: PanelModeDefault
  /** 估计的手牌区高度（px），供浮动面板定位使用 */
  estimatedHandAreaHeight: number
}

/**
 * 根据断点推导卡牌尺寸。
 * xs (<640) → xs；sm (640-767) → sm；md (768-1023) → md；lg+ (>=1024) → lg
 */
export function getCardSizeForBreakpoint(bp: Breakpoint): CardSize {
  switch (bp) {
    case 'xs':
      return 'xs'
    case 'sm':
      return 'sm'
    case 'md':
      return 'md'
    case 'lg':
    case 'xl':
      return 'lg'
  }
}

/**
 * 根据断点推导对手面板布局。
 * xs/sm → scroll；md → grid；lg+ → sidebar
 */
export function getOpponentLayoutForBreakpoint(bp: Breakpoint): OpponentLayout {
  switch (bp) {
    case 'xs':
    case 'sm':
      return 'scroll'
    case 'md':
      return 'grid'
    case 'lg':
    case 'xl':
      return 'sidebar'
  }
}

/**
 * 根据断点推导星图宽高比。
 * xs/sm → 1/1；md → 4/3；lg+ → 16/10
 */
export function getStarMapRatioForBreakpoint(bp: Breakpoint): StarMapRatio {
  switch (bp) {
    case 'xs':
    case 'sm':
      return '1/1'
    case 'md':
      return '4/3'
    case 'lg':
    case 'xl':
      return '16/10'
  }
}

/**
 * 根据断点推导玩家状态栏默认模式。
 * xs/sm → minimal；md → brief；lg+ → detailed
 */
export function getPanelModeDefaultForBreakpoint(bp: Breakpoint): PanelModeDefault {
  switch (bp) {
    case 'xs':
    case 'sm':
      return 'minimal'
    case 'md':
      return 'brief'
    case 'lg':
    case 'xl':
      return 'detailed'
  }
}

/**
 * 估计的手牌区高度（含行动栏、场上门牌、手牌列表、安全区）。
 * 用于浮动面板（StickyPanel、BroadcastPanel）定位。
 *
 * 注意：此函数不感知 doorCardDisplayMode，移动端的精确估算请使用
 * useGameLayout().estimatedHandAreaHeight（hook 内部按模式分支）。
 */
export function getEstimatedHandAreaHeight(bp: Breakpoint): number {
  switch (bp) {
    case 'xs':
      return 180 // 紧凑：行动栏 44 + 场上门牌 24 + 手牌 88 + safe-bottom 24
    case 'sm':
      return 200
    case 'md':
      return 220
    case 'lg':
    case 'xl':
      return 240
  }
}

/**
 * 移动端门牌展示模式下的手牌区高度估算（仅 xs/sm 生效）。
 * - default：门牌区与手牌区横向同行，图文卡牌（md 64×88），高度 ≈ 188
 *   = 行动栏 44 + 标签 16 + 卡牌 88 + 内边距 16 + safe-bottom 24
 * - simple：门牌区为文字列表（每类一行，列满再开新列），高度更紧凑 ≈ 160
 *   = 行动栏 44 + 标签 16 + 文字 4×16 + 内边距 16 + safe-bottom 24
 */
function getEstimatedHandAreaHeightForMobileMode(mode: 'default' | 'simple'): number {
  // default 模式：门牌卡与手牌卡同尺寸（xs 48×68 或 sm 56×80），较旧 md 64×88 缩小约 8-20px
  // 行动栏 44 + 标签 16 + 卡牌 80(sm) + 内边距 16 + safe-bottom 24 = 180
  // simple 模式：文字列表不受影响，保持 160
  return mode === 'simple' ? 160 : 180
}

/**
 * 游戏对局界面布局 hook。
 * 整合 useBreakpoint 等，返回完整的布局配置，供 OnlineBoard 及其子组件共用。
 *
 * 使用示例：
 * ```tsx
 * const layout = useGameLayout()
 * <OnlinePlayerPanel layout="scroll" />  // layout.opponentLayout
 * <GameCard size={layout.cardSize} />
 * ```
 */
export function useGameLayout(): GameLayout {
  const breakpoint = useBreakpoint()
  const isMobile = useIsMobile()
  const isTablet = useIsTablet()
  const isDesktop = useIsDesktop()
  // 移动端门牌展示模式影响手牌区高度估算（横向同行布局）
  const { mode: doorCardMode } = useDoorCardDisplayMode()

  const cardSize = getCardSizeForBreakpoint(breakpoint)
  const opponentLayout = getOpponentLayoutForBreakpoint(breakpoint)
  const starMapRatio = getStarMapRatioForBreakpoint(breakpoint)
  const panelModeDefault = getPanelModeDefaultForBreakpoint(breakpoint)
  // 移动端按门牌展示模式估算手牌区高度；桌面端沿用断点估算
  const estimatedHandAreaHeight = isMobile
    ? getEstimatedHandAreaHeightForMobileMode(doorCardMode)
    : getEstimatedHandAreaHeight(breakpoint)

  // 左侧栏：桌面端 normal（lg 时缩窄为 narrow 给中央更多空间），其他隐藏
  const sidebarLeft: SidebarVisibility = (() => {
    if (breakpoint === 'xl') return 'normal'
    if (breakpoint === 'lg') return 'narrow'
    return 'hidden'
  })()

  // 右侧栏：xl 显示，lg/md 折叠兜底，其他隐藏
  const sidebarRight: SidebarVisibility = (() => {
    if (breakpoint === 'xl') return 'normal'
    if (breakpoint === 'lg' || breakpoint === 'md') return 'folded'
    return 'hidden'
  })()

  return {
    breakpoint,
    isMobile,
    isTablet,
    isDesktop,
    cardSize,
    opponentLayout,
    sidebarLeft,
    sidebarRight,
    starMapRatio,
    panelModeDefault,
    estimatedHandAreaHeight,
  }
}
