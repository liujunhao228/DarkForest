import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Wifi, WifiOff, Users, Trophy, History, Zap, BookOpen } from 'lucide-react';
import { useOnlineStore } from '@/store/onlineStore';
import { parseReplayIdFromInput } from '@/lib/replayShare';
import { GameRulesPanel } from '@/components/rules/GameRulesPanel';
import { GameRulesButton } from '@/components/rules/GameRulesButton';

interface MainMenuProps {
  onPlayOnline: () => void;
  onQuickMatch: () => void;
}

export function MainMenu({ onPlayOnline, onQuickMatch }: MainMenuProps) {
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('地球文明');
  const [shareInput, setShareInput] = useState('');
  const [showRules, setShowRules] = useState(false);

  // 按字段 selector 订阅，避免 store 任意字段变化触发重渲染
  const { isConnected, isConnecting, isLoggedIn, error } = useOnlineStore(
    useShallow((s) => ({
      isConnected: s.isConnected,
      isConnecting: s.isConnecting,
      isLoggedIn: s.isLoggedIn,
      error: s.error,
    }))
  );
  // 函数引用稳定，单字段订阅不会触发重渲染
  const connect = useOnlineStore((s) => s.connect);
  const login = useOnlineStore((s) => s.login);

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

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 p-4">
      {/* 顶部右上角：游戏规则入口（无论是否登录都可见） */}
      <div className="absolute top-4 right-4 z-10">
        <GameRulesButton
          onClick={() => setShowRules(true)}
          label="游戏规则"
          icon={<BookOpen className="w-4 h-4" />}
          className="bg-slate-900/80 border-slate-700 text-slate-200 hover:bg-slate-800 hover:text-white"
        />
      </div>
      <GameRulesPanel
        variant="full"
        visible={showRules}
        onClose={() => setShowRules(false)}
      />
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="w-full max-w-lg space-y-6">
        <div className="text-center mb-8">
          <div className="relative">
            <div className="absolute inset-0 bg-purple-500/10 blur-3xl rounded-full" />
            <h1 className="relative text-4xl font-bold bg-gradient-to-r from-purple-400 via-cyan-400 to-emerald-400 bg-clip-text text-transparent">代号：黑暗森林</h1>
          </div>
          <p className="mt-3 text-sm text-slate-500 italic">&ldquo;宇宙就是一座黑暗森林，每个文明都是带枪的猎人&rdquo;</p>
          <p className="mt-1 text-xs text-slate-600">— 刘慈欣《三体》</p>
        </div>

        <Card className="bg-slate-900/80 border-slate-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                {isConnected ? <Wifi className="w-4 h-4 text-green-500" /> : <WifiOff className="w-4 h-4 text-red-500" />}
                {isConnected ? '已连接' : '未连接'}
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
            <CardHeader className="pb-3"><CardTitle className="text-base text-slate-200">文明身份</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-sm text-slate-300">文明名称</Label>
                <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="输入你的文明名称" className="bg-slate-800 border-slate-700 text-white" maxLength={12} />
              </div>
              <Button className="w-full bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500" onClick={handleLogin} disabled={!isConnected || !displayName.trim() || isConnecting}>
                {isConnecting ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" />连接中...</>) : '进入黑暗森林'}
              </Button>
            </CardContent>
          </Card>
        )}

        {isLoggedIn && (
          <Card className="bg-slate-900/80 border-slate-800">
            <CardHeader className="pb-3"><CardTitle className="text-base text-slate-200 flex items-center gap-2"><Users className="w-4 h-4" />在线对战</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-slate-500">随机匹配或创建房间，进入黑暗森林战场</p>
              <Button className="w-full h-12 text-base font-bold bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500" onClick={handleQuickMatch} disabled={!isConnected || isConnecting}>
                {isConnecting ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" />连接中...</>) : (<><Zap className="w-4 h-4 mr-2" />快速匹配</>)}
              </Button>
              <Button className="w-full h-12 text-base font-bold bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500" onClick={handleStartMatchmaking} disabled={!isConnected || isConnecting}>
                {isConnecting ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" />连接中...</>) : (<><Trophy className="w-4 h-4 mr-2" />创建/加入房间</>)}
              </Button>
            </CardContent>
          </Card>
        )}

        {isLoggedIn && (
          <Card className="bg-slate-900/80 border-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-slate-200 flex items-center gap-2">
                <History className="w-4 h-4" />历史回放
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button variant="outline" className="w-full" onClick={() => navigate('/replay')}>
                查看历史对局
              </Button>
              <div className="space-y-2">
                <Label className="text-xs text-slate-400">通过分享链接观看</Label>
                <div className="flex gap-2">
                  <Input
                    value={shareInput}
                    onChange={(e) => setShareInput(e.target.value)}
                    placeholder="粘贴分享链接或回放 ID"
                    className="bg-slate-800 border-slate-700 text-white text-xs"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleOpenSharedReplay}
                    disabled={!parseReplayIdFromInput(shareInput)}
                  >
                    观看
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="mt-6 text-[10px] text-slate-600 text-center space-y-0.5">
          <p>广播博弈 | 打击清理 | 防御生存 | 设施发展</p>
          <p>隐藏自己，做好清理 — 最后的文明获胜</p>
        </div>
      </motion.div>
    </div>
  );
}
