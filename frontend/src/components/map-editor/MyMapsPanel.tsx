import { useState, useEffect } from 'react';
import { listMyMaps, getMap, deleteMap, type MapData, type MapLayoutSnapshot } from '@/api/maps';
import { parseHttpError } from '@/api/http';
import type { MapSource } from '@/pages/mapEditorState';
import { toast } from 'sonner';
import { X, FolderOpen, Trash2, Copy } from 'lucide-react';

interface MyMapsPanelProps {
  onClose: () => void;
  onLoad: (layout: MapLayoutSnapshot, source: MapSource) => void;
  onDeleted: () => void;
}

/** 个人地图配额上限（与后端 CountUserMaps 限制一致）。 */
const MAP_QUOTA = 10;

/**
 * 「我的地图」弹窗：列出当前登录用户上传的个人地图（is_official=false），
 * 支持复制 ID / 加载到编辑器 / 删除。地图 ID 是社区流通载体，无平台内广场入口。
 */
export default function MyMapsPanel({ onClose, onLoad, onDeleted }: MyMapsPanelProps) {
  const [maps, setMaps] = useState<MapData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    setLoading(true);
    setError(null);
    // refresh 由用户操作触发；组件卸载时挂载态请求由 useEffect cleanup 处理，
    // 此处不再单独追踪 cancel（React 18+ 对卸载后 setState 为 no-op，无告警）。
    listMyMaps()
      .then((data) => {
        setMaps(data);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : '加载我的地图失败');
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    // 挂载时拉取一次我的地图列表（loading 初始为 true，无需重复设置）
    let cancelled = false;
    listMyMaps()
      .then((data) => {
        if (cancelled) return;
        setMaps(data);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : '加载我的地图失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCopyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      toast.success('已复制');
    } catch {
      toast.error('剪贴板写入失败');
    }
  };

  const handleLoad = async (m: MapData) => {
    try {
      // 重新拉取最新 layoutJson（列表数据已含 layoutJson，但显式 getMap 保证一致性）
      const fresh = await getMap(m.id);
      onLoad(fresh.layoutJson, {
        kind: 'mine',
        mapId: fresh.id,
        ownedByMe: true,
        originName: fresh.name,
      });
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载地图失败');
    }
  };

  const handleDelete = async (m: MapData) => {
    if (!window.confirm(`确认删除地图 "${m.name}"？此操作不可撤销。`)) return;
    try {
      await deleteMap(m.id);
      toast.success('已删除');
      refresh();
      onDeleted();
    } catch (err) {
      const parsed = parseHttpError(err);
      if (parsed?.status === 409) {
        toast.error('被 waiting 房间引用，无法删除');
      } else if (parsed?.status === 403) {
        toast.error('无权删除他人地图');
      } else {
        toast.error(parsed?.message ?? (err instanceof Error ? err.message : '删除失败'));
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-slate-800 border border-slate-700 rounded-lg p-6 max-w-lg w-full mx-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-100">我的地图</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="text-slate-400 text-sm py-8 text-center">加载中...</div>
          ) : error ? (
            <div className="text-red-400 text-sm py-8 text-center">{error}</div>
          ) : maps.length === 0 ? (
            <div className="text-slate-400 text-sm italic py-8 text-center">
              尚未上传地图，在编辑器创建后点「保存到 DB」
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {maps.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between bg-slate-900/50 border border-slate-700 rounded p-2"
                >
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-sm text-slate-100 truncate">{m.name}</span>
                    <span className="text-xs text-slate-400">
                      节点 {m.layoutJson.nodes.length} · {new Date(m.updatedAt * 1000).toLocaleString()}
                    </span>
                    <code className="text-xs text-slate-400 truncate" title={m.id}>
                      {m.id}
                    </code>
                  </div>
                  <div className="flex items-center gap-1 ml-2">
                    <button
                      type="button"
                      onClick={() => handleCopyId(m.id)}
                      className="text-slate-400 hover:text-slate-200 p-1"
                      title="复制 ID"
                    >
                      <Copy size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleLoad(m)}
                      className="text-indigo-400 hover:text-indigo-300 p-1"
                      title="加载到编辑器"
                    >
                      <FolderOpen size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(m)}
                      className="text-red-400 hover:text-red-300 p-1"
                      title="删除"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 text-xs text-slate-400 text-right">
          {maps.length}/{MAP_QUOTA}
          {maps.length >= MAP_QUOTA && ' · 已达上限，需删除旧地图才能上传新图'}
        </div>
      </div>
    </div>
  );
}
