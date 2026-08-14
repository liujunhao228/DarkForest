package replay

import (
	"github.com/darkforest/backend/internal/game"
)

// AnalysisFrame 是 GameState 的轻量分析投影，仅含分析必要的字段。
// 用于 MCP/analyser 下钻回放时替代全量 GameState，单帧体积从 MB 级降至 KB 级。
type AnalysisFrame struct {
	Turn            int                   `json:"turn"`
	Phase           string                `json:"phase"`
	TurnPhase       string                `json:"turnPhase"`
	GameMode        string                `json:"gameMode,omitempty"`
	Players         []AnalysisPlayer      `json:"players"`
	DrawPileCount   int                   `json:"drawPileCount"`
	DiscardPile     []string              `json:"discardPile"`
	FlyingStrikes   []AnalysisFlyingStrike `json:"flyingStrikes"`
	DestroyedStars  []int                 `json:"destroyedStars"`
	StarEffects     []AnalysisStarEffect  `json:"starEffects"`
	LogEntries      []AnalysisLogEntry    `json:"logEntries,omitempty"`
	Winner          string                `json:"winner,omitempty"`
	CurrentPlayerID string                `json:"currentPlayerId,omitempty"`
	Clamped         bool                  `json:"clamped,omitempty"`
	InvalidActions  int                   `json:"invalidActions,omitempty"`
}

// AnalysisPlayer 是玩家粒度的轻量分析投影。
type AnalysisPlayer struct {
	ID                string   `json:"id"`
	Name              string   `json:"name"`
	Energy            int      `json:"energy"`
	Position          int      `json:"position"`
	HandCount         int      `json:"handCount"`
	FaceUpNames       []string `json:"faceUpNames"`
	Eliminated        bool     `json:"eliminated"`
	EliminationReason string   `json:"eliminationReason,omitempty"`
}

// AnalysisFlyingStrike 是飞行打击的轻量分析投影。
type AnalysisFlyingStrike struct {
	UID          string `json:"uid"`
	StrikeName   string `json:"strikeName"`
	DefID        string `json:"defId"`
	Level        int    `json:"level"`
	OwnerID      string `json:"ownerId"`
	Position     int    `json:"position"`
	TargetSystem int    `json:"targetSystem"`
	Arrived      bool   `json:"arrived"`
}

// AnalysisStarEffect 是星系级持续效果的轻量分析投影。
type AnalysisStarEffect struct {
	SystemID      int    `json:"systemId"`
	Type          string `json:"type"`
	AppliedAtTurn int    `json:"appliedAtTurn"`
	Duration      int    `json:"duration"`
}

// AnalysisLogEntry 是回放日志的轻量分析投影。
type AnalysisLogEntry struct {
	Turn    int    `json:"turn,omitempty"`
	Phase   string `json:"phase,omitempty"`
	Message string `json:"message"`
}

// ProjectAnalysisFrame 将全量 GameState 投影为轻量 AnalysisFrame。
// clamped 表示该帧是否因越界被 clamp 到末帧；invalidCount 为重放过程中的无效动作数。
func ProjectAnalysisFrame(gs *game.GameState, clamped bool, invalidCount int) *AnalysisFrame {
	if gs == nil {
		return nil
	}
	frame := &AnalysisFrame{
		Turn:            gs.TotalTurn,
		Phase:           string(gs.Phase),
		TurnPhase:       string(gs.TurnPhase),
		GameMode:        string(gs.GameMode),
		DrawPileCount:   len(gs.DrawPile),
		DestroyedStars:  append([]int(nil), gs.DestroyedStars...),
		CurrentPlayerID: gs.CurrentPlayerID,
		Clamped:         clamped,
		InvalidActions:  invalidCount,
	}
	if gs.Winner != nil {
		frame.Winner = *gs.Winner
	}

	// 玩家投影
	frame.Players = make([]AnalysisPlayer, 0, len(gs.Players))
	for i := range gs.Players {
		p := &gs.Players[i]
		faceUp := make([]string, 0, len(p.FaceUpCards))
		for j := range p.FaceUpCards {
			faceUp = append(faceUp, p.FaceUpCards[j].Name)
		}
		frame.Players = append(frame.Players, AnalysisPlayer{
			ID:                p.ID,
			Name:              p.Name,
			Energy:            p.Energy,
			Position:          p.Position,
			HandCount:         len(p.Hand),
			FaceUpNames:       faceUp,
			Eliminated:        p.Eliminated,
			EliminationReason: p.EliminationReason,
		})
	}

	// 弃牌堆卡名
	frame.DiscardPile = make([]string, 0, len(gs.DiscardPile))
	for i := range gs.DiscardPile {
		frame.DiscardPile = append(frame.DiscardPile, gs.DiscardPile[i].Name)
	}

	// 飞行打击
	frame.FlyingStrikes = make([]AnalysisFlyingStrike, 0, len(gs.FlyingStrikes))
	for i := range gs.FlyingStrikes {
		fs := &gs.FlyingStrikes[i]
		frame.FlyingStrikes = append(frame.FlyingStrikes, AnalysisFlyingStrike{
			UID:          fs.UID,
			StrikeName:   fs.StrikeName,
			DefID:        fs.DefID,
			Level:        fs.Level,
			OwnerID:      fs.OwnerID,
			Position:     fs.Position,
			TargetSystem: fs.TargetSystem,
			Arrived:      fs.Arrived,
		})
	}

	// 星系效果
	frame.StarEffects = make([]AnalysisStarEffect, 0, len(gs.StarEffects))
	for i := range gs.StarEffects {
		se := &gs.StarEffects[i]
		frame.StarEffects = append(frame.StarEffects, AnalysisStarEffect{
			SystemID:      se.SystemID,
			Type:          string(se.Type),
			AppliedAtTurn: se.AppliedAtTurn,
			Duration:      se.Duration,
		})
	}

	// 日志
	if len(gs.Logs) > 0 {
		frame.LogEntries = make([]AnalysisLogEntry, 0, len(gs.Logs))
		for i := range gs.Logs {
			l := &gs.Logs[i]
			frame.LogEntries = append(frame.LogEntries, AnalysisLogEntry{
				Turn:    l.Turn,
				Phase:   l.Phase,
				Message: l.Message,
			})
		}
	}

	return frame
}
