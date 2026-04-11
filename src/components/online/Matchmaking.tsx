'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Loader2,
  Rocket,
  X,
  Users,
  AlertCircle,
  Plus,
  Search,
  Copy,
  Play,
  LogOut,
} from 'lucide-react';
import { useOnlineStore } from '@/store/onlineStore';
import { StarfieldBackground } from './StarfieldBackground';

// ============================
// 游戏提示
// ============================

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
  '自定义房间可以邀请好友一起游戏',
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
    player,
    currentQueue,
    currentRoom,
    hasRestoredQueue,
    error,
    createCustomQueue,
    joinSpecificQueue,
    leaveSpecificQueue,
    getQueueInfo,
    joinRoomByCode,
    leaveRoom,
  } = useOnlineStore();

  const [mode, setMode] = useState<'menu' | 'queue' | 'room'>('menu');
  const [queueIdInput, setQueueIdInput] = useState('');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [queueName, setQueueName] = useState('');
  const [playerCount, setPlayerCount] = useState(4);
  const [currentTip, setCurrentTip] = useState(0);
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);

  // 监听房间状态变化，如果房间开始游戏则通知父组件
  useEffect(() => {
    if (currentRoom && currentRoom.status === 'playing') {
      onMatchFound(currentRoom.id, currentRoom.roomCode, currentRoom.players);
    }
  }, [currentRoom, onMatchFound]);

  // 随机提示
  useEffect(() => {
    const tipTimer = setInterval(() => {
      setCurrentTip(prev => (prev + 1) % GAME_TIPS.length);
    }, 8000);

    return () => clearInterval(tipTimer);
  }, []);

  // 恢复队列状态时自动跳转到等待页面
  useEffect(() => {
    if (currentQueue && hasRestoredQueue && mode === 'menu') {
      setMode('queue');
    }
  }, [currentQueue, hasRestoredQueue, mode]);

  // 当 WebSocket 事件更新 currentQueue 时，自动切换到 queue 模式
  useEffect(() => {
    if (currentQueue && mode === 'menu') {
      setMode('queue');
    }
  }, [currentQueue, mode]);

  // 当 WebSocket 事件更新 currentRoom 时，自动切换到 room 模式
  useEffect(() => {
    if (currentRoom && mode === 'menu') {
      setMode('room');
    }
  }, [currentRoom, mode]);

  // 注意：队列和房间状态更新完全依赖 WebSocket 事件推送
  // （match:queueInfoResponse, room:playerJoined, room:playerLeft, room:gameStarting 等）
  // 不再使用轮询，避免不必要的网络开销

  const handleCreateQueue = async () => {
    if (!queueName.trim()) return;

    setIsCreating(true);
    await createCustomQueue(queueName, playerCount, playerCount);
    setIsCreating(false);

    // 注意：现在由 WebSocket 事件监听器自动更新 currentQueue 状态
    // 当收到 match:queueCreated 事件时，currentQueue 会被设置
    // 由 useEffect 自动检测 currentQueue 并切换到 queue 模式
  };

  const handleJoinQueue = async () => {
    if (!queueIdInput.trim()) return;

    setIsJoining(true);
    await joinSpecificQueue(queueIdInput.trim());
    setIsJoining(false);

    // 注意：现在由 WebSocket 事件监听器自动更新 currentQueue 状态
    // 当收到 match:queueInfoResponse 事件时，currentQueue 会被设置
  };

  const handleJoinRoom = async () => {
    if (!roomCodeInput.trim()) return;

    setIsJoining(true);
    await joinRoomByCode(roomCodeInput.trim().toUpperCase());
    setIsJoining(false);

    // 注意：现在由 WebSocket 事件监听器自动更新 currentRoom 状态
    // 当收到 room:joined 事件时，currentRoom 会被设置
  };

  const handleLeaveQueue = async () => {
    if (currentQueue) {
      await leaveSpecificQueue(currentQueue.queueId);
      setMode('menu');
    }
  };

  const handleLeaveRoom = () => {
    leaveRoom();
    setMode('menu');
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const isHost = currentRoom && player && currentRoom.hostId === player.id;
  const isQueueFull = currentQueue && currentQueue.players.length >= currentQueue.maxPlayers;

  return (
    <div className="relative min-h-screen overflow-hidden bg-black">
      {/* 星空背景 */}
      <StarfieldBackground
        phase="searching"
        matchSuccess={false}
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
                  <Rocket className="w-6 h-6 text-cyan-400" />
                  <div>
                    <h2 className="text-xl font-bold text-white tracking-wider">
                      {mode === 'menu' && '创建/加入房间'}
                      {mode === 'queue' && '等待玩家加入'}
                      {mode === 'room' && '房间准备中'}
                    </h2>
                    <p className="text-xs text-cyan-400/70 font-mono">
                      DARK FOREST // ROOM SYSTEM v3.0
                    </p>
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
              <AnimatePresence mode="wait">
                {/* 主菜单模式 */}
                {mode === 'menu' && (
                  <motion.div
                    key="menu"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="space-y-6"
                  >
                    {/* 创建房间 */}
                    <div className="space-y-3">
                      <div className="text-xs text-slate-500 uppercase tracking-wider font-semibold">
                        创建自定义房间
                      </div>
                      <Input
                        placeholder="房间名称"
                        value={queueName}
                        onChange={(e) => setQueueName(e.target.value)}
                        className="bg-slate-900/50 border-cyan-500/20 text-white placeholder:text-slate-600"
                      />
                      <div className="flex gap-2">
                        {[3, 4, 5].map(count => (
                          <Button
                            key={count}
                            variant={playerCount === count ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setPlayerCount(count)}
                            className={`flex-1 ${
                              playerCount === count
                                ? 'bg-blue-500/20 text-blue-400 border-blue-500/50'
                                : 'border-slate-700 text-slate-400'
                            }`}
                          >
                            {count}人
                          </Button>
                        ))}
                      </div>
                      <Button
                        onClick={handleCreateQueue}
                        disabled={!queueName.trim() || isCreating}
                        className="w-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/50 hover:bg-cyan-500/30"
                      >
                        {isCreating ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            创建中...
                          </>
                        ) : (
                          <>
                            <Plus className="w-4 h-4 mr-2" />
                            创建 {playerCount} 人房间
                          </>
                        )}
                      </Button>
                    </div>

                    {/* 加入队列 */}
                    <div className="space-y-3">
                      <div className="text-xs text-slate-500 uppercase tracking-wider font-semibold">
                        加入已有队列
                      </div>
                      <Input
                        placeholder="队列 ID"
                        value={queueIdInput}
                        onChange={(e) => setQueueIdInput(e.target.value)}
                        className="bg-slate-900/50 border-purple-500/20 text-white placeholder:text-slate-600"
                      />
                      <Button
                        onClick={handleJoinQueue}
                        disabled={!queueIdInput.trim() || isJoining}
                        className="w-full bg-purple-500/20 text-purple-400 border border-purple-500/50 hover:bg-purple-500/30"
                      >
                        {isJoining ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            加入中...
                          </>
                        ) : (
                          <>
                            <Search className="w-4 h-4 mr-2" />
                            加入队列
                          </>
                        )}
                      </Button>
                    </div>

                    {/* 加入房间 */}
                    <div className="space-y-3">
                      <div className="text-xs text-slate-500 uppercase tracking-wider font-semibold">
                        直接加入房间
                      </div>
                      <Input
                        placeholder="房间号 (例如: ABC123)"
                        value={roomCodeInput}
                        onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                        maxLength={6}
                        className="bg-slate-900/50 border-yellow-500/20 text-white placeholder:text-slate-600 uppercase font-mono"
                      />
                      <Button
                        onClick={handleJoinRoom}
                        disabled={!roomCodeInput.trim() || isJoining}
                        className="w-full bg-yellow-500/20 text-yellow-400 border border-yellow-500/50 hover:bg-yellow-500/30"
                      >
                        {isJoining ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            加入中...
                          </>
                        ) : (
                          <>
                            <Rocket className="w-4 h-4 mr-2" />
                            加入房间
                          </>
                        )}
                      </Button>
                    </div>
                  </motion.div>
                )}

                {/* 队列等待模式 */}
                {mode === 'queue' && currentQueue && (
                  <motion.div
                    key="queue"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="space-y-6"
                  >
                    {/* 队列信息 */}
                    <div className="text-center space-y-2">
                      <h3 className="text-lg font-semibold text-white">
                        {currentQueue.queueName}
                      </h3>
                      <div className="flex items-center justify-center gap-2">
                        <Badge variant="outline" className="border-cyan-500/50 text-cyan-400">
                          队列 ID: {currentQueue.queueId}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() => copyToClipboard(currentQueue.queueId)}
                        >
                          <Copy className="w-3 h-3" />
                        </Button>
                      </div>
                      <p className="text-xs text-slate-500">
                        分享队列 ID 邀请好友加入
                      </p>
                    </div>

                    {/* 玩家列表 */}
                    <div className="space-y-2">
                      <div className="text-xs text-slate-500 uppercase tracking-wider font-semibold">
                        已加入玩家 ({currentQueue.players.length}/{currentQueue.maxPlayers})
                      </div>
                      <div className="bg-slate-900/50 rounded-lg border border-cyan-500/10 p-3 space-y-2">
                        {currentQueue.players.map((player, idx) => (
                          <div key={idx} className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <Users className="w-4 h-4 text-cyan-400" />
                              <span className="text-slate-300">{player.displayName}</span>
                            </div>
                            <Badge variant="outline" className="border-green-500/50 text-green-400">
                              已准备
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 队列状态 */}
                    {isQueueFull && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-center"
                      >
                        <p className="text-sm text-green-400 font-semibold">
                          队列已满，正在创建房间...
                        </p>
                      </motion.div>
                    )}

                    {/* 离开按钮 */}
                    <Button
                      variant="outline"
                      className="w-full border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-red-400 hover:border-red-500/50 transition-all"
                      onClick={handleLeaveQueue}
                    >
                      <LogOut className="w-4 h-4 mr-2" />
                      离开队列
                    </Button>
                  </motion.div>
                )}

                {/* 房间模式 */}
                {mode === 'room' && currentRoom && (
                  <motion.div
                    key="room"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="space-y-6"
                  >
                    {/* 房间号 */}
                    <div className="text-center space-y-2">
                      <h3 className="text-lg font-semibold text-white">
                        房间号
                      </h3>
                      <div className="flex items-center justify-center gap-2">
                        <span className="text-3xl font-bold text-cyan-400 font-mono tracking-wider">
                          {currentRoom.roomCode}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => copyToClipboard(currentRoom.roomCode)}
                        >
                          <Copy className="w-4 h-4" />
                        </Button>
                      </div>
                      <p className="text-xs text-slate-500">
                        分享房间号邀请好友加入
                      </p>
                    </div>

                    {/* 玩家列表 */}
                    <div className="space-y-2">
                      <div className="text-xs text-slate-500 uppercase tracking-wider font-semibold">
                        房间玩家 ({currentRoom.players.length}/{currentRoom.playerCount})
                      </div>
                      <div className="bg-slate-900/50 rounded-lg border border-cyan-500/10 p-3 space-y-2">
                        {currentRoom.players.map((player, idx) => (
                          <div key={idx} className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <Users className="w-4 h-4 text-cyan-400" />
                              <span className="text-slate-300">{player.displayName}</span>
                              {player.isHost && (
                                <Badge variant="outline" className="border-yellow-500/50 text-yellow-400 text-xs">
                                  房主
                                </Badge>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 等待游戏开始 */}
                    <div className="bg-slate-900/50 rounded-lg p-3 text-center">
                      <p className="text-sm text-slate-400">
                        等待游戏开始...
                      </p>
                    </div>

                    {/* 离开按钮 */}
                    <Button
                      variant="outline"
                      className="w-full border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-red-400 hover:border-red-500/50 transition-all"
                      onClick={handleLeaveRoom}
                    >
                      <LogOut className="w-4 h-4 mr-2" />
                      离开房间
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>

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
            </CardContent>
          </Card>

          {/* 底部信息 */}
          <div className="mt-4 text-center space-y-1">
            <p className="text-[10px] text-slate-600 font-mono tracking-wider">
              DARK FOREST // MATCHMAKING SYSTEM v3.0
            </p>
            <p className="text-[10px] text-slate-700">
              模式: {mode.toUpperCase()}
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
