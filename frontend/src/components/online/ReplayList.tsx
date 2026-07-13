import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatDate } from '@/lib/utils';
import { listReplays } from '@/api/replay';
import type { ReplayListItem } from '@/api/replay';
import { PLAYER_COLORS } from '@/lib/game/playerColors';

const PAGE_SIZE = 20;

interface ReplayListProps {
  onSelectReplay: (replayId: string) => void;
}

export function ReplayList({ onSelectReplay }: ReplayListProps) {
  const [replays, setReplays] = useState<ReplayListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const loadReplayList = useCallback(async (fetchOffset: number, append: boolean) => {
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      setError(null);
    }
    try {
      const response = await listReplays(PAGE_SIZE, fetchOffset);
      if (append) {
        setReplays(prev => [...prev, ...response.replays]);
      } else {
        setReplays(response.replays);
      }
      setHasMore(response.replays.length >= PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载回放列表失败');
    } finally {
      if (append) setLoadingMore(false);
      else setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadReplayList(0, false);
  }, [loadReplayList]);

  const handleLoadMore = () => {
    void loadReplayList(replays.length, true);
  };

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
          <Button onClick={() => loadReplayList(0, false)}>重试</Button>
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
              <CardTitle className="text-lg">游戏 #{replay.matchId.slice(-8)}</CardTitle>
              <CardDescription className="flex items-center justify-between">
                <span>{formatDate(replay.createdAt * 1000)}</span>
                <span>{replay.actionCount} 回合</span>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">玩家:</span>
                  <div className="flex flex-wrap gap-2">
                    {replay.playerNames.map((name, idx) => {
                      const playerId = replay.playerIds[idx];
                      const isWinner = replay.winner === playerId;
                      return (
                        <span
                          key={playerId}
                          className="text-xs px-2 py-1 rounded-full"
                          style={{ backgroundColor: PLAYER_COLORS[idx % PLAYER_COLORS.length], color: '#fff' }}
                        >
                          {name}
                          {isWinner && ' 🏆'}
                        </span>
                      );
                    })}
                  </div>
                </div>
                <div className="text-sm">
                  <span className="font-medium">胜利者:</span>{' '}
                  {replay.winner
                    ? replay.playerNames[replay.playerIds.indexOf(replay.winner)] ?? '未知'
                    : '平局'}
                </div>
              </div>
            </CardContent>
            <CardFooter className="pt-0">
              <Button variant="default" className="w-full" onClick={() => onSelectReplay(replay.id)}>
                观看回放
              </Button>
            </CardFooter>
          </Card>
        ))}

        {hasMore && (
          <div className="flex justify-center pt-2">
            <Button
              variant="outline"
              onClick={handleLoadMore}
              disabled={loadingMore}
            >
              {loadingMore ? '加载中...' : '加载更多'}
            </Button>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
