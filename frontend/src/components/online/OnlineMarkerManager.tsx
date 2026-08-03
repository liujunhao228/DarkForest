import { useState } from 'react';
import { useStarMapMarkers, type StarMapMarker } from '@/hooks/useStarMapMarkers';
import type { StickyLayout } from '@/hooks/useStickyLayout';
import { StickyPanel } from '@/components/online/StickyPanel';
import { STAR_NODE_MAP } from '@/lib/game/starmap';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ListChecks, MapPin, Highlighter, Trash2, Pencil } from 'lucide-react';

// 根据 systemId 查星系名：找不到时回退到"星系 N"
function getSystemName(systemId: number): string {
  const node = STAR_NODE_MAP.get(systemId);
  return node?.name ?? `星系 ${systemId}`;
}

// 截断 note 至首行 + 12 字符（与 MarkingOverlayLayer SVG 渲染一致：多行 note 仅取首行避免布局错乱）
function truncateFirstLine(note: string, max = 12): string {
  if (!note) return '';
  const firstLine = note.split('\n')[0];
  return firstLine.length <= max ? firstLine : `${firstLine.slice(0, max)}...`;
}

// 格式化区域位置：≤3 个星系全列，超过显示前 3 + "等 N 个星系"
function formatRegionLocation(systemIds: number[]): string {
  if (systemIds.length === 0) return '无星系';
  if (systemIds.length <= 3) {
    return systemIds.map((id) => getSystemName(id)).join(', ');
  }
  return `${systemIds.slice(0, 3).map(getSystemName).join(', ')} 等 ${systemIds.length} 个星系`;
}

// 单条标记行：通过 marker.kind 判别式联合窄化区分图钉/区域
function MarkerRow({
  marker,
  onRemove,
  onEdit,
}: {
  marker: StarMapMarker;
  onRemove: (id: string) => void;
  onEdit: (marker: StarMapMarker) => void;
}) {
  if (marker.kind === 'pin') {
    return (
      <div className="flex items-center gap-2 p-2 bg-slate-800/50 border border-slate-700/50 rounded-lg">
        <MapPin className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
        <span
          className="w-3 h-3 rounded-full flex-shrink-0 border border-white/20"
          style={{ backgroundColor: marker.color }}
        />
        <span className="text-xs text-slate-200 flex-1 truncate">
          {getSystemName(marker.systemId)}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onEdit(marker)}
          className="h-6 w-6 p-0 text-slate-400 hover:text-amber-400 hover:bg-amber-950/30"
          aria-label="编辑注释"
        >
          <Pencil className="w-3 h-3" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onRemove(marker.id)}
          className="h-6 w-6 p-0 text-slate-400 hover:text-red-400 hover:bg-red-950/30"
          aria-label="删除标记"
        >
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>
    );
  }
  // region 分支
  return (
    <div className="p-2 bg-slate-800/50 border border-slate-700/50 rounded-lg space-y-1">
      <div className="flex items-center gap-2">
        <Highlighter className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
        <span
          className="w-3 h-3 rounded-full flex-shrink-0 border border-white/20"
          style={{ backgroundColor: marker.color }}
        />
        <span className="text-xs text-slate-200 flex-1 truncate">
          {formatRegionLocation(marker.systemIds)}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onEdit(marker)}
          className="h-6 w-6 p-0 text-slate-400 hover:text-amber-400 hover:bg-amber-950/30"
          aria-label="编辑注释"
        >
          <Pencil className="w-3 h-3" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onRemove(marker.id)}
          className="h-6 w-6 p-0 text-slate-400 hover:text-red-400 hover:bg-red-950/30"
          aria-label="删除标记"
        >
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>
      {marker.note && (
        <div className="text-[11px] text-slate-400 pl-6 truncate">
          {truncateFirstLine(marker.note)}
        </div>
      )}
    </div>
  );
}

/**
 * 星图标记默认布局：放在左上角，避开右侧 OnlineBroadcastPanel 与笔记本便签。
 */
const MARKER_DEFAULTS: StickyLayout = {
  x: 16,
  y: 80,
  width: 320,
  height: 420,
  locked: false,
  collapsed: true,
};

/**
 * 在线模式星图标记管理面板：基于 StickyPanel 的可拖动可拉伸便签。
 * 列出当前房间所有手动标记（图钉 + 区域），支持单条删除与清空全部。
 * 数据通过 useStarMapMarkers 按房间隔离持久化，与 OnlineStarMap 共享同一 hook，
 * 删除/清空操作会自动同步到星图渲染。
 */
export function OnlineMarkerManager() {
  const { markers, removeMarker, clearAll, updateNote } = useStarMapMarkers();
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  // 编辑注释 Dialog 状态：editingMarker 非空时 Dialog 打开
  const [editingMarker, setEditingMarker] = useState<StarMapMarker | null>(null);
  const [editNoteInput, setEditNoteInput] = useState('');

  const handleConfirmClear = () => {
    clearAll();
    setConfirmClearOpen(false);
  };

  // 打开编辑 Dialog：用 marker 当前 note（pin 可能无 note 视为 ''）初始化输入框
  const openEditDialog = (marker: StarMapMarker) => {
    setEditingMarker(marker);
    setEditNoteInput(marker.note ?? '');
  };

  // 确认编辑：调用 updateNote 写入并关闭 Dialog（pin 与 region 都通过同一 updateNote 处理）
  const confirmEditNote = () => {
    if (!editingMarker) return;
    const note = editNoteInput.trim();
    updateNote(editingMarker.id, note);
    setEditingMarker(null);
    setEditNoteInput('');
  };

  // 取消编辑：丢弃输入，回到列表
  const cancelEditDialog = () => {
    setEditingMarker(null);
    setEditNoteInput('');
  };

  return (
    <>
      <StickyPanel
        kind="marker"
        accent="amber"
        title="星图标记"
        icon={<ListChecks />}
        count={markers.length}
        defaultPosition={{ x: MARKER_DEFAULTS.x, y: MARKER_DEFAULTS.y }}
        defaultSize={{
          width: MARKER_DEFAULTS.width,
          height: MARKER_DEFAULTS.height,
        }}
        onClearAll={() => setConfirmClearOpen(true)}
        clearDisabled={markers.length === 0}
      >
        {markers.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500">
            暂无标记，可从玩家面板进入标记模式添加
          </div>
        ) : (
          markers.map((marker) => (
            <MarkerRow
              key={marker.id}
              marker={marker}
              onRemove={removeMarker}
              onEdit={openEditDialog}
            />
          ))
        )}
      </StickyPanel>

      {/* 清空全部二次确认（Radix Portal 渲染到 body） */}
      <AlertDialog open={confirmClearOpen} onOpenChange={setConfirmClearOpen}>
        <AlertDialogContent className="bg-slate-900 border-slate-700 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">确认清空全部星图标记？</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              此操作将删除当前房间的所有星图标记（共 {markers.length} 个），且无法撤销。
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

      {/* 编辑注释 Dialog：图钉与区域共用，复用区域创建 Dialog 样式（textarea + Ctrl/⌘+Enter 快速确认） */}
      <Dialog
        open={editingMarker !== null}
        onOpenChange={(open) => { if (!open) cancelEditDialog(); }}
      >
        <DialogContent showCloseButton={false} className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingMarker?.kind === 'pin' ? '编辑图钉注释' : '编辑区域注释'}
            </DialogTitle>
            <DialogDescription>
              修改注释内容。按 Ctrl/⌘ + Enter 快速确认。
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={editNoteInput}
            onChange={(e) => setEditNoteInput(e.target.value)}
            placeholder="可留空"
            autoFocus
            className="w-full min-h-[80px] rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500/40 resize-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                confirmEditNote();
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={cancelEditDialog}>取消</Button>
            <Button onClick={confirmEditNote}>确认</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
