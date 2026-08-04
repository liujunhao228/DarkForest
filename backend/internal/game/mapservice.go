package game

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/darkforest/backend/internal/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// OfficialDefaultMapSlug 是官方默认地图的固定 slug。
const OfficialDefaultMapSlug = "classic-9"

// MapService 负责地图数据的 DB 加载、seed 与查询。
// P2 阶段：启动时 SeedIfAbsent + LoadDefaultMap 覆盖 DefaultMapState。
type MapService struct {
	queries *db.Queries
	logger  *slog.Logger
}

// NewMapService 创建 MapService。
func NewMapService(queries *db.Queries, logger *slog.Logger) *MapService {
	return &MapService{
		queries: queries,
		logger:  logger,
	}
}

// SeedIfAbsent 幂等写入官方默认地图（slug=classic-9）。
// 若 slug 已存在则跳过；否则从硬编码 StarNodes/StarEdges 构建 layout_json 并 INSERT。
func (s *MapService) SeedIfAbsent(ctx context.Context) error {
	slug := OfficialDefaultMapSlug

	// 检查是否已存在
	_, err := s.queries.GetMapBySlug(ctx, &slug)
	if err == nil {
		// 已存在，跳过
		return nil
	}
	// err != nil 可能是 not found（预期）或 DB 错误
	// pgx 的 ErrNoRows 在 sqlc 生成代码中表现为 pgx.ErrNoRows

	// 构建官方默认地图的 layout_json
	snapshot := &MapLayoutSnapshot{
		Nodes: StarNodes,
		Edges: StarEdges,
	}
	layoutJSON, err := json.Marshal(snapshot)
	if err != nil {
		return fmt.Errorf("序列化官方地图 layout_json 失败: %w", err)
	}

	// 校验布局合法性
	if err := ValidateMap(StarNodes, StarEdges); err != nil {
		return fmt.Errorf("官方默认地图校验失败: %w", err)
	}

	mapUUID := uuid.New()
	name := "经典 9 星图"
	description := "官方默认地图（9 节点 14 边）"

	_, err = s.queries.CreateMap(ctx, db.CreateMapParams{
		ID:          pgtype.UUID{Bytes: mapUUID, Valid: true},
		Slug:        &slug,
		Name:        name,
		Description: &description,
		IsOfficial:  true,
		CreatedBy:   pgtype.UUID{}, // 官方地图无创建者
		Version:     1,
		LayoutJson:  layoutJSON,
	})
	if err != nil {
		// 并发情况下可能 slug UNIQUE 冲突，视为已存在
		s.logger.Warn("seed official map failed (may already exist)", "slug", slug, "error", err)
		return nil
	}

	s.logger.Info("official map seeded", "slug", slug, "id", mapUUID.String())
	return nil
}

// LoadDefaultMap 从 DB 加载官方默认地图（slug=classic-9）并覆盖包级 DefaultMapState。
// 若 DB 不可用或未找到，返回 error（调用方决定是否回落到硬编码）。
func (s *MapService) LoadDefaultMap(ctx context.Context) error {
	slug := OfficialDefaultMapSlug

	dbMap, err := s.queries.GetMapBySlug(ctx, &slug)
	if err != nil {
		return fmt.Errorf("加载官方默认地图失败 (slug=%s): %w", slug, err)
	}

	snapshot, err := parseLayoutJSON(dbMap.LayoutJson)
	if err != nil {
		return fmt.Errorf("解析官方地图 layout_json 失败: %w", err)
	}

	// 覆盖包级 DefaultMapState
	DefaultMapState = NewMapState(snapshot.Nodes, snapshot.Edges)
	// 同步旧 Adjacency 别名
	Adjacency = DefaultMapState.Adjacency

	s.logger.Info("default map loaded from db", "slug", slug, "nodes", len(snapshot.Nodes), "edges", len(snapshot.Edges))
	return nil
}

// LoadMapBySlug 按 slug 加载地图，返回 MapLayoutSnapshot。
func (s *MapService) LoadMapBySlug(ctx context.Context, slug string) (*MapLayoutSnapshot, error) {
	dbMap, err := s.queries.GetMapBySlug(ctx, &slug)
	if err != nil {
		return nil, err
	}
	return parseLayoutJSON(dbMap.LayoutJson)
}

// LoadMapByID 按 ID 加载地图，返回 MapLayoutSnapshot。
func (s *MapService) LoadMapByID(ctx context.Context, id pgtype.UUID) (*MapLayoutSnapshot, error) {
	dbMap, err := s.queries.GetMapByID(ctx, id)
	if err != nil {
		return nil, err
	}
	return parseLayoutJSON(dbMap.LayoutJson)
}

// parseLayoutJSON 将 DB 的 layout_json []byte 反序列化为 MapLayoutSnapshot。
func parseLayoutJSON(data []byte) (*MapLayoutSnapshot, error) {
	var snapshot MapLayoutSnapshot
	if err := json.Unmarshal(data, &snapshot); err != nil {
		return nil, fmt.Errorf("反序列化 layout_json 失败: %w", err)
	}
	if len(snapshot.Nodes) == 0 {
		return nil, fmt.Errorf("layout_json 节点为空")
	}
	return &snapshot, nil
}
