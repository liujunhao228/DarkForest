package game

import (
	"time"

	"github.com/google/uuid"
)

type CardType string

const (
	CardTypeBroadcast CardType = "broadcast"
	CardTypeStrike    CardType = "strike"
	CardTypeDefense   CardType = "defense"
	CardTypeFacility  CardType = "facility"
)

type BroadcastSubtype string

const (
	BroadcastSubtypeCooperation BroadcastSubtype = "cooperation"
	BroadcastSubtypeDisguise    BroadcastSubtype = "disguise"
)

type GamePhase string

const (
	GamePhaseSetup    GamePhase = "setup"
	GamePhasePlaying  GamePhase = "playing"
	GamePhaseGameOver GamePhase = "gameOver"
)

type TurnPhase string

const (
	TurnPhaseTurnBegin      TurnPhase = "turnBegin"
	TurnPhaseStrikeMovement TurnPhase = "strikeMovement"
	TurnPhaseDrawPhase      TurnPhase = "drawPhase"
	TurnPhaseActionPhase    TurnPhase = "actionPhase"
	TurnPhaseTurnEnd        TurnPhase = "turnEnd"
	TurnPhaseInterrupted    TurnPhase = "interrupted"
)

type PlayerColor string

const (
	PlayerColorRed    PlayerColor = "red"
	PlayerColorBlue   PlayerColor = "blue"
	PlayerColorGreen  PlayerColor = "green"
	PlayerColorAmber  PlayerColor = "amber"
	PlayerColorPurple PlayerColor = "purple"
)

type LogEntryType string

const (
	LogEntryTypeInfo      LogEntryType = "info"
	LogEntryTypeAction    LogEntryType = "action"
	LogEntryTypeCombat    LogEntryType = "combat"
	LogEntryTypeSystem    LogEntryType = "system"
	LogEntryTypeBroadcast LogEntryType = "broadcast"
)

type CardDef struct {
	ID          string                 `json:"id"`
	Name        string                 `json:"name"`
	Type        CardType               `json:"type"`
	Energy      int                    `json:"energy"`
	Quantity    int                    `json:"quantity"`
	Description string                 `json:"description"`
	Image       string                 `json:"image"`
	Extended    map[string]interface{} `json:"extended"`
}

type Card struct {
	UID             string              `json:"uid"`
	DefID           string              `json:"defId"`
	Name            string              `json:"name"`
	Type            CardType            `json:"type"`
	Energy          int                 `json:"energy"`
	Description     string              `json:"description"`
	Image           string              `json:"image"`
	Subtype         *BroadcastSubtype   `json:"subtype,omitempty"`
	Range           *int                `json:"range,omitempty"`
	Level           *int                `json:"level,omitempty"`
	Speed           *int                `json:"speed,omitempty"`
	Effect          *string             `json:"effect,omitempty"`
	ProtectionLevel *int                `json:"protectionLevel,omitempty"`
	EnergyPerTurn   *int                `json:"energyPerTurn,omitempty"`
	Ability         *string             `json:"ability,omitempty"`
}

type Player struct {
	ID               string                                  `json:"id"`
	Name             string                                  `json:"name"`
	Color            PlayerColor                             `json:"color"`
	Position         int                                     `json:"position"`
	Energy           int                                     `json:"energy"`
	Hand             []Card                                  `json:"hand"`
	FaceUpCards      []Card                                  `json:"faceUpCards"`
	Eliminated       bool                                    `json:"eliminated"`
	BroadcastHistory []struct{ SystemID int; Turn int }       `json:"broadcastHistory"`
}

type FlyingStrike struct {
	UID            string `json:"uid"`
	DefID          string `json:"defId"`
	OwnerID        string `json:"ownerId"`
	Position       int    `json:"position"`
	TargetSystem   int    `json:"targetSystem"`
	TargetPlayerID *string `json:"targetPlayerId,omitempty"`
	Level          int    `json:"level"`
	Speed          int    `json:"speed"`
	RemainingMoves int    `json:"remainingMoves"`
	Effect         *string `json:"effect,omitempty"`
	StrikeName     string `json:"strikeName"`
	Arrived        bool   `json:"arrived"`
}

type BroadcastResponse struct {
	PlayerID   string  `json:"playerId"`
	PlayerName string  `json:"playerName"`
	CanRespond bool    `json:"canRespond"`
	MustRespond bool   `json:"mustRespond"`
	Responded  bool    `json:"responded"`
	Agreed     bool    `json:"agreed"`
	ResponseCard *Card `json:"responseCard,omitempty"`
}

type BroadcastState struct {
	Active            bool                `json:"active"`
	BroadcasterID     string              `json:"broadcasterId"`
	CardUID           string              `json:"cardUid"`
	Card              Card                `json:"card"`
	TargetSystem      int                 `json:"targetSystem"`
	Range             int                 `json:"range"`
	Subtype           BroadcastSubtype    `json:"subtype"`
	Responses         []BroadcastResponse `json:"responses"`
	Phase             string              `json:"phase"`
	SelectedResponderID *string           `json:"selectedResponderId,omitempty"`
	ResponseCard      *Card               `json:"responseCard,omitempty"`
}

type LogEntry struct {
	ID      string        `json:"id"`
	Turn    int           `json:"turn"`
	Phase   string        `json:"phase"`
	Message string        `json:"message"`
	Type    LogEntryType  `json:"type"`
}

type PendingAction struct {
	Type               string   `json:"type"`
	StrikeUID          string   `json:"strikeUid,omitempty"`
	ValidMoves         []int    `json:"validMoves,omitempty"`
	BroadcastState     *BroadcastState `json:"broadcastState,omitempty"`
	Responders         []string `json:"responders,omitempty"`
	TargetSystem       int      `json:"targetSystem,omitempty"`
	TargetPlayerIDs    []string `json:"targetPlayerIds,omitempty"`
	PlayerID           string   `json:"playerId,omitempty"`
	CardUID            string   `json:"cardUid,omitempty"`
	ValidTargets       []int    `json:"validTargets,omitempty"`
	RefundEnergy       int      `json:"refundEnergy,omitempty"`
}

type StarNode struct {
	ID   int     `json:"id"`
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
	Name string  `json:"name"`
}

type StarEdge struct {
	From int `json:"from"`
	To   int `json:"to"`
}

type InitConfig struct {
	PlayerCount int    `json:"playerCount"`
	HumanName   string `json:"humanName"`
}

type GameState struct {
	Phase             GamePhase        `json:"phase"`
	TotalTurn         int              `json:"totalTurn"`
	PlayerCount       int              `json:"playerCount"`
	Players           []Player         `json:"players"`
	CurrentPlayerIndex int             `json:"currentPlayerIndex"`
	CurrentPlayerID   string           `json:"currentPlayerId"`
	LocalPlayerID     string           `json:"localPlayerId"`
	DrawPile          []Card          `json:"drawPile"`
	DiscardPile       []Card          `json:"discardPile"`
	FlyingStrikes     []FlyingStrike  `json:"flyingStrikes"`
	Broadcast         *BroadcastState `json:"broadcast,omitempty"`
	TurnPhase         TurnPhase       `json:"turnPhase"`
	PendingAction     *PendingAction  `json:"pendingAction,omitempty"`
	Logs              []LogEntry      `json:"logs"`
	DestroyedStars    []int           `json:"destroyedStars"`
	Winner            *string         `json:"winner,omitempty"`
	IsProcessing      bool            `json:"isProcessing"`
	Version           *int            `json:"version,omitempty"`
	ReplayTimestamp   *int64          `json:"replayTimestamp,omitempty"`
	ReplayEventID     *string         `json:"replayEventId,omitempty"`
}

func GenerateID() string {
	return uuid.New().String()[:12]
}

func NowTimestamp() int64 {
	return time.Now().Unix()
}