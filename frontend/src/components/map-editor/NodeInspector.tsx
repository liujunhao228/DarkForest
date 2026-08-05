import type { StarNode, StarSize } from '@/lib/game/types';

interface NodeInspectorProps {
  node: StarNode | null;
  onUpdate: (patch: Partial<StarNode>) => void;
}

const HEX_REGEX = /^#[0-9a-fA-F]{6}$/;

const SIZE_OPTIONS: StarSize[] = ['sm', 'md', 'lg'];

/** 选中节点的属性编辑面板。 */
export default function NodeInspector({ node, onUpdate }: NodeInspectorProps) {
  if (node === null) {
    return (
      <div className="text-slate-400 text-sm italic">未选中节点。点击画布上的节点以编辑属性。</div>
    );
  }

  const handleHexChange = (value: string) => {
    if (HEX_REGEX.test(value)) {
      onUpdate({ tint: value });
    }
  };

  const handleCoordChange = (field: 'x' | 'y', raw: string) => {
    const num = Number(raw);
    if (!Number.isFinite(num)) return;
    const clamped = Math.max(0, Math.min(100, num));
    const stepped = Math.round(clamped * 2) / 2;
    onUpdate({ [field]: stepped });
  };

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-slate-200">节点属性</h3>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-slate-400">名称</span>
        <input
          type="text"
          value={node.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-slate-400">尺寸</span>
        <select
          value={node.size}
          onChange={(e) => onUpdate({ size: e.target.value as StarSize })}
          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
        >
          {SIZE_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-1">
        <span className="text-xs text-slate-400">颜色（tint）</span>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={node.tint}
            onChange={(e) => onUpdate({ tint: e.target.value })}
            className="h-8 w-12 bg-slate-900 border border-slate-700 rounded cursor-pointer"
          />
          <input
            type="text"
            value={node.tint}
            onChange={(e) => handleHexChange(e.target.value)}
            placeholder="#6366f1"
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100 font-mono focus:outline-none focus:border-indigo-500 w-28"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-400">X 坐标</span>
          <input
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={node.x}
            onChange={(e) => handleCoordChange('x', e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-400">Y 坐标</span>
          <input
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={node.y}
            onChange={(e) => handleCoordChange('y', e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
          />
        </label>
      </div>
    </div>
  );
}
