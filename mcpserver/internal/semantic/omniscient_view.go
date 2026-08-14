package semantic

import (
	"encoding/json"
	"fmt"

	"darkforest/mcpserver/internal/gamesdk"
)

// ============================================================================
// 输出类型：全知视角 OmniscientView
// ============================================================================

// OmniscientPlayer 是全知视角下的单个玩家（所有字段可见）。
// 与 SelfSnapshot 类似但 Hand 永远可见（不区分对手/自己）。
// 字段名注释指向 backend/internal/game/types.go:114-131 Player struct。
type OmniscientPlayer struct {
	ID                string                          `json:"id"`                          // backend: players[].id
	Name              string                          `json:"name"`                        // backend: players[].name
	Color             string                          `json:"color"`                       // backend: players[].color
	Energy            int                             `json:"energy"`                      // backend: players[].energy
	Position          int                             `json:"position"`                    // backend: players[].position (全知下所有玩家真实星系，无 -1)
	Eliminated        bool                            `json:"eliminated"`                  // backend: players[].eliminated
	EliminationReason string                          `json:"eliminationReason,omitempty"` // backend: players[].eliminationReason (strike/forfeit/timeout/fallback)
	Hand              []gamesdk.Card                  `json:"hand"`                        // backend: players[].hand（全知，所有玩家手牌全量）
	FaceUpCards       []SimpleCard                    `json:"faceUpCards"`                 // backend: players[].faceUpCards（简化语义投影）
	BroadcastHistory  []gamesdk.BroadcastHistoryEntry `json:"broadcastHistory"`            // backend: players[].broadcastHistory
}

// OmniscientDrawPile 是全知视角下的抽牌堆摘要。
type OmniscientDrawPile struct {
	Count     int      `json:"count"`     // 抽牌堆剩余张数
	CardNames []string `json:"cardNames"` // 全知下可见的按顺序卡名（顶牌在前）
}

// OmniscientStrike 是全知视角下的飞行打击（逐目标威胁分级）。
// 复用 computeStrikeETA/computeThreatLevel/buildStrikeExplain。
type OmniscientStrike struct {
	UID             string      `json:"uid"`
	StrikeName      string      `json:"strikeName"`
	DefID           string      `json:"defId"`
	Level           int         `json:"level"`
	OwnerID         string      `json:"ownerId"`
	OwnerName       string      `json:"ownerName"`
	Position        int         `json:"position"`
	TargetSystem    int         `json:"targetSystem"`
	Arrived         bool        `json:"arrived"`
	ETATurns        int         `json:"etaTurns"`
	ThreatLevel     ThreatLevel `json:"threatLevel"`
	Explain         string      `json:"explain"`
	TargetPlayerIDs []string    `json:"targetPlayerIds,omitempty"` // 目标星系上的候选玩家（排除已淘汰与打击者自己）
}

// OmniscientStarEffect 是星系效果的最小投影。
type OmniscientStarEffect struct {
	SystemID      int    `json:"systemId"`
	Type          string `json:"type"`
	AppliedAtTurn int    `json:"appliedAtTurn"`
	Duration      int    `json:"duration"`
}

// OmniscientView 是全知视角的顶层视图（所有玩家手牌/牌库可见）。
type OmniscientView struct {
	Players           []OmniscientPlayer     `json:"players"`
	DrawPile          OmniscientDrawPile     `json:"drawPile"`
	DiscardPile       []string               `json:"discardPile"` // 弃牌卡名列表
	FlyingStrikes     []OmniscientStrike     `json:"flyingStrikes"`
	DestroyedStars    []int                  `json:"destroyedStars"`
	StarEffects       []OmniscientStarEffect `json:"starEffects"`
	Turn              int                    `json:"turn"`
	Phase             string                 `json:"phase"`
	TurnPhase         string                 `json:"turnPhase"`
	CurrentPlayerID   string                 `json:"currentPlayerId"`
	GameMode          string                 `json:"gameMode"`
	Winner            string                 `json:"winner,omitempty"`
	CurrentPlayerName string                 `json:"currentPlayerName,omitempty"`
	Clamped           bool                   `json:"clamped,omitempty"`       // 请求回合越界时 clamp 到末帧
	InvalidActions    int                    `json:"invalidActions,omitempty"` // 截至目标回合重放遇到的无效动作数
}

// ============================================================================
// 内部解析结构：与 backend GameState JSON 对齐
// ============================================================================

// rawGameState 是 backend internal/game/types.go:296 GameState 的最小解析子集
// （仅 ProjectOmniscient 需要的字段）。字段顺序注释对应源位置。
type rawGameState struct {
	Phase              string                 `json:"phase"`              // backend: GameState.Phase
	TotalTurn          int                    `json:"totalTurn"`          // backend: GameState.TotalTurn
	CurrentPlayerIndex int                    `json:"currentPlayerIndex"` // backend: GameState.CurrentPlayerIndex
	CurrentPlayerID    string                 `json:"currentPlayerId"`    // backend: GameState.CurrentPlayerID
	LocalPlayerID      string                 `json:"localPlayerId"`      // backend: GameState.LocalPlayerID
	TurnPhase          string                 `json:"turnPhase"`          // backend: GameState.TurnPhase
	GameMode           string                 `json:"gameMode,omitempty"` // backend: GameState.GameMode
	Players            []rawPlayer            `json:"players"`
	DrawPile           []gamesdk.Card         `json:"drawPile"`
	DiscardPile        []gamesdk.Card         `json:"discardPile"`
	FlyingStrikes      []gamesdk.FlyingStrike `json:"flyingStrikes"`
	DestroyedStars     []int                  `json:"destroyedStars"`
	StarEffects        []OmniscientStarEffect `json:"starEffects"`
	Winner             *string                `json:"winner,omitempty"`
}

type rawPlayer struct {
	ID                string                          `json:"id"`
	Name              string                          `json:"name"`
	Color             string                          `json:"color"`
	Position          int                             `json:"position"`
	Energy            int                             `json:"energy"`
	Hand              []gamesdk.Card                  `json:"hand"`
	FaceUpCards       []gamesdk.Card                  `json:"faceUpCards"`
	Eliminated        bool                            `json:"eliminated"`
	EliminationReason string                          `json:"eliminationReason,omitempty"` // 对齐 backend Player 同名字段
	BroadcastHistory  []gamesdk.BroadcastHistoryEntry `json:"broadcastHistory,omitempty"`
}

// ============================================================================
// ProjectOmniscient：全量 GameState JSON → 全知视角投影
// ============================================================================

// ProjectOmniscient 从回放原始 GameState JSON（全量、未脱敏）投影全知视角。
// 复用 semantic 低层 helper：computeStrikeETA / computeThreatLevel / buildStrikeExplain
// / GetDistance / AreAdjacent / classifyCard。
//
// raw: 回放 states[] 中某一帧的完整 JSON（backend game.GameState 序列化）
// gameMode: 对局模式（classic / civilization_relics 等），写入输出
func ProjectOmniscient(raw json.RawMessage, gameMode string) (OmniscientView, error) {
	var gs rawGameState
	if err := json.Unmarshal(raw, &gs); err != nil {
		return OmniscientView{}, fmt.Errorf("解析 GameState JSON 失败: %w", err)
	}

	out := OmniscientView{
		Turn:            gs.TotalTurn,
		Phase:           gs.Phase,
		TurnPhase:       gs.TurnPhase,
		CurrentPlayerID: gs.CurrentPlayerID,
		GameMode:        gameMode,
		DestroyedStars:  append([]int(nil), gs.DestroyedStars...),
		StarEffects:     append([]OmniscientStarEffect(nil), gs.StarEffects...),
	}
	if gs.Winner != nil {
		out.Winner = *gs.Winner
	}

	// 玩家投影 + 建立 id→name 索引
	id2name := make(map[string]string, len(gs.Players))
	id2pos := make(map[string]int, len(gs.Players))
	for i := range gs.Players {
		rp := &gs.Players[i]
		id2name[rp.ID] = rp.Name
		id2pos[rp.ID] = rp.Position
		op := OmniscientPlayer{
			ID:                rp.ID,
			Name:              rp.Name,
			Color:             rp.Color,
			Energy:            rp.Energy,
			Position:          rp.Position,
			Eliminated:        rp.Eliminated,
			EliminationReason: rp.EliminationReason,
			Hand:              append([]gamesdk.Card(nil), rp.Hand...),
			FaceUpCards:       projectFaceUpCards(rp.FaceUpCards),
			BroadcastHistory:  append([]gamesdk.BroadcastHistoryEntry(nil), rp.BroadcastHistory...),
		}
		out.Players = append(out.Players, op)
		if rp.ID == gs.CurrentPlayerID {
			out.CurrentPlayerName = rp.Name
		}
	}

	// DrawPile 摘要
	out.DrawPile.Count = len(gs.DrawPile)
	out.DrawPile.CardNames = make([]string, 0, len(gs.DrawPile))
	for i := range gs.DrawPile {
		out.DrawPile.CardNames = append(out.DrawPile.CardNames, gs.DrawPile[i].Name)
	}

	// DiscardPile 卡名
	out.DiscardPile = make([]string, 0, len(gs.DiscardPile))
	for i := range gs.DiscardPile {
		out.DiscardPile = append(out.DiscardPile, gs.DiscardPile[i].Name)
	}

	// 飞行打击：ETA + 威胁 + explain + 目标候选
	out.FlyingStrikes = make([]OmniscientStrike, 0, len(gs.FlyingStrikes))
	for i := range gs.FlyingStrikes {
		fs := &gs.FlyingStrikes[i]
		eta := computeStrikeETA(fs)
		// 目标星系上的最高防御（全知视角，对所有该星系玩家 faceUp 的防御取最大）
		targetMaxProtection := computeSystemMaxProtection(gs.Players, fs.TargetSystem)
		threat := computeThreatLevel(fs.Level, fs.Effect, targetMaxProtection)
		// explain：全知视角 explain 陈述事实（buildStrikeExplain 内部处理 Effect 空值）
		explain := buildStrikeExplain(fs, fs.TargetSystem, targetMaxProtection, false)
		// 目标候选玩家
		targets := collectOmniscientTargets(&gs, fs)
		out.FlyingStrikes = append(out.FlyingStrikes, OmniscientStrike{
			UID:             fs.UID,
			StrikeName:      fs.StrikeName,
			DefID:           fs.DefID,
			Level:           fs.Level,
			OwnerID:         fs.OwnerID,
			OwnerName:       id2name[fs.OwnerID],
			Position:        fs.Position,
			TargetSystem:    fs.TargetSystem,
			Arrived:         fs.Arrived,
			ETATurns:        eta,
			ThreatLevel:     threat,
			Explain:         explain,
			TargetPlayerIDs: targets,
		})
	}

	return out, nil
}

// computeSystemMaxProtection 返回目标星系上所有非打击者玩家的最高防御等级。
// 与 computeMyMaxProtection 类似但按星系聚合。
func computeSystemMaxProtection(players []rawPlayer, systemID int) int {
	maxProt := 0
	for i := range players {
		p := &players[i]
		if p.Position != systemID {
			continue
		}
		if p.Eliminated {
			continue
		}
		for _, c := range p.FaceUpCards {
			if c.Type == "defense" {
				prot := c.ProtectionLevel
				if prot > maxProt {
					maxProt = prot
				}
			}
		}
	}
	return maxProt
}

// collectOmniscientTargets 返回目标星系上的候选玩家 ID（排除已淘汰与打击拥有者）。
// 全知版本；与 collectTargetPlayerIDs 逻辑类似但基于 rawGameState + rawPlayer。
func collectOmniscientTargets(gs *rawGameState, fs *gamesdk.FlyingStrike) []string {
	var ids []string
	for i := range gs.Players {
		p := &gs.Players[i]
		if p.Eliminated {
			continue
		}
		if p.Position != fs.TargetSystem {
			continue
		}
		if p.ID == fs.OwnerID {
			continue
		}
		ids = append(ids, p.ID)
	}
	return ids
}
