import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Loader2, Rocket, X, Users, AlertCircle, Plus, Search, Copy, Check, LogOut } from 'lucide-react';
import { useOnlineStore } from '@/store/onlineStore';
import { StarfieldBackground } from './StarfieldBackground';

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

interface MatchmakingProps {
  onCancel: () => void;
  onMatchFound: (roomId: string, roomCode: string, players: unknown[]) => void;
}

export function Matchmaking({ onCancel, onMatchFound }: MatchmakingProps) {
  // 按字段 selector 订阅，避免 store 任意字段变化触发重渲染
  const { currentQueue, currentRoom, countdownEndsAt, error } = useOnlineStore(
    useShallow((s) => ({
      currentQueue: s.currentQueue,
      currentRoom: s.currentRoom,
      countdownEndsAt: s.countdownEndsAt,
      error: s.error,
    }))
  );
  // 函数引用稳定，单字段订阅不会触发重渲染
  const createCustomQueue = useOnlineStore((s) => s.createCustomQueue);
  const joinSpecificQueue = useOnlineStore((s) => s.joinSpecificQueue);
  const leaveSpecificQueue = useOnlineStore((s) => s.leaveSpecificQueue);
  const leaveRoom = useOnlineStore((s) => s.leaveRoom);

  const mode = currentRoom ? 'room' : currentQueue ? 'queue' : 'menu';
  const [queueIdInput, setQueueIdInput] = useState('');
  const [queueName, setQueueName] = useState('');
  const [playerCount, setPlayerCount] = useState(4);
  const [currentTip, setCurrentTip] = useState(0);
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [copiedQueueId, setCopiedQueueId] = useState(false);
  const [copiedRoomCode, setCopiedRoomCode] = useState(false);

  const hasTriggeredMatchFound = useRef(false);

  useEffect(() => {
    if (currentRoom && currentRoom.status === 'playing' && !hasTriggeredMatchFound.current) {
      hasTriggeredMatchFound.current = true;
      onMatchFound(currentRoom.id, currentRoom.roomCode, currentRoom.players);
    }
  }, [currentRoom, onMatchFound]);

  const [countdownDisplay, setCountdownDisplay] = useState<number | null>(null);

  useEffect(() => {
    if (countdownEndsAt === null) {
      // 同步清空倒计时显示，属于合法的 effect 状态同步
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCountdownDisplay(null);
      return;
    }
    const update = () => {
      const remaining = Math.max(0, Math.ceil((countdownEndsAt - Date.now()) / 1000));
      setCountdownDisplay(remaining);
    };
    update();
    const timer = setInterval(update, 200);
    return () => clearInterval(timer);
  }, [countdownEndsAt]);

  useEffect(() => {
    const tipTimer = setInterval(() => setCurrentTip(prev => (prev + 1) % GAME_TIPS.length), 8000);
    return () => clearInterval(tipTimer);
  }, []);

  const handleCreateQueue = async () => {
    if (!queueName.trim()) return;
    setIsCreating(true);
    await createCustomQueue(queueName, playerCount, playerCount);
    setIsCreating(false);
  };

  const handleJoinQueue = async () => {
    if (!queueIdInput.trim()) return;
    setIsJoining(true);
    await joinSpecificQueue(queueIdInput.trim());
    setIsJoining(false);
  };

  const handleLeaveQueue = async () => {
    if (currentQueue) {
      await leaveSpecificQueue(currentQueue.queueId);
      hasTriggeredMatchFound.current = false;
    }
  };

  const handleLeaveRoom = () => {
    leaveRoom();
    hasTriggeredMatchFound.current = false;
  };

  const copyQueueId = () => {
    navigator.clipboard.writeText(currentQueue!.queueId);
    setCopiedQueueId(true);
    setTimeout(() => setCopiedQueueId(false), 1200);
  };

  const copyRoomCode = () => {
    navigator.clipboard.writeText(currentRoom!.roomCode);
    setCopiedRoomCode(true);
    setTimeout(() => setCopiedRoomCode(false), 1200);
  };

  const isQueueFull = currentQueue && currentQueue.players.length >= currentQueue.maxPlayers;

  return (
    <div className="relative min-h-screen overflow-hidden bg-black">
      <StarfieldBackground phase="searching" matchSuccess={false} />
      <div className="relative z-10 min-h-screen flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: 'easeOut' }} className="w-full max-w-lg">
          <Card className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 shadow-2xl">
            <CardHeader className="pb-4 border-b border-slate-800">
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Rocket className="w-6 h-6 text-cyan-400" />
                  <div>
                    <h2 className="text-xl font-bold text-white tracking-wider">
                      {mode === 'menu' && '创建/加入房间'}
                      {mode === 'queue' && '等待玩家加入'}
                      {mode === 'room' && '房间准备中'}
                    </h2>
                    <p className="text-xs text-cyan-400/70 font-mono">DARK FOREST // ROOM SYSTEM v3.0</p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={onCancel} className="h-8 w-8 p-0 hover:bg-red-500/20 hover:text-red-400 transition-colors"><X className="w-4 h-4" /></Button>
              </CardTitle>
            </CardHeader>

            <CardContent className="pt-6 space-y-6">
              <AnimatePresence mode="wait">
                {mode === 'menu' && (
                  <motion.div key="menu" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="space-y-6">
                    <div className="space-y-3">
                      <div className="text-xs text-slate-500 uppercase tracking-wider font-semibold">创建自定义房间</div>
                      <Input placeholder="房间名称" value={queueName} onChange={(e) => setQueueName(e.target.value)} className="bg-slate-900/50 border-sky-500/20 text-white placeholder:text-slate-600" />
                      <div className="flex gap-2">
                        {[3, 4, 5].map(count => (
                          <Button key={count} variant={playerCount === count ? 'default' : 'outline'} size="sm" onClick={() => setPlayerCount(count)}
                            className={`flex-1 ${playerCount === count ? 'bg-sky-500/20 text-sky-400 border-sky-500/50' : 'border-slate-700 text-slate-400'}`}>{count}人</Button>
                        ))}
                      </div>
                      <Button onClick={handleCreateQueue} disabled={!queueName.trim() || isCreating} className="w-full bg-sky-500/20 text-sky-400 border border-sky-500/50 hover:bg-sky-500/30">
                        {isCreating ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" />创建中...</>) : (<><Plus className="w-4 h-4 mr-2" />创建 {playerCount} 人房间</>)}
                      </Button>
                    </div>

                    <div className="space-y-3">
                      <div className="text-xs text-slate-500 uppercase tracking-wider font-semibold">加入已有队列</div>
                      <Input placeholder="队列 ID" value={queueIdInput} onChange={(e) => setQueueIdInput(e.target.value)} className="bg-slate-900/50 border-purple-500/20 text-white placeholder:text-slate-600" />
                      <Button onClick={handleJoinQueue} disabled={!queueIdInput.trim() || isJoining} className="w-full bg-purple-500/20 text-purple-400 border border-purple-500/50 hover:bg-purple-500/30">
                        {isJoining ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" />加入中...</>) : (<><Search className="w-4 h-4 mr-2" />加入队列</>)}
                      </Button>
                    </div>
                  </motion.div>
                )}

                {mode === 'queue' && currentQueue && (
                  <motion.div key="queue" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="space-y-6">
                    <div className="text-center space-y-2">
                      <h3 className="text-lg font-semibold text-white">{currentQueue.queueName}</h3>
                      <div className="flex items-center justify-center gap-2">
                        <Badge variant="outline" className="border-slate-500/50 text-slate-300 font-mono">队列 ID: {currentQueue.queueId}</Badge>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 bg-slate-800/50 hover:bg-slate-700/50 transition-all" onClick={copyQueueId}>
                          {copiedQueueId ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3 text-slate-400 hover:text-slate-300" />}
                        </Button>
                      </div>
                      <p className="text-xs text-slate-500">分享队列 ID 邀请好友加入</p>
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs text-slate-500 uppercase tracking-wider font-semibold">已加入玩家 ({currentQueue.players.length}/{currentQueue.maxPlayers})</div>
                      <div className="bg-slate-900/50 rounded-lg border border-slate-700 p-3 space-y-2">
                        {currentQueue.players.map((player, idx) => (
                          <div key={idx} className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2"><Users className="w-4 h-4 text-cyan-400" /><span className="text-slate-300">{player.displayName}</span></div>
                            <Badge variant="outline" className="border-green-500/50 text-green-400">已准备</Badge>
                          </div>
                        ))}
                      </div>
                    </div>

                    {isQueueFull && (
                      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-center">
                        <p className="text-sm text-green-400 font-semibold">队列已满，正在创建房间...</p>
                      </motion.div>
                    )}

                    <Button variant="ghost" className="w-full bg-slate-800/50 border border-slate-700 text-slate-400 hover:bg-slate-700/70 hover:border-slate-600 hover:text-slate-300 transition-all" onClick={handleLeaveQueue}>
                      <LogOut className="w-4 h-4 mr-2" />离开队列
                    </Button>
                  </motion.div>
                )}

                {mode === 'room' && currentRoom && (
                  <motion.div key="room" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="space-y-6">
                    <div className="text-center space-y-2">
                      <h3 className="text-lg font-semibold text-white">房间号</h3>
                      <div className="flex items-center justify-center gap-2">
                        <span className="text-3xl font-bold text-cyan-400 font-mono tracking-wider">{currentRoom.roomCode}</span>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 bg-slate-800/50 hover:bg-slate-700/50 transition-all rounded-lg" onClick={copyRoomCode}>
                          {copiedRoomCode ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4 text-slate-400 hover:text-slate-300" />}
                        </Button>
                      </div>
                      <p className="text-xs text-slate-500">分享房间号邀请好友加入</p>
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs text-slate-500 uppercase tracking-wider font-semibold">房间玩家 ({currentRoom.players.length}/{currentRoom.playerCount})</div>
                      <div className="bg-slate-900/50 rounded-lg border border-slate-700 p-3 space-y-2">
                        {currentRoom.players.map((player, idx) => (
                          <div key={idx} className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <Users className="w-4 h-4 text-cyan-400" /><span className="text-slate-300">{player.displayName}</span>
                              {player.isHost && <Badge variant="outline" className="border-yellow-500/50 text-yellow-400 text-xs">房主</Badge>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {countdownDisplay !== null ? (
                      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-4 text-center space-y-1">
                        <p className="text-sm text-cyan-300 font-semibold">游戏即将开始</p>
                        <div className="text-4xl font-bold text-cyan-400 font-mono tabular-nums">{countdownDisplay}</div>
                        <p className="text-xs text-slate-500">秒后进入战场</p>
                      </motion.div>
                    ) : (
                      <div className="bg-slate-900/50 rounded-lg p-3 text-center"><p className="text-sm text-slate-400">等待游戏开始...</p></div>
                    )}

                    <Button variant="ghost" className="w-full bg-slate-800/50 border border-slate-700 text-slate-400 hover:bg-slate-700/70 hover:border-slate-600 hover:text-slate-300 transition-all" onClick={handleLeaveRoom}>
                      <LogOut className="w-4 h-4 mr-2" />离开房间
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
            <p className="text-[10px] text-slate-600 font-mono tracking-wider">DARK FOREST // MATCHMAKING SYSTEM v3.0</p>
            <p className="text-[10px] text-slate-700">模式: {mode.toUpperCase()}</p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
