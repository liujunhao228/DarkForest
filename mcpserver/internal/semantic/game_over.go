package semantic

import "darkforest/mcpserver/internal/gamesdk"

// GameResult 是终局结果相对观察者的三态。
type GameResult string

const (
	// GameResultWin 观察者获胜。
	GameResultWin GameResult = "win"
	// GameResultLoss 观察者落败（存在其他胜者）。
	GameResultLoss GameResult = "loss"
	// GameResultDraw 全灭/无胜者。
	GameResultDraw GameResult = "draw"
)

// GameOverView 是终局权威投影，回答"对局结束，谁赢/谁输/平局"。
//
// result 相对 viewerID 判定：winner==viewerID→win、非空非我→loss、
// 空串（全灭）→draw。观战者（winner 非空且非我）为 loss。
//
// 注意：ViewState.Winner 是 string omitempty，空串即全灭语义，
// 不要当作字段缺失。
type GameOverView struct {
	Winner     string     `json:"winner,omitempty"`
	Result     GameResult `json:"result"`
	ReplayID   string     `json:"replayId,omitempty"`
	TotalTurn  int        `json:"totalTurn"`
	Eliminated []string   `json:"eliminated,omitempty"`
}

// ProjectGameOver 把 gameOver 状态的 ViewState 投影为权威终局视图。
//
// viewerID 是当前观察者玩家 ID。
// 若 state 为 nil，返回零值 GameOverView（Result=draw，实为防御分支，调用方应保证非 nil）。
func ProjectGameOver(state *gamesdk.ViewState, viewerID string) GameOverView {
	view := GameOverView{Result: GameResultDraw}
	if state == nil {
		return view
	}

	view.Winner = state.Winner
	view.ReplayID = state.ReplayID
	view.TotalTurn = state.TotalTurn

	switch {
	case state.Winner == "":
		view.Result = GameResultDraw
	case state.Winner == viewerID:
		view.Result = GameResultWin
	default:
		view.Result = GameResultLoss
	}

	for i := range state.Players {
		if state.Players[i].Eliminated {
			view.Eliminated = append(view.Eliminated, state.Players[i].ID)
		}
	}

	return view
}
