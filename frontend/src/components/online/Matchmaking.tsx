import { useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { BookOpen } from 'lucide-react';
import { useOnlineStore } from '@/store/onlineStore';
import { GameRulesPanel } from '@/components/rules/GameRulesPanel';
import { GameRulesButton } from '@/components/rules/GameRulesButton';
import { MatchmakingShell } from './matchmaking/MatchmakingShell';
import { CreateRoomForm, type CreateRoomFormSubmit } from './matchmaking/CreateRoomForm';
import { JoinQueueForm } from './matchmaking/JoinQueueForm';
import { QueueWaitingView } from './matchmaking/QueueWaitingView';
import { RoomWaitingView } from './matchmaking/RoomWaitingView';
import { useMatchmakingTips } from './matchmaking/useMatchmakingTips';
import { useCountdown } from './matchmaking/useCountdown';
import { useMatchFoundTrigger } from './matchmaking/useMatchFoundTrigger';

interface MatchmakingProps {
  onCancel: () => void;
  onMatchFound: (roomId: string, roomCode: string, players: unknown[]) => void;
}

/**
 * 自定义房间主入口（容器编排器）。
 *
 * 职责：
 * - 订阅 onlineStore 的 currentQueue / currentRoom / countdownEndsAt / error
 * - 根据 mode（menu / queue / room）路由到对应子视图
 * - 委派副作用给 hooks（tips 轮播、倒计时、match found 触发）
 * - 挂载 GameRulesPanel（仅 room 模式）
 *
 * 对外 props 保持不变：onCancel + onMatchFound。
 */
export function Matchmaking({ onCancel, onMatchFound }: MatchmakingProps) {
  // 按字段 selector 订阅，避免 store 任意字段变化触发重渲染
  const { currentQueue, currentRoom, countdownEndsAt, error } = useOnlineStore(
    useShallow((s) => ({
      currentQueue: s.currentQueue,
      currentRoom: s.currentRoom,
      countdownEndsAt: s.countdownEndsAt,
      error: s.error,
    })),
  );
  // 函数引用稳定，单字段订阅不会触发重渲染
  const createCustomQueue = useOnlineStore((s) => s.createCustomQueue);
  const joinSpecificQueue = useOnlineStore((s) => s.joinSpecificQueue);
  const leaveSpecificQueue = useOnlineStore((s) => s.leaveSpecificQueue);
  const leaveRoom = useOnlineStore((s) => s.leaveRoom);

  const mode = currentRoom ? 'room' : currentQueue ? 'queue' : 'menu';
  const currentTip = useMatchmakingTips();
  const countdownDisplay = useCountdown(countdownEndsAt);
  const { reset: resetMatchFound } = useMatchFoundTrigger(currentRoom, onMatchFound);

  const [showRoomRules, setShowRoomRules] = useState(false);

  const handleCreate = useCallback(
    async (params: CreateRoomFormSubmit) => {
      await createCustomQueue(
        params.queueName,
        params.playerCount,
        params.playerCount,
        params.baseGameMode,
        params.customRules,
      );
    },
    [createCustomQueue],
  );

  const handleJoin = useCallback(
    async (queueId: string) => {
      await joinSpecificQueue(queueId);
    },
    [joinSpecificQueue],
  );

  const handleLeaveQueue = useCallback(() => {
    if (currentQueue) {
      void leaveSpecificQueue(currentQueue.queueId);
      resetMatchFound();
    }
  }, [currentQueue, leaveSpecificQueue, resetMatchFound]);

  const handleLeaveRoom = useCallback(() => {
    leaveRoom();
    resetMatchFound();
  }, [leaveRoom, resetMatchFound]);

  const title =
    mode === 'menu' ? '创建/加入房间' : mode === 'queue' ? '等待玩家加入' : '房间准备中';

  return (
    <>
      <MatchmakingShell
        title={title}
        onCancel={onCancel}
        currentTip={currentTip}
        error={error}
        modeLabel={mode.toUpperCase()}
      >
        <AnimatePresence mode="wait">
          {mode === 'menu' && (
            <motion.div
              key="menu"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-6"
            >
              <CreateRoomForm onCreate={handleCreate} />
              <JoinQueueForm onJoin={handleJoin} />
            </motion.div>
          )}

          {mode === 'queue' && currentQueue && (
            <motion.div
              key="queue"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
            >
              <QueueWaitingView queue={currentQueue} onLeave={handleLeaveQueue} />
            </motion.div>
          )}

          {mode === 'room' && currentRoom && (
            <motion.div
              key="room"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
            >
              <RoomWaitingView
                room={currentRoom}
                countdownDisplay={countdownDisplay}
                onLeave={handleLeaveRoom}
                rulesButton={
                  <GameRulesButton
                    onClick={() => setShowRoomRules(true)}
                    label="房间规则"
                    icon={<BookOpen className="w-3.5 h-3.5" />}
                    className="flex-shrink-0 bg-slate-800/60 border-slate-700 text-slate-200 hover:bg-slate-700/70"
                  />
                }
              />
            </motion.div>
          )}
        </AnimatePresence>
      </MatchmakingShell>

      {currentRoom && (
        <GameRulesPanel
          variant="mode-filtered"
          roomId={currentRoom.id}
          visible={showRoomRules}
          onClose={() => setShowRoomRules(false)}
        />
      )}
    </>
  );
}
