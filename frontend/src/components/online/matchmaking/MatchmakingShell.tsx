import type { ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Rocket, X, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StarfieldBackground } from '../StarfieldBackground';
import { GAME_TIPS } from './matchmakingConstants';

export interface MatchmakingShellProps {
  /** 顶部标题（如「创建/加入房间」、「等待玩家加入」、「房间准备中」） */
  title: string;
  /** 副标题（版本号文案，默认 DARK FOREST // ROOM SYSTEM v3.0） */
  subtitle?: string;
  /** 取消回调（关闭按钮） */
  onCancel: () => void;
  /** 当前 tips 索引 */
  currentTip: number;
  /** 错误信息（null 表示无错误） */
  error?: string | null;
  /** 背景阶段（默认 searching） */
  phase?: 'searching' | 'expanding' | 'starting';
  /** 底部模式标记（如 MENU / QUEUE / ROOM） */
  modeLabel?: string;
  /** 子节点 */
  children: ReactNode;
}

/**
 * Matchmaking 容器壳：统一背景、卡片框架、header、tips 轮播与错误提示。
 *
 * 三个 mode（menu/queue/room）共享的视觉容器，避免每个子视图重复写一遍卡片骨架。
 */
export function MatchmakingShell({
  title,
  subtitle = 'DARK FOREST // ROOM SYSTEM v3.0',
  onCancel,
  currentTip,
  error,
  phase = 'searching',
  modeLabel,
  children,
}: MatchmakingShellProps) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-black">
      <StarfieldBackground phase={phase} matchSuccess={false} />
      <div className="relative z-10 min-h-screen flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="w-full max-w-lg"
        >
          <Card className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 shadow-2xl">
            <CardHeader className="pb-4 border-b border-slate-800">
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Rocket className="w-6 h-6 text-cyan-400" />
                  <div>
                    <h2 className="text-xl font-bold text-white tracking-wider">{title}</h2>
                    <p className="text-xs text-cyan-400/70 font-mono">{subtitle}</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onCancel}
                  className="h-8 w-8 p-0 hover:bg-red-500/20 hover:text-red-400 transition-colors"
                >
                  <X className="w-4 h-4" />
                </Button>
              </CardTitle>
            </CardHeader>

            <CardContent className="pt-6 space-y-6">
              {children}

              {/* Tips 轮播 */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={currentTip}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.3 }}
                  className="bg-cyan-500/5 border border-cyan-500/20 rounded-lg p-3"
                >
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-cyan-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-slate-300 leading-relaxed">{GAME_TIPS[currentTip]}</p>
                  </div>
                </motion.div>
              </AnimatePresence>

              {/* 错误提示（顶部 toast 风格滑入） */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-center"
                  >
                    {error}
                  </motion.div>
                )}
              </AnimatePresence>
            </CardContent>
          </Card>

          <div className="mt-4 text-center space-y-1">
            <p className="text-[10px] text-slate-600 font-mono tracking-wider">
              DARK FOREST // MATCHMAKING SYSTEM v3.0
            </p>
            {modeLabel && <p className="text-[10px] text-slate-700">模式: {modeLabel}</p>}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
