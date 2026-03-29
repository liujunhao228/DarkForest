'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useGameStore } from '@/store/gameStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function GameSetup({ onStart }: { onStart: (playerCount: number, playerName: string) => void }) {
  const [playerCount, setPlayerCount] = useState(4);
  const [playerName, setPlayerName] = useState('地球文明');
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 p-4">
      <motion.div
        initial={isMounted ? { opacity: 0, y: 20 } : false}
        animate={isMounted ? { opacity: 1, y: 0 } : { opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="w-full max-w-md"
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

        {/* Setup form */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-6 space-y-6 backdrop-blur">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm text-slate-300">文明名称</Label>
              <Input
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="输入你的文明名称"
                className="bg-slate-800 border-slate-700 text-white"
                maxLength={8}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm text-slate-300">玩家人数</Label>
              <Select value={String(playerCount)} onValueChange={(v) => setPlayerCount(Number(v))}>
                <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  <SelectItem value="3">3 名玩家</SelectItem>
                  <SelectItem value="4">4 名玩家</SelectItem>
                  <SelectItem value="5">5 名玩家</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="text-xs text-slate-500 space-y-1">
            <p>• 你将扮演 <span className="text-cyan-400">{playerName || '地球文明'}</span></p>
            <p>• 对手: {playerCount - 1} 个 AI 文明</p>
            <p>• 初始能量: ⚡3 &nbsp;|&nbsp; 初始手牌: 4 张</p>
          </div>

          <Button
            className="w-full h-12 text-base font-bold bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 text-white border-0"
            onClick={() => onStart(playerCount, playerName)}
          >
            🌌 开始游戏
          </Button>
        </div>

        {/* Brief rules */}
        <div className="mt-6 text-[10px] text-slate-600 text-center space-y-0.5">
          <p>广播博弈 | 打击清理 | 防御生存 | 设施发展</p>
          <p>隐藏自己，做好清理 — 最后的文明获胜</p>
        </div>
      </motion.div>
    </div>
  );
}
