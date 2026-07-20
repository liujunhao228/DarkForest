import { motion } from 'framer-motion';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PlayerList } from './PlayerList';
import { CopyableId } from './CopyableId';
import { useClipboardCopy } from './useClipboardCopy';
import type { CustomQueueInfo } from './types';

export interface QueueWaitingViewProps {
  /** 当前队列信息 */
  queue: CustomQueueInfo;
  /** 离开队列回调 */
  onLeave: () => void;
}

/**
 * 队列等待视图：队列信息 + 玩家列表 + 规则摘要 + 队列满提示 + 离开按钮。
 *
 * UI 改进：
 * - 玩家列表显示空位占位
 * - 队列满时改为带脉动动画的提示
 */
export function QueueWaitingView({ queue, onLeave }: QueueWaitingViewProps) {
  const { copied, copy } = useClipboardCopy();
  const isQueueFull = queue.players.length >= queue.maxPlayers;

  return (
    <div className="space-y-6">
      <CopyableId
        label="队列 ID"
        value={queue.queueId}
        hint="分享队列 ID 邀请好友加入"
        copied={copied}
        onCopy={() => copy(queue.queueId)}
      />

      <div className="text-center space-y-1">
        <h3 className="text-lg font-semibold text-white">{queue.queueName}</h3>
      </div>

      <div className="space-y-2">
        <div className="text-xs text-slate-500 uppercase tracking-wider font-semibold">
          已加入玩家 ({queue.players.length}/{queue.maxPlayers})
        </div>
        <PlayerList players={queue.players} max={queue.maxPlayers} variant="queue" />
      </div>

      {queue.baseGameMode && (
        <div className="bg-slate-900/50 rounded-lg border border-slate-700 p-3 space-y-1.5">
          <div className="text-xs text-slate-500 uppercase tracking-wider font-semibold">房间规则</div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">基础模式</span>
            <Badge variant="outline" className="border-cyan-500/50 text-cyan-400">
              {queue.baseGameMode === 'civilization_relics' ? '文明遗迹' : '经典'}
            </Badge>
          </div>
          {queue.customRules && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400">自定义规则</span>
              <Badge variant="outline" className="border-amber-500/50 text-amber-400">
                已配置
              </Badge>
            </div>
          )}
        </div>
      )}

      {isQueueFull && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: [1, 1.02, 1] }}
          transition={{ scale: { repeat: Infinity, duration: 1.5 } }}
          className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-center"
        >
          <p className="text-sm text-green-400 font-semibold">队列已满，正在创建房间...</p>
        </motion.div>
      )}

      <Button
        variant="ghost"
        className="w-full bg-slate-800/50 border border-slate-700 text-slate-400 hover:bg-slate-700/70 hover:border-slate-600 hover:text-slate-300 transition-all"
        onClick={onLeave}
      >
        <LogOut className="w-4 h-4 mr-2" />
        离开队列
      </Button>
    </div>
  );
}
