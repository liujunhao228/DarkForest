// ============================
// 回放播放器组件
// ============================

import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useSocket } from '@/hooks/useSocket';
import type { ReplayData, ReplayStateNode, ReplayDelta } from '@/lib/game/types';
import { createViewState } from '@/server/ViewManager';
import { OnlineStarMap } from './OnlineStarMap';
import { OnlinePlayerPanel } from './OnlinePlayerPanel';
import { OnlineGameLog } from './OnlineGameLog';

interface ReplayPlayerProps {
  replayId: string;
  onClose: () => void;
}

export function ReplayPlayer({ replayId, onClose }: ReplayPlayerProps) {
  const [replayData, setReplayData] = useState<ReplayData | null>(null);
  const [currentVersion, setCurrentVersion] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [currentState, setCurrentState] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const playbackInterval = useRef<NodeJS.Timeout | null>(null);
  const socket = useSocket();

  // 加载回放数据
  useEffect(() => {
    if (socket) {
      socket.emit('replay:load', { replayId });

      const handleReplayData = (data: any) => {
        setReplayData(data);
        setLoading(false);
        // 设置初始状态
        if (data.snapshots && data.snapshots.length > 0) {
          const initialState = data.snapshots[0].state;
          setCurrentState(initialState);
          setSelectedPlayerId(initialState.players[0].id);
        }
      };

      const handleReplayError = (data: { error: string }) => {
        setError(data.error);
        setLoading(false);
      };

      socket.on('replay:data', handleReplayData);
      socket.on('replay:error', handleReplayError);

      return () => {
        socket.off('replay:data', handleReplayData);
        socket.off('replay:error', handleReplayError);
      };
    }
  }, [socket, replayId]);

  // 播放控制
  useEffect(() => {
    if (isPlaying && replayData) {
      playbackInterval.current = setInterval(() => {
        setCurrentVersion(prev => {
          const maxVersion = replayData.snapshots[replayData.snapshots.length - 1].version;
          if (prev >= maxVersion) {
            setIsPlaying(false);
            return maxVersion;
          }
          return prev + 1;
        });
      }, 1000 / playbackSpeed);
    } else if (playbackInterval.current) {
      clearInterval(playbackInterval.current);
      playbackInterval.current = null;
    }

    return () => {
      if (playbackInterval.current) {
        clearInterval(playbackInterval.current);
      }
    };
  }, [isPlaying, playbackSpeed, replayData]);

  // 更新当前状态
  useEffect(() => {
    if (replayData && currentVersion) {
      // 找到最接近的快照
      const snapshot = replayData.snapshots.find(s => s.version <= currentVersion);
      if (snapshot) {
        setCurrentState(snapshot.state);
      }
    }
  }, [currentVersion, replayData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">加载回放数据...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <p className="text-destructive mb-4">{error}</p>
          <Button onClick={onClose}>返回</Button>
        </div>
      </div>
    );
  }

  if (!replayData || !currentState) {
    return null;
  }

  const maxVersion = replayData.snapshots[replayData.snapshots.length - 1].version;
  const currentSnapshot = replayData.snapshots.find(s => s.version === currentVersion);
  const viewState = createViewState(currentState, {
    role: 'REPLAY',
    playerId: selectedPlayerId || currentState.players[0].id
  });

  return (
    <div className="space-y-4">
      {/* 回放控制栏 */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle>回放控制</CardTitle>
            <Button variant="ghost" size="sm" onClick={onClose}>
              关闭
            </Button>
          </div>
          <CardDescription>
            游戏 #{replayData.metadata.gameId.slice(-8)} · {replayData.metadata.players.length} 玩家
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* 进度条 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>版本: {currentVersion} / {maxVersion}</span>
                <span>回合: {currentState.totalTurn}</span>
              </div>
              <Slider
                value={[currentVersion]}
                min={1}
                max={maxVersion}
                step={1}
                onValueChange={(value) => setCurrentVersion(value[0])}
              />
            </div>

            {/* 控制按钮 */}
            <div className="flex items-center gap-4">
              <Button
                variant="default"
                size="sm"
                onClick={() => setIsPlaying(!isPlaying)}
              >
                {isPlaying ? '暂停' : '播放'}
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={() => setCurrentVersion(1)}
              >
                重置
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={() => setCurrentVersion(prev => Math.max(1, prev - 10))}
              >
                快退
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={() => setCurrentVersion(prev => Math.min(maxVersion, prev + 10))}
              >
                快进
              </Button>
              <Select value={playbackSpeed.toString()} onValueChange={(value) => setPlaybackSpeed(parseFloat(value))}>
                <SelectTrigger className="w-24">
                  <SelectValue placeholder="速度" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0.5">0.5x</SelectItem>
                  <SelectItem value="1">1x</SelectItem>
                  <SelectItem value="2">2x</SelectItem>
                  <SelectItem value="4">4x</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 视角选择 */}
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium">视角:</span>
              <div className="flex flex-wrap gap-2">
                {replayData.metadata.players.map((player) => (
                  <Button
                    key={player.id}
                    variant={selectedPlayerId === player.id ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setSelectedPlayerId(player.id)}
                    style={{ 
                      borderColor: player.color, 
                      color: selectedPlayerId === player.id ? '#fff' : player.color 
                    }}
                    className={selectedPlayerId === player.id ? 'bg-primary' : ''}
                  >
                    {player.name}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 游戏界面 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 星图 */}
        <div className="lg:col-span-2">
          <Card className="h-[500px]">
            <CardHeader>
              <CardTitle>星图</CardTitle>
              <CardDescription>回合: {currentState.totalTurn} · 阶段: {currentState.turnPhase}</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <OnlineStarMap 
                gameState={viewState} 
                onStrikeMove={() => {}} 
                onBroadcast={() => {}} 
                onSelectSystem={() => {}}
              />
            </CardContent>
          </Card>
        </div>

        {/* 玩家信息和日志 */}
        <div className="space-y-4">
          {/* 玩家面板 */}
          <Card>
            <CardHeader>
              <CardTitle>玩家信息</CardTitle>
            </CardHeader>
            <CardContent>
              <OnlinePlayerPanel gameState={viewState} />
            </CardContent>
          </Card>

          {/* 游戏日志 */}
          <Card className="h-[300px]">
            <CardHeader>
              <CardTitle>游戏日志</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[240px]">
                <OnlineGameLog logs={viewState.logs || []} />
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
