import { motion, AnimatePresence } from 'framer-motion';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PlayerList } from './PlayerList';
import { CopyableId } from './CopyableId';
import { useClipboardCopy } from './useClipboardCopy';
import type { RoomInfo } from './types';

export interface RoomWaitingViewProps {
  /** 当前房间信息 */
  room: RoomInfo;
  /** 倒计时剩余秒数（null 表示无倒计时） */
  countdownDisplay: number | null;
  /** 离开房间回调 */
  onLeave: () => void;
  /** 右上角规则按钮节点（由 Matchmaking 容器注入，便于复用 GameRulesButton） */
  rulesButton?: React.ReactNode;
}

/**
 * 房间等待视图：房间号 + 玩家列表 + 倒计时 + 离开按钮 + 规则按钮。
 *
 * UI 改进：
 * - 房间号大号显示 + 复制成功微弹动画
 * - 倒计时数字每秒脉动，增强紧张感
 * - 玩家列表显示空位占位
 */
export function RoomWaitingView({
  room,
  countdownDisplay,
  onLeave,
  rulesButton,
}: RoomWaitingViewProps) {
  const { copied, copy } = useClipboardCopy();

  return (
    <div className="space-y-6">
      <CopyableId
        label="房间号"
        value={room.roomCode}
        size="lg"
        hint="分享房间号邀请好友加入"
        copied={copied}
        onCopy={() => copy(room.roomCode)}
        trailing={rulesButton}
      />

      <div className="space-y-2">
        <div className="text-xs text-slate-500 uppercase tracking-wider font-semibold">
          房间玩家 ({room.players.length}/{room.playerCount})
        </div>
        <PlayerList players={room.players} max={room.playerCount} variant="room" />
      </div>

      <AnimatePresence mode="wait">
        {countdownDisplay !== null ? (
          <motion.div
            key="countdown"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-4 text-center space-y-1"
          >
            <p className="text-sm text-cyan-300 font-semibold">游戏即将开始</p>
            <motion.div
              key={countdownDisplay}
              initial={{ scale: 1.2, opacity: 0.7 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.3 }}
              className="text-4xl font-bold text-cyan-400 font-mono tabular-nums"
            >
              {countdownDisplay}
            </motion.div>
            <p className="text-xs text-slate-500">秒后进入战场</p>
          </motion.div>
        ) : (
          <motion.div
            key="waiting"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="bg-slate-900/50 rounded-lg p-3 text-center"
          >
            <p className="text-sm text-slate-400">等待游戏开始...</p>
          </motion.div>
        )}
      </AnimatePresence>

      <Button
        variant="ghost"
        className="w-full bg-slate-800/50 border border-slate-700 text-slate-400 hover:bg-slate-700/70 hover:border-slate-600 hover:text-slate-300 transition-all"
        onClick={onLeave}
      >
        <LogOut className="w-4 h-4 mr-2" />
        离开房间
      </Button>
    </div>
  );
}
