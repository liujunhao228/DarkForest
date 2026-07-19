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

type BroadcastPhase string

const (
	BroadcastPhaseWaiting BroadcastPhase = "waiting"
	BroadcastPhaseSelect  BroadcastPhase = "select"
	BroadcastPhaseReveal  BroadcastPhase = "reveal"
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

type GameMode string

const (
	GameModeClassic            GameMode = "classic"
	GameModeCivilizationRelics GameMode = "civilization_relics"
)

// IsCivilizationRelics reports whether the mode is "civilization_relics".
// A zero-value GameMode ("") is treated as classic and returns false.
func (m GameMode) IsCivilizationRelics() bool {
	return m == GameModeCivilizationRelics
}

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
	UID             string            `json:"uid"`
	DefID           string            `json:"defId"`
	Name            string            `json:"name"`
	Type            CardType          `json:"type"`
	Energy          int               `json:"energy"`
	Description     string            `json:"description"`
	Image           string            `json:"image"`
	Subtype         *BroadcastSubtype `json:"subtype,omitempty"`
	Range           *int              `json:"range,omitempty"`
	Level           *int              `json:"level,omitempty"`
	Speed           *int              `json:"speed,omitempty"`
	Effect          *string           `json:"effect,omitempty"`
	ProtectionLevel *int              `json:"protectionLevel,omitempty"`
	EnergyPerTurn   *int              `json:"energyPerTurn,omitempty"`
	Ability         *string           `json:"ability,omitempty"`
}

type Player struct {
	ID               string      `json:"id"`
	Name             string      `json:"name"`
	Color            PlayerColor `json:"color"`
	Position         int         `json:"position"`
	Energy           int         `json:"energy"`
	Hand             []Card      `json:"hand"`
	FaceUpCards      []Card      `json:"faceUpCards"`
	Eliminated       bool        `json:"eliminated"`
	BroadcastHistory []struct {
		SystemID int
		Turn     int
	} `json:"broadcastHistory"`
	BroadcastSuccessCount int `json:"broadcastSuccessCount"`
	StrikeCount           int `json:"strikeCount"`
}

type FlyingStrike struct {
	UID                string  `json:"uid"`
	DefID              string  `json:"defId"`
	OwnerID            string  `json:"ownerId"`
	Position           int     `json:"position"`
	TargetSystem       int     `json:"targetSystem"`
	TargetPlayerID     *string `json:"targetPlayerId,omitempty"`
	Level              int     `json:"level"`
	Speed              int     `json:"speed"`
	Energy             int     `json:"energy,omitempty"`
	RemainingMoves     int     `json:"remainingMoves"`
	Effect             *string `json:"effect,omitempty"`
	StrikeName         string  `json:"strikeName"`
	Arrived            bool    `json:"arrived"`
	Delayed            bool    `json:"delayed"`
	RetargetedThisTurn bool    `json:"retargetedThisTurn,omitempty"`
	Missed             bool    `json:"missed,omitempty"`
}

type BroadcastResponse struct {
	PlayerID     string `json:"playerId"`
	PlayerName   string `json:"playerName"`
	CanRespond   bool   `json:"canRespond"`
	MustRespond  bool   `json:"mustRespond"`
	Responded    bool   `json:"responded"`
	Agreed       bool   `json:"agreed"`
	ResponseCard *Card  `json:"responseCard,omitempty"`
}

type BroadcastState struct {
	BroadcasterID       string              `json:"broadcasterId"`
	CardUID             string              `json:"cardUid"`
	Card                Card                `json:"card"`
	TargetSystem        int                 `json:"targetSystem"`
	Range               int                 `json:"range"`
	Subtype             BroadcastSubtype    `json:"subtype"`
	Responses           []BroadcastResponse `json:"responses"`
	Phase               BroadcastPhase      `json:"phase"`
	SelectedResponderID *string             `json:"selectedResponderId,omitempty"`
	ResponseCard        *Card               `json:"responseCard,omitempty"`
}

type LogEntry struct {
	ID        string       `json:"id"`
	Turn      int          `json:"turn"`
	Phase     string       `json:"phase"`
	Message   string       `json:"message"`
	Type      LogEntryType `json:"type"`
	StrikeUID *string      `json:"strikeUid,omitempty"`
	// SystemID 涉及的星系 ID（打击目标/广播目标/跃迁目标等），不适用时为 nil
	SystemID *int `json:"systemId,omitempty"`
	// CardDefID 涉及的卡牌定义 ID（打击/出牌/广播卡牌），不适用时为 nil
	CardDefID *string `json:"cardDefId,omitempty"`
	// PlayerIDs 涉及的玩家 ID 列表（行动者+目标），不适用时为 nil
	PlayerIDs []string `json:"playerIds,omitempty"`
	// BroadcastID 关联的广播会话 ID（当前 BroadcastState 无独立 ID，预留字段，不适用时为 nil）
	BroadcastID *string `json:"broadcastId,omitempty"`
}

type PendingAction struct {
	Type            string          `json:"type"`
	StrikeUID       string          `json:"strikeUid,omitempty"`
	StrikeUIDs      []string        `json:"strikeUids,omitempty"`
	ValidMoves      []int           `json:"validMoves,omitempty"`
	BroadcastState  *BroadcastState `json:"broadcastState,omitempty"`
	Responders      []string        `json:"responders,omitempty"`
	TargetSystem    int             `json:"targetSystem,omitempty"`
	TargetPlayerIDs []string        `json:"targetPlayerIds,omitempty"`
	PlayerID        string          `json:"playerId,omitempty"`
	CardUID         string          `json:"cardUid,omitempty"`
	ValidTargets    []int           `json:"validTargets,omitempty"`
	RefundEnergy    int             `json:"refundEnergy,omitempty"`
	// BroadcastOnInherit 用于光速飞船遗留动作的客户端可选项；
	// nil 表示客户端未指定，按默认 true 处理（向后兼容经典模式公共继承日志）。
	BroadcastOnInherit *bool `json:"broadcastOnInherit,omitempty"`
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

type StarLeftover struct {
	SystemID           int    `json:"systemId"`
	Energy             int    `json:"energy"`
	Facilities         []Card `json:"facilities"`
	LeftByPlayerID     string `json:"leftByPlayerId,omitempty"`
	IsRelic            bool   `json:"isRelic,omitempty"`
	Name               string `json:"name,omitempty"`
	Lore               string `json:"lore,omitempty"`
	Message            string `json:"message,omitempty"`
	BroadcastOnInherit bool   `json:"broadcastOnInherit,omitempty"`
}

// RelicDiscovery 是继承遗迹/遗留物时发送给继承者的瞬时私有揭示。
// 由 view_state.go（Task 6）按观察者身份门控：仅本地/继承玩家可见。
// 非遗迹（光速飞船遗留）时 IsRelic=false 且 Name/Lore 为空，仅含 Energy + FacilityNames。
// PlayerID 为继承者玩家 ID，用于 view_state.go 按 viewerID == PlayerID 门控私有揭示。
type RelicDiscovery struct {
	PlayerID      string   `json:"playerId,omitempty"`
	SystemID      int      `json:"systemId"`
	IsRelic       bool     `json:"isRelic,omitempty"`
	Name          string   `json:"name,omitempty"`
	Lore          string   `json:"lore,omitempty"`
	Message       string   `json:"message,omitempty"`
	Energy        int      `json:"energy"`
	FacilityNames []string `json:"facilityNames,omitempty"`
}

// PlayerSeed carries the real player identity to inject into the game state.
type PlayerSeed struct {
	ID   string
	Name string
}

type InitConfig struct {
	PlayerCount int          `json:"playerCount"`
	PlayerSeeds []PlayerSeed `json:"playerSeeds"`
	GameMode    GameMode     `json:"gameMode,omitempty"`
	// CustomRules 覆盖 ModeRules。nil=用 GameMode 对应预设；非 nil=自定义房间由房主配置的全量规则。
	// 通过 NewGame 透传至 state.ModeRules。
	CustomRules *ModeRules `json:"customRules,omitempty"`
}

type GameState struct {
	Phase              GamePhase       `json:"phase"`
	TotalTurn          int             `json:"totalTurn"`
	PlayerCount        int             `json:"playerCount"`
	Players            []Player        `json:"players"`
	CurrentPlayerIndex int             `json:"currentPlayerIndex"`
	CurrentPlayerID    string          `json:"currentPlayerId"`
	LocalPlayerID      string          `json:"localPlayerId"`
	DrawPile           []Card          `json:"drawPile"`
	DiscardPile        []Card          `json:"discardPile"`
	FlyingStrikes      []FlyingStrike  `json:"flyingStrikes"`
	Broadcast          *BroadcastState `json:"broadcast,omitempty"`
	TurnPhase          TurnPhase       `json:"turnPhase"`
	// PrevTurnPhase 用于 InterruptTurn/ResumeTurn 保存与还原中断前的回合阶段，
	// 不序列化（仅运行时状态）
	PrevTurnPhase   TurnPhase      `json:"-"`
	PendingAction   *PendingAction `json:"pendingAction,omitempty"`
	Logs            []LogEntry     `json:"logs"`
	DestroyedStars  []int          `json:"destroyedStars"`
	Leftovers       []StarLeftover `json:"leftovers"`
	Winner          *string        `json:"winner,omitempty"`
	IsProcessing    bool           `json:"isProcessing"`
	Version         *int           `json:"version,omitempty"`
	ReplayTimestamp *int64         `json:"replayTimestamp,omitempty"`
	ReplayEventID   *string        `json:"replayEventId,omitempty"`
	GameMode        GameMode       `json:"gameMode,omitempty"`
	// ModeRules 自定义房间覆盖：nil=回退 GetModeRules(GameMode) 预设；非 nil=房主配置的全量规则。
	// 旧回放未序列化此字段，自动回退到预设规则。
	ModeRules       *ModeRules     `json:"modeRules,omitempty"`
	// LastRelicDiscovery 是继承遗留物时设置的瞬时私有揭示；
	// view_state.go（Task 6）按观察者身份门控，仅本地/继承玩家可见。
	LastRelicDiscovery *RelicDiscovery `json:"lastRelicDiscovery,omitempty"`
}

func GenerateID() string {
	return uuid.New().String()[:12]
}

func NowTimestamp() int64 {
	return time.Now().Unix()
}
