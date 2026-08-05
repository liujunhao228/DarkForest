import { useReducer, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import type { StarNode, StarEdge } from '@/lib/game/types';
import type { MapLayoutSnapshot } from '@/api/maps';
import { validateMap } from '@/lib/game/mapValidator';
import { saveDraft, getDraft, DRAFT_NAME_REGEX } from '@/lib/game/mapDrafts';
import { exportMapFile } from '@/lib/game/mapExport';
import EditorToolbar from '@/components/map-editor/EditorToolbar';
import MapCanvas from '@/components/map-editor/MapCanvas';
import NodeInspector from '@/components/map-editor/NodeInspector';
import EdgeList from '@/components/map-editor/EdgeList';
import JsonPreview from '@/components/map-editor/JsonPreview';
import DraftManager from '@/components/map-editor/DraftManager';
import OfficialMapLoader from '@/components/map-editor/OfficialMapLoader';
import { ArrowLeft } from 'lucide-react';

interface EditorState {
  nodes: StarNode[];
  edges: StarEdge[];
  selectedNodeId: number | null;
  mode: 'select' | 'edge';
  edgeFrom: number | null;
}

type EditorAction =
  | { type: 'ADD_NODE' }
  | { type: 'UPDATE_NODE'; id: number; patch: Partial<StarNode> }
  | { type: 'DELETE_NODE'; id: number }
  | { type: 'ADD_EDGE'; from: number; to: number }
  | { type: 'DELETE_EDGE'; index: number }
  | { type: 'SELECT_NODE'; id: number | null }
  | { type: 'SET_MODE'; mode: 'select' | 'edge' }
  | { type: 'SET_EDGE_FROM'; id: number | null }
  | { type: 'LOAD_LAYOUT'; layout: MapLayoutSnapshot }
  | { type: 'CLEAR' };

const initialState: EditorState = {
  nodes: [],
  edges: [],
  selectedNodeId: null,
  mode: 'select',
  edgeFrom: null,
};

function nextNodeId(nodes: StarNode[]): number {
  if (nodes.length === 0) return 1;
  return Math.max(...nodes.map((n) => n.id)) + 1;
}

function edgeExists(edges: StarEdge[], from: number, to: number): boolean {
  return edges.some((e) => (e.from === from && e.to === to) || (e.from === to && e.to === from));
}

function reducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'ADD_NODE': {
      const id = nextNodeId(state.nodes);
      const newNode: StarNode = {
        id,
        x: 50,
        y: 50,
        name: `星系 ${id}`,
        size: 'md',
        tint: '#6366f1',
      };
      return { ...state, nodes: [...state.nodes, newNode], selectedNodeId: id };
    }
    case 'UPDATE_NODE':
      return {
        ...state,
        nodes: state.nodes.map((n) =>
          n.id === action.id ? { ...n, ...action.patch } : n,
        ),
      };
    case 'DELETE_NODE':
      return {
        ...state,
        nodes: state.nodes.filter((n) => n.id !== action.id),
        edges: state.edges.filter((e) => e.from !== action.id && e.to !== action.id),
        selectedNodeId: state.selectedNodeId === action.id ? null : state.selectedNodeId,
        edgeFrom: state.edgeFrom === action.id ? null : state.edgeFrom,
      };
    case 'ADD_EDGE': {
      if (action.from === action.to) return state;
      if (edgeExists(state.edges, action.from, action.to)) return state;
      return { ...state, edges: [...state.edges, { from: action.from, to: action.to }] };
    }
    case 'DELETE_EDGE':
      return { ...state, edges: state.edges.filter((_, i) => i !== action.index) };
    case 'SELECT_NODE': {
      // 连边模式下，SELECT_NODE 同时设置 edgeFrom
      if (state.mode === 'edge') {
        return { ...state, edgeFrom: action.id };
      }
      return { ...state, selectedNodeId: action.id };
    }
    case 'SET_MODE':
      return { ...state, mode: action.mode, edgeFrom: null };
    case 'SET_EDGE_FROM':
      return { ...state, edgeFrom: action.id };
    case 'LOAD_LAYOUT':
      return {
        ...state,
        nodes: action.layout.nodes,
        edges: action.layout.edges,
        selectedNodeId: null,
        edgeFrom: null,
      };
    case 'CLEAR':
      return { ...initialState };
    default:
      return state;
  }
}

export default function MapEditorPage() {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [state, dispatch] = useReducer(reducer, initialState);
  const [showDraftManager, setShowDraftManager] = useState(false);
  const [showOfficialLoader, setShowOfficialLoader] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/auth');
    }
  }, [isAuthenticated, navigate]);

  const layout: MapLayoutSnapshot = useMemo(
    () => ({ nodes: state.nodes, edges: state.edges }),
    [state.nodes, state.edges],
  );

  const validation = useMemo(() => validateMap(layout), [layout]);
  const selectedNode = useMemo(
    () => state.nodes.find((n) => n.id === state.selectedNodeId) ?? null,
    [state.nodes, state.selectedNodeId],
  );

  // 未登录时组件不渲染（useEffect 会跳转）
  if (!isAuthenticated) {
    return null;
  }

  const handleSaveDraft = () => {
    const name = window.prompt('输入草稿名称', '我的地图');
    if (!name) return;
    if (!DRAFT_NAME_REGEX.test(name)) {
      window.alert('名称非法（仅允许字母、数字、下划线、连字符、中文，长度 1-30）');
      return;
    }
    // 同名草稿确认覆盖
    if (getDraft(name) !== null) {
      if (!window.confirm(`已存在同名草稿 "${name}"，是否覆盖？`)) return;
    }
    const res = saveDraft(name, layout);
    if (res.ok) {
      window.alert('草稿已保存');
    } else {
      window.alert(res.error ?? '保存失败');
    }
  };

  const handleExport = () => {
    if (!validation.valid) return;
    const filename = window.prompt('输入文件名（不含扩展名）', 'my-map');
    if (!filename) return;
    exportMapFile(layout, filename);
  };

  const handleLoadOfficial = (officialLayout: MapLayoutSnapshot, suggestedName: string) => {
    dispatch({ type: 'LOAD_LAYOUT', layout: officialLayout });
    // 提示用户可保存为草稿
    if (window.confirm(`已加载官方地图。是否保存为草稿 "${suggestedName}"？`)) {
      const res = saveDraft(suggestedName, officialLayout);
      if (!res.ok) {
        window.alert(res.error ?? '保存草稿失败');
      }
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4">
      <div className="max-w-7xl mx-auto flex flex-col gap-4 h-[calc(100vh-2rem)]">
        {/* 顶部：返回 + 工具栏 */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="flex items-center gap-1 text-slate-400 hover:text-slate-200 text-sm transition-colors"
          >
            <ArrowLeft size={16} /> 返回首页
          </button>
          <span className="text-slate-600">|</span>
          <h1 className="text-lg font-semibold">地图编辑器</h1>
        </div>

        <EditorToolbar
          validation={validation}
          nodeCount={state.nodes.length}
          edgeCount={state.edges.length}
          mode={state.mode}
          onAddNode={() => dispatch({ type: 'ADD_NODE' })}
          onSetMode={(m) => dispatch({ type: 'SET_MODE', mode: m })}
          onSaveDraft={handleSaveDraft}
          onLoadDrafts={() => setShowDraftManager(true)}
          onLoadOfficial={() => setShowOfficialLoader(true)}
          onExport={handleExport}
          onClear={() => dispatch({ type: 'CLEAR' })}
        />

        {/* 主体：左侧画布 + 右侧面板 */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 min-h-0">
          <div className="bg-slate-900 rounded-lg border border-slate-700 p-2 min-h-[400px]">
            <MapCanvas
              nodes={state.nodes}
              edges={state.edges}
              selectedNodeId={state.selectedNodeId}
              mode={state.mode}
              edgeFrom={state.edgeFrom}
              onSelectNode={(id) => dispatch({ type: 'SELECT_NODE', id })}
              onMoveNode={(id, x, y) => dispatch({ type: 'UPDATE_NODE', id, patch: { x, y } })}
              onConnectEdge={(from, to) => dispatch({ type: 'ADD_EDGE', from, to })}
              onClearEdgeFrom={() => dispatch({ type: 'SET_EDGE_FROM', id: null })}
            />
          </div>

          <div className="flex flex-col gap-4 overflow-auto">
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
              <NodeInspector
                node={selectedNode}
                onUpdate={(patch) =>
                  selectedNode &&
                  dispatch({ type: 'UPDATE_NODE', id: selectedNode.id, patch })
                }
              />
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
              <EdgeList
                nodes={state.nodes}
                edges={state.edges}
                onAddEdge={(from, to) => dispatch({ type: 'ADD_EDGE', from, to })}
                onDeleteEdge={(index) => dispatch({ type: 'DELETE_EDGE', index })}
              />
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 flex-1 min-h-[200px]">
              <JsonPreview layout={layout} />
            </div>
          </div>
        </div>
      </div>

      {showDraftManager && (
        <DraftManager
          onClose={() => setShowDraftManager(false)}
          onLoad={(loaded) => dispatch({ type: 'LOAD_LAYOUT', layout: loaded })}
        />
      )}
      {showOfficialLoader && (
        <OfficialMapLoader
          onClose={() => setShowOfficialLoader(false)}
          onLoad={handleLoadOfficial}
        />
      )}
    </div>
  );
}
