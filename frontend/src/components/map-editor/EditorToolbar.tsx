import type { ValidationResult } from '@/lib/game/mapValidator';
import { Plus, MousePointer2, Share2, Save, FolderOpen, Globe, Download, Trash2, Database, Search, FolderArchive, FileInput } from 'lucide-react';

interface EditorToolbarProps {
  validation: ValidationResult;
  nodeCount: number;
  edgeCount: number;
  mode: 'select' | 'edge';
  onAddNode: () => void;
  onSetMode: (mode: 'select' | 'edge') => void;
  onSaveDraft: () => void;
  onLoadDrafts: () => void;
  onLoadOfficial: () => void;
  onPublish: () => void;
  onLoadByID: () => void;
  onOpenMyMaps: () => void;
  onImportBackup: () => void;
  onExport: () => void;
  onClear: () => void;
}

/** 顶部工具栏：节点/模式/草稿/官方图/DB/导入/导出/清空 + 校验状态。 */
export default function EditorToolbar({
  validation,
  nodeCount,
  edgeCount,
  mode,
  onAddNode,
  onSetMode,
  onSaveDraft,
  onLoadDrafts,
  onLoadOfficial,
  onPublish,
  onLoadByID,
  onOpenMyMaps,
  onImportBackup,
  onExport,
  onClear,
}: EditorToolbarProps) {
  const handleClear = () => {
    if (window.confirm('确认清空所有节点和边？此操作不可撤销。')) {
      onClear();
    }
  };

  const errorTitle = validation.valid ? '' : validation.errors.join('\n');

  return (
    <div className="flex flex-wrap items-center gap-2 bg-slate-800 border border-slate-700 rounded-lg p-2">
      <button
        type="button"
        onClick={onAddNode}
        className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-2 py-1 rounded transition-colors"
      >
        <Plus size={14} /> 添加节点
      </button>

      <button
        type="button"
        onClick={() => onSetMode(mode === 'select' ? 'edge' : 'select')}
        className="flex items-center gap-1 bg-slate-700 hover:bg-slate-600 text-slate-100 text-xs px-2 py-1 rounded transition-colors"
        title={mode === 'select' ? '切换到连边模式' : '切换到选择模式'}
      >
        {mode === 'select' ? <Share2 size={14} /> : <MousePointer2 size={14} />}
        {mode === 'select' ? '连边模式' : '选择模式'}
      </button>

      <div className="w-px h-5 bg-slate-600 mx-1" />

      <button
        type="button"
        onClick={onSaveDraft}
        className="flex items-center gap-1 bg-slate-700 hover:bg-slate-600 text-slate-100 text-xs px-2 py-1 rounded transition-colors"
      >
        <Save size={14} /> 保存草稿
      </button>
      <button
        type="button"
        onClick={onLoadDrafts}
        className="flex items-center gap-1 bg-slate-700 hover:bg-slate-600 text-slate-100 text-xs px-2 py-1 rounded transition-colors"
      >
        <FolderOpen size={14} /> 加载草稿
      </button>
      <button
        type="button"
        onClick={onLoadOfficial}
        className="flex items-center gap-1 bg-slate-700 hover:bg-slate-600 text-slate-100 text-xs px-2 py-1 rounded transition-colors"
      >
        <Globe size={14} /> 加载官方地图
      </button>

      <div className="w-px h-5 bg-slate-600 mx-1" />

      <button
        type="button"
        onClick={onPublish}
        disabled={!validation.valid}
        title={errorTitle}
        className="flex items-center gap-1 bg-indigo-700 hover:bg-indigo-600 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs px-2 py-1 rounded transition-colors"
      >
        <Database size={14} /> 保存到 DB
      </button>
      <button
        type="button"
        onClick={onLoadByID}
        className="flex items-center gap-1 bg-slate-700 hover:bg-slate-600 text-slate-100 text-xs px-2 py-1 rounded transition-colors"
      >
        <Search size={14} /> 按 ID 加载
      </button>
      <button
        type="button"
        onClick={onOpenMyMaps}
        className="flex items-center gap-1 bg-slate-700 hover:bg-slate-600 text-slate-100 text-xs px-2 py-1 rounded transition-colors"
      >
        <FolderArchive size={14} /> 我的地图
      </button>
      <button
        type="button"
        onClick={onImportBackup}
        className="flex items-center gap-1 bg-slate-700 hover:bg-slate-600 text-slate-100 text-xs px-2 py-1 rounded transition-colors"
      >
        <FileInput size={14} /> 导入备份
      </button>

      <div className="w-px h-5 bg-slate-600 mx-1" />

      <button
        type="button"
        onClick={onExport}
        disabled={!validation.valid}
        title={errorTitle}
        className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs px-2 py-1 rounded transition-colors"
      >
        <Download size={14} /> 导出本地备份
      </button>

      <button
        type="button"
        onClick={handleClear}
        className="flex items-center gap-1 bg-red-900/60 hover:bg-red-800 text-red-200 text-xs px-2 py-1 rounded transition-colors"
      >
        <Trash2 size={14} /> 清空
      </button>

      <div className="ml-auto flex items-center gap-3 text-xs">
        <span className="text-slate-400">
          节点 {nodeCount} / 边 {edgeCount}
        </span>
        {validation.valid ? (
          <span className="text-emerald-400">✓ 校验通过</span>
        ) : (
          <span className="text-red-400 cursor-help" title={errorTitle}>
            ✗ 校验失败（{validation.errors.length} 项错误）
          </span>
        )}
      </div>
    </div>
  );
}
