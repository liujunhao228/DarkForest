/**
 * 组局任务文本生成：为 dsh profile AI 玩家生成「加入自定义队列 + 打完整局」的指令。
 *
 * 与游戏交互链路（对齐后端 WS/MCP 协议，不新增后端能力）：
 *   1. dsh CLI 以 DF_AGENT_SID 身份经 mcpserver trust 通道连入；
 *   2. df_join_custom_queue 加入前端建好的 specific queue；
 *   3. df_await_turn 循环等待：needDecision=false 继续等，true 则决策；
 *   4. gameOver 时 df_finish 收尾。
 *
 * 基准见被弃插件 matchmaker.ts 的 buildJoinTask；此处去掉 playerCount（队列
 * min/maxPlayers 在建队列时已定），补 gameMode 可选字段。
 *
 * @module
 */

export interface BuildMatchTaskOptions {
  /** 前端 match:createQueue 返回的队列 ID。 */
  queueId: string
  /** 对局模式（classic / civilization_relics）；可选。 */
  gameMode?: string
}

/**
 * 生成 AI 的入队+打牌任务文本。
 * @param opts - queueId / 可选 gameMode。
 * @returns 任务文本。
 */
export function buildMatchTask(opts: BuildMatchTaskOptions): string {
  const modePart = opts.gameMode ? `，模式=${opts.gameMode}` : ''
  return '有人创建了自定义对局队列，等待你加入。'
    + `请先用 df_join_custom_queue 加入队列（queueId=${opts.queueId}${modePart}）。`
    + '加入后反复调用 df_await_turn：needDecision=false 就继续等；needDecision=true 就按局面正常决策'
    + '（forced 事件先响应，动作参数 snake_case、目标来自合法集）；gameOver 时调用 df_finish。'
    + '全程只通过工具交互，不编造局面。'
}
