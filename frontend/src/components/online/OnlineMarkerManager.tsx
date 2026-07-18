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
import { ListChecks, MapPin, Highlighter, Trash2 } from 'lucide-react';

// 根据 systemId 查星系名：找不到时回退到"星系 N"
function getSystemName(systemId: number): string {
  const node = STAR_NODE_MAP.get(systemId);
  return node?.name ?? `星系 ${systemId}`;
}

// 截断注释到指定长度（默认 20 字符 + "..."）
function truncateNote(note: string, max = 20): string {
  if (note.length <= max) return note;
  return `${note.slice(0, max)}...`;
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
}: {
  marker: StarMapMarker;
  onRemove: (id: string) => void;
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
          onClick={() => onRemove(marker.id)}
          className="h-6 w-6 p-0 text-slate-400 hover:text-red-400 hover:bg-red-950/30"
          aria-label="删除标记"
        >
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>
      {marker.note && (
        <div className="text-[11px] text-slate-400 pl-6 truncate">
          {truncateNote(marker.note)}
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
  const { markers, removeMarker, clearAll } = useStarMapMarkers();
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  const handleConfirmClear = () => {
    clearAll();
    setConfirmClearOpen(false);
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
            <MarkerRow key={marker.id} marker={marker} onRemove={removeMarker} />
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
    </>
  );
}
