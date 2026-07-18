import { memo } from 'react';
import { useOnlineGameStore } from '@/store/onlineGameStore';
import { useLocalPlayerId } from '@/hooks/useLocalPlayerId';
import { usePlayerPanelMode } from '@/hooks/usePlayerPanelMode';
import { Badge } from '@/components/ui/badge';
import { StackedGameCard } from '@/components/game/GameCard';
import { Zap, Layers, MapPin, Shield } from 'lucide-react';
import type { Player, GameState } from '@/lib/game/types';
import type { PlayerView, ViewState } from '@/lib/game/viewState';
import { groupCardsByDefId } from '@/lib/game/cards';
import { PLAYER_COLORS as PLAYER_HEX_COLORS } from '@/lib/game/strikeStyles';

const PLAYER_COLORS: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  red: { bg: 'bg-red-950/30', border: 'border-red-800/40', text: 'text-red-400', dot: 'bg-red-500' },
  blue: { bg: 'bg-blue-950/30', border: 'border-blue-800/40', text: 'text-blue-400', dot: 'bg-blue-500' },
  green: { bg: 'bg-green-950/30', border: 'border-green-800/40', text: 'text-green-400', dot: 'bg-green-500' },
  amber: { bg: 'bg-amber-950/30', border: 'border-amber-800/40', text: 'text-amber-400', dot: 'bg-amber-500' },
  purple: { bg: 'bg-purple-950/30', border: 'border-purple-800/40', text: 'text-purple-400', dot: 'bg-purple-500' },
};

interface PlayerPanelProps {
  player: Player | PlayerView;
  position: 'left' | 'right' | 'top';
  gameState?: GameState | ViewState;
  /** 为 true 时强制显示该玩家面板（即使其为本机/观察者），用于回放等全知场景 */
  showSelf?: boolean;
  /** 点击位置区域回调，传入玩家 ID 与 hex 颜色，用于进入星图标记模式 */
  onPositionClick?: (playerId: string, color: string) => void;
  /** 当前处于标记模式的玩家 ID，用于在面板上高亮显示并支持 toggle 退出 */
  markingPlayerId?: string | null;
}

function PlayerPanelComponent({ player, position, gameState: propGameState, showSelf = false, onPositionClick, markingPlayerId }: PlayerPanelProps) {
  void position;
  const storeGameState = useOnlineGameStore(s => s.gameState);
  const gameState = propGameState || storeGameState;
  const localPlayerId = useLocalPlayerId();
  const { mode: panelMode } = usePlayerPanelMode();

  if (!gameState) return null;

  const { players, currentPlayerIndex } = gameState;
  const isCurrentPlayer = players?.[currentPlayerIndex]?.id === player.id;
  const colors = PLAYER_COLORS[player.color] || PLAYER_COLORS.blue;
  const localPlayerIdFromState = localPlayerId || gameState.localPlayerId;
  // 标记模式所需：玩家 hex 颜色（传给 addPin）与当前是否处于标记态（toggle 高亮）
  const hexColor = PLAYER_HEX_COLORS[player.color] ?? '#9ca3af';
  const isMarkingThis = markingPlayerId != null && markingPlayerId === player.id;

  if (!showSelf && player.id === localPlayerIdFromState) return null;

  // 极简模式：聚合场上卡牌的总能量产出与最高防御等级
  const totalEnergyPerTurn = player.faceUpCards.reduce((sum, c) => sum + (c.energyPerTurn ?? 0), 0);
  const maxProtectionLevel = player.faceUpCards.reduce((max, c) => Math.max(max, c.protectionLevel ?? 0), 0);
  const cardGroups = panelMode === 'brief' ? groupCardsByDefId(player.faceUpCards) : [];

  return (
    <div className={`rounded-xl border p-3 transition-all duration-300 ${colors.bg} ${colors.border} ${isCurrentPlayer ? 'ring-2 ring-white/20 shadow-lg' : 'opacity-80'} ${player.eliminated ? 'opacity-30 line-through' : ''}`}>
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-3 h-3 rounded-full ${colors.dot} ${isCurrentPlayer ? 'animate-pulse' : ''}`} />
        <span className={`font-bold text-sm ${colors.text}`}>{player.name}</span>
        {isCurrentPlayer && <Badge className="text-[8px] px-1.5 py-0 bg-white/10 text-white border-0">当前回合</Badge>}
        {player.eliminated && <Badge variant="destructive" className="text-[8px] px-1 py-0">已淘汰</Badge>}
      </div>
      {!player.eliminated && (
        <>
          {panelMode !== 'minimal' && (
            <div className="flex items-center gap-3 text-xs mb-2">
              <span className="text-yellow-500 flex items-center gap-1"><Zap className="w-3.5 h-3.5" /> {player.energy}</span>
              <span className="text-slate-400 flex items-center gap-1"><Layers className="w-3.5 h-3.5" /> {'handCount' in player ? player.handCount : (player.hand?.length ?? 0)}</span>
              {onPositionClick ? (
                <button
                  type="button"
                  onClick={() => onPositionClick(player.id, hexColor)}
                  title={isMarkingThis ? '点击退出标记模式' : '点击进入标记模式：在星图上标记该玩家的可能位置'}
                  className={`flex items-center gap-1 rounded px-1 py-0.5 transition-colors cursor-pointer ${isMarkingThis ? 'bg-white/20 text-white ring-1 ring-white/40' : 'text-slate-600 hover:bg-white/10 hover:text-slate-300'}`}
                >
                  <MapPin className="w-3.5 h-3.5" /> {player.position < 0 ? '位置未知' : `位置 ${player.position}`}
                </button>
              ) : (
                <span className="text-slate-600 flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {player.position < 0 ? '位置未知' : `位置 ${player.position}`}</span>
              )}
            </div>
          )}
          {panelMode === 'detailed' && (
            <>
              {player.faceUpCards.length > 0 && (
                <div className="flex gap-1 flex-wrap">
                  {groupCardsByDefId(player.faceUpCards).map(({ card, count }) => (
                    <StackedGameCard key={card.defId} card={card} count={count} compact inHand={false} />
                  ))}
                </div>
              )}
              {player.hand && player.hand.length > 0 && (
                <div className="flex gap-0.5 mt-1">
                  {Array.from({ length: Math.min(player.hand.length, 6) }, (_, i) => (
                    <div key={i} className="w-5 h-7 rounded border border-slate-600 bg-slate-800" style={{ marginLeft: i > 0 ? '-4px' : '0' }} />
                  ))}
                  {player.hand.length > 6 && <span className="text-[9px] text-slate-500 self-center ml-1">+{player.hand.length - 6}</span>}
                </div>
              )}
            </>
          )}
          {panelMode === 'brief' && cardGroups.length > 0 && (
            <div className="space-y-0.5">
              {cardGroups.map(({ card, count }) => (
                <div key={card.defId} className="flex items-center gap-1.5 text-[10px]">
                  <span className="text-slate-300 truncate flex-1">{card.name}</span>
                  <span className="text-slate-500">×{count}</span>
                  {card.energyPerTurn != null && (
                    <span className="text-amber-400 flex items-center gap-0.5"><Zap className="w-2.5 h-2.5" />+{card.energyPerTurn}</span>
                  )}
                  {card.protectionLevel != null && (
                    <span className="text-blue-400 flex items-center gap-0.5"><Shield className="w-2.5 h-2.5" />Lv.{card.protectionLevel}</span>
                  )}
                </div>
              ))}
            </div>
          )}
          {panelMode === 'minimal' && player.faceUpCards.length > 0 && (
            <div className="flex items-center gap-2 text-[10px]">
              <span className="text-amber-400 flex items-center gap-0.5"><Zap className="w-2.5 h-2.5" />+{totalEnergyPerTurn}/回合</span>
              {maxProtectionLevel > 0 && (
                <span className="text-blue-400 flex items-center gap-0.5"><Shield className="w-2.5 h-2.5" />Lv.{maxProtectionLevel}</span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export const OnlinePlayerPanel = memo(PlayerPanelComponent);

interface OnlineOpponentsPanelProps {
  /** 点击位置区域回调，透传给每个 OnlinePlayerPanel */
  onPositionClick?: (playerId: string, color: string) => void;
  /** 当前处于标记模式的玩家 ID，透传给每个 OnlinePlayerPanel */
  markingPlayerId?: string | null;
}

export function OnlineOpponentsPanel({ onPositionClick, markingPlayerId }: OnlineOpponentsPanelProps = {}) {
  const gameState = useOnlineGameStore(s => s.gameState);
  const localPlayerId = useLocalPlayerId();

  if (!gameState) return null;

  const localPlayerIdFromState = localPlayerId || gameState.localPlayerId;
  const opponents = (gameState.players || []).filter((p) => p.id !== localPlayerIdFromState);
  const leftOpponents = opponents.filter((_, i) => i % 2 === 0);
  const rightOpponents = opponents.filter((_, i) => i % 2 === 1);

  return (
    <>
      <div className="flex flex-col gap-2">
        {leftOpponents.map((p) => (
          <OnlinePlayerPanel key={p.id} player={p} position="left" onPositionClick={onPositionClick} markingPlayerId={markingPlayerId} />
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {rightOpponents.map((p) => (
          <OnlinePlayerPanel key={p.id} player={p} position="right" onPositionClick={onPositionClick} markingPlayerId={markingPlayerId} />
        ))}
      </div>
    </>
  );
}
