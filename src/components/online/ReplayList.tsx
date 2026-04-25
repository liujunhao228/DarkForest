// ============================
// 回放列表组件
// ============================

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatDuration, formatDate } from '@/lib/utils';
import { useSocket } from '@/hooks/useSocket';

interface ReplayItem {
  id: string;
  gameId: string;
  startTime: number;
  duration: number;
  playerCount: number;
  players: Array<{
    id: string;
    name: string;
    color: string;
  }>;
  winner: string | null;
}

interface ReplayListProps {
  onSelectReplay: (replay: ReplayItem) => void;
}

export function ReplayList({ onSelectReplay }: ReplayListProps) {
  const [replays, setReplays] = useState<ReplayItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const socket = useSocket();

  useEffect(() => {
    if (socket) {
      // 请求回放列表
      socket.emit('replay:list');

      // 监听回放列表响应
      const handleReplayList = (data: { replays: ReplayItem[] }) => {
        setReplays(data.replays);
        setLoading(false);
      };

      // 监听错误
      const handleReplayError = (data: { error: string }) => {
        setError(data.error);
        setLoading(false);
      };

      socket.on('replay:list', handleReplayList);
      socket.on('replay:error', handleReplayError);

      return () => {
        socket.off('replay:list', handleReplayList);
        socket.off('replay:error', handleReplayError);
      };
    }
  }, [socket]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">加载回放列表...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <p className="text-destructive mb-4">{error}</p>
          <Button onClick={() => window.location.reload()}>重试</Button>
        </div>
      </div>
    );
  }

  if (replays.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">暂无回放记录</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[600px] pr-4">
      <div className="space-y-4">
        {replays.map((replay) => (
          <Card key={replay.id} className="cursor-pointer hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">
                游戏 #{replay.gameId.slice(-8)}
              </CardTitle>
              <CardDescription className="flex items-center justify-between">
                <span>{formatDate(replay.startTime)}</span>
                <span>{formatDuration(replay.duration)}</span>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">玩家:</span>
                  <div className="flex flex-wrap gap-2">
                    {replay.players.map((player, index) => (
                      <span
                        key={player.id}
                        className="text-xs px-2 py-1 rounded-full"
                        style={{ backgroundColor: player.color, color: '#fff' }}
                      >
                        {player.name}
                        {replay.winner === player.id && ' 🏆'}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="text-sm">
                  <span className="font-medium">胜利者:</span> {replay.winner ? 
                    replay.players.find(p => p.id === replay.winner)?.name : '平局'}
                </div>
              </div>
            </CardContent>
            <CardFooter className="pt-0">
              <Button 
                variant="default" 
                className="w-full"
                onClick={() => onSelectReplay(replay)}
              >
                观看回放
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </ScrollArea>
  );
}
