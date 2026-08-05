import { useState, useEffect } from 'react';
import { listMaps, type MapData } from '@/api/maps';
import type { MapLayoutSnapshot } from '@/api/maps';
import { X, Globe } from 'lucide-react';

interface OfficialMapLoaderProps {
  onClose: () => void;
  onLoad: (layout: MapLayoutSnapshot, suggestedName: string) => void;
}

/** 官方地图列表弹窗：只读加载官方地图为本地草稿副本。 */
export default function OfficialMapLoader({ onClose, onLoad }: OfficialMapLoaderProps) {
  const [maps, setMaps] = useState<MapData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // loading 初始为 true，无需在此重复设置
    listMaps()
      .then((data) => {
        if (cancelled) return;
        setMaps(data.filter((m) => m.isOfficial));
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : '加载官方地图失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLoad = (m: MapData) => {
    onLoad(m.layoutJson, `${m.name}-副本`);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-slate-800 border border-slate-700 rounded-lg p-6 max-w-lg w-full mx-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-100">加载官方地图</h2>
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
            <div className="text-slate-400 text-sm italic py-8 text-center">暂无官方地图</div>
          ) : (
            <ul className="flex flex-col gap-2">
              {maps.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between bg-slate-900/50 border border-slate-700 rounded p-2"
                >
                  <div className="flex flex-col">
                    <span className="text-sm text-slate-100 flex items-center gap-1">
                      <Globe size={14} className="text-emerald-400" />
                      {m.name}
                    </span>
                    <span className="text-xs text-slate-400">
                      slug: {m.slug ?? '—'} · 节点 {m.layoutJson.nodes.length}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleLoad(m)}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-3 py-1 rounded transition-colors"
                  >
                    加载
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 text-xs text-slate-400">
          加载官方地图将复制为本地草稿，可自由编辑，不影响原官方地图。
        </div>
      </div>
    </div>
  );
}
