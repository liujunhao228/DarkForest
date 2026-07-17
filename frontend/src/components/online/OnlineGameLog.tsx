import { useEffect, useRef, useMemo, useState } from 'react';
import type { ComponentType } from 'react';
import { useOnlineGameStore } from '@/store/onlineGameStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  Info, Activity, Swords, Terminal, Radio,
  Sparkles, Zap, Layers, Crosshair, RotateCw, Pause,
  ChevronRight, Check, BookmarkPlus,
} from 'lucide-react';
import type { LogEntry } from '@/lib/game/types';
import { CARD_DEFINITIONS } from '@/lib/game/cards';
import { useNotepad } from '@/hooks/useNotepad';

// defId → 卡牌名映射（用于日志详情展示）
const CARD_NAME_BY_ID: Record<string, string> = Object.fromEntries(
  CARD_DEFINITIONS.map(def => [def.id, def.name]),
);

// 日志类型
type LogType = LogEntry['type'];

// 所有日志类型
const ALL_TYPES: LogType[] = ['info', 'action', 'combat', 'system', 'broadcast'];

// phase 中文映射（复用 OnlineBoard.tsx 既有命名，未命中的直接显示原值）
const PHASE_LABELS: Record<string, string> = {
  turnBegin: '回合开始',
  strikeMovement: '打击移动',
  drawPhase: '摸牌阶段',
  actionPhase: '行动阶段',
  turnEnd: '回合结束',
  interrupted: '回合中断',
};

// phase 对应图标（与 OnlineBoard.tsx 保持一致，未命中的不显示图标）
const PHASE_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  turnBegin: Sparkles,
  strikeMovement: Zap,
  drawPhase: Layers,
  actionPhase: Crosshair,
  turnEnd: RotateCw,
  interrupted: Pause,
};

// 日志类型差异化样式
interface LogStyle {
  border: string; // 左边框色
  bg: string;     // 底色
  text: string;   // 文字色
  dot: string;    // chip 圆点色
  Icon: ComponentType<{ className?: string }>;
}

const LOG_STYLES: Record<LogType, LogStyle> = {
  info: {
    border: 'border-l-slate-500',
    bg: 'bg-slate-800/40',
    text: 'text-slate-300',
    dot: 'bg-slate-400',
    Icon: Info,
  },
  action: {
    border: 'border-l-emerald-500',
    bg: 'bg-emerald-900/20',
    text: 'text-emerald-300',
    dot: 'bg-emerald-400',
    Icon: Activity,
  },
  combat: {
    border: 'border-l-red-500',
    bg: 'bg-red-900/20',
    text: 'text-red-300',
    dot: 'bg-red-400',
    Icon: Swords,
  },
  system: {
    border: 'border-l-purple-500',
    bg: 'bg-purple-900/20',
    text: 'text-purple-300',
    dot: 'bg-purple-400',
    Icon: Terminal,
  },
  broadcast: {
    border: 'border-l-amber-500',
    bg: 'bg-amber-900/20',
    text: 'text-amber-300',
    dot: 'bg-amber-400',
    Icon: Radio,
  },
};

interface OnlineGameLogProps {
  logs?: LogEntry[];
  replayMode?: boolean;
  autoAdvancing?: boolean;
}

export function OnlineGameLog({ logs: propLogs, replayMode, autoAdvancing }: OnlineGameLogProps) {
  const gameState = useOnlineGameStore(s => s.gameState);
  const scrollRef = useRef<HTMLDivElement>(null);
  // 默认全部类型选中
  const [selectedTypes, setSelectedTypes] = useState<Set<LogType>>(() => new Set(ALL_TYPES));
  // 展开的日志条目 id 集合（点击条目切换展开/收起）
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // 记事本：加入日志条目 + 防重复
  const { addEntry, hasSourceLog } = useNotepad();

  // 把日志加入记事本：派发自定义事件让 OnlineNotepad 自动展开 + 高亮新条目
  // 注意：按需求不弹出 Toast，仅通过便签自动展开 + 高亮提供视觉反馈
  const handleAddToNotepad = (log: LogEntry) => {
    addEntry(log.message, log.id);
    window.dispatchEvent(
      new CustomEvent('df:open-notepad', { detail: { sourceLogId: log.id } }),
    );
  };

  // propLogs（回放）与 gameState.logs（在线）统一处理
  const logs = useMemo(() => propLogs || gameState?.logs || [], [propLogs, gameState?.logs]);

  // 先按选中类型过滤
  const filteredLogs = useMemo(
    () => logs.filter(log => selectedTypes.has(log.type)),
    [logs, selectedTypes],
  );

  // 再按 (turn, phase) 分组，保留原顺序
  const groups = useMemo(() => {
    const result: Array<{ key: string; turn: number; phase: string; entries: LogEntry[] }> = [];
    for (const log of filteredLogs) {
      const key = `${log.turn}-${log.phase}`;
      const last = result[result.length - 1];
      if (last && last.key === key) {
        last.entries.push(log);
      } else {
        result.push({ key, turn: log.turn, phase: log.phase, entries: [log] });
      }
    }
    return result;
  }, [filteredLogs]);

  // 最后一条日志的 id（用于触发自动滚动，比 length 更精确）
  const lastLogId = logs.length > 0 ? logs[logs.length - 1].id : '';

  useEffect(() => {
    // 回放 seek 时不自动滚动到底部，避免打断用户查看历史
    if (replayMode && !autoAdvancing) return;
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lastLogId, replayMode, autoAdvancing]);

  // 切换某个类型选中态；若清空则回到"全部"
  const toggleType = (type: LogType) => {
    setSelectedTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      if (next.size === 0) return new Set(ALL_TYPES);
      return next;
    });
  };

  const selectAll = () => setSelectedTypes(new Set(ALL_TYPES));

  const isAllSelected = selectedTypes.size === ALL_TYPES.length;

  if (!gameState && !propLogs) return null;

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-lg overflow-hidden">
      {/* 顶部标题栏 */}
      <div className="px-3 py-1.5 border-b border-slate-800 flex items-center justify-between">
        <span className="text-xs font-bold text-slate-400">📋 游戏日志</span>
        <Badge variant="outline" className="text-[8px] px-1 py-0 border-slate-700 text-slate-500">
          回合 {logs.length > 0 ? logs[logs.length - 1].turn : 0}
        </Badge>
      </div>

      {/* 事件类型过滤栏 */}
      <div className="px-2 py-1.5 border-b border-slate-800/50 flex flex-wrap items-center gap-1">
        <FilterChip
          label="全部"
          active={isAllSelected}
          onClick={selectAll}
        />
        {ALL_TYPES.map(type => {
          const style = LOG_STYLES[type];
          return (
            <FilterChip
              key={type}
              label={type}
              dotClass={style.dot}
              active={selectedTypes.has(type)}
              onClick={() => toggleType(type)}
            />
          );
        })}
      </div>

      {/* 日志列表（按 turn + phase 分组） */}
      <ScrollArea className="h-32" ref={scrollRef}>
        <div className="p-2 space-y-2">
          {groups.length === 0 ? (
            <div className="text-[11px] text-slate-500 text-center py-2">无匹配日志</div>
          ) : (
            groups.map(group => {
              const PhaseIcon = PHASE_ICONS[group.phase];
              const phaseLabel = PHASE_LABELS[group.phase] || group.phase;
              return (
                <div key={group.key} className="space-y-0.5">
                  {/* 组头 */}
                  <div className="flex items-center gap-1 text-[10px] text-slate-400 font-bold border-b border-slate-800/50 pb-0.5">
                    {PhaseIcon ? <PhaseIcon className="w-3 h-3 flex-shrink-0" /> : null}
                    <span>第 {group.turn} 回合 · {phaseLabel}</span>
                  </div>
                  {/* 组内条目 */}
                  {group.entries.map(log => {
                    const style = LOG_STYLES[log.type];
                    const StyleIcon = style.Icon;
                    const isExpanded = expandedIds.has(log.id);
                    const added = hasSourceLog(log.id);
                    return (
                      <div
                        key={log.id}
                        className={`group relative text-[11px] leading-relaxed border-l-2 ${style.border} ${style.bg} ${style.text} pl-1.5 pr-6 py-0.5 rounded-r`}
                      >
                        <button
                          type="button"
                          onClick={() => toggleExpand(log.id)}
                          className="flex items-start gap-1 w-full text-left"
                          aria-expanded={isExpanded}
                        >
                          <StyleIcon className="w-3 h-3 mt-0.5 flex-shrink-0 opacity-70" />
                          <span className="break-words flex-1">
                            {log.type === 'system'
                              ? <span className="font-bold">&gt; {log.message}</span>
                              : log.message}
                          </span>
                          <ChevronRight className={`w-3 h-3 mt-0.5 flex-shrink-0 opacity-50 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                        </button>
                        {/* 加入记事本按钮：hover 显示；已添加时变为禁用态 */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAddToNotepad(log);
                          }}
                          disabled={added}
                          className={`absolute right-0.5 top-0.5 p-0.5 rounded transition-opacity ${
                            added
                              ? 'opacity-40 cursor-not-allowed'
                              : 'opacity-0 group-hover:opacity-100 hover:text-cyan-300 hover:bg-slate-700/50'
                          }`}
                          aria-label={added ? '已加入记事本' : '加入记事本'}
                          title={added ? '已加入记事本' : '加入记事本'}
                        >
                          {added
                            ? <Check className="w-3 h-3" />
                            : <BookmarkPlus className="w-3 h-3" />}
                        </button>
                        {isExpanded && <LogEntryDetails log={log} players={gameState?.players} />}
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// 过滤 chip 子组件
interface FilterChipProps {
  label: string;
  active: boolean;
  onClick: () => void;
  dotClass?: string;
}

function FilterChip({ label, active, onClick, dotClass }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors flex items-center gap-1 ${
        active
          ? 'bg-slate-700 border-slate-600 text-slate-100'
          : 'bg-transparent border-slate-700 text-slate-500 hover:text-slate-300'
      }`}
    >
      {dotClass ? <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} /> : null}
      <span>{label}</span>
    </button>
  );
}

// 日志条目结构化详情：读取 LogEntry 的 systemId/cardDefId/playerIds 字段
// 字段缺失时优雅降级（不显示对应行）；全部缺失时显示"无结构化详情"
interface LogEntryDetailsProps {
  log: LogEntry;
  // 回放模式下 gameState 可能缺失，此时 playerIds 显示原值
  players?: Array<{ id: string; name: string }>;
}

function LogEntryDetails({ log, players }: LogEntryDetailsProps) {
  const hasSystemId = log.systemId !== undefined;
  const hasCardDefId = !!log.cardDefId;
  const hasPlayerIds = !!log.playerIds && log.playerIds.length > 0;

  // 卡牌 defId → 名称（找不到时显示 defId 原值）
  const cardName = log.cardDefId ? (CARD_NAME_BY_ID[log.cardDefId] ?? log.cardDefId) : undefined;
  // 玩家 id → 名称（找不到时显示 playerId 原值；无 players 上下文时也显示原值）
  const playerNames = log.playerIds?.map(pid => players?.find(p => p.id === pid)?.name ?? pid);

  const hasAnything = hasSystemId || hasCardDefId || hasPlayerIds;

  if (!hasAnything) {
    return <div className="mt-0.5 pl-4 text-[10px] text-slate-500 italic">无结构化详情</div>;
  }

  return (
    <div className="mt-0.5 pl-4 text-[10px] text-slate-400 space-y-0.5">
      {hasSystemId && <div>星系: {log.systemId}</div>}
      {hasCardDefId && <div>卡牌: {cardName}</div>}
      {hasPlayerIds && <div>玩家: {playerNames?.join(', ')}</div>}
    </div>
  );
}
