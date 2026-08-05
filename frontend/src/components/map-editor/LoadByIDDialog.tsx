import { useState } from 'react';
import { getMap, type MapData, type MapLayoutSnapshot } from '@/api/maps';
import { parseHttpError } from '@/api/http';
import type { MapSource } from '@/pages/mapEditorState';
import { X, Search } from 'lucide-react';

interface LoadByIDDialogProps {
  onClose: () => void;
  onLoad: (layout: MapLayoutSnapshot, source: MapSource) => void;
  currentUserId: string;
}

/** UUID v1-5 不区分大小写正则（与后端 uuid.Parse 宽松一致）。 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 「按地图 ID 加载」弹窗：输入 UUID → 失焦/输入时调 getMap 预览 → 加载到编辑器。
 * 加载自己图 source=mine（可覆盖），加载他人图 source=foreign（仅另存）。
 */
export default function LoadByIDDialog({ onClose, onLoad, currentUserId }: LoadByIDDialogProps) {
  const [mapIdInput, setMapIdInput] = useState('');
  const [preview, setPreview] = useState<MapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleChange = (value: string) => {
    setMapIdInput(value);
    setPreview(null);
    setError(null);
    if (!UUID_REGEX.test(value.trim())) {
      // 非 UUID 不发请求（避免无效请求打到后端）
      return;
    }
    void fetchPreview(value.trim());
  };

  const fetchPreview = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const map = await getMap(id);
      setPreview(map);
    } catch (err) {
      const parsed = parseHttpError(err);
      if (parsed?.status === 404) {
        setError('地图不存在');
      } else {
        setError(parsed?.message ?? (err instanceof Error ? err.message : '加载地图失败'));
      }
      setPreview(null);
    } finally {
      setLoading(false);
    }
  };

  const handleLoad = () => {
    if (!preview) return;
    const isMine = preview.createdBy === currentUserId;
    const source: MapSource = isMine
      ? { kind: 'mine', mapId: preview.id, ownedByMe: true, originName: preview.name }
      : { kind: 'foreign', mapId: preview.id, ownedByMe: false, originName: preview.name };
    onLoad(preview.layoutJson, source);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-slate-800 border border-slate-700 rounded-lg p-6 max-w-lg w-full mx-4 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-100">按地图 ID 加载</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Search size={16} className="text-slate-400" />
            <input
              type="text"
              value={mapIdInput}
              onChange={(e) => handleChange(e.target.value)}
              placeholder="粘贴地图 ID"
              autoFocus
              className="flex-1 bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {loading && (
            <div className="text-slate-400 text-sm">查询中...</div>
          )}

          {preview && !loading && (
            <div className="bg-slate-900/50 border border-emerald-700/50 rounded p-3 text-sm">
              <div className="text-emerald-400">
                ✓ {preview.name}（{preview.layoutJson.nodes.length} 节点）
              </div>
              <div className="text-slate-400 text-xs mt-1">
                来源：{preview.createdBy === currentUserId ? '我自己' : '他人'}
              </div>
            </div>
          )}

          {error && !loading && (
            <div className="bg-slate-900/50 border border-red-700/50 rounded p-3 text-sm text-red-400">
              ✗ {error}
            </div>
          )}

          {!loading && !preview && !error && (
            <div className="text-slate-500 text-xs">
              粘贴地图 ID 后自动预览。
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            type="button"
            onClick={onClose}
            className="bg-slate-700 hover:bg-slate-600 text-slate-100 text-sm px-3 py-1.5 rounded transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleLoad}
            disabled={!preview}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm px-3 py-1.5 rounded transition-colors"
          >
            加载
          </button>
        </div>
      </div>
    </div>
  );
}
