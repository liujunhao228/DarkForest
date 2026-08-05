import type { StarNode, StarEdge } from '@/lib/game/types';
import type { MapLayoutSnapshot } from '@/api/maps';

/**
 * 地图编辑器状态机：reducer + 状态/动作类型 + source 元数据。
 *
 * 从 MapEditorPage.tsx 抽出以便单测直接导入，且避免 react-refresh 规则
 * 要求页面文件仅导出组件。
 */

export type MapSourceKind = 'draft' | 'new' | 'mine' | 'foreign';

export interface MapSource {
  kind: MapSourceKind;
  mapId?: string;
  ownedByMe?: boolean;
  originName?: string;
}

export interface EditorState {
  nodes: StarNode[];
  edges: StarEdge[];
  selectedNodeId: number | null;
  mode: 'select' | 'edge';
  edgeFrom: number | null;
  source: MapSource;
}

export type EditorAction =
  | { type: 'ADD_NODE' }
  | { type: 'UPDATE_NODE'; id: number; patch: Partial<StarNode> }
  | { type: 'DELETE_NODE'; id: number }
  | { type: 'ADD_EDGE'; from: number; to: number }
  | { type: 'DELETE_EDGE'; index: number }
  | { type: 'SELECT_NODE'; id: number | null }
  | { type: 'SET_MODE'; mode: 'select' | 'edge' }
  | { type: 'SET_EDGE_FROM'; id: number | null }
  | { type: 'LOAD_LAYOUT'; layout: MapLayoutSnapshot; source: MapSource }
  | { type: 'SET_SOURCE'; source: MapSource }
  | { type: 'CLEAR' };

export const initialState: EditorState = {
  nodes: [],
  edges: [],
  selectedNodeId: null,
  mode: 'select',
  edgeFrom: null,
  source: { kind: 'new' },
};

function nextNodeId(nodes: StarNode[]): number {
  if (nodes.length === 0) return 1;
  return Math.max(...nodes.map((n) => n.id)) + 1;
}

function edgeExists(edges: StarEdge[], from: number, to: number): boolean {
  return edges.some((e) => (e.from === from && e.to === to) || (e.from === to && e.to === from));
}

export function reducer(state: EditorState, action: EditorAction): EditorState {
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
        source: action.source,
      };
    case 'SET_SOURCE':
      return { ...state, source: action.source };
    case 'CLEAR':
      return { ...initialState };
    default:
      return state;
  }
}
