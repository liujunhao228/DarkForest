package tools

import (
	"encoding/json"
	"fmt"

	"darkforest/mcpserver/internal/gamesdk"
	"darkforest/mcpserver/internal/persistence"
)

// replayGameState 是后端 game.GameState 的解析子集，仅保留 delta 计算所需字段。
// JSON tag 必须与 backend/internal/game/types.go 的 GameState 对齐。
type replayGameState struct {
	Phase           string         `json:"phase"`
	TotalTurn       int            `json:"totalTurn"`
	Players         []replayPlayer `json:"players"`
	CurrentPlayerID string         `json:"currentPlayerId"`
	DrawPile        []replayCard   `json:"drawPile"`
	DiscardPile     []replayCard   `json:"discardPile"`
	FlyingStrikes   []replayStrike `json:"flyingStrikes"`
	DestroyedStars  []int          `json:"destroyedStars"`
	Winner          *string        `json:"winner,omitempty"`
}

type replayPlayer struct {
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	Energy      int          `json:"energy"`
	Hand        []replayCard `json:"hand"`
	FaceUpCards []replayCard `json:"faceUpCards"`
	Eliminated  bool         `json:"eliminated"`
}

type replayCard struct {
	UID  string `json:"uid"`
	Name string `json:"name"`
	Type string `json:"type"`
}

type replayStrike struct {
	UID        string `json:"uid"`
	OwnerID    string `json:"ownerId"`
	StrikeName string `json:"strikeName"`
	Arrived    bool   `json:"arrived"`
}

// --- delta 输出类型 ---

// TurnDelta 是单个回合的 delta。
type TurnDelta struct {
	Turn       int                    `json:"turn"`
	PlayerID   string                 `json:"playerId"`
	PlayerName string                 `json:"playerName"`
	Actions    []gamesdk.ActionRecord `json:"actions"`
	Changes    TurnChanges            `json:"changes"`
}

// TurnChanges 是回合边界的关键状态差异。
type TurnChanges struct {
	Players              []PlayerChange `json:"players"`
	DrawPileCountDelta   int            `json:"drawPileCountDelta"`
	DiscardAdditions     []string       `json:"discardAdditions"`     // 新进入弃牌堆的卡牌名
	FlyingStrikesAdded   []string       `json:"flyingStrikesAdded"`   // 新发射的打击名
	FlyingStrikesRemoved []string       `json:"flyingStrikesRemoved"` // 已抵达/被摧毁的打击名
	DestroyedStarsAdded  []int          `json:"destroyedStarsAdded"`
	Winner               string         `json:"winner,omitempty"` // 本回合决出胜负时填入
}

// PlayerChange 是单个玩家在本回合的状态变化。
type PlayerChange struct {
	PlayerID      string   `json:"playerId"`
	PlayerName    string   `json:"playerName"`
	HandAdded     []string `json:"handAdded"`     // 抽到的卡牌名
	HandRemoved   []string `json:"handRemoved"`   // 打出/弃掉的卡牌名
	FaceUpAdded   []string `json:"faceUpAdded"`   // 部署的卡牌名
	FaceUpRemoved []string `json:"faceUpRemoved"` // 被摧毁/移除的场上卡牌名
	EnergyDelta   int      `json:"energyDelta"`
	Eliminated    bool     `json:"eliminated,omitempty"` // 本回合被淘汰时为 true
}

// --- diff 辅助函数 ---

// diffCards 按 UID 比较两个卡牌切片，返回 (added, removed) 卡牌名。
// added = curr 有而 prev 无的卡；removed = prev 有而 curr 无的卡。
func diffCards(prev, curr []replayCard) (added, removed []string) {
	prevSet := make(map[string]replayCard, len(prev))
	for _, c := range prev {
		prevSet[c.UID] = c
	}
	currSet := make(map[string]replayCard, len(curr))
	for _, c := range curr {
		currSet[c.UID] = c
	}
	for uid, c := range currSet {
		if _, ok := prevSet[uid]; !ok {
			added = append(added, c.Name)
		}
	}
	for uid, c := range prevSet {
		if _, ok := currSet[uid]; !ok {
			removed = append(removed, c.Name)
		}
	}
	return
}

// diffStrikes 按 UID 比较两个飞行打击切片，返回 (added, removed) 打击名。
func diffStrikes(prev, curr []replayStrike) (added, removed []string) {
	prevSet := make(map[string]replayStrike, len(prev))
	for _, s := range prev {
		prevSet[s.UID] = s
	}
	currSet := make(map[string]replayStrike, len(curr))
	for _, s := range curr {
		currSet[s.UID] = s
	}
	for uid, s := range currSet {
		if _, ok := prevSet[uid]; !ok {
			added = append(added, s.StrikeName)
		}
	}
	for uid, s := range prevSet {
		if _, ok := currSet[uid]; !ok {
			removed = append(removed, s.StrikeName)
		}
	}
	return
}

// diffIntSlice 返回 curr 相对 prev 新增的整数。
func diffIntSlice(prev, curr []int) []int {
	prevSet := make(map[int]bool, len(prev))
	for _, v := range prev {
		prevSet[v] = true
	}
	var added []int
	for _, v := range curr {
		if !prevSet[v] {
			added = append(added, v)
		}
	}
	return added
}

// --- computeDeltas 主逻辑 ---

// computeDeltas 从本地 ReplayRow 计算 [fromTurn, toTurn] 范围内的逐回合 delta。
// states 索引对齐：states[0] = 初始状态；states[k] = 应用 actions[k-1] 之后的状态。
// 对回合 T：prevState = states[该回合首个动作下标]（首个动作应用前），
// currState = states[该回合末个动作下标+1]（末个动作应用后）。
func computeDeltas(row *persistence.ReplayRow, fromTurn, toTurn int) ([]TurnDelta, error) {
	// 解析 states
	var states []replayGameState
	if err := json.Unmarshal([]byte(row.StatesJSON), &states); err != nil {
		return nil, fmt.Errorf("解析 states 失败: %w", err)
	}
	// 解析 actions
	var actions []gamesdk.ActionRecord
	if err := json.Unmarshal([]byte(row.ActionsJSON), &actions); err != nil {
		return nil, fmt.Errorf("解析 actions 失败: %w", err)
	}
	// 解析 playerNames 用于回合玩家名映射
	var playerNames []string
	_ = json.Unmarshal([]byte(row.PlayerNames), &playerNames)
	nameByID := make(map[string]string)
	var playerIDs []string
	_ = json.Unmarshal([]byte(row.PlayerIDs), &playerIDs)
	for i, id := range playerIDs {
		if i < len(playerNames) {
			nameByID[id] = playerNames[i]
		}
	}

	// 按 turn 分组动作索引
	turnFirstIdx := map[int]int{}
	turnLastIdx := map[int]int{}
	var turnOrder []int
	for i, a := range actions {
		t := a.Turn
		if _, ok := turnFirstIdx[t]; !ok {
			turnFirstIdx[t] = i
			turnOrder = append(turnOrder, t)
		}
		turnLastIdx[t] = i
	}

	var deltas []TurnDelta
	for _, t := range turnOrder {
		if t < fromTurn || t > toTurn {
			continue
		}
		firstIdx := turnFirstIdx[t]
		lastIdx := turnLastIdx[t]
		// prevState = states[firstIdx] (第一个动作应用前)
		// currState = states[lastIdx+1] (最后一个动作应用后)
		if firstIdx >= len(states) || lastIdx+1 >= len(states) {
			continue
		}
		prev := states[firstIdx]
		curr := states[lastIdx+1]
		turnActions := actions[firstIdx : lastIdx+1]

		// 回合玩家 = curr.CurrentPlayerID（或 prev，理论上同一回合不变）
		playerID := curr.CurrentPlayerID
		if playerID == "" {
			playerID = prev.CurrentPlayerID
		}

		delta := TurnDelta{
			Turn:       t,
			PlayerID:   playerID,
			PlayerName: nameByID[playerID],
			Actions:    turnActions,
			Changes:    computeTurnChanges(prev, curr),
		}
		deltas = append(deltas, delta)
	}
	return deltas, nil
}

func computeTurnChanges(prev, curr replayGameState) TurnChanges {
	ch := TurnChanges{
		DrawPileCountDelta: len(curr.DrawPile) - len(prev.DrawPile),
	}
	// 玩家变化
	prevPlayers := make(map[string]replayPlayer, len(prev.Players))
	for _, p := range prev.Players {
		prevPlayers[p.ID] = p
	}
	for _, p := range curr.Players {
		pp, existed := prevPlayers[p.ID]
		if !existed {
			continue
		}
		handAdd, handRem := diffCards(pp.Hand, p.Hand)
		faceAdd, faceRem := diffCards(pp.FaceUpCards, p.FaceUpCards)
		pc := PlayerChange{
			PlayerID:      p.ID,
			PlayerName:    p.Name,
			HandAdded:     handAdd,
			HandRemoved:   handRem,
			FaceUpAdded:   faceAdd,
			FaceUpRemoved: faceRem,
			EnergyDelta:   p.Energy - pp.Energy,
			Eliminated:    !pp.Eliminated && p.Eliminated,
		}
		ch.Players = append(ch.Players, pc)
	}
	// 弃牌堆新增 = curr 相对 prev 新增的卡
	discAdd, _ := diffCards(prev.DiscardPile, curr.DiscardPile)
	ch.DiscardAdditions = discAdd
	// 飞行打击
	strikeAdd, strikeRem := diffStrikes(prev.FlyingStrikes, curr.FlyingStrikes)
	ch.FlyingStrikesAdded = strikeAdd
	ch.FlyingStrikesRemoved = strikeRem
	// 摧毁星辰
	ch.DestroyedStarsAdded = diffIntSlice(prev.DestroyedStars, curr.DestroyedStars)
	// 胜负
	if curr.Winner != nil && (prev.Winner == nil || *prev.Winner != *curr.Winner) {
		ch.Winner = *curr.Winner
	}
	return ch
}
