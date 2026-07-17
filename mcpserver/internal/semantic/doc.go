// Package semantic 提供 Agent 视角的游戏状态语义抽象层。
//
// 本包把 gamesdk.ViewState（脱敏后的原始状态）投影为 Agent 决策友好的
// 强类型结构，屏蔽底层松散字段、补齐语义边界。整个抽象层划分为五个域：
//
//   - ObjectProjector      : 对象投影。把 ViewState 拆分为 Self/Foes/Field
//                             三类对象快照，并按 Agent 决策需要做语义化裁剪。
//                             产出 AgentView 顶层容器。
//   - MechanismInterpreter  : 机制解释。把广播/打击/防御等原始事件解读为
//                             高层语义动作（后续 Phase 实现）。
//   - AffordanceExplorer    : 可行性枚举。从 PendingAction 派生 Agent 当前
//                             可执行动作空间（后续 Phase 实现）。
//   - StateDelta            : 状态增量。对比两次 ViewState 派生结构化 diff，
//                             帮助 Agent 关注变化（后续 Phase 实现）。
//   - OnDemandDetail        : 按需下钻。Agent 提问时再展开特定对象细节，
//                             避免一次性投递过载（后续 Phase 实现）。
//
// Phase A 仅实现 ObjectProjector，产出 AgentView 顶层容器，含
// Self/Foes/Field/Events/Cursor 五个域。
package semantic
