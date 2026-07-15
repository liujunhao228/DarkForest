package game

import "math/rand"

// 「文明遗迹」模式初始化分布概率（可调常量，须满足和为 1.0）。
//
// 累计阈值：
//
//	r < 0.50                       → 空
//	r < 0.50 + 0.30 = 0.80         → 弱
//	r < 0.50 + 0.30 + 0.15 = 0.95  → 中
//	else (>= 0.95)                 → 强
const (
	relicProbEmpty  = 0.50
	relicProbWeak   = 0.30
	relicProbMedium = 0.15
	relicProbStrong = 0.05

	// relicBroadcastProb 为预设遗迹被分配时 BroadcastOnInherit 取 true 的概率。
	relicBroadcastProb = 0.50
)

var playerColors = []PlayerColor{PlayerColorRed, PlayerColorBlue, PlayerColorGreen, PlayerColorAmber, PlayerColorPurple}

func NewGame(config InitConfig) *GameState {
	drawPile := CreateDrawPile()
	players := make([]Player, 0, config.PlayerCount)

	positions := Shuffle([]int{1, 2, 3, 4, 5, 6, 7, 8, 9})[:config.PlayerCount]

	for i := 0; i < config.PlayerCount; i++ {
		players = append(players, Player{
			ID:               config.PlayerSeeds[i].ID,
			Name:             config.PlayerSeeds[i].Name,
			Color:            playerColors[i],
			Position:         positions[i],
			Energy:           3,
			Hand:             []Card{},
			FaceUpCards:      []Card{},
			Eliminated:       false,
			BroadcastHistory: []struct{ SystemID int; Turn int }{},
		})
	}

	for i := range players {
		for j := 0; j < 4; j++ {
			if len(drawPile) > 0 {
				card := drawPile[len(drawPile)-1]
				drawPile = drawPile[:len(drawPile)-1]
				players[i].Hand = append(players[i].Hand, card)
			}
		}
	}

	state := &GameState{
		Phase:              GamePhasePlaying,
		TotalTurn:          1,
		PlayerCount:        config.PlayerCount,
		Players:            players,
		CurrentPlayerIndex: 0,
		CurrentPlayerID:    players[0].ID,
		LocalPlayerID:      players[0].ID,
		DrawPile:           drawPile,
		DiscardPile:        []Card{},
		FlyingStrikes:      []FlyingStrike{},
		Broadcast:          nil,
		TurnPhase:          TurnPhaseTurnBegin,
		PendingAction:      nil,
		Logs: []LogEntry{
			{
				ID:      GenerateID(),
				Turn:    0,
				Phase:   "system",
				Message: "游戏开始！隐藏自己，做好清理。",
				Type:    LogEntryTypeSystem,
			},
		},
		Winner:         nil,
		IsProcessing:   false,
		DestroyedStars: []int{},
		Leftovers:      []StarLeftover{},
		GameMode:       config.GameMode,
	}

	if config.GameMode.IsCivilizationRelics() {
		distributeRelics(state, positions)
	}

	return state
}

// distributeRelics 在「文明遗迹」模式下，对非起始星系按强度档概率分布预设遗迹。
// startingPositions 为玩家起始星系 ID 列表，这些星系不会生成遗迹。
// 调用前 state.Leftovers 必须为非 nil 切片。
func distributeRelics(state *GameState, startingPositions []int) {
	startingSet := make(map[int]struct{}, len(startingPositions))
	for _, p := range startingPositions {
		startingSet[p] = struct{}{}
	}

	for sys := 1; sys <= 9; sys++ {
		if _, isStart := startingSet[sys]; isStart {
			continue
		}

		strength := rollRelicStrength()
		if strength == RelicStrengthEmpty {
			continue
		}

		combo := PickComboByStrength(strength)
		if combo.ID == "" {
			continue
		}

		broadcast := rand.Float64() < relicBroadcastProb
		state.Leftovers = append(state.Leftovers, StarLeftover{
			SystemID:           sys,
			Energy:             combo.Energy,
			Facilities:         combo.Facilities,
			IsRelic:            true,
			Name:               combo.Name,
			Lore:               combo.Lore,
			BroadcastOnInherit: broadcast,
		})
	}
}

// rollRelicStrength 按累计概率返回遗迹强度档位：
//
//	r < 0.50                       → 空 (RelicStrengthEmpty)
//	r < 0.80                       → 弱 (RelicStrengthWeak)
//	r < 0.95                       → 中 (RelicStrengthMedium)
//	else                           → 强 (RelicStrengthStrong)
func rollRelicStrength() int {
	r := rand.Float64()
	switch {
	case r < relicProbEmpty:
		return RelicStrengthEmpty
	case r < relicProbEmpty+relicProbWeak:
		return RelicStrengthWeak
	case r < relicProbEmpty+relicProbWeak+relicProbMedium:
		return RelicStrengthMedium
	default:
		return RelicStrengthStrong
	}
}
