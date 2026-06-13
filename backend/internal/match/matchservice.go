package match

import (
	"context"
	cryptorand "crypto/rand"
	"encoding/json"
	"log/slog"
	"math/rand"
	"sync"
	"time"

	"github.com/darkforest/backend/internal/db"
	"github.com/darkforest/backend/internal/hub"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	MatchCheckInterval = 5 * time.Second
	MatchTimeout       = 30 * time.Second
)

type MatchService struct {
	queries     *db.Queries
	hub         *hub.Hub
	logger      *slog.Logger
	quit        chan struct{}
	running     bool
	mu          sync.Mutex
}

type MatchPlayerInfo struct {
	PlayerID     string `json:"playerId"`
	DisplayName  string `json:"displayName"`
	IsHost       bool   `json:"isHost"`
	PlayerNumber int32  `json:"playerNumber"`
	Position     int32  `json:"position"`
}

type MatchResult struct {
	Success bool              `json:"success"`
	Match   *MatchInfo        `json:"match,omitempty"`
	Error   string            `json:"error,omitempty"`
}

type MatchInfo struct {
	ID       string          `json:"id"`
	RoomCode string          `json:"roomCode"`
	HostID   string          `json:"hostId"`
	Players  []MatchPlayerInfo `json:"players"`
}

type QueueStatus struct {
	InQueue       bool `json:"inQueue"`
	Position      int  `json:"position,omitempty"`
	EstimatedTime int  `json:"estimatedTime,omitempty"`
}

func NewMatchService(queries *db.Queries, hub *hub.Hub, logger *slog.Logger) *MatchService {
	return &MatchService{
		queries: queries,
		hub:     hub,
		logger:  logger,
		quit:    make(chan struct{}),
	}
}

func (s *MatchService) Start() {
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return
	}
	s.running = true
	s.mu.Unlock()

	go s.matchmakingLoop()
	s.logger.Info("matchmaking service started")
}

func (s *MatchService) Stop() {
	s.mu.Lock()
	if !s.running {
		s.mu.Unlock()
		return
	}
	s.running = false
	s.mu.Unlock()

	close(s.quit)
	s.logger.Info("matchmaking service stopped")
}

func (s *MatchService) matchmakingLoop() {
	ticker := time.NewTicker(MatchCheckInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			s.tryMatch()
		case <-s.quit:
			return
		}
	}
}

func (s *MatchService) tryMatch() {
	ctx := context.Background()
	result, err := s.FindMatches(ctx)
	if err != nil {
		s.logger.Error("find matches failed", "error", err)
		return
	}

	if len(result.Matches) == 0 {
		return
	}

	s.logger.Info("matches found", "count", len(result.Matches))

	for _, playerIDs := range result.Matches {
		matchResult, err := s.CreateMatchRoom(ctx, playerIDs)
		if err != nil {
			s.logger.Error("create match room failed", "error", err)
			continue
		}

		if matchResult.Success && matchResult.Match != nil {
			s.notifyMatchFound(matchResult.Match)
			s.removeFromQueue(ctx, playerIDs)
		}
	}
}

func (s *MatchService) notifyMatchFound(match *MatchInfo) {
	payload, _ := json.Marshal(match)
	for _, player := range match.Players {
		client, ok := s.hub.GetClientByPlayerID(player.PlayerID)
		if ok {
			client.Send(hub.Message{
				Type:    string(hub.EvtSrvMatchFound),
				RoomID:  match.RoomCode,
				Payload: payload,
			})
		}
	}
}

func (s *MatchService) removeFromQueue(ctx context.Context, playerIDs []string) {
	for _, playerID := range playerIDs {
		uid, _ := parseUUID(playerID)
		s.queries.LeaveMatchmakingQueue(ctx, uid)
	}
}

func (s *MatchService) JoinQueue(ctx context.Context, player *hub.PlayerInfo, preferredCount int) error {
	uid, err := parseUUID(player.ID)
	if err != nil {
		return err
	}

	existing, err := s.queries.GetPlayerInQueue(ctx, uid)
	if err == nil && existing.PlayerID.Valid {
		return nil
	}

	queueID := uuid.New()
	pgQueueID := pgtype.UUID{Bytes: queueID, Valid: true}

	_, err = s.queries.JoinMatchmakingQueue(ctx, db.JoinMatchmakingQueueParams{
		ID:             pgQueueID,
		PlayerID:       uid,
		PreferredCount: int32(preferredCount),
		Timeout:        int32(MatchTimeout.Milliseconds()),
	})

	return err
}

func (s *MatchService) LeaveQueue(ctx context.Context, playerID string) error {
	uid, err := parseUUID(playerID)
	if err != nil {
		return err
	}

	return s.queries.LeaveMatchmakingQueue(ctx, uid)
}

func (s *MatchService) GetQueueStatus(ctx context.Context, playerID string) (*QueueStatus, error) {
	uid, err := parseUUID(playerID)
	if err != nil {
		return nil, err
	}

	queue, err := s.queries.GetPlayerInQueue(ctx, uid)
	if err != nil {
		return &QueueStatus{InQueue: false}, nil
	}

	if !queue.PlayerID.Valid {
		return &QueueStatus{InQueue: false}, nil
	}

	queues, err := s.queries.GetAllQueues(ctx)
	if err != nil {
		return nil, err
	}

	position := 0
	var joinedAt time.Time
	for _, q := range queues {
		if uuidString(q.PlayerID) == playerID {
			joinedAt = q.JoinedAt.Time
			break
		}
		position++
	}

	estimatedTime := max(0, 30-int(time.Since(joinedAt).Seconds()))

	return &QueueStatus{
		InQueue:       true,
		Position:      position,
		EstimatedTime: estimatedTime,
	}, nil
}

type FindMatchesResult struct {
	Matches [][]string
}

func (s *MatchService) FindMatches(ctx context.Context) (*FindMatchesResult, error) {
	queues, err := s.queries.GetAllQueues(ctx)
	if err != nil {
		return nil, err
	}

	if len(queues) < 2 {
		return &FindMatchesResult{Matches: [][]string{}}, nil
	}

	matches := [][]string{}
	usedPlayerIDs := make(map[string]bool)

	queuesByCount := make(map[int32][]db.MatchmakingQueue)
	for _, q := range queues {
		count := q.PreferredCount
		if _, ok := queuesByCount[count]; !ok {
			queuesByCount[count] = []db.MatchmakingQueue{}
		}
		queuesByCount[count] = append(queuesByCount[count], q)
	}

	for count, queueList := range queuesByCount {
		available := []db.MatchmakingQueue{}
		for _, q := range queueList {
			if !usedPlayerIDs[uuidString(q.PlayerID)] {
				available = append(available, q)
			}
		}

		if len(available) >= int(count) {
			matchPlayers := []string{}
			for i := 0; i < int(count); i++ {
				pID := uuidString(available[i].PlayerID)
				matchPlayers = append(matchPlayers, pID)
				usedPlayerIDs[pID] = true
			}
			matches = append(matches, matchPlayers)
		}
	}

	remaining := []db.MatchmakingQueue{}
	for _, q := range queues {
		if !usedPlayerIDs[uuidString(q.PlayerID)] {
			remaining = append(remaining, q)
		}
	}

	if len(remaining) >= 3 {
		targetCount := min(5, len(remaining))
		matchPlayers := []string{}
		for i := 0; i < targetCount; i++ {
			pID := uuidString(remaining[i].PlayerID)
			matchPlayers = append(matchPlayers, pID)
		}
		matches = append(matches, matchPlayers)
	}

	return &FindMatchesResult{Matches: matches}, nil
}

func (s *MatchService) CreateMatchRoom(ctx context.Context, playerIDs []string) (*MatchResult, error) {
	roomCode := generateRoomCode()
	hostID := playerIDs[0]

	positions := shuffleInts([]int{1, 2, 3, 4, 5, 6, 7, 8, 9})[:len(playerIDs)]

	hostUUID, err := parseUUID(hostID)
	if err != nil {
		return &MatchResult{Success: false, Error: "无效的主机ID"}, nil
	}

	matchID := uuid.New()
	pgMatchID := pgtype.UUID{Bytes: matchID, Valid: true}

	_, err = s.queries.CreateMatch(ctx, db.CreateMatchParams{
		ID:          pgMatchID,
		RoomCode:    roomCode,
		HostID:      hostUUID,
		Status:      "waiting",
		PlayerCount: int32(len(playerIDs)),
		AiCount:     0,
	})
	if err != nil {
		return &MatchResult{Success: false, Error: "创建对局失败"}, err
	}

	players := []MatchPlayerInfo{}

	for i, playerID := range playerIDs {
		pUUID, err := parseUUID(playerID)
		if err != nil {
			continue
		}

		player, err := s.queries.GetPlayerByID(ctx, pUUID)
		if err != nil {
			continue
		}

		mpID := uuid.New()
		pgMPID := pgtype.UUID{Bytes: mpID, Valid: true}

		_, err = s.queries.AddPlayerToMatch(ctx, db.AddPlayerToMatchParams{
			ID:           pgMPID,
			MatchID:      pgMatchID,
			PlayerID:     pUUID,
			PlayerNumber: int32(i),
			IsHost:       i == 0,
			Position:     int32(positions[i]),
		})
		if err != nil {
			continue
		}

		players = append(players, MatchPlayerInfo{
			PlayerID:     playerID,
			DisplayName:  player.DisplayName,
			IsHost:       i == 0,
			PlayerNumber: int32(i),
			Position:     int32(positions[i]),
		})
	}

	return &MatchResult{
		Success: true,
		Match: &MatchInfo{
			ID:       uuidString(pgMatchID),
			RoomCode: roomCode,
			HostID:   hostID,
			Players:  players,
		},
	}, nil
}

func (s *MatchService) GetMatchRoom(ctx context.Context, roomCode string) (*MatchInfo, error) {
	match, err := s.queries.GetMatchByRoomCode(ctx, roomCode)
	if err != nil {
		return nil, err
	}

	players, err := s.queries.ListPlayersByMatch(ctx, match.ID)
	if err != nil {
		return nil, err
	}

	matchPlayers := []MatchPlayerInfo{}
	for _, mp := range players {
		player, err := s.queries.GetPlayerByID(ctx, mp.PlayerID)
		if err != nil {
			continue
		}

		matchPlayers = append(matchPlayers, MatchPlayerInfo{
			PlayerID:     uuidString(mp.PlayerID),
			DisplayName:  player.DisplayName,
			IsHost:       mp.IsHost,
			PlayerNumber: mp.PlayerNumber,
			Position:     mp.Position,
		})
	}

	return &MatchInfo{
		ID:       uuidString(match.ID),
		RoomCode: match.RoomCode,
		HostID:   uuidString(match.HostID),
		Players:  matchPlayers,
	}, nil
}

func generateRoomCode() string {
	chars := "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	bytes := make([]byte, 6)
	cryptorand.Read(bytes)
	var code string
	for _, b := range bytes {
		code += string(chars[int(b)%len(chars)])
	}
	return code
}

func shuffleInts(arr []int) []int {
	a := make([]int, len(arr))
	copy(a, arr)
	for i := len(a) - 1; i > 0; i-- {
		j := rand.Intn(i + 1)
		a[i], a[j] = a[j], a[i]
	}
	return a
}

func uuidString(id pgtype.UUID) string {
	return uuid.UUID(id.Bytes).String()
}

func parseUUID(s string) (pgtype.UUID, error) {
	u, err := uuid.Parse(s)
	if err != nil {
		return pgtype.UUID{}, err
	}
	return pgtype.UUID{Bytes: u, Valid: true}, nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
