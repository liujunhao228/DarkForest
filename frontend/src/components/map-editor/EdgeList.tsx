import { useState, useMemo } from 'react';
import type { StarNode, StarEdge } from '@/lib/game/types';
import { Trash2 } from 'lucide-react';

interface EdgeListProps {
  nodes: StarNode[];
  edges: StarEdge[];
  onAddEdge: (from: number, to: number) => void;
  onDeleteEdge: (idx: number) => void;
}

/** 边列表面板：显示现有边 + 添加/删除边。 */
export default function EdgeList({ nodes, edges, onAddEdge, onDeleteEdge }: EdgeListProps) {
  // 用户显式选择的端点；为 null 时由渲染期回退到默认节点
  const [fromIdRaw, setFromId] = useState<number | null>(null);
  const [toIdRaw, setToId] = useState<number | null>(null);

  // 渲染期计算有效端点：raw 缺失或指向已删除节点时回退到首/次节点
  const fromId = useMemo(() => {
    if (fromIdRaw !== null && nodes.some((n) => n.id === fromIdRaw)) return fromIdRaw;
    return nodes[0]?.id ?? null;
  }, [fromIdRaw, nodes]);
  const toId = useMemo(() => {
    if (toIdRaw !== null && nodes.some((n) => n.id === toIdRaw)) return toIdRaw;
    return nodes[1]?.id ?? nodes[0]?.id ?? null;
  }, [toIdRaw, nodes]);

  const nameById = new Map(nodes.map((n) => [n.id, n.name]));

  // 已存在的无序边对集合
  const existingEdgeKeys = new Set(
    edges.map((e) => (e.from < e.to ? `${e.from}-${e.to}` : `${e.to}-${e.from}`)),
  );
  const isDuplicate =
    fromId !== null &&
    toId !== null &&
    fromId !== toId &&
    existingEdgeKeys.has(fromId < toId ? `${fromId}-${toId}` : `${toId}-${fromId}`);
  const isSelfLoop = fromId !== null && fromId === toId;
  const canAdd = fromId !== null && toId !== null && !isDuplicate && !isSelfLoop;

  const handleAdd = () => {
    if (fromId === null || toId === null) return;
    if (!canAdd) return;
    onAddEdge(fromId, toId);
  };

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-slate-200">边列表</h3>

      <div className="flex items-center gap-2">
        <select
          value={fromId ?? ''}
          onChange={(e) => setFromId(e.target.value === '' ? null : Number(e.target.value))}
          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 flex-1"
        >
          {nodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.id}: {n.name}
            </option>
          ))}
        </select>
        <span className="text-slate-400 text-xs">→</span>
        <select
          value={toId ?? ''}
          onChange={(e) => setToId(e.target.value === '' ? null : Number(e.target.value))}
          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 flex-1"
        >
          {nodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.id}: {n.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleAdd}
          disabled={!canAdd}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs px-2 py-1 rounded transition-colors"
          title={isSelfLoop ? '不能连接自身' : isDuplicate ? '该边已存在' : '添加边'}
        >
          添加
        </button>
      </div>

      <div className="flex flex-col gap-1 max-h-48 overflow-auto">
        {edges.length === 0 ? (
          <div className="text-slate-500 text-xs italic">无边</div>
        ) : (
          edges.map((e, i) => (
            <div
              key={`${e.from}-${e.to}-${i}`}
              className="flex items-center justify-between bg-slate-900/50 border border-slate-700 rounded px-2 py-1 text-xs"
            >
              <span className="text-slate-300">
                {nameById.get(e.from) ?? e.from} → {nameById.get(e.to) ?? e.to}
              </span>
              <button
                type="button"
                onClick={() => onDeleteEdge(i)}
                className="text-red-400 hover:text-red-300 transition-colors"
                title="删除边"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
