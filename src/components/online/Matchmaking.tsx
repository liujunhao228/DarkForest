'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Loader2, 
  Rocket, 
  Timer, 
  X, 
  Zap, 
  Users, 
  Gamepad2, 
  TrendingUp, 
  TrendingDown,
  Radio,
  Signal,
  AlertCircle,
} from 'lucide-react';
import { useOnlineStore } from '@/store/onlineStore';
import { StarfieldBackground } from './StarfieldBackground';

// ============================
// 类型和常量
// ============================

interface QueueGroup {
  mode: 'casual' | 'ranked';
  playerCount: number;
  count: number;
}

const MATCH_PHASES = {
  searching: {
    duration: 10000,
    message: '正在扫描深空信号...',
    subMessage: '搜索邻近文明的广播频率',
    icon: Radio,
  },
  expanding: {
    duration: 10000,
    message: '扩大搜索范围...',
    subMessage: '延伸至更远星系，寻找潜在文明',
    icon: Signal,
  },
  starting: {
    duration: 0,
    message: '建立通讯连接...',
    subMessage: '即将进入黑暗森林',
    icon: Rocket,
  },
} as const;

const GAME_TIPS = [
  '广播阶段可以伪装合作，获取其他文明的信任',
  '打击牌有速度等级，快速打击可能先结算',
  '设施牌每回合产出能量，优先建设是关键',
  '防御牌只能保护一个星系，谨慎选择目标',
  '隐藏自己，做好清理 — 最后的文明获胜',
  '合作广播可以获得能量，但要小心背叛',
  '星图上的位置影响打击范围和防御策略',
  '终极文明：唯一幸存的文明获胜',
  '永恒黑暗：无幸存玩家，所有人平局',
  '快速匹配可以接受3-5人任意组合',
];

// ============================
// 组件
// ============================

interface MatchmakingProps {
  onCancel: () => void;
  onMatchFound: (roomId: string, roomCode: string, players: unknown[]) => void;
}

export function Matchmaking({ onCancel, onMatchFound }: MatchmakingProps) {
  const {
    queueStatus,
    matchInfo,
    matchMode,
    matchPlayerCount,
    isQuickMatch,
    error,
    cancelQueue,
    setMatchPreferences,
  } = useOnlineStore();

  const [timeElapsed, setTimeElapsed] = useState(0);
  const [currentPhase, setCurrentPhase] = useState<'searching' | 'expanding' | 'starting'>('searching');
  const [previousPosition, setPreviousPosition] = useState<number | undefined>(undefined);
  const [positionTrend, setPositionTrend] = useState<'up' | 'down' | 'same' | null>(null);
  const [currentTip, setCurrentTip] = useState(0);
  const [showQuickMatchConfirm, setShowQuickMatchConfirm] = useState(false);

  // 监听匹配成功
  useEffect(() => {
    if (matchInfo) {
      onMatchFound(matchInfo.roomId, matchInfo.roomCode, matchInfo.players);
    }
  }, [matchInfo, onMatchFound]);

  // 计时器
  useEffect(() => {
    if (!queueStatus.inQueue) return;

    const timer = setInterval(() => {
      setTimeElapsed(prev => prev + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [queueStatus.inQueue]);

  // 阶段计算
  useEffect(() => {
    if (timeElapsed < 10) {
      setCurrentPhase('searching');
    } else if (timeElapsed < 20) {
      setCurrentPhase('expanding');
    } else {
      setCurrentPhase('starting');
    }
  }, [timeElapsed]);

  // 队列位置变化追踪
  useEffect(() => {
    const currentPosition = queueStatus.position;
    if (previousPosition !== undefined && currentPosition !== undefined) {
      if (currentPosition < previousPosition) {
        setPositionTrend('up');
      } else if (currentPosition > previousPosition) {
        setPositionTrend('down');
      } else {
        setPositionTrend('same');
      }
    }
    setPreviousPosition(currentPosition);
  }, [queueStatus.position, previousPosition]);

  // 随机提示
  useEffect(() => {
    const tipTimer = setInterval(() => {
      setCurrentTip(prev => (prev + 1) % GAME_TIPS.length);
    }, 8000);

    return () => clearInterval(tipTimer);
  }, []);

  const handleCancel = () => {
    cancelQueue();
    onCancel();
  };

  const handleQuickMatchToggle = () => {
    if (isQuickMatch) {
      setMatchPreferences(matchMode, matchPlayerCount, false);
    } else {
      setShowQuickMatchConfirm(true);
    }
  };

  const confirmQuickMatch = () => {
    setMatchPreferences(matchMode, 4, true);
    setShowQuickMatchConfirm(false);
  };

  const phase = MATCH_PHASES[currentPhase];
  const PhaseIcon = phase.icon;

  const remainingTime = Math.max(0, 30 - timeElapsed);
  const progressPercent = Math.min(100, (timeElapsed / 30) * 100);

  return (
    <div className="relative min-h-screen overflow-hidden bg-black">
      {/* 星空背景 */}
      <StarfieldBackground
        phase={currentPhase}
        matchSuccess={!!matchInfo}
      />

      {/* 主内容 */}
      <div className="relative z-10 min-h-screen flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="w-full max-w-lg"
        >
          {/* 主卡片 */}
          <Card className="bg-black/60 backdrop-blur-xl border border-cyan-500/20 shadow-2xl shadow-cyan-500/10">
            {/* 标题栏 */}
            <CardHeader className="pb-4 border-b border-cyan-500/10">
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <motion.div
                    animate={{ rotate: [0, 360] }}
                    transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
                  >
                    <Rocket className="w-6 h-6 text-cyan-400" />
                  </motion.div>
                  <div>
                    <h2 className="text-xl font-bold text-white tracking-wider">
                      匹配中
                    </h2>
                    <p className="text-xs text-cyan-400/70 font-mono">
                      MATCHMAKING ACTIVE
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCancel}
                  className="h-8 w-8 p-0 hover:bg-red-500/20 hover:text-red-400 transition-colors"
                >
                  <X className="w-4 h-4" />
                </Button>
              </CardTitle>
            </CardHeader>

            <CardContent className="pt-6 space-y-6">
              {/* 阶段指示器 */}
              <motion.div
                key={currentPhase}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center space-y-2"
              >
                <div className="flex items-center justify-center gap-2">
                  <PhaseIcon className="w-5 h-5 text-cyan-400" />
                  <h3 className="text-lg font-semibold text-white">
                    {phase.message}
                  </h3>
                </div>
                <p className="text-sm text-slate-400">
                  {phase.subMessage}
                </p>
              </motion.div>

              {/* 队列信息 */}
              <div className="grid grid-cols-3 gap-4">
                {/* 队列位置 */}
                <div className="bg-slate-900/50 rounded-lg p-3 border border-cyan-500/20">
                  <div className="text-xs text-slate-500 mb-1">队列位置</div>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold text-white font-mono">
                      #{queueStatus.position ?? '?'}
                    </span>
                    <AnimatePresence mode="wait">
                      {positionTrend && positionTrend !== 'same' && (
                        <motion.div
                          key={positionTrend}
                          initial={{ opacity: 0, y: positionTrend === 'up' ? 5 : -5 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                        >
                          {positionTrend === 'up' ? (
                            <TrendingUp className="w-4 h-4 text-green-400" />
                          ) : (
                            <TrendingDown className="w-4 h-4 text-red-400" />
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {/* 预计时间 */}
                <div className="bg-slate-900/50 rounded-lg p-3 border border-cyan-500/20">
                  <div className="text-xs text-slate-500 mb-1">预计等待</div>
                  <div className="flex items-center gap-1">
                    <Timer className="w-4 h-4 text-cyan-400" />
                    <span className="text-2xl font-bold text-white font-mono">
                      {remainingTime}s
                    </span>
                  </div>
                </div>

                {/* 队列总人数 */}
                <div className="bg-slate-900/50 rounded-lg p-3 border border-cyan-500/20">
                  <div className="text-xs text-slate-500 mb-1">队列总人数</div>
                  <div className="flex items-center gap-1">
                    <Users className="w-4 h-4 text-purple-400" />
                    <span className="text-2xl font-bold text-white font-mono">
                      {queueStatus.totalInQueue ?? '?'}
                    </span>
                  </div>
                </div>
              </div>

              {/* 进度条 */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-slate-500">
                  <span>匹配进度</span>
                  <span>{Math.floor(progressPercent)}%</span>
                </div>
                <div className="relative h-2 bg-slate-900 rounded-full overflow-hidden border border-cyan-500/20">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${progressPercent}%` }}
                    transition={{ duration: 0.5 }}
                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-cyan-500 via-purple-500 to-blue-500"
                  />
                  {/* 光晕效果 */}
                  <motion.div
                    animate={{ opacity: [0.5, 1, 0.5] }}
                    transition={{ duration: 2, repeat: Infinity }}
                    className="absolute inset-y-0 right-0 w-4 bg-white/30 blur-sm"
                    style={{ marginLeft: `${progressPercent}%` }}
                  />
                </div>
              </div>

              {/* 匹配偏好 */}
              <div className="space-y-3">
                <div className="text-xs text-slate-500 uppercase tracking-wider font-semibold">
                  匹配设置
                </div>
                <div className="flex flex-wrap gap-2">
                  {/* 模式选择 */}
                  <Button
                    variant={matchMode === 'casual' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setMatchPreferences('casual', matchPlayerCount, isQuickMatch)}
                    className={`flex-1 gap-2 ${
                      matchMode === 'casual'
                        ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/50 hover:bg-cyan-500/30'
                        : 'border-slate-700 text-slate-400 hover:bg-slate-800'
                    }`}
                  >
                    <Gamepad2 className="w-4 h-4" />
                    休闲
                  </Button>
                  <Button
                    variant={matchMode === 'ranked' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setMatchPreferences('ranked', matchPlayerCount, isQuickMatch)}
                    className={`flex-1 gap-2 ${
                      matchMode === 'ranked'
                        ? 'bg-purple-500/20 text-purple-400 border-purple-500/50 hover:bg-purple-500/30'
                        : 'border-slate-700 text-slate-400 hover:bg-slate-800'
                    }`}
                  >
                    <TrendingUp className="w-4 h-4" />
                    排位
                  </Button>

                  {/* 人数选择 */}
                  {[3, 4, 5].map(count => (
                    <Button
                      key={count}
                      variant={matchPlayerCount === count && !isQuickMatch ? 'default' : 'outline'}
                      size="sm"
                      disabled={isQuickMatch}
                      onClick={() => setMatchPreferences(matchMode, count, false)}
                      className={`flex-1 gap-2 ${
                        matchPlayerCount === count && !isQuickMatch
                          ? 'bg-blue-500/20 text-blue-400 border-blue-500/50 hover:bg-blue-500/30'
                          : 'border-slate-700 text-slate-400 hover:bg-slate-800 disabled:opacity-50'
                      }`}
                    >
                      <Users className="w-4 h-4" />
                      {count}人
                    </Button>
                  ))}
                </div>

                {/* 快速匹配按钮 */}
                <Button
                  variant={isQuickMatch ? 'default' : 'outline'}
                  size="sm"
                  onClick={handleQuickMatchToggle}
                  className={`w-full gap-2 ${
                    isQuickMatch
                      ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50 hover:bg-yellow-500/30'
                      : 'border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/20 hover:border-yellow-500/50'
                  }`}
                >
                  <Zap className="w-4 h-4" />
                  {isQuickMatch ? '快速匹配已启用' : '启用快速匹配 (3-5人)'}
                </Button>
              </div>

              {/* 队列详情 */}
              {queueStatus.groups && queueStatus.groups.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="space-y-2"
                >
                  <div className="text-xs text-slate-500 uppercase tracking-wider font-semibold">
                    队列分布
                  </div>
                  <div className="bg-slate-900/50 rounded-lg border border-cyan-500/10 p-3 space-y-2">
                    {queueStatus.groups.map((group, idx) => (
                      <div key={idx} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <Gamepad2 className={`w-3 h-3 ${
                            group.mode === 'casual' ? 'text-cyan-400' : 'text-purple-400'
                          }`} />
                          <span className="text-slate-400">
                            {group.mode === 'casual' ? '休闲' : '排位'}
                          </span>
                          <span className="text-slate-600">·</span>
                          <span className="text-slate-300">{group.playerCount}人</span>
                        </div>
                        <Badge variant="outline" className="border-slate-700 text-slate-400">
                          {group.count} 人在队列
                        </Badge>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* 游戏提示 */}
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
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {GAME_TIPS[currentTip]}
                    </p>
                  </div>
                </motion.div>
              </AnimatePresence>

              {/* 错误信息 */}
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

              {/* 取消按钮 */}
              <Button
                variant="outline"
                className="w-full border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-red-400 hover:border-red-500/50 transition-all"
                onClick={handleCancel}
              >
                取消匹配
              </Button>
            </CardContent>
          </Card>

          {/* 底部信息 */}
          <div className="mt-4 text-center space-y-1">
            <p className="text-[10px] text-slate-600 font-mono tracking-wider">
              DARK FOREST // MATCHMAKING SYSTEM v2.0
            </p>
            <p className="text-[10px] text-slate-700">
              已等待 {timeElapsed}秒 | 阶段: {currentPhase.toUpperCase()}
            </p>
          </div>
        </motion.div>
      </div>

      {/* 快速匹配确认弹窗 */}
      <AnimatePresence>
        {showQuickMatchConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={() => setShowQuickMatchConfirm(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-slate-900 border border-yellow-500/30 rounded-lg p-6 max-w-sm w-full space-y-4"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center gap-3">
                <Zap className="w-6 h-6 text-yellow-400" />
                <h3 className="text-lg font-bold text-white">启用快速匹配？</h3>
              </div>
              <p className="text-sm text-slate-400">
                启用后将接受 <span className="text-yellow-400 font-semibold">3-5人</span> 任意组合，
                大幅提高匹配速度，但无法精确控制玩家数量。
              </p>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1 border-slate-700 text-slate-300"
                  onClick={() => setShowQuickMatchConfirm(false)}
                >
                  取消
                </Button>
                <Button
                  className="flex-1 bg-yellow-500/20 text-yellow-400 border border-yellow-500/50 hover:bg-yellow-500/30"
                  onClick={confirmQuickMatch}
                >
                  确认启用
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
