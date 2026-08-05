import type { MapLayoutSnapshot } from '@/api/maps';
import type { StarNode, StarEdge } from './types';

/**
 * .dfmap.json / .json 备份文件解析辅助。
 *
 * 编辑器「导入备份」直接解析文件后 dispatch LOAD_LAYOUT；后端创建/更新地图时会再次
 * 校验（ValidateMap + 敏感词 + 配额），但前端预校验可减少无效请求并提早反馈。
 */

const ALLOWED_EXTENSIONS = ['.dfmap.json', '.json'];

/**
 * 解析用户选择的地图文件，返回 MapLayoutSnapshot。
 *
 * 校验规则：
 *   1. 文件名以 `.dfmap.json` 或 `.json` 结尾
 *   2. 内容为合法 JSON
 *   3. 顶层结构为 `{ nodes: StarNode[], edges: StarEdge[] }`
 *   4. nodes 为数组且每个 node 含 id（number）/x（number）/y（number）/name（string）
 *   5. edges 为数组且每条 edge 含 from（number）/to（number）
 *
 * 任何校验失败 throw Error（含具体原因），UI 层 catch 后展示。
 */
export async function parseMapFile(file: File): Promise<MapLayoutSnapshot> {
  const name = file.name.toLowerCase();
  const matched = ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext));
  if (!matched) {
    throw new Error(`文件扩展名不支持，仅接受 ${ALLOWED_EXTENSIONS.join(' / ')}`);
  }

  let text: string;
  try {
    text = await file.text();
  } catch (err) {
    throw new Error(`读取文件失败：${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`JSON 解析失败：${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }

  return validateLayout(parsed);
}

/**
 * 校验解析后的 JSON 结构是否符合 MapLayoutSnapshot。
 * 抛出带具体字段路径的 Error 以便 UI 展示。
 */
function validateLayout(value: unknown): MapLayoutSnapshot {
  if (typeof value !== 'object' || value === null) {
    throw new Error('地图根结构必须是对象 { nodes, edges }');
  }
  const obj = value as Record<string, unknown>;

  if (!Array.isArray(obj.nodes)) {
    throw new Error('nodes 字段缺失或不是数组');
  }
  if (!Array.isArray(obj.edges)) {
    throw new Error('edges 字段缺失或不是数组');
  }

  const nodes = obj.nodes as unknown[];
  const edges = obj.edges as unknown[];

  nodes.forEach((n, i) => {
    if (typeof n !== 'object' || n === null) {
      throw new Error(`nodes[${i}] 不是对象`);
    }
    const node = n as Record<string, unknown>;
    if (typeof node.id !== 'number' || !Number.isFinite(node.id)) {
      throw new Error(`nodes[${i}].id 必须是有限数字`);
    }
    if (typeof node.x !== 'number' || !Number.isFinite(node.x)) {
      throw new Error(`nodes[${i}].x 必须是有限数字`);
    }
    if (typeof node.y !== 'number' || !Number.isFinite(node.y)) {
      throw new Error(`nodes[${i}].y 必须是有限数字`);
    }
    if (typeof node.name !== 'string' || node.name === '') {
      throw new Error(`nodes[${i}].name 必须是非空字符串`);
    }
  });

  edges.forEach((e, i) => {
    if (typeof e !== 'object' || e === null) {
      throw new Error(`edges[${i}] 不是对象`);
    }
    const edge = e as Record<string, unknown>;
    if (typeof edge.from !== 'number' || !Number.isFinite(edge.from)) {
      throw new Error(`edges[${i}].from 必须是有限数字`);
    }
    if (typeof edge.to !== 'number' || !Number.isFinite(edge.to)) {
      throw new Error(`edges[${i}].to 必须是有限数字`);
    }
  });

  // 类型断言：经过上面校验，结构符合 StarNode[] / StarEdge[]
  return {
    nodes: nodes as StarNode[],
    edges: edges as StarEdge[],
  };
}
