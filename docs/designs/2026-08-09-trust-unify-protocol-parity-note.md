---
design_type: note
created_at: 2026-08-09
---

# 协议双份维护（hub/protocol.go ↔ gamesdk/protocol.go）—— codegen 候选记录

## 背景

backend 的 WS 协议事件常量与消息结构体存在于两个包，内容需要逐字节对齐（否则 mcpserver 对讲不上）：

- backend：`backend/internal/hub/protocol.go`（`ProtocolVersion "1.0.0"`、ClientEvent/ServerEvent 类型与事件常量 `EvtPlayerLogin` 等、`Message`、`PlayerInfo`、`LoginRequest`、`MatchmakingRequest`、`RoomJoinRequest`、`GameActionRequest`、`ErrorResponse`、`ActiveGameInfo`）
- mcpserver：`mcpserver/internal/gamesdk/protocol.go`（同名源字符串常量 `EventPlayerLogin`/`EventMatchJoinQueue` 等 + `Message`/`GameActionRequest`/`ErrorResponse`/`GameActionResult` 与大量脱敏 View 结构 `ViewState`/`Card`/`StarEffect`…，带「对齐后端」注释）

两者靠「ws payload + git 评审」双份手工维持；曾用「struct 对齐 + 字段补丁」补洞，但没有结构化检测（mode_rules 已用 codegen + 对拍测试锁，见总 design `docs/designs/2026-08-09-backend-mcp-trust-unify-design.md` 的「codegen 对拍」条目与批 C）。

## 决策

- Q23：协议事件常量 / 卡牌库 / 星图拓扑 **搁置本轮 codegen 化**，留作专项。
- 本批（批 E）仅记录，不做 codegen 改造。

## 后续触发信号

- 再次出现「协议加字段/改事件名只改了一边」且回归顺手时，启动专项：以 backend `hub/protocol.go` 为唯一真相源，codegen 出 mcpserver 侧常量 + 消息结构，并加 AST/反射对拍测试锁（复用 `backend/internal/game/mode_rules_gen_parity_test.go` 的先例）。
- 专项灵感可参考批 C 的模板与 gate：template + fmt.Sprintf + `cd backend && go run ./cmd/codegen`。
