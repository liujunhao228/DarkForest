import { useReducer, useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import type { MapLayoutSnapshot } from '@/api/maps';
import { validateMap } from '@/lib/game/mapValidator';
import { saveDraft, getDraft, DRAFT_NAME_REGEX } from '@/lib/game/mapDrafts';
import { exportMapFile } from '@/lib/game/mapExport';
import { parseMapFile } from '@/lib/game/mapFile';
import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';
import EditorToolbar from '@/components/map-editor/EditorToolbar';
import MapCanvas from '@/components/map-editor/MapCanvas';
import NodeInspector from '@/components/map-editor/NodeInspector';
import EdgeList from '@/components/map-editor/EdgeList';
import JsonPreview from '@/components/map-editor/JsonPreview';
import DraftManager from '@/components/map-editor/DraftManager';
import OfficialMapLoader from '@/components/map-editor/OfficialMapLoader';
import MyMapsPanel from '@/components/map-editor/MyMapsPanel';
import LoadByIDDialog from '@/components/map-editor/LoadByIDDialog';
import PublishDialog from '@/components/map-editor/PublishDialog';
import { reducer, initialState } from './mapEditorState';
import { ArrowLeft } from 'lucide-react';
import { isTrustAuthenticated } from '@/lib/trust';

export default function MapEditorPage() {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const currentUserId = useAuthStore((s) => s.player?.id ?? '');
  const [state, dispatch] = useReducer(reducer, initialState);
  const [showDraftManager, setShowDraftManager] = useState(false);
  const [showOfficialLoader, setShowOfficialLoader] = useState(false);
  const [showMyMaps, setShowMyMaps] = useState(false);
  const [showLoadByID, setShowLoadByID] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const backupInputRef = useRef<HTMLInputElement>(null);

  // trust 模式：无 JWT 会话，视为已认证（本地玩家可访问地图编辑器）
  const isAuth = isAuthenticated || isTrustAuthenticated();

  useEffect(() => {
    if (!isAuth) {
      navigate('/auth');
    }
  }, [isAuth, navigate]);

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
  if (!isAuth) {
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
    dispatch({ type: 'LOAD_LAYOUT', layout: officialLayout, source: { kind: 'foreign', originName: suggestedName } });
    // 提示用户可保存为草稿
    if (window.confirm(`已加载官方地图。是否保存为草稿 "${suggestedName}"？`)) {
      const res = saveDraft(suggestedName, officialLayout);
      if (!res.ok) {
        window.alert(res.error ?? '保存草稿失败');
      }
    }
  };

  const handleImportBackup = () => {
    backupInputRef.current?.click();
  };

  const handleBackupFile = async (file: File) => {
    try {
      const parsed = await parseMapFile(file);
      dispatch({ type: 'LOAD_LAYOUT', layout: parsed, source: { kind: 'new' } });
      toast.success('已导入备份');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导入备份失败');
    }
  };

  // source banner：仅 foreign / mine 显示，new/draft 不显示
  const renderSourceBanner = () => {
    if (state.source.kind === 'foreign') {
      return (
        <div className="text-xs text-amber-300 bg-slate-900/60 border border-slate-700 rounded px-3 py-1.5">
          来自：{state.source.originName ?? '他人地图'}（{state.source.ownedByMe ? '我' : '他人'}，编辑后点「保存到 DB」可另存为新图）
        </div>
      );
    }
    if (state.source.kind === 'mine') {
      return (
        <div className="text-xs text-indigo-300 bg-slate-900/60 border border-slate-700 rounded px-3 py-1.5">
          当前：{state.source.originName ?? '我的图'}（map ID: {state.source.mapId ?? '—'}，可覆盖或另存）
        </div>
      );
    }
    return null;
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
          onPublish={() => setShowPublish(true)}
          onLoadByID={() => setShowLoadByID(true)}
          onOpenMyMaps={() => setShowMyMaps(true)}
          onImportBackup={handleImportBackup}
          onExport={handleExport}
          onClear={() => dispatch({ type: 'CLEAR' })}
        />

        {renderSourceBanner()}

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

      {/* 隐藏的备份文件 input：被「导入备份」按钮触发 */}
      <input
        type="file"
        ref={backupInputRef}
        accept=".dfmap.json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            void handleBackupFile(f);
          }
          // 清空 value 允许重复选择同一文件
          e.target.value = '';
        }}
      />

      {showDraftManager && (
        <DraftManager
          onClose={() => setShowDraftManager(false)}
          onLoad={(loaded) => dispatch({ type: 'LOAD_LAYOUT', layout: loaded, source: { kind: 'draft' } })}
        />
      )}
      {showOfficialLoader && (
        <OfficialMapLoader
          onClose={() => setShowOfficialLoader(false)}
          onLoad={handleLoadOfficial}
        />
      )}
      {showMyMaps && (
        <MyMapsPanel
          onClose={() => setShowMyMaps(false)}
          onLoad={(loadedLayout, source) => {
            dispatch({ type: 'LOAD_LAYOUT', layout: loadedLayout, source });
          }}
          onDeleted={() => {
            // 删除后若当前画布来自被删地图，重置 source 为 new 避免误覆盖
            if (state.source.kind === 'mine') {
              dispatch({ type: 'SET_SOURCE', source: { kind: 'new' } });
            }
          }}
        />
      )}
      {showLoadByID && (
        <LoadByIDDialog
          onClose={() => setShowLoadByID(false)}
          currentUserId={currentUserId}
          onLoad={(loadedLayout, source) => {
            dispatch({ type: 'LOAD_LAYOUT', layout: loadedLayout, source });
          }}
        />
      )}
      {showPublish && (
        <PublishDialog
          layout={layout}
          source={state.source}
          validation={validation}
          onClose={() => setShowPublish(false)}
          onPublished={(source) => {
            dispatch({ type: 'SET_SOURCE', source });
            setShowPublish(false);
          }}
        />
      )}

      <Toaster />
    </div>
  );
}
