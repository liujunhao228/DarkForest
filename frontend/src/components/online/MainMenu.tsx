import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Wifi, WifiOff, Users, Trophy, History, Zap, BookOpen, RefreshCw, Map as MapIcon, Bot, Eye } from 'lucide-react';
import { useOnlineStore } from '@/store/onlineStore';
import { parseReplayIdFromInput } from '@/lib/replayShare';
import { GameRulesPanel } from '@/components/rules/GameRulesPanel';
import { GameRulesButton } from '@/components/rules/GameRulesButton';
import { isTrustMode, getTrustIdentity } from '@/lib/trust';
import { spawnBatch, killAgent } from '@/api/agentManager';
import { useMatchFoundTrigger } from './matchmaking/useMatchFoundTrigger';
import {
  DEFAULT_DISPLAY_NAME,
  MENU_TITLE,
  CONNECTION,
  IDENTITY_CARD,
  ONLINE_CARD,
  REPLAY_CARD,
  RULES_BTN_LABEL,
  MENU_SUBTITLE,
  REJOIN_CARD,
} from '@/constants/menuText';

interface MainMenuProps {
  onPlayOnline: () => void;
  onQuickMatch: () => void;
  onRejoinGame: (roomId: string, roomCode: string) => void;
  onMatchFound: (roomId: string, roomCode: string, players: unknown[]) => void;
}

/** 轮询等待 match:queueCreated 写入 currentQueue 后返回 queueId。 */
async function waitForQueueCreated(timeoutMs = 10000): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const q = useOnlineStore.getState().currentQueue;
    if (q && q.queueId) return q.queueId;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

export function MainMenu({ onPlayOnline, onQuickMatch, onRejoinGame, onMatchFound }: MainMenuProps) {
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState(DEFAULT_DISPLAY_NAME);
  const [shareInput, setShareInput] = useState('');
  const [showRules, setShowRules] = useState(false);

  // 按字段 selector 订阅，避免 store 任意字段变化触发重渲染
  const { isConnected, isConnecting, isLoggedIn, error, activeGame, currentQueue, currentRoom } = useOnlineStore(
    useShallow((s) => ({
      isConnected: s.isConnected,
      isConnecting: s.isConnecting,
      isLoggedIn: s.isLoggedIn,
      error: s.error,
      activeGame: s.activeGame,
      currentQueue: s.currentQueue,
      currentRoom: s.currentRoom,
    }))
  );
  // 函数引用稳定，单字段订阅不会触发重渲染
  const connect = useOnlineStore((s) => s.connect);
  const login = useOnlineStore((s) => s.login);
  const clearActiveGame = useOnlineStore((s) => s.clearActiveGame);
  const createCustomQueue = useOnlineStore((s) => s.createCustomQueue);
  const joinSpecificQueue = useOnlineStore((s) => s.joinSpecificQueue);
  const leaveSpecificQueue = useOnlineStore((s) => s.leaveSpecificQueue);

  // 满员（specific queue）→ room:joined → status=playing → 进入对局
  const { reset: resetMatchFound } = useMatchFoundTrigger(currentRoom, onMatchFound);

  // —— 人机对弈（创建一局·本地）：拉起 N 个 AI 入同一定制队列 + 自己入队 ——
  const [agentCount, setAgentCount] = useState(2);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  /** 我发起的人机局 queueId（非空即"组局中"；本地 state 重挂载自动重置） */
  const [localQueueId, setLocalQueueId] = useState<string | null>(null);
  /** 本局已 spawn 的 AI sid（取消时清理；ref 避免闭包 stale） */
  const spawnedSidsRef = useRef<Set<string>>(new Set());

  // —— 纯 AI 观战（观战一局）：拉起 N 个 AI 互斗，创建者不入队，轮询看开局 ——
  const [spectateCount, setSpectateCount] = useState(3);
  const [spectateQueueId, setSpectateQueueId] = useState<string | null>(null);
  const [spectateCreating, setSpectateCreating] = useState(false);
  const [spectateStarted, setSpectateStarted] = useState(false);
  const [spectateError, setSpectateError] = useState('');

  /** 清理当前人机局：kill 已 spawn 的 AI + 离开队列。 */
  const cleanupLocalGame = useCallback(async () => {
    for (const sid of spawnedSidsRef.current) {
      try {
        await killAgent(sid);
      } catch {
        // 单次失败忽略，继续清理其余
      }
    }
    spawnedSidsRef.current.clear();
    const qid = useOnlineStore.getState().currentQueue?.queueId;
    if (qid) {
      try {
        await leaveSpecificQueue(qid);
      } catch {
        // 队列可能已满/已开始，忽略
      }
    }
    resetMatchFound();
    setLocalQueueId(null);
  }, [leaveSpecificQueue, resetMatchFound]);

  const handleCreateGame = async () => {
    const total = agentCount + 1;
    if (total < 3 || total > 5) return; // specific queue 限 3-5 人
    setCreating(true);
    setCreateError('');
    try {
      const identity = getTrustIdentity();
      const name = identity?.name || displayName || '玩家';
      await createCustomQueue(`人机局-${name}`, total, total, 'classic');
      const qid = await waitForQueueCreated();
      if (!qid) throw new Error('创建队列超时');
      setLocalQueueId(qid);
      // 一次拉起 N 个 AI（任务文本含 queueId，AI 自动入队）
      const { sids } = await spawnBatch({ count: agentCount, queueId: qid, gameMode: 'classic' });
      sids.forEach((s) => spawnedSidsRef.current.add(s));
      // 自己入队；此后队列成员变动经 queueInfoResponse 实时广播
      await joinSpecificQueue(qid);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : '创建对局失败');
      await cleanupLocalGame();
    } finally {
      setCreating(false);
    }
  };

  const handleStartSpectate = async () => {
    const total = spectateCount;
    if (total < 3 || total > 5) return;
    setSpectateCreating(true);
    setSpectateError('');
    try {
      await createCustomQueue(`观战局-${total}人AI`, total, total, 'classic');
      const qid = await waitForQueueCreated();
      if (!qid) throw new Error('创建队列超时');
      setSpectateQueueId(qid);
      setSpectateStarted(false);
      // 创建者不入队；AI 满员自动开局（notifyMatchFound 只发队列成员）
      const { sids } = await spawnBatch({ count: total, queueId: qid, gameMode: 'classic' });
      sids.forEach((s) => spawnedSidsRef.current.add(s));
    } catch (e) {
      setSpectateError(e instanceof Error ? e.message : '创建观战局失败');
      await cleanupSpectate();
    } finally {
      setSpectateCreating(false);
    }
  };

  /** 清理纯 AI 观战局：kill 已 spawn 的 AI + 离开队列。 */
  const cleanupSpectate = useCallback(async () => {
    for (const sid of spawnedSidsRef.current) {
      try {
        await killAgent(sid);
      } catch {
        // 忽略
      }
    }
    spawnedSidsRef.current.clear();
    const qid = useOnlineStore.getState().currentQueue?.queueId;
    if (qid) {
      try {
        await leaveSpecificQueue(qid);
      } catch {
        // 忽略
      }
    }
    setSpectateQueueId(null);
    setSpectateStarted(false);
  }, [leaveSpecificQueue]);

  // 纯 AI 局：创建者不在队列中收不到广播，轮询 getQueueInfo 检测满员开局。
  useEffect(() => {
    if (!spectateQueueId) return;
    const timer = setInterval(() => {
      void useOnlineStore.getState().getQueueInfo(spectateQueueId);
      const q = useOnlineStore.getState().currentQueue;
      if (q && q.queueId === spectateQueueId && (q.status === 'full' || q.players.length >= spectateCount)) {
        setSpectateStarted(true);
        clearInterval(timer);
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [spectateQueueId, spectateCount]);

  const handleOpenSharedReplay = () => {
    const replayId = parseReplayIdFromInput(shareInput);
    if (replayId) {
      navigate(`/replay/${replayId}`);
    }
  };

  useEffect(() => {
    connect();
  }, [connect]);

  const handleLogin = async () => {
    if (!displayName.trim()) return;
    await login(displayName.trim());
  };

  const handleStartMatchmaking = () => {
    if (!isLoggedIn) {
      handleLogin();
    } else {
      onPlayOnline();
    }
  };

  const handleQuickMatch = () => {
    if (!isLoggedIn) {
      handleLogin();
    } else {
      onQuickMatch();
    }
  };

  // 本局就位列表数据（仅当 currentQueue 是我发起的局时采信，避免串台）
  const localQueue = currentQueue && currentQueue.queueId === localQueueId ? currentQueue : null;
  const localTotal = agentCount + 1;
  const spectateQueue = currentQueue && currentQueue.queueId === spectateQueueId ? currentQueue : null;

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 p-4">
      {/* 顶部右上角：游戏规则入口（无论是否登录都可见） */}
      <div className="absolute top-4 right-4 z-10">
        <GameRulesButton
          onClick={() => setShowRules(true)}
          label={RULES_BTN_LABEL}
          icon={<BookOpen className="w-4 h-4" />}
          className="bg-slate-900/80 border-slate-700 text-slate-200 hover:bg-slate-800 hover:text-white"
        />
      </div>
      <GameRulesPanel
        variant="full"
        visible={showRules}
        onClose={() => setShowRules(false)}
      />
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="w-full max-w-lg space-y-6 max-md:space-y-4">
        <div className="text-center mb-8">
          <div className="relative">
            <div className="absolute inset-0 bg-purple-500/10 blur-3xl rounded-full" />
            <h1 className="relative text-4xl font-bold bg-gradient-to-r from-purple-400 via-cyan-400 to-emerald-400 bg-clip-text text-transparent">{MENU_TITLE.main}</h1>
          </div>
          <p className="mt-3 text-sm text-slate-500 italic">&ldquo;{MENU_TITLE.quote}&rdquo;</p>
          <p className="mt-1 text-xs text-slate-600">{MENU_TITLE.quoteAuthor}</p>
        </div>

        <Card className="bg-slate-900/80 border-slate-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                {isConnected ? <Wifi className="w-4 h-4 text-green-500" /> : <WifiOff className="w-4 h-4 text-red-500" />}
                {isConnected ? CONNECTION.connected : CONNECTION.disconnected}
              </span>
              {isConnecting && <Loader2 className="w-4 h-4 animate-spin text-cyan-500" />}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {error && <div className="text-xs text-red-400 bg-red-950/30 border border-red-900 rounded p-2">{error}</div>}
          </CardContent>
        </Card>

        {!isLoggedIn && (
          <Card className="bg-slate-900/80 border-slate-800">
            <CardHeader className="pb-3"><CardTitle className="text-base text-slate-200">{IDENTITY_CARD.title}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-sm text-slate-300">{IDENTITY_CARD.nameLabel}</Label>
                <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={IDENTITY_CARD.namePlaceholder} className="bg-slate-800 border-slate-700 text-white" maxLength={12} />
              </div>
              <Button className="w-full bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500" onClick={handleLogin} disabled={!isConnected || !displayName.trim() || isConnecting}>
                {isConnecting ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" />{CONNECTION.connecting}</>) : IDENTITY_CARD.enterBtn}
              </Button>
            </CardContent>
          </Card>
        )}

        {isLoggedIn && activeGame && (
          <Card className="bg-gradient-to-r from-amber-900/60 to-orange-900/60 border-amber-700/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-amber-200 flex items-center gap-2">
                <RefreshCw className="w-4 h-4" />
                {REJOIN_CARD.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-xs text-amber-300/80 space-y-1">
                <p>{REJOIN_CARD.desc}</p>
                <div className="flex gap-3">
                  <span>{REJOIN_CARD.playerCount(activeGame.activePlayers, activeGame.playerCount)}</span>
                  <span>{REJOIN_CARD.turnInfo(activeGame.totalTurn)}</span>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  className="flex-1 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500"
                  onClick={() => onRejoinGame(activeGame.roomId, activeGame.roomCode)}
                  disabled={!isConnected || isConnecting}
                >
                  {isConnecting ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{CONNECTION.connecting}</>
                  ) : (
                    <><RefreshCw className="w-4 h-4 mr-2" />{REJOIN_CARD.rejoinBtn}</>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearActiveGame}
                  className="text-amber-300/60 hover:text-amber-200"
                >
                  {REJOIN_CARD.dismissBtn}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {isLoggedIn && (
          <Card className="bg-slate-900/80 border-slate-800">
            <CardHeader className="pb-3"><CardTitle className="text-base text-slate-200 flex items-center gap-2"><Users className="w-4 h-4" />{ONLINE_CARD.title}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-slate-500">{ONLINE_CARD.desc}</p>
              <Button className="w-full h-12 text-base font-bold bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500" onClick={handleQuickMatch} disabled={!isConnected || isConnecting}>
                {isConnecting ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" />{CONNECTION.connecting}</>) : (<><Zap className="w-4 h-4 mr-2" />{ONLINE_CARD.quickMatchBtn}</>)}
              </Button>
              <Button className="w-full h-12 text-base font-bold bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500" onClick={handleStartMatchmaking} disabled={!isConnected || isConnecting}>
                {isConnecting ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" />{CONNECTION.connecting}</>) : (<><Trophy className="w-4 h-4 mr-2" />{ONLINE_CARD.createJoinBtn}</>)}
              </Button>
            </CardContent>
          </Card>
        )}

        {isTrustMode() && isLoggedIn && (
          <Card className="bg-slate-900/80 border-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-slate-200 flex items-center gap-2">
                <Bot className="w-4 h-4 text-cyan-400" />
                创建一局（本地）
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-slate-500">拉起 N 个 AI 与自己组局（AI 大脑由 dsh profile 提供）</p>
              {createError && (
                <div className="text-xs text-red-400 bg-red-950/30 border border-red-900 rounded p-2">{createError}</div>
              )}
              {!localQueueId ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-300">Agent 数量</span>
                    <div className="flex-1 flex gap-2">
                      {[2, 3, 4].map((n) => (
                        <Button
                          key={n}
                          variant={agentCount === n ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setAgentCount(n)}
                          className={`flex-1 ${agentCount === n ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/50' : 'border-slate-700 text-slate-400'}`}
                        >
                          {n}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <Button
                    className="w-full h-11 bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500"
                    onClick={() => void handleCreateGame()}
                    disabled={!isConnected || isConnecting || creating}
                  >
                    {creating ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" />创建中...</>
                    ) : (
                      <>拉起 {agentCount} 个 Agent 并匹配 {agentCount + 1} 人局</>
                    )}
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-sm text-slate-300">
                    等待玩家就位（{localQueue?.players.length ?? 1}/{localTotal}）
                    <span className="text-slate-500"> · 满员自动开局</span>
                  </div>
                  {localQueue && localQueue.players.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {localQueue.players.map((p) => (
                        <span key={p.playerId} className="text-xs px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300">
                          {p.displayName}
                        </span>
                      ))}
                    </div>
                  )}
                  <Button variant="ghost" className="w-full bg-slate-800/50 border border-slate-700 text-slate-400 hover:bg-slate-700/70" onClick={() => void cleanupLocalGame()}>
                    取消组局
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {isTrustMode() && isLoggedIn && (
          <Card className="bg-slate-900/80 border-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-slate-200 flex items-center gap-2">
                <Eye className="w-4 h-4 text-emerald-400" />
                观战一局（纯 AI）
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-slate-500">拉起 N 个 AI 互斗，不亲自下场，满员后去观战页看</p>
              {spectateError && (
                <div className="text-xs text-red-400 bg-red-950/30 border border-red-900 rounded p-2">{spectateError}</div>
              )}
              {!spectateQueueId ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-300">AI 数量</span>
                    <div className="flex-1 flex gap-2">
                      {[3, 4, 5].map((n) => (
                        <Button
                          key={n}
                          variant={spectateCount === n ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setSpectateCount(n)}
                          className={`flex-1 ${spectateCount === n ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50' : 'border-slate-700 text-slate-400'}`}
                        >
                          {n}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <Button
                    className="w-full h-11 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500"
                    onClick={() => void handleStartSpectate()}
                    disabled={!isConnected || isConnecting || spectateCreating}
                  >
                    {spectateCreating ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" />创建中...</>
                    ) : (
                      <>拉起 {spectateCount} 个 AI 互斗</>
                    )}
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {spectateStarted ? (
                    <>
                      <div className="text-sm text-emerald-300">对局已开始，去观战页选择一个 AI 观看</div>
                      <div className="flex gap-2">
                        <Button className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500" onClick={() => navigate('/watch')}>
                          <Eye className="w-4 h-4 mr-2" />去观战
                        </Button>
                        <Button variant="ghost" className="bg-slate-800/50 border border-slate-700 text-slate-400 hover:bg-slate-700/70" onClick={() => void cleanupSpectate()}>
                          关闭
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-sm text-slate-300">
                        AI 就位（{spectateQueue?.players.length ?? 0}/{spectateCount}）
                        <span className="text-slate-500"> · 满员自动开局</span>
                      </div>
                      {spectateQueue && spectateQueue.players.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {spectateQueue.players.map((p) => (
                            <span key={p.playerId} className="text-xs px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300">
                              {p.displayName}
                            </span>
                          ))}
                        </div>
                      )}
                      <Button variant="ghost" className="w-full bg-slate-800/50 border border-slate-700 text-slate-400 hover:bg-slate-700/70" onClick={() => void cleanupSpectate()}>
                        取消
                      </Button>
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {isLoggedIn && (
          <Card className="bg-slate-900/80 border-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-slate-200 flex items-center gap-2">
                <History className="w-4 h-4" />{REPLAY_CARD.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button variant="outline" className="w-full" onClick={() => navigate('/replay')}>
                {REPLAY_CARD.viewHistoryBtn}
              </Button>
              <div className="space-y-2">
                <Label className="text-xs text-slate-400">{REPLAY_CARD.shareLabel}</Label>
                <div className="flex gap-2">
                  <Input
                    value={shareInput}
                    onChange={(e) => setShareInput(e.target.value)}
                    placeholder={REPLAY_CARD.sharePlaceholder}
                    className="bg-slate-800 border-slate-700 text-white text-xs"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleOpenSharedReplay}
                    disabled={!parseReplayIdFromInput(shareInput)}
                  >
                    {REPLAY_CARD.watchBtn}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="mt-6 text-[10px] text-slate-600 text-center space-y-0.5">
          <p>{MENU_SUBTITLE.features}</p>
          <p>{MENU_SUBTITLE.tagline}</p>
        </div>

        {isLoggedIn && (
          <Button
            variant="outline"
            size="sm"
            className="w-full border-slate-700 text-slate-300 hover:bg-slate-800"
            onClick={() => navigate('/map-editor')}
          >
            <MapIcon className="w-4 h-4 mr-2" />
            地图编辑器
          </Button>
        )}
      </motion.div>
    </div>
  );
}
