// 敏感词过滤工具：大小写不敏感子串匹配替换。
// 词表由后端统一下发（见 api/sensitiveWords.ts），调用方需显式传入。

/**
 * 对输入字符串进行大小写不敏感的子串匹配，命中词替换为 "***"。
 * 多次命中会全部替换；未命中返回原文。
 *
 * 实现说明：使用 RegExp 构造匹配模式时对词中可能的正则元字符做转义，
 * 避免词表含特殊字符导致误匹配或抛错。
 *
 * 当传入词表为空数组时，直接返回原文（降级不过滤）。
 *
 * @param s 待过滤的字符串
 * @param words 敏感词数组（由后端下发）
 * @returns 过滤后的字符串（命中替换为 ***，未命中返回原文）
 */
export function filterSensitive(s: string, words: readonly string[]): string {
  if (!s) return s;
  // 词表为空时降级为不过滤，避免无意义循环
  if (!words || words.length === 0) return s;
  let result = s;
  for (const word of words) {
    if (!word) continue;
    // 转义正则元字符，保证按字面量匹配
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 大小写不敏感 + 全局替换
    const pattern = new RegExp(escaped, 'giu');
    result = result.replace(pattern, '***');
  }
  return result;
}
