import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  ArrowLeft,
  Eye,
  Orbit,
  Zap,
  BookOpen,
  Radio,
  Shield,
  Factory,
  Trophy,
  Share2,
  Check,
} from 'lucide-react';
import { getReplay } from '@/api/replay';
import { ReplayPlayerEngine, type ReplayPlayerState } from '@/lib/replay';
import { buildReplayShareUrl } from '@/lib/replayShare';
import { PLAYER_COLORS } from '@/lib/game/playerColors';
import { STRIKE_SHAPES, getOwnerColor } from '@/lib/game/strikeStyles';
import { OnlineStarMap } from './OnlineStarMap';
import { OnlinePlayerPanel } from './OnlinePlayerPanel';
import { OnlineGameLog } from './OnlineGameLog';
import { StrikeShapeIcon } from './StrikeShapeIcon';

interface ReplayPlayerProps {
  replayId: string;
  onClose: () => void;
}

const PLAYBACK_SPEEDS = [0.5, 1, 2, 4];

export function ReplayPlayer({ replayId, onClose }: ReplayPlayerProps) {
  // 引擎实例通过 useRef 持有，避免单例跨组件实例污染；懒初始化仅创建一次
  const engineRef = useRef<ReplayPlayerEngine | null>(null);
  if (engineRef.current === null) {
    engineRef.current = new ReplayPlayerEngine();
  }

  const [playerState, setPlayerState] = useState<ReplayPlayerState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playerNames, setPlayerNames] = useState<Record<string, string>>({});
  const [playerColors, setPlayerColors] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const [isAutoAdvancing, setIsAutoAdvancing] = useState(false);
  const prevIndexRef = useRef(0);
  // 自适应布局: 768px 以下视为移动端,用于 JS 端条件渲染(玩家视角切换按钮组收纳为 Select 下拉)
  const isMobile = useIsMobile();

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(buildReplayShareUrl(replayId));
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch (err) {
      console.error('复制分享链接失败:', err);
    }
  };

  // 单个 Effect 统一管理订阅 + 加载 + 清理，避免双 Effect 生命周期错配
  useEffect(() => {
    const engine = engineRef.current!;
    const unsubscribe = engine.onStateChange((state) => {
      const newIndex = state.currentStateIndex;
      // 自动播放前进（index 单步递增）才视为 autoAdvancing，seek 跳转则不算
      const auto = state.isPlaying && newIndex === prevIndexRef.current + 1;
      setIsAutoAdvancing(auto);
      prevIndexRef.current = newIndex;
      setPlayerState(state);
    });

    let cancelled = false;
    // 数据加载副作用：setState 在异步边界后执行，setLoading(true) 同步调用属必要的重置场景
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    void (async () => {
      try {
        const replayData = await getReplay(replayId);
        if (cancelled) return;

        const nameMap: Record<string, string> = {};
        const colorMap: Record<string, string> = {};
        replayData.playerIds.forEach((id, idx) => {
          nameMap[id] = replayData.playerNames[idx] || `Player ${idx + 1}`;
          colorMap[id] = PLAYER_COLORS[idx % PLAYER_COLORS.length];
        });
        setPlayerNames(nameMap);
        setPlayerColors(colorMap);

        await engine.loadReplay(replayData);
        if (cancelled) return;
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : '加载回放失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe();
      engine.destroy();
    };
  }, [replayId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">加载回放数据...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <p className="text-destructive mb-4">{error}</p>
          <Button onClick={onClose}>返回</Button>
        </div>
      </div>
    );
  }

  if (!playerState || !playerState.currentViewState) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-muted-foreground">暂无回放数据</p>
      </div>
    );
  }

  const viewState = playerState.currentViewState;
  const engine = engineRef.current!;
  const playerIds = Object.keys(playerNames);
  // 从 playerState 派生，避免渲染期读取可变单例
  const hasPrev = playerState.currentStateIndex > 0;
  const hasNext = playerState.currentStateIndex < playerState.totalStates - 1;
  const isObserver = playerState.viewerPlayerId === '';

  // 改造 2: 提取右侧栏内容为内部函数,在桌面端 xl:block 与移动端 xl:hidden 折叠兜底两处复用
  const renderFlyingStrikes = () => {
    if (!viewState.flyingStrikes || viewState.flyingStrikes.length === 0) return null;
    return (
      <div className="bg-red-950/20 border border-red-900/30 rounded-lg p-2 max-h-40 overflow-y-auto">
        <div className="text-xs font-bold text-red-400 mb-2 flex items-center gap-1">
          <Zap className="w-3.5 h-3.5" /> 飞行中的打击
        </div>
        {viewState.flyingStrikes.map((strike) => {
          const owner = viewState.players.find((p) => p.id === strike.ownerId);
          const ownerColor = getOwnerColor(strike.ownerId, viewState.players);
          const shape = STRIKE_SHAPES[strike.defId] ?? 'circle';
          return (
            <div
              key={strike.uid}
              className="text-[10px] text-slate-400 mb-1 p-1.5 bg-red-950/20 rounded"
              style={{ borderLeft: `2px solid ${ownerColor}` }}
            >
              <div className="text-red-300 font-bold flex items-center gap-1">
                <StrikeShapeIcon shape={shape} color={ownerColor} className="w-3 h-3 flex-shrink-0" />
                {strike.strikeName} (Lv.{strike.level})
                {strike.arrived && ' · 待命'}
              </div>
              <div>发射者: {owner?.name}</div>
              <div>
                位置: {strike.position} → 目标: {strike.targetSystem}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderQuickRef = () => (
    <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-3">
      <div className="text-sm font-bold text-slate-400 mb-2 flex items-center gap-1.5">
        <BookOpen className="w-4 h-4" /> 快速参考
      </div>
      <div className="text-[11px] text-slate-500 space-y-1.5 leading-relaxed">
        <p className="flex items-center gap-1.5">
          <Radio className="w-3 h-3 text-cyan-400" />
          <span className="text-slate-300">广播:</span> 博弈获取能量
        </p>
        <p className="flex items-center gap-1.5">
          <Zap className="w-3 h-3 text-red-400" />
          <span className="text-slate-300">打击:</span> 清理其他文明
        </p>
        <p className="flex items-center gap-1.5">
          <Shield className="w-3 h-3 text-blue-400" />
          <span className="text-slate-300">防御:</span> 抵御打击攻击
        </p>
        <p className="flex items-center gap-1.5">
          <Factory className="w-3 h-3 text-amber-400" />
          <span className="text-slate-300">设施:</span> 能量产出/特殊能力
        </p>
        <div className="border-t border-slate-800/50 pt-2 mt-2">
          <p className="text-slate-400 flex items-center gap-1.5">
            <span className="text-emerald-400 font-medium">双方合作:</span> 各+3
            <Zap className="w-3 h-3" />
          </p>
          <p className="text-slate-400 flex items-center gap-1.5">
            <span className="text-emerald-400 font-medium">伪装成功:</span> +5
            <Zap className="w-3 h-3" />
          </p>
          <p className="text-slate-400 flex items-center gap-1.5">
            <span className="text-slate-500 font-medium">双方伪装:</span> 无收益
          </p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="h-dvh flex flex-col bg-gradient-to-b from-slate-950 via-[#0a0e1a] to-slate-950 text-white overflow-hidden">
      <header className="flex-shrink-0 flex items-center justify-between px-4 py-2 bg-slate-950/80 border-b border-slate-800/50">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent flex items-center gap-2">
            <Orbit className="w-4 h-4 text-purple-400" /> 黑暗森林 - 回放
          </h1>
          <Badge variant="outline" className="text-[10px] sm:text-[11px] px-1.5 py-0 border-slate-700 text-slate-400">
            回合 {viewState.totalTurn}
          </Badge>
          <Badge variant="outline" className="text-[10px] sm:text-[11px] px-1.5 py-0 border-slate-700 text-slate-400">
            {viewState.turnPhase}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleShare}
            title="复制分享链接"
            className="h-8 w-8 p-0 hover:bg-cyan-950/30 hover:text-cyan-400"
          >
            {copied ? <Check className="w-4 h-4 text-green-400" /> : <Share2 className="w-4 h-4" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-8 w-8 p-0 hover:bg-red-950/30 hover:text-red-400"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </div>
      </header>

      <div className="flex-shrink-0 px-4 py-1.5 bg-slate-900/50 border-b border-slate-800/30">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400 font-mono">
              状态: {playerState.currentStateIndex + 1} / {playerState.totalStates}
            </span>
            <span className="text-xs text-slate-300">
              当前玩家: {viewState.players[viewState.currentPlayerIndex]?.name || '未知'}
            </span>
            {viewState.winner && (
              <span className="text-xs text-emerald-400 flex items-center gap-1">
                <Trophy className="w-3.5 h-3.5" />
                胜利者: {playerNames[viewState.winner] || '未知'}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-9 text-xs px-2"
              onClick={() => engine.togglePlay()}
            >
              {playerState.isPlaying ? (
                <>
                  <Pause className="h-4 w-4 mr-1" /> 暂停
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-1" /> 播放
                </>
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={() => engine.seekToState(0)}
              title="重置"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={() => engine.prevState()}
              disabled={!hasPrev}
              title="上一步"
            >
              <SkipBack className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={() => engine.nextState()}
              disabled={!hasNext}
              title="下一步"
            >
              <SkipForward className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex-1 min-w-[120px]">
            <Slider
              value={[playerState.currentStateIndex]}
              min={0}
              max={Math.max(0, playerState.totalStates - 1)}
              step={1}
              onValueChange={(value) => engine.seekToState(value[0])}
            />
          </div>

          <Select
            value={playerState.playbackSpeed.toString()}
            onValueChange={(value) => engine.setSpeed(parseFloat(value))}
          >
            <SelectTrigger className="w-20 h-7 text-xs">
              <SelectValue placeholder="速度" />
            </SelectTrigger>
            <SelectContent>
              {PLAYBACK_SPEEDS.map((speed) => (
                <SelectItem key={speed} value={speed.toString()} className="text-xs">
                  {speed}x
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* 改造 3: 移动端用 Select 下拉替代按钮组,避免在窄屏换行错乱 */}
          {!isMobile ? (
            <div className="flex items-center gap-1">
              <Button
                variant={isObserver ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs px-2"
                onClick={() => engine.setViewerPlayer('')}
              >
                <Eye className="h-3.5 w-3.5 mr-1" />
                全知
              </Button>
              {playerIds.map((playerId) => {
                const isActive = viewState._viewMeta.viewerId === playerId;
                return (
                  <Button
                    key={playerId}
                    variant={isActive ? 'default' : 'outline'}
                    size="sm"
                    className="h-7 text-xs px-2"
                    onClick={() => engine.setViewerPlayer(playerId)}
                    style={{
                      borderColor: playerColors[playerId],
                      color: isActive ? '#fff' : playerColors[playerId],
                      backgroundColor: isActive ? playerColors[playerId] : 'transparent',
                    }}
                  >
                    {playerNames[playerId]}
                    {viewState.winner === playerId && ' 🏆'}
                  </Button>
                );
              })}
            </div>
          ) : (
            <Select
              value={playerState.viewerPlayerId}
              onValueChange={(v) => engine.setViewerPlayer(v)}
            >
              <SelectTrigger className="h-7 text-xs w-32">
                <SelectValue placeholder="视角" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">全知</SelectItem>
                {playerIds.map((playerId) => (
                  <SelectItem key={playerId} value={playerId}>
                    {playerNames[playerId]}{viewState.winner === playerId ? ' 🏆' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* 改造 4: 左侧栏在 lg(1024-1279px) 缩到 44(176px),给中央栏让出 16px,xl+ 恢复 48(192px) */}
        <div className="w-48 lg:w-44 xl:w-48 flex-shrink-0 p-2 overflow-y-auto hidden lg:block">
          <div className="space-y-2">
            {viewState.players.map((player) => (
              <OnlinePlayerPanel
                key={player.id}
                player={player}
                position="left"
                gameState={viewState}
                showSelf
              />
            ))}
          </div>
        </div>

        <div className="flex-1 flex flex-col min-w-0 p-2 gap-2">
          <div className="flex-1 flex items-center justify-center min-h-0">
            <div className="w-full max-w-2xl">
              <OnlineStarMap
                gameState={viewState}
                replayMode
                replayStateIndex={playerState.currentStateIndex}
                isAutoAdvancing={isAutoAdvancing}
              />
            </div>
          </div>
          <div className="flex-shrink-0">
            <OnlineGameLog
              logs={viewState.logs || []}
              replayMode
              autoAdvancing={isAutoAdvancing}
            />
          </div>
          <div className="flex-shrink-0 lg:hidden">
            <div className="space-y-2">
              {viewState.players.map((player) => (
                <OnlinePlayerPanel
                  key={player.id}
                  player={player}
                  position="left"
                  gameState={viewState}
                  showSelf
                />
              ))}
            </div>
          </div>
          {/* 改造 2: 右侧栏移动端兜底 — 仅在 <xl 显示,使用 <details> 折叠避免占用过多空间 */}
          <div className="flex-shrink-0 xl:hidden">
            <details className="bg-slate-900/50 border border-slate-800 rounded-lg">
              <summary className="text-xs font-bold text-slate-400 px-3 py-1.5 cursor-pointer flex items-center gap-1.5 list-none">
                <BookOpen className="w-3.5 h-3.5" /> 快速参考
                {viewState.flyingStrikes && viewState.flyingStrikes.length > 0 && (
                  <Badge variant="destructive" className="text-[9px] px-1 py-0 ml-1">{viewState.flyingStrikes.length}</Badge>
                )}
              </summary>
              <div className="px-2 pb-2 space-y-2">
                {renderFlyingStrikes()}
                {renderQuickRef()}
              </div>
            </details>
          </div>
        </div>

        {/* 桌面端右侧栏: 仅 xl+ 显示,内容复用 renderFlyingStrikes / renderQuickRef */}
        <div className="w-48 flex-shrink-0 p-2 space-y-2 overflow-y-auto hidden xl:block">
          {renderFlyingStrikes()}
          {renderQuickRef()}
        </div>
      </div>
    </div>
  );
}
