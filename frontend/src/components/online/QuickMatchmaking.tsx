import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Zap, X, Orbit, Users, AlertCircle, LogOut, Landmark } from 'lucide-react';
import { useOnlineStore } from '@/store/onlineStore';
import { StarfieldBackground } from './StarfieldBackground';

type GameMode = 'classic' | 'civilization_relics';

const GAME_MODES: Array<{ mode: GameMode; label: string; icon: typeof Zap; desc: string }> = [
  { mode: 'classic', label: '经典模式', icon: Zap, desc: '标准对局，无预设遗迹' },
  { mode: 'civilization_relics', label: '文明遗迹', icon: Landmark, desc: '星球分布预设遗迹，探索与博弈' },
];

const GAME_TIPS = [
  '宇宙是黑暗森林。生存第一法则：隐藏自己，做好清理。',
  '中央星系航线多但易暴露；边缘星系适合蛰伏。',
  '广播是博弈：双方合作各得3点，你伪装对方合作则你得5点。',
  '广播定位到你时必须回应，有"监听基地"可沉默。',
  '打击非瞬发，每回合移动1格，可部署防御或逃离。',
  '清理其他文明收益大。淘汰玩家获得（剩余玩家数×3）点能量。',
  '防御等级≥打击等级才能幸存，警惕高等级打击。',
  '降维打击无视防御，"光速飞船"是唯一生路。',
  '"科技锁死"无法防御，可清空对手手牌。',
  '设施是文明根基，能量产出可获军备优势。',
  '行动阶段可回收设施或防御牌，获消耗值一半能量。',
  '"光速飞船"可跃迁至随机星系，但放弃原星系建设。',
  '建造"监听基地"，被广播时可保持沉默。',
  '胜利属于最后幸存者。同归于尽则宇宙"永恒黑暗"。',
];

interface QuickMatchmakingProps {
  onCancel: () => void;
  onMatchFound: (roomId: string, roomCode: string, players: unknown[]) => void;
}

export function QuickMatchmaking({ onCancel, onMatchFound }: QuickMatchmakingProps) {
  const { isInQueue, queueStatus, matchInfo, error, joinQueue, cancelQueue } = useOnlineStore();

  const [preferredCount, setPreferredCount] = useState(4);
  const [gameMode, setGameMode] = useState<GameMode>('classic');
  const [hasJoined, setHasJoined] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [currentTip, setCurrentTip] = useState(0);

  const hasTriggeredMatchFound = useRef(false);
  const hasCancelledRef = useRef(false);

  // 匹配成功：监听 matchInfo，触发 onMatchFound
  useEffect(() => {
    if (matchInfo && !hasTriggeredMatchFound.current) {
      hasTriggeredMatchFound.current = true;
      onMatchFound(matchInfo.roomId, matchInfo.roomCode, matchInfo.players);
    }
  }, [matchInfo, onMatchFound]);

  // 游戏提示轮播
  useEffect(() => {
    const tipTimer = setInterval(() => setCurrentTip(prev => (prev + 1) % GAME_TIPS.length), 8000);
    return () => clearInterval(tipTimer);
  }, []);

  // 组件卸载时若仍在队列中且未触发匹配成功，主动取消队列，避免遗留状态
  useEffect(() => {
    return () => {
      if (hasCancelledRef.current) return;
      if (useOnlineStore.getState().isInQueue) {
        void useOnlineStore.getState().cancelQueue();
      }
    };
  }, []);

  const handleStartMatch = async () => {
    setIsStarting(true);
    await joinQueue(preferredCount, gameMode);
    setIsStarting(false);
    // 仅在发送成功（未因断连提前返回）后切到搜索态；以 isInQueue 为准更稳妥
    setHasJoined(true);
  };

  const handleCancel = async () => {
    hasCancelledRef.current = true;
    if (isInQueue) {
      await cancelQueue();
    }
    onCancel();
  };

  const phase = !hasJoined ? 'select' : 'searching';

  return (
    <div className="relative min-h-screen overflow-hidden bg-black">
      <StarfieldBackground phase="searching" matchSuccess={false} />
      <div className="relative z-10 min-h-screen flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: 'easeOut' }} className="w-full max-w-lg">
          <Card className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 shadow-2xl">
            <CardHeader className="pb-4 border-b border-slate-800">
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Zap className="w-6 h-6 text-purple-400" />
                  <div>
                    <h2 className="text-xl font-bold text-white tracking-wider">
                      {phase === 'select' && '快速匹配'}
                      {phase === 'searching' && '搜索对手中'}
                    </h2>
                    <p className="text-xs text-purple-400/70 font-mono">DARK FOREST // QUICK MATCH v3.0</p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={handleCancel} className="h-8 w-8 p-0 hover:bg-red-500/20 hover:text-red-400 transition-colors"><X className="w-4 h-4" /></Button>
              </CardTitle>
            </CardHeader>

            <CardContent className="pt-6 space-y-6">
              <AnimatePresence mode="wait">
                {phase === 'select' && (
                  <motion.div key="select" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="space-y-6">
                    <div className="space-y-3">
                      <div className="text-xs text-slate-500 uppercase tracking-wider font-semibold">选择游戏模式</div>
                      <div className="grid grid-cols-2 gap-2">
                        {GAME_MODES.map(({ mode, label, icon: Icon, desc }) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => setGameMode(mode)}
                            className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-all ${
                              gameMode === mode
                                ? 'border-purple-500/50 bg-purple-500/20 text-purple-300'
                                : 'border-slate-700 bg-slate-900/40 text-slate-400 hover:border-slate-600'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <Icon className="w-4 h-4" />
                              <span className="text-sm font-semibold">{label}</span>
                            </div>
                            <span className="text-[10px] leading-tight opacity-70">{desc}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div className="text-xs text-slate-500 uppercase tracking-wider font-semibold">选择对战人数</div>
                      <p className="text-xs text-slate-500">系统将为你随机匹配相同人数的对手</p>
                      <div className="flex gap-2">
                        {[3, 4, 5].map(count => (
                          <Button key={count} variant={preferredCount === count ? 'default' : 'outline'} size="sm" onClick={() => setPreferredCount(count)}
                            className={`flex-1 ${preferredCount === count ? 'bg-purple-500/20 text-purple-400 border-purple-500/50' : 'border-slate-700 text-slate-400'}`}>{count}人</Button>
                        ))}
                      </div>
                      <Button onClick={handleStartMatch} disabled={isStarting} className="w-full h-12 text-base font-bold bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500">
                        {isStarting ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" />匹配中...</>) : (<><Zap className="w-4 h-4 mr-2" />开始匹配 {preferredCount} 人局</>)}
                      </Button>
                    </div>
                  </motion.div>
                )}

                {phase === 'searching' && (
                  <motion.div key="searching" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="space-y-6">
                    <div className="text-center space-y-3 py-4">
                      <div className="relative inline-flex">
                        <div className="absolute inset-0 bg-purple-500/20 blur-2xl rounded-full" />
                        <Orbit className="relative w-12 h-12 text-purple-400 animate-spin" style={{ animationDuration: '2.5s' }} />
                      </div>
                      <h3 className="text-lg font-semibold text-white">搜索对手中...</h3>
                      <p className="text-xs text-slate-500">
                        正在为你匹配 {preferredCount} 人
                        <span className="text-purple-400/80">
                          {gameMode === 'civilization_relics' ? ' 文明遗迹' : ' 经典'}
                        </span>
                        对局，请稍候
                      </p>
                    </div>

                    {isInQueue && (
                      <div className="space-y-2">
                        <div className="text-xs text-slate-500 uppercase tracking-wider font-semibold">队列状态</div>
                        <div className="bg-slate-900/50 rounded-lg border border-slate-700 p-4 space-y-3">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-slate-400 flex items-center gap-2"><Users className="w-4 h-4 text-cyan-400" />队列位置</span>
                            <span className="text-white font-mono font-semibold">
                              {queueStatus.position != null ? `第 ${queueStatus.position} 位` : '—'}
                              <span className="text-slate-600"> / 共 {queueStatus.totalInQueue ?? '—'} 人</span>
                            </span>
                          </div>
                          {queueStatus.groups && queueStatus.groups.length > 0 && (
                            <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-800">
                              {queueStatus.groups.map((g, idx) => (
                                <Badge key={idx} variant="outline" className="border-cyan-500/50 text-cyan-400 font-mono">
                                  {g.playerCount}人房: {g.count}组
                                </Badge>
                              ))}
                            </div>
                          )}
                          {queueStatus.phase === 'expanding' && (
                            <p className="text-xs text-amber-400/80 pt-2 border-t border-slate-800">匹配范围扩大中...</p>
                          )}
                        </div>
                      </div>
                    )}

                    <Button variant="ghost" className="w-full bg-slate-800/50 border border-slate-700 text-slate-400 hover:bg-slate-700/70 hover:border-slate-600 hover:text-slate-300 transition-all" onClick={handleCancel}>
                      <LogOut className="w-4 h-4 mr-2" />取消匹配
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence mode="wait">
                <motion.div key={currentTip} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }} className="bg-cyan-500/5 border border-cyan-500/20 rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-cyan-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-slate-300 leading-relaxed">{GAME_TIPS[currentTip]}</p>
                  </div>
                </motion.div>
              </AnimatePresence>

              <AnimatePresence>
                {error && (
                  <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-center">{error}</motion.div>
                )}
              </AnimatePresence>
            </CardContent>
          </Card>

          <div className="mt-4 text-center space-y-1">
            <p className="text-[10px] text-slate-600 font-mono tracking-wider">DARK FOREST // QUICK MATCH SYSTEM v3.0</p>
            <p className="text-[10px] text-slate-700">模式: {phase.toUpperCase()}</p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
