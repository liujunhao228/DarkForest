'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Wifi, WifiOff, Users, Trophy } from 'lucide-react';
import { useOnlineStore } from '@/store/onlineStore';

interface MainMenuProps {
  onPlayOnline: () => void;
}

export function MainMenu({ onPlayOnline }: MainMenuProps) {
  const [displayName, setDisplayName] = useState('地球文明');

  const {
    isConnected,
    isConnecting,
    isLoggedIn,
    player,
    error,
    connect,
    disconnect,
    login,
  } = useOnlineStore();

  // 自动连接 - 仅在组件挂载时连接一次
  useEffect(() => {
    connect();
    // 只在组件真正卸载时才断开，避免中断正在进行的连接
    return () => {
      // 不在这里断开，让连接在其他组件中保持
    };
  }, []); // 空依赖数组，只执行一次

  const handleLogin = async () => {
    if (!displayName.trim()) return;
    await login(displayName.trim());
  };

  const handleStartMatchmaking = () => {
    if (!isLoggedIn) {
      handleLogin();
    } else {
      // 通知父组件切换到匹配界面
      onPlayOnline();
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="w-full max-w-lg space-y-6"
      >
        {/* Title */}
        <div className="text-center mb-8">
          <div className="relative">
            <div className="absolute inset-0 bg-purple-500/10 blur-3xl rounded-full" />
            <h1 className="relative text-4xl font-bold bg-gradient-to-r from-purple-400 via-cyan-400 to-emerald-400 bg-clip-text text-transparent">
              代号：黑暗森林
            </h1>
          </div>
          <p className="mt-3 text-sm text-slate-500 italic">
            &ldquo;宇宙就是一座黑暗森林，每个文明都是带枪的猎人&rdquo;
          </p>
          <p className="mt-1 text-xs text-slate-600">— 刘慈欣《三体》</p>
        </div>

        {/* Connection Status */}
        <Card className="bg-slate-900/80 border-slate-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                {isConnected ? (
                  <Wifi className="w-4 h-4 text-green-500" />
                ) : (
                  <WifiOff className="w-4 h-4 text-red-500" />
                )}
                {isConnected ? '已连接' : '未连接'}
              </span>
              {isConnecting && <Loader2 className="w-4 h-4 animate-spin text-cyan-500" />}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {error && (
              <div className="text-xs text-red-400 bg-red-950/30 border border-red-900 rounded p-2">
                {error}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Login Section */}
        {!isLoggedIn && (
          <Card className="bg-slate-900/80 border-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-slate-200">文明身份</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-sm text-slate-300">文明名称</Label>
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="输入你的文明名称"
                  className="bg-slate-800 border-slate-700 text-white"
                  maxLength={12}
                />
              </div>
              <Button
                className="w-full bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500"
                onClick={handleLogin}
                disabled={!isConnected || !displayName.trim() || isConnecting}
              >
                {isConnecting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    连接中...
                  </>
                ) : (
                  '进入黑暗森林'
                )}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Player Stats */}
        {isLoggedIn && player && (
          <Card className="bg-slate-900/80 border-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-slate-200">
                {player.displayName}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-center">
                <div className="space-y-1">
                  <div className="text-xs text-slate-500">胜率</div>
                  <div className="text-lg font-bold text-green-400">
                    {player.totalMatches > 0
                      ? Math.round((player.wins / player.totalMatches) * 100)
                      : 0}%
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-slate-500">对局</div>
                  <div className="text-lg font-bold text-slate-200">{player.totalMatches}</div>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
                <span>胜 {player.wins}</span>
                <span>负 {player.losses}</span>
                <span>平 {player.draws}</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Game Mode Selection */}
        {isLoggedIn && (
          <Card className="bg-slate-900/80 border-slate-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-slate-200 flex items-center gap-2">
                <Users className="w-4 h-4" />
                在线对战
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-slate-500">
                创建或加入自定义房间，与好友一起游戏
              </p>

              <Button
                className="w-full h-12 text-base font-bold bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500"
                onClick={handleStartMatchmaking}
                disabled={!isConnected || isConnecting}
              >
                {isConnecting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    连接中...
                  </>
                ) : (
                  <>
                    <Trophy className="w-4 h-4 mr-2" />
                    创建/加入房间
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Brief rules */}
        <div className="mt-6 text-[10px] text-slate-600 text-center space-y-0.5">
          <p>广播博弈 | 打击清理 | 防御生存 | 设施发展</p>
          <p>隐藏自己，做好清理 — 最后的文明获胜</p>
        </div>
      </motion.div>
    </div>
  );
}
