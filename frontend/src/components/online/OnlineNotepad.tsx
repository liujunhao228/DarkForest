import { useState, useEffect } from 'react';
import { useNotepad, type NotepadEntry } from '@/hooks/useNotepad';
import { useStickyLayout, type StickyLayout } from '@/hooks/useStickyLayout';
import { StickyPanel } from '@/components/online/StickyPanel';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Notebook, Trash2, Pencil, Check, Undo2 } from 'lucide-react';

/**
 * 将时间戳格式化为相对时间（简单实现，不引入新依赖）。
 * - < 1 分钟：刚刚
 * - < 1 小时：X 分钟前
 * - < 1 天：X 小时前
 * - 其它：HH:MM
 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = Math.max(0, now - timestamp);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return '刚刚';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * 笔记本默认布局：避开右侧 OnlineBroadcastPanel（right-4 w-80 = 320px + 16px 间距）。
 * x 在客户端计算，避免 SSR 问题（本项目为纯 CSR SPA）。
 */
const NOTEPAD_DEFAULTS: StickyLayout = {
  x: typeof window !== 'undefined' ? Math.max(16, window.innerWidth - 360) : 16,
  y: 80,
  width: 320,
  height: 480,
  locked: false,
  collapsed: true,
};

/**
 * 在线模式记事本：基于 StickyPanel 的可拖动可拉伸便签。
 * 折叠态为右下角小图标按钮（带条目数 badge），展开态为可拖动可拉伸面板。
 * 数据通过 useNotepad 按房间隔离持久化；布局通过 useStickyLayout 按房间+kind 隔离持久化。
 */
export function OnlineNotepad() {
  const { entries, updateEntry, removeEntry, clearAll } = useNotepad();
  // 复用 StickyPanel 内部使用的同一份 layout store，用于外部触发"展开"
  const { setLayout } = useStickyLayout('notepad', NOTEPAD_DEFAULTS);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  // 高亮新加入条目的 sourceLogId（1.5s 后清除）；用 sourceLogId 匹配避免依赖 entries 闭包
  const [highlightSourceLogId, setHighlightSourceLogId] = useState<string | null>(null);

  // 监听"加入记事本"自定义事件：自动展开面板 + 高亮新条目 1.5s
  // 事件由 OnlineGameLog 的"加入记事本"按钮派发，detail 携带 sourceLogId
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ sourceLogId?: string }>).detail;
      const targetSourceLogId = detail?.sourceLogId ?? null;
      // 展开便签（覆盖持久化的 collapsed 状态）
      setLayout({ collapsed: false });
      if (!targetSourceLogId) return;
      setHighlightSourceLogId(targetSourceLogId);
      window.setTimeout(() => {
        setHighlightSourceLogId((prev) =>
          prev === targetSourceLogId ? null : prev,
        );
      }, 1500);
    };
    window.addEventListener('df:open-notepad', handler);
    return () => window.removeEventListener('df:open-notepad', handler);
  }, [setLayout]);

  const handleStartEdit = (entry: NotepadEntry) => {
    setEditingId(entry.id);
    setEditingText(entry.text);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditingText('');
  };

  // 保存编辑：清空文本视为删除条目，保持数据整洁
  const handleSaveEdit = () => {
    if (editingId === null) return;
    const trimmed = editingText.trim();
    if (!trimmed) {
      removeEntry(editingId);
    } else {
      updateEntry(editingId, trimmed);
    }
    setEditingId(null);
    setEditingText('');
  };

  const handleConfirmClear = () => {
    clearAll();
    setConfirmClearOpen(false);
  };

  return (
    <>
      <StickyPanel
        kind="notepad"
        accent="cyan"
        title="记事本"
        icon={<Notebook />}
        count={entries.length}
        defaultPosition={{ x: NOTEPAD_DEFAULTS.x, y: NOTEPAD_DEFAULTS.y }}
        defaultSize={{
          width: NOTEPAD_DEFAULTS.width,
          height: NOTEPAD_DEFAULTS.height,
        }}
        onClearAll={() => setConfirmClearOpen(true)}
        clearDisabled={entries.length === 0}
      >
        {entries.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500">
            暂无记事本条目，可从游戏日志添加
          </div>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.id}
              className={`bg-slate-800/50 border rounded-lg p-2 space-y-1.5 transition-colors duration-300 ${
                entry.sourceLogId !== undefined &&
                entry.sourceLogId === highlightSourceLogId
                  ? 'border-cyan-400 bg-cyan-950/40 ring-1 ring-cyan-400/50'
                  : 'border-slate-700/50'
              }`}
            >
              {editingId === entry.id ? (
                // 编辑态：textarea + 保存/取消
                <>
                  <textarea
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    autoFocus
                    rows={3}
                    className="w-full bg-slate-900/80 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 resize-none focus:outline-none focus:ring-1 focus:ring-cyan-500"
                  />
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCancelEdit}
                      className="h-7 px-2 text-[11px] text-slate-400 hover:text-white hover:bg-slate-700"
                    >
                      <Undo2 className="w-3 h-3 mr-1" />取消
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleSaveEdit}
                      className="h-7 px-2 text-[11px] text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/30"
                    >
                      <Check className="w-3 h-3 mr-1" />保存
                    </Button>
                  </div>
                </>
              ) : (
                // 展示态：文本 + 时间 + 编辑/删除按钮
                <>
                  <div className="text-xs text-slate-200 whitespace-pre-wrap break-words leading-relaxed">
                    {entry.text}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-500">
                      {formatRelativeTime(entry.createdAt)}
                    </span>
                    <div className="flex items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleStartEdit(entry)}
                        className="h-7 w-7 p-0 text-slate-400 hover:text-cyan-400 hover:bg-slate-700/50"
                        aria-label="编辑条目"
                      >
                        <Pencil className="w-3 h-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeEntry(entry.id)}
                        className="h-7 w-7 p-0 text-slate-400 hover:text-red-400 hover:bg-red-950/30"
                        aria-label="删除条目"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </StickyPanel>

      {/* 清空全部二次确认（Radix Portal 渲染到 body，不受 StickyPanel 层级影响） */}
      <AlertDialog open={confirmClearOpen} onOpenChange={setConfirmClearOpen}>
        <AlertDialogContent className="bg-slate-900 border-slate-700 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">确认清空全部记事本条目？</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              此操作将删除当前房间的所有记事本条目（共 {entries.length} 条），且无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700">
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmClear}
              className="bg-red-600 hover:bg-red-700 text-white border-0"
            >
              确认清空
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
