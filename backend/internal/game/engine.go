package game

import "fmt"

var aiNames = []string{"三体文明", "歌者文明", "归零者", "魔戒文明"}
var playerColors = []PlayerColor{PlayerColorRed, PlayerColorBlue, PlayerColorGreen, PlayerColorAmber, PlayerColorPurple}

func NewGame(config InitConfig) *GameState {
	drawPile := CreateDrawPile()
	players := make([]Player, 0, config.PlayerCount)

	positions := Shuffle([]int{1, 2, 3, 4, 5, 6, 7, 8, 9})[:config.PlayerCount]

	for i := 0; i < config.PlayerCount; i++ {
		name := config.HumanName
		if i > 0 {
			name = aiNames[i-1]
		}
		players = append(players, Player{
			ID:               fmt.Sprintf("player_%d", i),
			Name:             name,
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

	return &GameState{
		Phase:             GamePhasePlaying,
		TotalTurn:         1,
		PlayerCount:       config.PlayerCount,
		Players:           players,
		CurrentPlayerIndex: 0,
		CurrentPlayerID:   players[0].ID,
		LocalPlayerID:     "player_0",
		DrawPile:          drawPile,
		DiscardPile:       []Card{},
		FlyingStrikes:     []FlyingStrike{},
		Broadcast:         nil,
		TurnPhase:         TurnPhaseTurnBegin,
		PendingAction:     nil,
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
	}
}