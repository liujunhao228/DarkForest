import { useState } from 'react';
import { createMap, updateMap, type MapLayoutSnapshot } from '@/api/maps';
import { parseHttpError } from '@/api/http';
import type { MapSource } from '@/pages/mapEditorState';
import type { ValidationResult } from '@/lib/game/mapValidator';
import { toast } from 'sonner';
import { X } from 'lucide-react';

interface PublishDialogProps {
  layout: MapLayoutSnapshot;
  source: MapSource;
  validation: ValidationResult;
  onClose: () => void;
  onPublished: (source: MapSource) => void;
}

/**
 * 「保存到 DB」弹窗：另存为新图（POST，恒可用）或覆盖当前图（PUT，仅 source=mine 可用）。
 * 成功后回调 onPublished 更新编辑器 source；map ID 复制到剪贴板便于社区分享。
 */
export default function PublishDialog({
  layout,
  source,
  validation,
  onClose,
  onPublished,
}: PublishDialogProps) {
  const [name, setName] = useState(source.originName ?? '');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canOverwrite = source.kind === 'mine' && !!source.mapId;
  const validationOk = validation.valid && name.trim() !== '';
  const errorTitle = validation.valid ? '' : validation.errors.join('\n');

  const handleSaveAsNew = async () => {
    if (!validationOk || busy) return;
    setBusy(true);
    setError(null);
    try {
      const resp = await createMap({ name: name.trim(), description: description.trim(), layoutJson: layout });
      try {
        await navigator.clipboard.writeText(resp.id);
        toast.success(`已保存，map ID：${resp.id}（已复制）`);
      } catch {
        toast.success(`已保存，map ID：${resp.id}`);
      }
      onPublished({ kind: 'mine', mapId: resp.id, ownedByMe: true, originName: name.trim() });
      onClose();
    } catch (err) {
      const parsed = parseHttpError(err);
      if (parsed?.status === 429) {
        setError('已达上传配额上限（10 张/用户）');
      } else if (parsed?.status === 400) {
        setError(parsed.message || '请求参数错误');
      } else {
        setError(parsed?.message ?? (err instanceof Error ? err.message : '保存失败'));
      }
    } finally {
      setBusy(false);
    }
  };

  const handleOverwrite = async () => {
    if (!canOverwrite || !validationOk || busy || !source.mapId) return;
    setBusy(true);
    setError(null);
    try {
      await updateMap(source.mapId, { name: name.trim(), description: description.trim(), layoutJson: layout });
      toast.success(`已覆盖 map ${source.mapId}`);
      onPublished({ ...source, originName: name.trim() });
      onClose();
    } catch (err) {
      const parsed = parseHttpError(err);
      if (parsed?.status === 403) {
        setError('无权覆盖他人地图');
      } else if (parsed?.status === 400) {
        setError(parsed.message || '请求参数错误');
      } else {
        setError(parsed?.message ?? (err instanceof Error ? err.message : '覆盖失败'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-slate-800 border border-slate-700 rounded-lg p-6 max-w-lg w-full mx-4 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-100">保存到 DB</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-400">名称（必填）</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="地图名称"
              className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-400">描述（可选）</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="地图描述"
              rows={2}
              className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 resize-none"
            />
          </label>

          {!validation.valid && (
            <div className="text-red-400 text-xs cursor-help" title={errorTitle}>
              校验未通过（{validation.errors.length} 项错误），无法保存。鼠标悬停查看详情。
            </div>
          )}

          {error && (
            <div className="bg-slate-900/50 border border-red-700/50 rounded p-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {busy && (
            <div className="text-slate-400 text-sm">保存中...</div>
          )}

          {canOverwrite && (
            <div className="text-slate-500 text-xs">
              当前画布来自 map ID {source.mapId}，可覆盖原图或另存为新图。
            </div>
          )}
          {!canOverwrite && validation.valid && (
            <div className="text-slate-500 text-xs">
              当前画布非本人地图，将另存为新图（生成新 map ID）。
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="bg-slate-700 hover:bg-slate-600 disabled:bg-slate-700 disabled:text-slate-500 text-slate-100 text-sm px-3 py-1.5 rounded transition-colors"
          >
            取消
          </button>
          {canOverwrite && (
            <button
              type="button"
              onClick={handleOverwrite}
              disabled={!validationOk || busy}
              title={errorTitle}
              className="bg-amber-700 hover:bg-amber-600 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm px-3 py-1.5 rounded transition-colors"
            >
              覆盖当前图
            </button>
          )}
          <button
            type="button"
            onClick={handleSaveAsNew}
            disabled={!validationOk || busy}
            title={errorTitle}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm px-3 py-1.5 rounded transition-colors"
          >
            另存为新图
          </button>
        </div>
      </div>
    </div>
  );
}
