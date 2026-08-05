import { useState, useEffect } from 'react';
import { listDrafts, getDraft, deleteDraft, copyDraft, renameDraft, DRAFT_LIMIT, type MapDraftMeta } from '@/lib/game/mapDrafts';
import type { MapLayoutSnapshot } from '@/api/maps';
import { X, FolderOpen, Copy, Pencil, Trash2 } from 'lucide-react';

interface DraftManagerProps {
  onClose: () => void;
  onLoad: (layout: MapLayoutSnapshot) => void;
}

/** localStorage 草稿管理弹窗：列出/加载/复制/重命名/删除草稿。 */
export default function DraftManager({ onClose, onLoad }: DraftManagerProps) {
  const [drafts, setDrafts] = useState<MapDraftMeta[]>([]);

  const refresh = () => setDrafts(listDrafts());

  useEffect(() => {
    // 挂载时从 localStorage 读取草稿列表（外部系统同步），属于合法的 effect 状态同步
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, []);

  const handleLoad = (name: string) => {
    const layout = getDraft(name);
    if (layout) {
      onLoad(layout);
      onClose();
    } else {
      window.alert('草稿加载失败：数据不存在或已损坏');
    }
  };

  const handleCopy = (name: string) => {
    const dst = window.prompt('输入副本名称', `${name}-copy`);
    if (!dst) return;
    const res = copyDraft(name, dst);
    if (res.ok) {
      refresh();
    } else {
      window.alert(res.error ?? '复制失败');
    }
  };

  const handleRename = (name: string) => {
    const dst = window.prompt('输入新名称', name);
    if (!dst || dst === name) return;
    const res = renameDraft(name, dst);
    if (res.ok) {
      refresh();
    } else {
      window.alert(res.error ?? '重命名失败');
    }
  };

  const handleDelete = (name: string) => {
    if (!window.confirm(`确认删除草稿 "${name}"？`)) return;
    deleteDraft(name);
    refresh();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-slate-800 border border-slate-700 rounded-lg p-6 max-w-lg w-full mx-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-100">草稿管理</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {drafts.length === 0 ? (
            <div className="text-slate-400 text-sm italic py-8 text-center">暂无草稿</div>
          ) : (
            <ul className="flex flex-col gap-2">
              {drafts.map((d) => (
                <li
                  key={d.name}
                  className="flex items-center justify-between bg-slate-900/50 border border-slate-700 rounded p-2"
                >
                  <div className="flex flex-col">
                    <span className="text-sm text-slate-100">{d.name}</span>
                    <span className="text-xs text-slate-400">
                      节点 {d.nodeCount} / 边 {d.edgeCount} · {new Date(d.updatedAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleLoad(d.name)}
                      className="text-indigo-400 hover:text-indigo-300 p-1"
                      title="加载"
                    >
                      <FolderOpen size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopy(d.name)}
                      className="text-slate-400 hover:text-slate-200 p-1"
                      title="复制"
                    >
                      <Copy size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRename(d.name)}
                      className="text-slate-400 hover:text-slate-200 p-1"
                      title="重命名"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(d.name)}
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
          {drafts.length}/{DRAFT_LIMIT}
          {drafts.length >= DRAFT_LIMIT && ' · 已达上限，需删除旧草稿才能保存新草稿'}
        </div>
      </div>
    </div>
  );
}
