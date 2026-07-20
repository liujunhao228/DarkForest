import { memo } from 'react';
import { motion } from 'framer-motion';
import { Users, Crown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { RoomPlayer, QueuePlayer } from './types';

export interface PlayerListProps {
  /** 玩家列表 */
  players: Array<RoomPlayer | QueuePlayer>;
  /** 最大玩家数（用于显示空位占位） */
  max: number;
  /** 变体：queue 显示「已准备」徽章，room 显示「房主」徽章 */
  variant: 'queue' | 'room';
}

/**
 * 通用玩家列表组件。
 *
 * UI 改进：当 players.length < max 时，显示虚线占位「等待玩家加入...」，
 * 让等待阶段的玩家数信息密度更直观。
 */
function PlayerListBase({ players, max, variant }: PlayerListProps) {
  const slots = Math.max(0, max - players.length);

  return (
    <div className="bg-slate-900/50 rounded-lg border border-slate-700 p-3 space-y-2">
      {players.map((player, idx) => (
        <div key={idx} className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-cyan-400" />
            <span className="text-slate-300">{player.displayName}</span>
            {variant === 'room' && (player as RoomPlayer).isHost && (
              <Badge variant="outline" className="border-yellow-500/50 text-yellow-400 text-xs">
                <Crown className="w-3 h-3 mr-0.5" />
                房主
              </Badge>
            )}
          </div>
          {variant === 'queue' && (
            <Badge variant="outline" className="border-green-500/50 text-green-400">
              已准备
            </Badge>
          )}
        </div>
      ))}

      {/* 空位占位 */}
      {Array.from({ length: slots }).map((_, i) => (
        <motion.div
          key={`empty-${i}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: i * 0.05 }}
          className="flex items-center justify-between text-sm border border-dashed border-slate-700/50 rounded-md px-2 py-1.5"
        >
          <div className="flex items-center gap-2 text-slate-600">
            <Users className="w-4 h-4" />
            <span className="italic">等待玩家加入...</span>
          </div>
          <span className="text-[10px] text-slate-700 font-mono">空位</span>
        </motion.div>
      ))}
    </div>
  );
}

export const PlayerList = memo(PlayerListBase);
