import { memo } from 'react';
import { Zap } from 'lucide-react';
import { GameCard } from '@/components/game/GameCard';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import type { PlayerView, ViewState } from '@/lib/game/viewState';

interface ReplayPlayerHandProps {
  player: PlayerView;
  gameState: ViewState;
}

function ReplayPlayerHandComponent({ player, gameState }: ReplayPlayerHandProps) {
  // gameState 当前未直接用于渲染，但按 spec 保留以备未来模式相关样式扩展
  void gameState;

  const hand = player.hand ?? [];
  const hasHand = hand.length > 0;

  return (
    <div className="flex-shrink-0 bg-slate-950/80 border-t border-slate-800/50 px-4 py-2 safe-bottom">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="inline-block w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: player.color }}
            aria-hidden
          />
          <span className="text-xs text-slate-300 font-medium truncate">{player.name}</span>
          <span className="text-[10px] text-slate-500">手牌 ({hand.length}张)</span>
        </div>
        <span className="text-[10px] text-yellow-500 flex items-center gap-1 flex-shrink-0">
          <Zap className="w-3 h-3" /> {player.energy} 能量
        </span>
      </div>

      {hasHand ? (
        <ScrollArea className="w-full">
          <div className="flex gap-2 pb-2">
            {hand.map((card) => (
              <GameCard key={card.uid} card={card} showSubtype />
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      ) : (
        <div className="text-slate-500 text-xs py-2 text-center">暂无手牌</div>
      )}
    </div>
  );
}

export const ReplayPlayerHand = memo(ReplayPlayerHandComponent);
ReplayPlayerHand.displayName = 'ReplayPlayerHand';
