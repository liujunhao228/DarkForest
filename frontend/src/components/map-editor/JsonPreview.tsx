import { useMemo } from 'react';
import type { MapLayoutSnapshot } from '@/api/maps';

interface JsonPreviewProps {
  layout: MapLayoutSnapshot;
}

/** 实时 JSON 预览面板，显示当前 layout_json schema。 */
export default function JsonPreview({ layout }: JsonPreviewProps) {
  const json = useMemo(() => JSON.stringify(layout, null, 2), [layout]);
  return (
    <div className="flex flex-col h-full">
      <h3 className="text-sm font-semibold text-slate-200 mb-2">JSON 预览（layout_json schema）</h3>
      <pre className="bg-slate-900 text-slate-300 text-xs p-3 rounded overflow-auto max-h-96 flex-1 border border-slate-700">
        {json}
      </pre>
    </div>
  );
}
