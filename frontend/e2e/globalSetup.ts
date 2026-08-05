import { type FullConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ESM 下 __dirname 不可用，需通过 import.meta.url 派生
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * E2E globalSetup（D6 决策）
 *
 * 职责：
 *   1. 探测后端就绪
 *   2. 从 backend/.env 读取 ADMIN_SECRET_KEY
 *   3. 引导 admin 账号：先尝试 admin-setup（首次部署），失败则 login（已存在）
 *      约定 admin 显示名 'e2e_admin'，密码为固定强密码 E2E_ADMIN_PASSWORD
 *      （secret 仅作 admin-setup 校验，不作为登录密码——secret 可能不满足密码强度）
 *   4. 用 admin token 预生成 27 个邀请码
 *   5. 将邀请码以逗号分隔写入 process.env.E2E_INVITE_CODES 供测试取用
 *   6. P3：上传/复用固定测试地图（slug=e2e-test-map），把 map_id 写入
 *      process.env.E2E_TEST_MAP_ID 供 custom-room-custom-map.spec.ts 取用
 *
 * 幂等性：admin-setup 在 admin 已存在时返回 400，自动 fallback 到 login；
 *         invite 每次创建新邀请码（不查询旧码），多次 E2E run 累积可接受（R4）；
 *         e2e-test-map 通过 slug 查询复用，避免重复上传导致 slug 冲突。
 *
 * 注意：密码强度规则要求「至少 8 位且包含字母和数字」，固定密码需满足此规则。
 */
export default async function globalSetup(_config: FullConfig) {
  const baseURL = process.env.E2E_BASE_URL || 'http://localhost:8080';

  // 1. 探测后端就绪（最多 30 次每次 1s）
  await waitForBackend(baseURL, 30, 1000);

  // 2. 读取 backend/.env 中的 ADMIN_SECRET_KEY
  const adminSecret = readAdminSecretFromEnv();
  if (!adminSecret) {
    throw new Error(
      'E2E globalSetup: backend/.env 中未配置 ADMIN_SECRET_KEY，无法引导 admin 账号',
    );
  }

  const adminDisplayName = 'e2e_admin';
  // 固定强密码：满足后端 ValidatePasswordStrength（≥8 位 + 字母 + 数字 + 无空白）
  // secret 仅作 admin-setup 的管理员密钥校验，不作为登录密码
  const adminPassword = 'E2eAdmin123Pass';

  // 3. 引导 admin：先 admin-setup，失败则 login
  let adminToken: string;
  try {
    const resp = await fetchJson<AuthResponse>(`${baseURL}/api/auth/admin-setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        displayName: adminDisplayName,
        password: adminPassword,
        secret: adminSecret,
      }),
    });
    adminToken = resp.token;
    console.log('[globalSetup] admin-setup 成功（首次部署）');
  } catch {
    // admin 已存在或其他 4xx → fallback 到 login
    const resp = await fetchJson<AuthResponse>(`${baseURL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        displayName: adminDisplayName,
        password: adminPassword,
      }),
    });
    adminToken = resp.token;
    console.log('[globalSetup] admin login 成功（已存在）');
  }

  // 将 admin token 写入 process.env 供测试 helper 读取（createTestGame 需要）
  // 放在此处可覆盖 admin-setup 成功 + login fallback 两条路径，无需在两处分别写入
  process.env.E2E_ADMIN_TOKEN = adminToken;
  console.log('[globalSetup] admin token 已写入 process.env.E2E_ADMIN_TOKEN');

  // 4. 预生成 44 个邀请码
  // 用量明细：auth 5 + custom-room-custom-map (P3) 4+3 + game 3×3 + determinism 3 + injection 3 + turn-timeout 3 + map-editor (P4) 4 = 34，留 10 余量
  // P4 新增 map-editor.spec.ts（Test 2 四人 = 4 码），原 36 不够，提到 44。
  const inviteCodes: string[] = [];
  for (let i = 0; i < 44; i++) {
    const resp = await fetchJson<CreateInviteResponse>(`${baseURL}/api/auth/invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: '{}',
    });
    inviteCodes.push(resp.invitation.code);
  }

  // 5. 写入 process.env 供测试读取
  process.env.E2E_INVITE_CODES = inviteCodes.join(',');
  console.log(`[globalSetup] 预生成 ${inviteCodes.length} 个邀请码`);

  // 6. P3：上传/复用固定测试地图（slug=e2e-test-map）
  const testMapId = await ensureE2ETestMap(baseURL, adminToken);
  process.env.E2E_TEST_MAP_ID = testMapId;
  console.log(`[globalSetup] e2e-test-map id=${testMapId}`);
}

// ===== P3: 固定测试地图 =====

const E2E_TEST_MAP_SLUG = 'e2e-test-map';

/**
 * 9 节点 14 边的测试地图布局（与 classic-9 节点数/边数一致但坐标不同）。
 *
 * 设计意图：
 *   - 节点数 = 9、边数 = 14，与 classic-9 一致，便于对照测试
 *   - 节点 1 坐标 (50,50) 居中，与 classic-9 的 (10,12) 明显不同
 *   - 满足 game.ValidateMap：节点数 3-20、坐标 0-100、连通图、无重复边、无自环
 */
const E2E_TEST_MAP_LAYOUT = {
  nodes: [
    { id: 1, x: 50, y: 50, name: '中心', size: 'lg' as const, tint: '#a855f7' },
    { id: 2, x: 20, y: 30, name: 'Alpha', size: 'sm' as const, tint: '#0ea5e9' },
    { id: 3, x: 80, y: 30, name: 'Beta', size: 'sm' as const, tint: '#14b8a6' },
    { id: 4, x: 15, y: 70, name: 'Gamma', size: 'sm' as const, tint: '#f59e0b' },
    { id: 5, x: 85, y: 70, name: 'Delta', size: 'sm' as const, tint: '#ef4444' },
    { id: 6, x: 50, y: 15, name: 'Epsilon', size: 'md' as const, tint: '#6366f1' },
    { id: 7, x: 50, y: 85, name: 'Zeta', size: 'md' as const, tint: '#6366f1' },
    { id: 8, x: 35, y: 50, name: 'Eta', size: 'sm' as const, tint: '#0ea5e9' },
    { id: 9, x: 65, y: 50, name: 'Theta', size: 'sm' as const, tint: '#14b8a6' },
  ],
  edges: [
    { from: 1, to: 8 },
    { from: 1, to: 9 },
    { from: 1, to: 6 },
    { from: 1, to: 7 },
    { from: 8, to: 2 },
    { from: 9, to: 3 },
    { from: 2, to: 6 },
    { from: 3, to: 6 },
    { from: 8, to: 4 },
    { from: 9, to: 5 },
    { from: 4, to: 7 },
    { from: 5, to: 7 },
    { from: 2, to: 3 },
    { from: 4, to: 5 },
  ],
};

/**
 * 确保固定测试地图存在：
 *   - 先 GET /api/maps 查找 slug=e2e-test-map 的官方地图（幂等复用）
 *   - 未找到则 POST /api/maps 上传（admin 自动 is_official=true）
 *   - 返回 map_id 供测试用例使用
 */
async function ensureE2ETestMap(baseURL: string, adminToken: string): Promise<string> {
  // 1. 查找已存在的 e2e-test-map
  try {
    const maps = await fetchJson<MapResponse[]>(`${baseURL}/api/maps`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const existing = maps.find((m) => m.slug === E2E_TEST_MAP_SLUG);
    if (existing) {
      console.log(`[globalSetup] 复用已存在的 e2e-test-map (id=${existing.id})`);
      return existing.id;
    }
  } catch (err) {
    // 查询失败不致命，继续尝试上传
    console.warn('[globalSetup] 查询地图列表失败，尝试直接上传:', err);
  }

  // 2. 上传新的 e2e-test-map
  const resp = await fetchJson<MapResponse>(`${baseURL}/api/maps`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      name: 'E2E Test Map',
      description: 'E2E 测试固定地图（9 节点 14 边，与 classic-9 不同布局）',
      slug: E2E_TEST_MAP_SLUG,
      layoutJson: E2E_TEST_MAP_LAYOUT,
    }),
  });
  console.log(`[globalSetup] 上传新的 e2e-test-map (id=${resp.id})`);
  return resp.id;
}

interface MapResponse {
  id: string;
  slug: string | null;
  name: string;
  description: string | null;
  isOfficial: boolean;
  createdBy?: string | null;
  version: number;
  layoutJson: unknown;
  createdAt: number;
  updatedAt: number;
}

// ===== Helpers =====

interface AuthResponse {
  success: boolean;
  token: string;
  player: { id: string; displayName: string; role: string };
}

interface CreateInviteResponse {
  success: boolean;
  invitation: { id: string; code: string; createdBy: string; isUsed: boolean };
}

/** 轮询后端就绪：接受 2xx/4xx 作为就绪信号（404 也算后端已起） */
async function waitForBackend(baseURL: string, maxAttempts: number, intervalMs: number): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const resp = await fetch(baseURL);
      // 2xx 或 4xx 都算后端已起（仅 5xx 或网络错误视为未就绪）
      if (resp.status < 500) return;
    } catch {
      // 网络错误，继续重试
    }
    await sleep(intervalMs);
  }
  throw new Error(`E2E globalSetup: 后端 ${baseURL} 在 ${maxAttempts} 次探测后仍未就绪`);
}

/** 从 backend/.env 读取 ADMIN_SECRET_KEY（不引入 dotenv） */
function readAdminSecretFromEnv(): string | undefined {
  const envPath = path.resolve(__dirname, '../../backend/.env');
  if (!fs.existsSync(envPath)) return undefined;

  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^ADMIN_SECRET_KEY\s*=\s*(.+)\s*$/);
    if (match) {
      // 去除可能的引号包裹
      return match[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  return undefined;
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const resp = await fetch(url, init);
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}: ${text || resp.statusText} [${url}]`);
  }
  return (await resp.json()) as T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
