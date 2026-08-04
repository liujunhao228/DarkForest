import { memo, useCallback, useEffect, useState } from 'react';
import { useOnlineGameStore } from '@/store/onlineGameStore';
import { useStarMapMarkers } from '@/hooks/useStarMapMarkers';
import { useContainerSize } from '@/hooks/useContainerSize';
import { useIsMobile } from '@/hooks/use-mobile';
import { MapPin, Shapes, Check, Trash2, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { GameState } from '@/lib/game/types';
import type { ViewState } from '@/lib/game/viewState';
import { StarMapBackground } from './starmap/StarMapBackground';
import { BroadcastMarkersLayer } from './starmap/BroadcastMarkersLayer';
import { StrikePathsLayer } from './starmap/StrikePathsLayer';
import { StrikeExplosionsLayer } from './starmap/StrikeExplosionsLayer';
import { HighlightLayer } from './starmap/HighlightLayer';
import { MarkingOverlayLayerBackground, MarkingOverlayLayerForeground } from './starmap/MarkingOverlayLayer';
import { StarSystemNodes } from './starmap/StarSystemNodes';
import { StealthStrikeLayer } from './starmap/StealthStrikeLayer';
import { SystemSelect } from './starmap/SystemSelect';
import { SystemMultiSelect } from './starmap/SystemMultiSelect';
import { useMapStore } from '@/store/mapStore';
import type { MarkingTool } from './starmap/types';

interface StarMapProps {
  gameState?: GameState | ViewState;
  onSystemClick?: (systemId: number) => void;
  highlightSystems?: number[];
  strikeMoveTargets?: number[];
  interactiveMode?: boolean;
  replayMode?: boolean;
  replayStateIndex?: number;
  isAutoAdvancing?: boolean;
  /** 星图标记模式：非 null 时点击星系放置图钉（而非触发 onSystemClick），ESC 退出 */
  markingMode?: { playerId: string; color: string } | null;
  /** 退出标记模式回调（由 ESC 键触发） */
  onExitMarkingMode?: () => void;
}

function OnlineStarMapComponent({ gameState: propGameState, onSystemClick, highlightSystems = [], strikeMoveTargets = [], interactiveMode = false, replayMode, replayStateIndex, isAutoAdvancing, markingMode, onExitMarkingMode }: StarMapProps) {
  // 容器仅订阅 gameExists（用于早退 null 渲染）；其余字段全部下沉到子图层各自订阅。
  // 子图层在回放模式下通过 propGameState 切片接收，在线模式下自行从 selector 获取。
  const storeGameExists = useOnlineGameStore(s => s.gameState != null);
  const gameStateExists = !!propGameState || storeGameExists;
  // P1：星系列表从 useMapStore 读取（后端单一数据源），仅在标记模式移动端下拉框内使用
  const systemIds = useMapStore(s => s.nodes.map(n => n.id));

  // 移动端（<768px）：星图保留为纯可视化，星系选择改用下拉框（解决触屏命中困难）
  const isMobile = useIsMobile();
  // 默认工具：桌面端='pin'(单点标记快)，移动端='region'(触屏命中困难，下拉框多选更顺手)；用户可主动切换
  const defaultTool: MarkingTool = isMobile ? 'region' : 'pin';

  // 星图标记：从 useStarMapMarkers 读取图钉/区域列表并获取 addPin/addRegion；标记模式下点击星系放置图钉或加入区域选择集
  const { pins, addPin, regions, addRegion } = useStarMapMarkers();
  const isMarking = markingMode != null;
  // 移动端动作类情境（仅 Dialog 内出现：interactiveMode + onSystemClick + 非 marking）：
  // 根 div 用固定高度替代 h-full，避免 Dialog 内父容器无高度导致 h-full 塌成 auto、
  // SVG 按宽度渲染成大正方形把下拉框推到与 footer 按钮重叠。主界面/标记模式仍用 h-full。
  const compactMobile = isMobile && interactiveMode && !!onSystemClick && !isMarking;

  // 标记工具切换：默认随平台（defaultTool），markingMode 激活时由工具栏切换；切工具时清空区域选择集避免残留
  const [activeTool, setActiveTool] = useState<MarkingTool>(defaultTool);
  // 区域模式选择集：点击星系 toggle 加入/移除，确认后调用 addRegion 并清空
  const [selectedSystems, setSelectedSystems] = useState<Set<number>>(new Set());
  // 区域注释输入 Dialog 状态
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [noteInput, setNoteInput] = useState('');

  // 容器尺寸监听：通过 ResizeObserver 跟踪实际渲染尺寸，< 360 宽或 < 280 高时进入紧凑模式
  // （窄屏下缩字号/缩半径/隐藏能量图标，避免越界与不可点击）
  const { ref: containerRef, width: containerWidth, height: containerHeight } = useContainerSize<HTMLDivElement>();
  const isCompact = containerWidth > 0 && containerHeight > 0 && (containerWidth < 360 || containerHeight < 280);

  // markingMode 关闭时重置工具与选择集，避免下次进入时残留旧状态
  // 采用渲染期间调整 state 的模式（参考 useStarMapMarkers.ts 中 roomId 变化重置），
  // 避免 effect 内同步 setState 触发级联渲染（react-hooks/set-state-in-effect）
  const [prevMarkingMode, setPrevMarkingMode] = useState(markingMode);
  if (markingMode !== prevMarkingMode) {
    setPrevMarkingMode(markingMode);
    if (!markingMode) {
      setActiveTool(defaultTool);
      setSelectedSystems(new Set());
      setNoteDialogOpen(false);
      setNoteInput('');
    }
  }

  // 切换工具：同时清空选择集（pin 与 region 的"点击语义"不同，避免误用旧选择集）
  const switchTool = useCallback((tool: MarkingTool) => {
    setActiveTool((prev) => {
      if (prev === tool) return prev;
      setSelectedSystems(new Set());
      return tool;
    });
  }, []);

  // 清空区域选择集
  const clearSelection = useCallback(() => {
    setSelectedSystems(new Set());
  }, []);

  // 打开注释 Dialog：选择集为空时不允许
  const openNoteDialog = useCallback(() => {
    if (selectedSystems.size === 0) return;
    setNoteInput('');
    setNoteDialogOpen(true);
  }, [selectedSystems]);

  // 确认添加区域：调用 addRegion 后清空选择集，保持在区域模式以便继续标记
  const confirmNote = useCallback(() => {
    if (!markingMode || selectedSystems.size === 0) return;
    const note = noteInput.trim();
    if (!note) return;
    addRegion(Array.from(selectedSystems), markingMode.color, note);
    setSelectedSystems(new Set());
    setNoteInput('');
    setNoteDialogOpen(false);
  }, [markingMode, selectedSystems, noteInput, addRegion]);

  // 取消注释 Dialog：丢弃输入，回到选择状态（仍保留选择集以便再次确认）
  const cancelNoteDialog = useCallback(() => {
    setNoteDialogOpen(false);
    setNoteInput('');
  }, []);

  // 星系点击：标记模式下按工具分支——pin 放图钉 / region toggle 选择集；否则透传 onSystemClick
  const handleSystemClick = useCallback((systemId: number) => {
    if (markingMode) {
      if (activeTool === 'pin') {
        addPin(systemId, markingMode.playerId, markingMode.color);
      } else {
        // 区域模式：toggle 加入/移除选择集（不直接放图钉）
        setSelectedSystems((prev) => {
          const next = new Set(prev);
          if (next.has(systemId)) next.delete(systemId);
          else next.add(systemId);
          return next;
        });
      }
      return;
    }
    onSystemClick?.(systemId);
  }, [markingMode, activeTool, addPin, onSystemClick]);

  // ESC 退出标记模式：仅在标记模式下监听全局 keydown；注释 Dialog 打开时跳过（让 Radix Dialog 先处理 ESC 关闭自身）
  useEffect(() => {
    if (!markingMode) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (noteDialogOpen) return;
        e.preventDefault();
        onExitMarkingMode?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [markingMode, onExitMarkingMode, noteDialogOpen]);

  const activeHighlights = strikeMoveTargets.length > 0 ? strikeMoveTargets : highlightSystems;

  if (!gameStateExists) return null;

  return (
    <>
    <div
      ref={containerRef}
      className={`relative w-full max-w-[800px] max-md:max-w-full mx-auto overflow-hidden
        ${compactMobile ? 'h-[45vh]' : 'h-full'}
        ${isMarking ? 'cursor-crosshair rounded-lg' : ''}`}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" className="w-full h-full block" style={{ filter: 'drop-shadow(0 0 20px rgba(0,0,0,0.5))' }}>
        {/* 1. 静态背景：defs / 底色 / 背景星点 / 星图边 */}
        <StarMapBackground />

        {/* 2. 广播标记：动画 + 可能位置 + 残留标记 */}
        <BroadcastMarkersLayer
          replayMode={replayMode}
          isAutoAdvancing={isAutoAdvancing}
          broadcast={propGameState?.broadcast}
          players={propGameState?.players}
          totalTurn={propGameState?.totalTurn}
        />

        {/* 3. 打击直线路径 */}
        <StrikePathsLayer
          flyingStrikes={propGameState?.flyingStrikes}
          players={propGameState?.players}
        />

        {/* 4. 打击爆炸动画 */}
        <StrikeExplosionsLayer
          replayMode={replayMode}
          replayStateIndex={replayStateIndex}
          isAutoAdvancing={isAutoAdvancing}
          flyingStrikes={propGameState?.flyingStrikes}
          players={propGameState?.players}
        />

        {/* 5. 高亮光晕 */}
        <HighlightLayer activeHighlights={activeHighlights} />

        {/* 6. 区域高亮圆（在星系之下） */}
        <MarkingOverlayLayerBackground regions={regions} />

        {/* 7. 星系节点（含玩家 token / 名牌 / 打击标记） */}
        <StarSystemNodes
          isCompact={isCompact}
          isMarking={isMarking}
          activeTool={activeTool}
          activeHighlights={activeHighlights}
          strikeMoveTargets={strikeMoveTargets}
          interactiveMode={interactiveMode}
          clickEnabled={!isMobile}
          onSystemClick={handleSystemClick}
          players={propGameState?.players}
          starEffects={propGameState?.starEffects}
          destroyedStars={propGameState?.destroyedStars}
          flyingStrikes={propGameState?.flyingStrikes}
          totalTurn={propGameState?.totalTurn}
        />

        {/* 8. 隐逐跳打击标记（独立图层，与 StarSystemNodes 同源 flyingStrikes）
            原代码中 incomingStealthHere 渲染在星系节点 map 内（与星系 token 同 z 层），
            本图层置于 StarSystemNodes 之后以保持原视觉顺序：在星系 token 之上、图钉之下 */}
        <StealthStrikeLayer
          flyingStrikes={propGameState?.flyingStrikes}
          players={propGameState?.players}
        />

        {/* 9. 图钉 + 区域注释文字 + 选择集 ring（最上层） */}
        <MarkingOverlayLayerForeground
          pins={pins}
          regions={regions}
          selectedSystems={selectedSystems}
          isMarking={isMarking}
          activeTool={activeTool}
        />
      </svg>

      {/* 玩家名牌已搬入 SVG（见 StarSystemNodes 内的 <foreignObject>），不再用 HTML 浮层避免越界 */}

      {/* 标记模式工具栏：底部居中（贴底而非贴顶，避免被状态栏/header 遮挡），含图钉/区域工具切换 + 提示文字 + 区域模式下的选择集操作按钮 */}
      {isMarking && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-950/90 border border-amber-500/60 text-amber-300 text-[11px] font-medium shadow-lg">
          {/* 工具切换：图钉 / 区域 互斥 */}
          <button
            type="button"
            onClick={() => switchTool('pin')}
            title="图钉模式：单点标记"
            className={`flex items-center justify-center rounded min-h-[28px] w-7 px-1.5 transition-colors ${activeTool === 'pin' ? 'bg-amber-500/30 text-amber-100 ring-1 ring-amber-400/50' : 'text-amber-400 hover:bg-amber-500/20'}`}
          >
            <MapPin className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={() => switchTool('region')}
            title="区域模式：多选星系 + 注释"
            className={`flex items-center justify-center rounded min-h-[28px] w-7 px-1.5 transition-colors ${activeTool === 'region' ? 'bg-amber-500/30 text-amber-100 ring-1 ring-amber-400/50' : 'text-amber-400 hover:bg-amber-500/20'}`}
          >
            <Shapes className="w-3 h-3" />
          </button>

          <span className="text-amber-500/40 hidden md:inline">|</span>

          <span className="text-[10px] whitespace-nowrap hidden md:inline">
            {activeTool === 'pin'
              ? '图钉模式：点击星系放置图钉'
              : '区域模式：点击星系选择区域，确认后添加注释'}
          </span>

          {/* 移动端标记模式：星图不可点击，改用下拉框。
              handleSystemClick 已按 activeTool 分支处理（pin→addPin / region→toggle 选择集），
              故 pin 用 onSelect、region 用 onToggle 都接同一 handler，无需新 handler。 */}
          {isMobile && activeTool === 'pin' && (
            <div className="md:hidden">
              <SystemSelect systems={systemIds} onSelect={handleSystemClick} placeholder="选择星系放置图钉" />
            </div>
          )}
          {isMobile && activeTool === 'region' && (
            <div className="md:hidden">
              <SystemMultiSelect systems={systemIds} selectedSystems={selectedSystems} onToggle={handleSystemClick} placeholder="选择星系加入区域" />
            </div>
          )}

          {/* 区域模式额外操作：已选数量 + 清空 + 确认 */}
          {activeTool === 'region' && (
            <>
              <span className="text-amber-500/40">|</span>
              <span className="text-[10px] tabular-nums">已选 {selectedSystems.size}</span>
              <button
                type="button"
                onClick={clearSelection}
                disabled={selectedSystems.size === 0}
                title="清空选择"
                className="flex items-center justify-center rounded min-h-[28px] w-7 px-1.5 text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <Trash2 className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={openNoteDialog}
                disabled={selectedSystems.size === 0}
                title="确认区域并添加注释"
                className="flex items-center gap-1 rounded min-h-[28px] px-2 py-1 bg-amber-500/30 text-amber-100 ring-1 ring-amber-400/50 hover:bg-amber-500/40 transition-colors disabled:opacity-40 disabled:hover:bg-amber-500/30 disabled:ring-0 disabled:cursor-not-allowed"
              >
                <Check className="w-3 h-3" /> 确认
              </button>
            </>
          )}

          <span className="text-amber-500/40">|</span>
          <button
            type="button"
            onClick={() => onExitMarkingMode?.()}
            title="退出标记模式"
            className="flex items-center justify-center gap-1 rounded min-h-[28px] px-2 py-1 text-amber-300 hover:bg-amber-500/20 transition-colors"
          >
            <X className="w-3.5 h-3.5" /> 退出
          </button>
        </div>
      )}

      {/* 区域注释输入 Dialog：确认选择集后弹出，输入注释调用 addRegion */}
      <Dialog open={noteDialogOpen} onOpenChange={(open) => { if (!open) cancelNoteDialog(); }}>
        <DialogContent showCloseButton={false} className="max-w-md">
          <DialogHeader>
            <DialogTitle>添加区域注释</DialogTitle>
            <DialogDescription>
              已选择 {selectedSystems.size} 个星系，输入注释后将在星图上显示半透明高亮与文字。按 Ctrl/⌘ + Enter 快速确认。
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
            placeholder="例如：玩家可能藏身于此区域"
            autoFocus
            className="w-full min-h-[80px] rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500/40 resize-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                confirmNote();
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={cancelNoteDialog}>取消</Button>
            <Button onClick={confirmNote} disabled={!noteInput.trim()}>确认添加</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    {/* 移动端动作类情境：下拉框放在根 div 外，避免被 overflow-hidden / h-full 裁切。
        标记工具栏（pin/region 下拉框）在根 div 内用 absolute 定位，不受 overflow-hidden 影响，无需移出。
        4 个 Dialog（打击目标/广播目标/打击移动/落空重定向）均通过此分支渲染下拉框，调用方零改动。 */}
    {!isMarking && isMobile && interactiveMode && onSystemClick && (
      <div className="mt-2">
        <SystemSelect systems={activeHighlights} onSelect={onSystemClick} placeholder="选择星系" />
      </div>
    )}
    </>
  );
}

export const OnlineStarMap = memo(OnlineStarMapComponent);
