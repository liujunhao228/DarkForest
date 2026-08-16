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
	ID                string       `json:"id"`
	Name              string       `json:"name"`
	Energy            int          `json:"energy"`
	Hand              []replayCard `json:"hand"`
	FaceUpCards       []replayCard `json:"faceUpCards"`
	Eliminated        bool         `json:"eliminated"`
	EliminationReason string       `json:"eliminationReason,omitempty"` // 对齐 backend Player 同名字段（strike/forfeit/timeout/fallback）
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

// DeltaAction 是回合动作的精简表示（不含大 Data 字段，除非 verbose=true）。
type DeltaAction struct {
	Action    string          `json:"action"`
	PlayerID  string          `json:"playerId"`
	Turn      int             `json:"turn"`
	CardName  string          `json:"cardName,omitempty"`
	CardDefID string          `json:"cardDefId,omitempty"`
	Data      json.RawMessage `json:"data,omitempty"` // 仅 verbose=true 时填充
}

// TurnDelta 是单个回合的 delta。
type TurnDelta struct {
	Turn       int           `json:"turn"`
	PlayerID   string        `json:"playerId"`
	PlayerName string        `json:"playerName"`
	Actions    []DeltaAction `json:"actions"`
	Changes    TurnChanges   `json:"changes"`
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
	PlayerID          string   `json:"playerId"`
	PlayerName        string   `json:"playerName"`
	HandAdded         []string `json:"handAdded"`     // 抽到的卡牌名
	HandRemoved       []string `json:"handRemoved"`   // 打出/弃掉的卡牌名
	FaceUpAdded       []string `json:"faceUpAdded"`   // 部署的卡牌名
	FaceUpRemoved     []string `json:"faceUpRemoved"` // 被摧毁/移除的场上卡牌名
	EnergyDelta       int      `json:"energyDelta"`
	Eliminated        bool     `json:"eliminated,omitempty"`        // 本回合被淘汰时为 true
	EliminationReason string   `json:"eliminationReason,omitempty"` // 本回合被淘汰时的原因（strike/forfeit/timeout/fallback）
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

// --- 轻量帧（AnalysisFrame 投影）解析：供新记录（仅两帧）的 delta 使用 ---

// lightFrame 是后端 AnalysisFrame 的本地解析子集（对齐 backend/replay/analysis_frame.go）。
// 轻量帧缺具体卡名（只有 handCount/faceUpNames），用于从帧端点拉取后计算回合变化。
type lightFrame struct {
	Turn            int           `json:"turn"`
	Phase           string        `json:"phase"`
	Players         []lightPlayer `json:"players"`
	DrawPileCount   int           `json:"drawPileCount"`
	DiscardPile     []string      `json:"discardPile"`
	FlyingStrikes   []lightStrike `json:"flyingStrikes"`
	DestroyedStars  []int         `json:"destroyedStars"`
	CurrentPlayerID string        `json:"currentPlayerId"`
	Winner          string        `json:"winner,omitempty"`
	InvalidActions  int           `json:"invalidActions,omitempty"`
}

type lightPlayer struct {
	ID                string   `json:"id"`
	Name              string   `json:"name"`
	Energy            int      `json:"energy"`
	HandCount         int      `json:"handCount"`
	FaceUpNames       []string `json:"faceUpNames"`
	Eliminated        bool     `json:"eliminated"`
	EliminationReason string   `json:"eliminationReason,omitempty"`
}

type lightStrike struct {
	UID        string `json:"uid"`
	StrikeName string `json:"strikeName"`
	Arrived    bool   `json:"arrived"`
}

// computeLightChanges 从两个轻量帧计算回合变化。
// 轻量帧缺具体卡名，手牌变化用数量占位（如 "+1张"/"-1张"）。
func computeLightChanges(prev, curr lightFrame) TurnChanges {
	ch := TurnChanges{DrawPileCountDelta: curr.DrawPileCount - prev.DrawPileCount}
	prevPlayers := make(map[string]lightPlayer, len(prev.Players))
	for _, p := range prev.Players {
		prevPlayers[p.ID] = p
	}
	for _, p := range curr.Players {
		pp, existed := prevPlayers[p.ID]
		if !existed {
			continue
		}
		faceAdd, faceRem := diffNameSlice(pp.FaceUpNames, p.FaceUpNames)
		pc := PlayerChange{
			PlayerID:          p.ID,
			PlayerName:        p.Name,
			FaceUpAdded:       faceAdd,
			FaceUpRemoved:     faceRem,
			EnergyDelta:       p.Energy - pp.Energy,
			Eliminated:        !pp.Eliminated && p.Eliminated,
			EliminationReason: lightEliminationReasonIfNewlyEliminated(pp, p),
		}
		if d := p.HandCount - pp.HandCount; d > 0 {
			pc.HandAdded = []string{fmt.Sprintf("+%d张", d)}
		} else if d < 0 {
			pc.HandRemoved = []string{fmt.Sprintf("-%d张", -d)}
		}
		ch.Players = append(ch.Players, pc)
	}
	ch.DiscardAdditions = diffOnlyAdded(prev.DiscardPile, curr.DiscardPile)
	ch.FlyingStrikesAdded, ch.FlyingStrikesRemoved = diffLightStrikes(prev.FlyingStrikes, curr.FlyingStrikes)
	ch.DestroyedStarsAdded = diffIntSlice(prev.DestroyedStars, curr.DestroyedStars)
	if curr.Winner != "" && curr.Winner != prev.Winner {
		ch.Winner = curr.Winner
	}
	return ch
}

// lightEliminationReasonIfNewlyEliminated 返回玩家在本回合新被淘汰时的淘汰原因。
func lightEliminationReasonIfNewlyEliminated(prev, curr lightPlayer) string {
	if !prev.Eliminated && curr.Eliminated {
		return curr.EliminationReason
	}
	return ""
}

// diffNameSlice 按名称比较两个字符串切片，返回 (added, removed)。
func diffNameSlice(prev, curr []string) (added, removed []string) {
	currSet := make(map[string]bool, len(curr))
	for _, n := range curr {
		currSet[n] = true
	}
	prevSet := make(map[string]bool, len(prev))
	for _, n := range prev {
		prevSet[n] = true
	}
	for n := range currSet {
		if !prevSet[n] {
			added = append(added, n)
		}
	}
	for n := range prevSet {
		if !currSet[n] {
			removed = append(removed, n)
		}
	}
	return
}

// diffOnlyAdded 返回 curr 相对 prev 新增的名称。
func diffOnlyAdded(prev, curr []string) []string {
	added, _ := diffNameSlice(prev, curr)
	return added
}

// diffLightStrikes 按 UID 比较两个轻量打击切片，返回 (added, removed) 打击名。
func diffLightStrikes(prev, curr []lightStrike) (added, removed []string) {
	prevSet := make(map[string]lightStrike, len(prev))
	for _, s := range prev {
		prevSet[s.UID] = s
	}
	currSet := make(map[string]lightStrike, len(curr))
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

// toDeltaActions 将完整 ActionRecord 转为精简 DeltaAction。
// verbose=false 时不填充 Data（减小体积）；verbose=true 时原样保留 Data。
// CardName/CardDefID 从 Data 提取（非 verbose 也保留，供分析标识卡牌）。
func toDeltaActions(actions []gamesdk.ActionRecord, verbose bool) []DeltaAction {
	out := make([]DeltaAction, 0, len(actions))
	for _, a := range actions {
		da := DeltaAction{
			Action:   a.Action,
			PlayerID: a.PlayerID,
			Turn:     a.Turn,
		}
		if a.Data != nil {
			if cn, ok := a.Data["cardName"].(string); ok && cn != "" {
				da.CardName = cn
			}
			if cd, ok := a.Data["cardDefId"].(string); ok && cd != "" {
				da.CardDefID = cd
			}
			if verbose {
				raw, _ := json.Marshal(a.Data)
				da.Data = raw
			}
		}
		out = append(out, da)
	}
	return out
}

// --- computeDeltas 主逻辑 ---

// computeDeltas 从本地 ReplayRow 计算 [fromTurn, toTurn] 范围内的逐回合 delta。
// states 索引对齐：states[0] = 初始状态；states[k] = 应用 actions[k-1] 之后的状态。
// 对回合 T：prevState = states[该回合首个动作下标]（首个动作应用前），
// currState = states[该回合末个动作下标+1]（末个动作应用后）。
// verbose=false 时回合动作精简输出（不含 Data），减小分析体积。
// 注意：仅适用于老记录（states 全量多帧）；新记录（仅两帧）请用 computeLightDeltas。
func computeDeltas(row *persistence.ReplayRow, fromTurn, toTurn int, verbose bool) ([]TurnDelta, error) {
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
			Actions:    toDeltaActions(turnActions, verbose),
			Changes:    computeTurnChanges(prev, curr),
		}
		deltas = append(deltas, delta)
	}
	return deltas, nil
}

// eliminationReasonIfNewlyEliminated 返回玩家在本回合新被淘汰时的淘汰原因，
// 否则返回空串（配合 omitempty 不在非淘汰回合输出）。
func eliminationReasonIfNewlyEliminated(prev, curr replayPlayer) string {
	if !prev.Eliminated && curr.Eliminated {
		return curr.EliminationReason
	}
	return ""
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
			PlayerID:          p.ID,
			PlayerName:        p.Name,
			HandAdded:         handAdd,
			HandRemoved:       handRem,
			FaceUpAdded:       faceAdd,
			FaceUpRemoved:     faceRem,
			EnergyDelta:       p.Energy - pp.Energy,
			Eliminated:        !pp.Eliminated && p.Eliminated,
			EliminationReason: eliminationReasonIfNewlyEliminated(pp, p),
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

// parsePlayerIDNameMap 从 ReplayRow 的 playerIds/playerNames 构建 id→name 映射。
func parsePlayerIDNameMap(row *persistence.ReplayRow) map[string]string {
	var playerNames []string
	_ = json.Unmarshal([]byte(row.PlayerNames), &playerNames)
	var playerIDs []string
	_ = json.Unmarshal([]byte(row.PlayerIDs), &playerIDs)
	nameByID := make(map[string]string, len(playerIDs))
	for i, id := range playerIDs {
		if i < len(playerNames) {
			nameByID[id] = playerNames[i]
		}
	}
	return nameByID
}

// computeLightDeltas 从轻量记录（仅存 actions + 首/终帧）计算逐回合 delta。
// 轻量帧缺具体卡名/手牌明细，无法本地重放，需经后端帧端点（view=light）逐回合拉取轻量帧。
// 对回合 T：prev = 回合 T-1 末帧（首回合为初始帧），curr = 回合 T 末帧。
//
// stateless：httpc 为全局共享 HTTP client，token 为占位身份（X-Trust-User）。
// 帧端点以 UUID 为 capability token，不校验参与者，无需借真实对战账户。
func computeLightDeltas(httpc *gamesdk.HTTPClient, token string, row *persistence.ReplayRow, fromTurn, toTurn int) ([]TurnDelta, error) {
	var actions []gamesdk.ActionRecord
	if err := json.Unmarshal([]byte(row.ActionsJSON), &actions); err != nil {
		return nil, fmt.Errorf("解析 actions 失败: %w", err)
	}
	nameByID := parsePlayerIDNameMap(row)

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

	// 初始帧（turn 0）作为首个回合的 prev
	prevRaw, err := fetchTurnFrame(httpc, token, row.ID, 0, "light")
	if err != nil {
		return nil, fmt.Errorf("拉取初始帧失败: %w", err)
	}
	var prev lightFrame
	if err := json.Unmarshal(prevRaw, &prev); err != nil {
		return nil, fmt.Errorf("解析初始帧失败: %w", err)
	}

	var deltas []TurnDelta
	for _, t := range turnOrder {
		if t < fromTurn || t > toTurn {
			continue
		}
		currRaw, err := fetchTurnFrame(httpc, token, row.ID, t, "light")
		if err != nil {
			return nil, fmt.Errorf("拉取回合 %d 帧失败: %w", t, err)
		}
		var curr lightFrame
		if err := json.Unmarshal(currRaw, &curr); err != nil {
			return nil, fmt.Errorf("解析回合 %d 帧失败: %w", t, err)
		}

		firstIdx := turnFirstIdx[t]
		lastIdx := turnLastIdx[t]
		playerID := curr.CurrentPlayerID
		if playerID == "" {
			playerID = prev.CurrentPlayerID
		}
		deltas = append(deltas, TurnDelta{
			Turn:       t,
			PlayerID:   playerID,
			PlayerName: nameByID[playerID],
			Actions:    toDeltaActions(actions[firstIdx:lastIdx+1], false),
			Changes:    computeLightChanges(prev, curr),
		})
		prev = curr
	}
	return deltas, nil
}
