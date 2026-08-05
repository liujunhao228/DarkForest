import type { MapLayoutSnapshot } from '@/api/maps';

/**
 * localStorage 草稿管理：编辑器本地多草稿 CRUD。
 *
 * key 规范：`dfmap-editor-v1-{draftName}`（版本前缀，schema 变更时可废弃旧 key）。
 * 上限 DRAFT_LIMIT 张草稿（与 P3 用户地图配额一致）。
 */

export const DRAFT_LIMIT = 10;
export const DRAFT_KEY_PREFIX = 'dfmap-editor-v1-';
export const DRAFT_NAME_REGEX = /^[a-zA-Z0-9_\u4e00-\u9fa5-]{1,30}$/;

export interface MapDraftMeta {
  name: string;
  nodeCount: number;
  edgeCount: number;
  updatedAt: number;
}

export interface MapDraft extends MapDraftMeta {
  layout: MapLayoutSnapshot;
}

interface StoredDraft extends MapDraftMeta {
  layout: MapLayoutSnapshot;
}

export type DraftResult = { ok: boolean; error?: string };

function buildKey(name: string): string {
  return DRAFT_KEY_PREFIX + name;
}

function isDraftKey(key: string): boolean {
  return key.startsWith(DRAFT_KEY_PREFIX);
}

function validateName(name: string): string | null {
  if (!DRAFT_NAME_REGEX.test(name)) {
    return '名称非法（仅允许字母、数字、下划线、连字符、中文，长度 1-30）';
  }
  return null;
}

/** 列出所有草稿元数据，按 updatedAt 降序。 */
export function listDrafts(): MapDraftMeta[] {
  const drafts: MapDraftMeta[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key === null || !isDraftKey(key)) continue;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as StoredDraft;
      drafts.push({
        name: parsed.name,
        nodeCount: parsed.nodeCount,
        edgeCount: parsed.edgeCount,
        updatedAt: parsed.updatedAt,
      });
    } catch {
      // 损坏的草稿跳过
    }
  }
  drafts.sort((a, b) => b.updatedAt - a.updatedAt);
  return drafts;
}

/** 按名称读取草稿 layout，不存在返回 null。 */
export function getDraft(name: string): MapLayoutSnapshot | null {
  try {
    const raw = localStorage.getItem(buildKey(name));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft;
    return parsed.layout;
  } catch {
    return null;
  }
}

/** 保存草稿。名称非法或超上限返回 {ok:false, error}。覆盖同名草稿不计入上限。 */
export function saveDraft(name: string, layout: MapLayoutSnapshot): DraftResult {
  const nameErr = validateName(name);
  if (nameErr) return { ok: false, error: nameErr };

  const exists = localStorage.getItem(buildKey(name)) !== null;
  if (!exists) {
    const drafts = listDrafts();
    if (drafts.length >= DRAFT_LIMIT) {
      return { ok: false, error: `草稿上限 ${DRAFT_LIMIT}，请删除旧草稿后再保存` };
    }
  }

  const draft: StoredDraft = {
    name,
    nodeCount: layout.nodes.length,
    edgeCount: layout.edges.length,
    updatedAt: Date.now(),
    layout,
  };
  try {
    localStorage.setItem(buildKey(name), JSON.stringify(draft));
  } catch (err) {
    if (err instanceof DOMException && err.name === 'QuotaExceededError') {
      return { ok: false, error: '存储已满，请删除旧草稿后再保存' };
    }
    return { ok: false, error: `保存失败：${err instanceof Error ? err.message : String(err)}` };
  }
  return { ok: true };
}

/** 删除草稿。 */
export function deleteDraft(name: string): void {
  localStorage.removeItem(buildKey(name));
}

/** 复制草稿。 */
export function copyDraft(srcName: string, dstName: string): DraftResult {
  const layout = getDraft(srcName);
  if (!layout) return { ok: false, error: `源草稿 "${srcName}" 不存在` };
  return saveDraft(dstName, layout);
}

/** 重命名草稿：复制到新名称后删除旧名称。 */
export function renameDraft(oldName: string, newName: string): DraftResult {
  const copyRes = copyDraft(oldName, newName);
  if (!copyRes.ok) return copyRes;
  deleteDraft(oldName);
  return { ok: true };
}
