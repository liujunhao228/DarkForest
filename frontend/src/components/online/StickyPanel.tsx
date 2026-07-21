import { useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Rnd } from 'react-rnd';
import { Button } from '@/components/ui/button';
import { useStickyLayout, type StickyKind } from '@/hooks/useStickyLayout';
import { useIsMobile } from '@/hooks/use-mobile';
import { Eraser, Lock, Unlock, X } from 'lucide-react';

/** 主题色：amber 用于星图标记，cyan 用于笔记本 */
type Accent = 'amber' | 'cyan';

/** 主题色样式映射：标题栏渐变 / 文字色 / badge / 折叠态按钮 */
const ACCENT_STYLES: Record<
  Accent,
  {
    titleText: string;
    titleGradient: string;
    badge: string;
    foldedButton: string;
    foldedIcon: string;
  }
> = {
  amber: {
    titleText: 'text-amber-400',
    titleGradient: 'from-amber-900/30 to-slate-800/30',
    badge: 'bg-amber-500',
    foldedButton: 'text-amber-400 hover:text-amber-300',
    foldedIcon: 'text-amber-400 hover:text-amber-300',
  },
  cyan: {
    titleText: 'text-cyan-400',
    titleGradient: 'from-cyan-900/30 to-slate-800/30',
    badge: 'bg-cyan-500',
    foldedButton: 'text-cyan-400 hover:text-cyan-300',
    foldedIcon: 'text-cyan-400 hover:text-cyan-300',
  },
};

/**
 * 折叠态小圆按钮位置：notepad 在最右，marker 错开一位。
 * 移动端上移至 bottom-24 避开手牌操作区，桌面端保持 bottom-4。
 */
function getFoldedPositionClass(kind: StickyKind, isMobile: boolean): string {
  if (isMobile) {
    return kind === 'notepad'
      ? 'fixed bottom-24 right-4 z-30'
      : 'fixed bottom-24 right-16 z-30';
  }
  return kind === 'notepad'
    ? 'fixed bottom-4 right-4 z-30'
    : 'fixed bottom-4 right-20 z-30';
}

/** 便签默认最小尺寸 */
const MIN_WIDTH = 260;
const MIN_HEIGHT = 200;

export interface StickyPanelProps {
  /** 便签种类（决定折叠态位置与持久化 key） */
  kind: StickyKind;
  /** 主题色 */
  accent: Accent;
  /** 标题文字 */
  title: string;
  /** 标题与折叠态按钮中的图标 */
  icon: ReactNode;
  /** 条目数（显示在标题栏与折叠态 badge；为 0 时不显示 badge） */
  count?: number;
  /** 默认位置（首次进入或无持久化时使用） */
  defaultPosition: { x: number; y: number };
  /** 默认尺寸 */
  defaultSize: { width: number; height: number };
  /** 清空全部回调（不传则不渲染该按钮） */
  onClearAll?: () => void;
  /** 清空全部按钮禁用态 */
  clearDisabled?: boolean;
  /** 面板主体内容（标题栏下方的滚动区域） */
  children: ReactNode;
}

/**
 * 通用便签面板：可拖动、可自由拉伸、可锁定（固定位置与尺寸）、可折叠。
 * - 拖动：仅标题栏可拖（dragHandleClassName="sticky-title-bar"）
 * - 拉伸：8 向 resize handle，锁定后禁用
 * - 锁定：标题栏锁定按钮 toggle，锁定后 disableDragging + enableResizing=false
 * - 折叠：折叠态渲染小圆按钮（位置由 kind 决定），展开态渲染 Rnd 面板
 * - 持久化：位置/尺寸/锁定/折叠状态通过 useStickyLayout 按 roomId+kind 隔离存储
 *
 * 使用非受控模式（`default` prop）让 Rnd 自管位置/尺寸，
 * 仅在 onDragStop/onResizeStop 时持久化，避免受控模式与 Rnd 内部 state 的同步坑。
 * 折叠→展开时 Rnd 重新挂载，从持久化的 layout 恢复初始位置/尺寸。
 */
export function StickyPanel({
  kind,
  accent,
  title,
  icon,
  count,
  defaultPosition,
  defaultSize,
  onClearAll,
  clearDisabled,
  children,
}: StickyPanelProps) {
  // 默认布局：折叠态默认为 true（首次进入不展开便签，避免遮挡）
  const defaults = useMemo(
    () => ({
      x: defaultPosition.x,
      y: defaultPosition.y,
      width: defaultSize.width,
      height: defaultSize.height,
      locked: false,
      collapsed: true,
    }),
    [defaultPosition.x, defaultPosition.y, defaultSize.width, defaultSize.height],
  );

  const { layout, setLayout } = useStickyLayout(kind, defaults);
  const styles = ACCENT_STYLES[accent];
  const isMobile = useIsMobile();
  const foldedClass = getFoldedPositionClass(kind, isMobile);

  // 锁定 toggle：切换后持久化，Rnd 通过 disableDragging/enableResizing 响应
  const toggleLock = useCallback(() => {
    setLayout({ locked: !layout.locked });
  }, [layout.locked, setLayout]);

  // 折叠/展开：直接持久化到 layout，下次进入页面恢复
  const handleCollapse = useCallback(() => {
    setLayout({ collapsed: true });
  }, [setLayout]);

  const handleExpand = useCallback(() => {
    setLayout({ collapsed: false });
  }, [setLayout]);

  // 拖动结束：持久化新位置
  const handleDragStop = useCallback(
    (_e: unknown, d: { x: number; y: number }) => {
      setLayout({ x: d.x, y: d.y });
    },
    [setLayout],
  );

  // 拉伸结束：持久化新尺寸与位置（resize 可能从左/上拉伸，position 也会变）
  const handleResizeStop = useCallback(
    (
      _e: unknown,
      _dir: unknown,
      ref: HTMLElement,
      _delta: unknown,
      pos: { x: number; y: number },
    ) => {
      setLayout({
        width: ref.offsetWidth,
        height: ref.offsetHeight,
        x: pos.x,
        y: pos.y,
      });
    },
    [setLayout],
  );

  const badgeCount =
    count !== undefined && count > 99 ? '99+' : count !== undefined ? String(count) : '';

  // 折叠态：渲染小圆按钮（与现有视觉保持一致）
  if (layout.collapsed) {
    return (
      <button
        type="button"
        onClick={handleExpand}
        className={`${foldedClass} h-12 w-12 rounded-full bg-slate-800/95 backdrop-blur-sm border border-slate-700 shadow-lg flex items-center justify-center ${styles.foldedButton} hover:bg-slate-700 transition-colors`}
        aria-label={`展开${title}（共 ${count ?? 0} 条记录）`}
      >
        <span className="[&>svg]:w-5 [&>svg]:h-5">{icon}</span>
        {count !== undefined && count > 0 && (
          <span
            className={`absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full ${styles.badge} text-white text-[10px] font-bold flex items-center justify-center border border-slate-900`}
          >
            {badgeCount}
          </span>
        )}
      </button>
    );
  }

  // 移动端展开态：底部抽屉（不使用 Rnd，避免触屏拖拽与页面滚动冲突）
  if (isMobile) {
    return (
      <div className="fixed inset-x-0 bottom-0 z-30 max-h-[60vh] flex flex-col bg-slate-900/95 backdrop-blur-sm border-t border-slate-700 rounded-t-xl shadow-2xl safe-bottom">
        <div className={`flex-shrink-0 flex items-center justify-between px-3 py-3 min-h-[40px] bg-gradient-to-r ${styles.titleGradient} border-b border-slate-700/50`}>
          <div className={`flex items-center gap-1.5 ${styles.titleText}`}>
            <span className="[&>svg]:w-4 [&>svg]:h-4">{icon}</span>
            <span className="font-bold text-sm">{title}</span>
            {count !== undefined && count > 0 && (
              <span className="text-[10px] text-slate-400">({count})</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {onClearAll && (
              <Button variant="ghost" size="sm" onClick={onClearAll} disabled={clearDisabled} className="h-8 px-2 text-[11px] text-slate-400 hover:text-red-400 hover:bg-red-950/30 disabled:opacity-40">
                <Eraser className="w-3 h-3 mr-1" />清空全部
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={handleCollapse} className="h-8 w-8 p-0 text-slate-400 hover:text-white hover:bg-slate-800" aria-label={`折叠${title}`}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-2">{children}</div>
      </div>
    );
  }

  // 展开态：Rnd 可拖动可拉伸面板
  return (
    <Rnd
      default={{
        x: layout.x,
        y: layout.y,
        width: layout.width,
        height: layout.height,
      }}
      minWidth={MIN_WIDTH}
      minHeight={MIN_HEIGHT}
      bounds="window"
      dragHandleClassName="sticky-title-bar"
      disableDragging={layout.locked}
      enableResizing={!layout.locked}
      onDragStop={handleDragStop}
      onResizeStop={handleResizeStop}
      className="z-30"
    >
      <div className="flex flex-col h-full w-full bg-slate-900/95 backdrop-blur-sm border border-slate-700 rounded-xl shadow-2xl overflow-hidden">
        {/* 标题栏：dragHandleClassName 指定此区域为拖拽手柄 */}
        <div
          className={`sticky-title-bar flex-shrink-0 flex items-center justify-between px-3 py-3 min-h-[40px] bg-gradient-to-r ${styles.titleGradient} border-b border-slate-700/50 ${
            layout.locked ? 'cursor-default' : 'cursor-move'
          }`}
        >
          <div className={`flex items-center gap-1.5 ${styles.titleText}`}>
            <span className="[&>svg]:w-4 [&>svg]:h-4">{icon}</span>
            <span className="font-bold text-sm">{title}</span>
            {count !== undefined && count > 0 && (
              <span className="text-[10px] text-slate-400">({count})</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {onClearAll && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onClearAll}
                disabled={clearDisabled}
                className="h-8 px-2 text-[11px] text-slate-400 hover:text-red-400 hover:bg-red-950/30 disabled:opacity-40"
              >
                <Eraser className="w-3 h-3 mr-1" />清空全部
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleLock}
              className={`h-8 w-8 p-0 ${
                layout.locked
                  ? 'text-amber-400 hover:text-amber-300 hover:bg-slate-800'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
              aria-label={layout.locked ? '解锁位置与尺寸' : '锁定位置与尺寸'}
              title={layout.locked ? '点击解锁位置与尺寸' : '点击锁定位置与尺寸'}
            >
              {layout.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCollapse}
              className="h-8 w-8 p-0 text-slate-400 hover:text-white hover:bg-slate-800"
              aria-label={`折叠${title}`}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* 内容区：滚动容器，调用方提供条目列表 */}
        <div className="flex-1 overflow-y-auto p-2 space-y-2">{children}</div>
      </div>
    </Rnd>
  );
}
