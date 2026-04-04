'use client';

import { memo } from 'react';
import { useGameStore } from '@/store/gameStore';
import { Badge } from '@/components/ui/badge';
import { Player } from '@/lib/game/types';
import { GameCard } from './GameCard';

const PLAYER_COLORS: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  red: { bg: 'bg-red-950/30', border: 'border-red-800/40', text: 'text-red-400', dot: 'bg-red-500' },
  blue: { bg: 'bg-blue-950/30', border: 'border-blue-800/40', text: 'text-blue-400', dot: 'bg-blue-500' },
  green: { bg: 'bg-green-950/30', border: 'border-green-800/40', text: 'text-green-400', dot: 'bg-green-500' },
  amber: { bg: 'bg-amber-950/30', border: 'border-amber-800/40', text: 'text-amber-400', dot: 'bg-amber-500' },
  purple: { bg: 'bg-purple-950/30', border: 'border-purple-800/40', text: 'text-purple-400', dot: 'bg-purple-500' },
};

interface PlayerPanelProps {
  player: Player;
  position: 'left' | 'right' | 'top';
}

function PlayerPanelComponent({ player, position }: PlayerPanelProps) {
  const currentPlayerIndex = useGameStore(s => s.currentPlayerIndex);
  const players = useGameStore(s => s.players);
  const humanPlayerId = useGameStore(s => s.humanPlayerId);

  const isCurrentPlayer = players[currentPlayerIndex]?.id === player.id;
  const colors = PLAYER_COLORS[player.color] || PLAYER_COLORS.blue;

  if (player.id === humanPlayerId) return null;

  return (
    <div
      className={`
        rounded-xl border p-3 transition-all duration-300
        ${colors.bg} ${colors.border}
        ${isCurrentPlayer ? 'ring-2 ring-white/20 shadow-lg' : 'opacity-80'}
        ${player.eliminated ? 'opacity-30 line-through' : ''}
      `}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-3 h-3 rounded-full ${colors.dot} ${isCurrentPlayer ? 'animate-pulse' : ''}`} />
        <span className={`font-bold text-sm ${colors.text}`}>{player.name}</span>
        {isCurrentPlayer && (
          <Badge className="text-[8px] px-1.5 py-0 bg-white/10 text-white border-0">当前回合</Badge>
        )}
        {player.eliminated && (
          <Badge variant="destructive" className="text-[8px] px-1 py-0">已淘汰</Badge>
        )}
      </div>

      {/* Stats */}
      {!player.eliminated && (
        <>
          <div className="flex items-center gap-3 text-xs mb-2">
            <span className="text-yellow-500">⚡ {player.energy}</span>
            <span className="text-slate-400">🃏 {player.hand.length}</span>
            <span className="text-slate-400">📍 星系 {player.position}</span>
          </div>

          {/* Face-up cards (shown as small cards) */}
          {player.faceUpCards.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {player.faceUpCards.map(card => (
                <GameCard key={card.uid} card={card} compact inHand={false} />
              ))}
            </div>
          )}

          {/* Hand card backs */}
          {player.hand.length > 0 && (
            <div className="flex gap-0.5 mt-1">
              {Array.from({ length: Math.min(player.hand.length, 6) }, (_, i) => (
                <div
                  key={i}
                  className="w-5 h-7 rounded border border-slate-600 bg-slate-800"
                  style={{ marginLeft: i > 0 ? '-4px' : '0' }}
                />
              ))}
              {player.hand.length > 6 && (
                <span className="text-[9px] text-slate-500 self-center ml-1">+{player.hand.length - 6}</span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export const PlayerPanel = memo(PlayerPanelComponent);

/** All opponents panel */
export function OpponentsPanel() {
  const players = useGameStore(s => s.players);
  const humanPlayerId = useGameStore(s => s.humanPlayerId);

  const opponents = players.filter(p => p.id !== humanPlayerId);
  const leftOpponents = opponents.filter((_, i) => i % 2 === 0);
  const rightOpponents = opponents.filter((_, i) => i % 2 === 1);

  return (
    <>
      <div className="flex flex-col gap-2">
        {leftOpponents.map(p => (
          <PlayerPanel key={p.id} player={p} position="left" />
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {rightOpponents.map(p => (
          <PlayerPanel key={p.id} player={p} position="right" />
        ))}
      </div>
    </>
  );
}
