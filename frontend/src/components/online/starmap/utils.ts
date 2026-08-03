/** 标注文本最大显示长度（SVG 内联渲染） */
export const MAX_NOTE_LEN = 12;

/**
 * 截断 note 至首行 + 限定字符数：
 * 1. 空字符串直接返回 ''
 * 2. 按 \n 拆分取首行（多行 note 仅渲染首行避免 SVG text 撑高布局）
 * 3. 首行超过 maxLen 字符截断为 maxLen + '…'
 */
export function truncateToFirstLine(note: string, maxLen = MAX_NOTE_LEN): string {
  if (!note) return '';
  const firstLine = note.split('\n')[0];
  if (firstLine.length <= maxLen) return firstLine;
  return `${firstLine.slice(0, maxLen)}…`;
}