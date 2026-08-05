import type { MapLayoutSnapshot } from '@/api/maps';

/**
 * 导出地图为 .dfmap.json 文件。
 *
 * 文件 schema 与 P3 layout_json 完全一致：{nodes:[{id,x,y,name,size,tint}], edges:[{from,to}]}。
 * MIME 类型 application/json，扩展名 .dfmap.json，与 P3 上传端点校验对齐。
 */

const FILE_EXTENSION = '.dfmap.json';
const MIME_TYPE = 'application/json';

/**
 * 触发浏览器下载 .dfmap.json 文件。
 *
 * @param layout 地图布局快照
 * @param filename 文件名（不含扩展名；若已含 .dfmap.json 后缀则不重复添加）
 */
export function exportMapFile(layout: MapLayoutSnapshot, filename: string): void {
  const json = JSON.stringify(layout, null, 2);
  const blob = new Blob([json], { type: MIME_TYPE });
  const url = URL.createObjectURL(blob);

  const fullName = filename.endsWith(FILE_EXTENSION) ? filename : filename + FILE_EXTENSION;

  const a = document.createElement('a');
  a.href = url;
  a.download = fullName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // 延迟释放，避免下载未完成就 revoke
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
