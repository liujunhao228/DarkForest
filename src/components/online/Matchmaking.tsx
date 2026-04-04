'use client';

import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Rocket, Timer, X } from 'lucide-react';
import { useOnlineStore } from '@/store/onlineStore';

interface MatchmakingProps {
  onCancel: () => void;
  onMatchFound: (roomId: string, roomCode: string, players: unknown[]) => void;
}

export function Matchmaking({ onCancel, onMatchFound }: MatchmakingProps) {
  const {
    queueStatus,
    matchInfo,
    error,
    cancelQueue,
  } = useOnlineStore();

  // 监听匹配成功
  useEffect(() => {
    if (matchInfo) {
      onMatchFound(matchInfo.roomId, matchInfo.roomCode, matchInfo.players);
    }
  }, [matchInfo, onMatchFound]);

  const handleCancel = () => {
    cancelQueue();
    onCancel();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <Card className="bg-slate-900/80 border-slate-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-xl text-slate-200 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Rocket className="w-5 h-5 text-cyan-400" />
                匹配中...
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCancel}
                className="h-8 w-8 p-0 hover:bg-red-950/30 hover:text-red-400"
              >
                <X className="w-4 h-4" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* 动画效果 */}
            <div className="relative h-32 flex items-center justify-center">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
                className="absolute inset-0 border-2 border-dashed border-cyan-500/30 rounded-full"
              />
              <motion.div
                animate={{ rotate: -360 }}
                transition={{ duration: 5, repeat: Infinity, ease: 'linear' }}
                className="absolute inset-4 border-2 border-dashed border-purple-500/30 rounded-full"
              />
              <div className="relative z-10 text-center">
                <motion.div
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                >
                  <Rocket className="w-12 h-12 text-cyan-400 mx-auto" />
                </motion.div>
                <p className="mt-2 text-sm text-slate-400">正在寻找其他文明...</p>
              </div>
            </div>

            {/* 队列信息 */}
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">队列位置</span>
                <Badge variant="outline" className="border-cyan-500 text-cyan-400">
                  #{queueStatus.position ?? '?'}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">预计等待</span>
                <span className="flex items-center gap-1 text-slate-300">
                  <Timer className="w-3 h-3" />
                  {queueStatus.estimatedTime ?? 30}秒
                </span>
              </div>
            </div>

            {/* 进度条 */}
            <div className="relative h-2 bg-slate-800 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: '100%' }}
                transition={{ duration: 30, ease: 'linear' }}
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-cyan-500 to-purple-500"
              />
            </div>

            {/* 提示信息 */}
            <div className="text-center space-y-1">
              <p className="text-xs text-slate-500">
                如果等待时间过长，将自动加入 AI 对手
              </p>
            </div>

            {/* 错误信息 */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="text-sm text-red-400 bg-red-950/30 border border-red-900 rounded p-3 text-center"
                >
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            {/* 取消按钮 */}
            <Button
              variant="outline"
              className="w-full border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-red-400"
              onClick={handleCancel}
            >
              取消匹配
            </Button>
          </CardContent>
        </Card>

        {/* 游戏提示 */}
        <div className="mt-6 text-[10px] text-slate-600 text-center space-y-0.5">
          <p>广播博弈 | 打击清理 | 防御生存 | 设施发展</p>
          <p>隐藏自己，做好清理 — 最后的文明获胜</p>
        </div>
      </motion.div>
    </div>
  );
}
