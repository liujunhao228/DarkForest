/**
 * 构造回放分享链接（含 origin，便于跨设备访问）
 */
export function buildReplayShareUrl(replayId: string): string {
  return `${window.location.origin}/replay/${replayId}`;
}

/**
 * 从用户输入解析回放 ID。
 * 支持三种输入：
 *   - 完整 URL：https://host/replay/abc-123 → "abc-123"
 *   - 路径：/replay/abc-123 → "abc-123"
 *   - 裸 UUID：abc-123 → "abc-123"
 * 输入为空或无法提取时返回 null。
 */
export function parseReplayIdFromInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // 尝试匹配 /replay/{id} 片段（含完整 URL 或纯路径）
  const match = trimmed.match(/\/replay\/([^/?#]+)/);
  if (match) return match[1];

  // 否则视为裸 UUID（简单校验非空且无空格/斜杠）
  if (/^[^\s/]+$/.test(trimmed)) return trimmed;

  return null;
}
