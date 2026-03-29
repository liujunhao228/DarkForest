'use client';

import { useEffect, useRef } from 'react';
import { useGameStore } from '@/store/gameStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';

const LOG_COLORS: Record<string, string> = {
  info: 'text-slate-300',
  action: 'text-cyan-400',
  combat: 'text-red-400',
  system: 'text-purple-400',
  broadcast: 'text-emerald-400',
};

export function GameLog() {
  const logs = useGameStore(s => s.logs);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs.length]);

  const recentLogs = logs.slice(-50);

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-lg overflow-hidden">
      <div className="px-3 py-1.5 border-b border-slate-800 flex items-center justify-between">
        <span className="text-xs font-bold text-slate-400">📋 游戏日志</span>
        <Badge variant="outline" className="text-[8px] px-1 py-0 border-slate-700 text-slate-500">
          回合 {logs.length > 0 ? logs[logs.length - 1].turn : 0}
        </Badge>
      </div>
      <ScrollArea className="h-32" ref={scrollRef}>
        <div className="p-2 space-y-0.5">
          {recentLogs.map((log) => (
            <div
              key={log.id}
              className={`text-[11px] leading-relaxed ${LOG_COLORS[log.type] || 'text-slate-400'}`}
            >
              {log.type === 'system' ? (
                <span className="font-bold">{'> '}{log.message}</span>
              ) : (
                <span>{log.message}</span>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
