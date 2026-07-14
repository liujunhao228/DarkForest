import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Share2, Check, Film, Calendar, Swords, Crown, Trophy, Play, AlertCircle, Clapperboard, Loader2, ChevronDown } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { listReplays } from '@/api/replay';
import type { ReplayListItem } from '@/api/replay';
import { PLAYER_COLORS } from '@/lib/game/playerColors';
import { buildReplayShareUrl } from '@/lib/replayShare';

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
  const [copiedReplayId, setCopiedReplayId] = useState<string | null>(null);

  const handleShare = async (replayId: string) => {
    try {
      await navigator.clipboard.writeText(buildReplayShareUrl(replayId));
      setCopiedReplayId(replayId);
      setTimeout(() => setCopiedReplayId(null), 1200);
    } catch (err) {
      console.error('复制分享链接失败:', err);
    }
  };

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
      <div className="space-y-4 pr-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-slate-900/80 border border-slate-800 rounded-xl p-6 space-y-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-56" />
            <div className="flex gap-2 pt-2">
              <Skeleton className="h-6 w-16 rounded-full" />
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
            <Skeleton className="h-9 w-full mt-2" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center max-w-sm">
          <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
            <AlertCircle className="w-6 h-6 text-red-400" />
          </div>
          <p className="text-destructive mb-4">{error}</p>
          <Button onClick={() => loadReplayList(0, false)}>重试</Button>
        </div>
      </div>
    );
  }

  if (replays.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center">
            <Clapperboard className="w-6 h-6 text-slate-400" />
          </div>
          <p className="text-muted-foreground">暂无回放记录</p>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[600px] pr-4">
      <div className="space-y-4">
        {replays.map((replay) => (
          <Card key={replay.id} className="cursor-pointer bg-slate-900/80 border-slate-800 backdrop-blur-xl hover:border-purple-500/40 hover:shadow-lg hover:shadow-purple-500/10 transition-all animate-fade-in">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Film className="w-4 h-4 text-purple-400" />
                <span>游戏 <span className="font-mono text-cyan-300">#{replay.matchId.slice(-8)}</span></span>
              </CardTitle>
              <CardDescription className="flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {formatDate(replay.createdAt * 1000)}
                </span>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-slate-700 text-slate-400 flex items-center gap-1">
                  <Swords className="w-3 h-3" />
                  {replay.actionCount} 回合
                </Badge>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {replay.playerNames.map((name, idx) => {
                    const playerId = replay.playerIds[idx];
                    const isWinner = replay.winner === playerId;
                    return (
                      <span
                        key={playerId}
                        className="text-xs px-2.5 py-1 rounded-full ring-1 ring-white/10 flex items-center gap-1"
                        style={{ backgroundColor: PLAYER_COLORS[idx % PLAYER_COLORS.length], color: '#fff' }}
                      >
                        {name}
                        {isWinner && <Crown className="w-3 h-3" />}
                      </span>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {replay.winner ? (
                    <span className="flex items-center gap-1 text-emerald-400">
                      <Trophy className="w-3.5 h-3.5" />
                      胜者：{replay.playerNames[replay.playerIds.indexOf(replay.winner)] ?? '未知'}
                    </span>
                  ) : (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-slate-700 text-slate-400">
                      平局
                    </Badge>
                  )}
                </div>
              </div>
            </CardContent>
            <CardFooter className="pt-0 gap-2">
              <Button variant="default" className="flex-1 gap-2" onClick={() => onSelectReplay(replay.id)}>
                <Play className="w-4 h-4" />
                观看回放
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => handleShare(replay.id)}
                title="复制分享链接"
              >
                {copiedReplayId === replay.id ? (
                  <Check className="w-4 h-4 text-green-400" />
                ) : (
                  <Share2 className="w-4 h-4" />
                )}
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
              className="gap-2"
            >
              {loadingMore ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  加载中...
                </>
              ) : (
                <>
                  <ChevronDown className="w-4 h-4" />
                  加载更多
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
