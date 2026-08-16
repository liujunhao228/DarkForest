-- SQLite DDL Migration: Initial Schema (consolidated from Postgres 000001-000007)
-- Version: 000001
-- Date: 2026-08-16
--
-- Translation rules (see design doc appendix A migration-point list):
--   * CREATE EXTENSION uuid-ossp -> removed, UUID PK/FK -> TEXT (app generates id via google/uuid)
--   * TIMESTAMP WITH TIME ZONE -> TEXT (SQLite native CURRENT_TIMESTAMP format, UTC)
--   * JSONB (custom_rules / layout_json) -> TEXT (JSON string)
--   * plpgsql triggers (update_updated_at_column x5) -> removed, updated_at set explicitly in app UPDATEs
--   * COMMENT ON -> removed (SQLite unsupported)
--   * one_admin_only partial unique index -> SQLite native partial index kept

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    password TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'player',
    password TEXT,
    avatar INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    draws INTEGER NOT NULL DEFAULT 0,
    total_matches INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_players_user_id ON players(user_id);
CREATE INDEX IF NOT EXISTS idx_players_display_name ON players(display_name);
CREATE INDEX IF NOT EXISTS idx_players_role ON players(role);

-- maps 在 custom_match_queues 之前创建（map_id 外键引用）
CREATE TABLE IF NOT EXISTS maps (
    id TEXT PRIMARY KEY,
    slug TEXT UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    is_official BOOLEAN NOT NULL DEFAULT FALSE,
    created_by TEXT REFERENCES players(id) ON DELETE SET NULL,
    version INTEGER NOT NULL DEFAULT 1,
    layout_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_maps_is_official ON maps(is_official);
CREATE INDEX IF NOT EXISTS idx_maps_created_by ON maps(created_by);

CREATE TABLE IF NOT EXISTS invitation_codes (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    created_by TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    is_used BOOLEAN NOT NULL DEFAULT FALSE,
    used_by TEXT REFERENCES players(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_invitation_codes_code ON invitation_codes(code);
CREATE INDEX IF NOT EXISTS idx_invitation_codes_created_by ON invitation_codes(created_by);
CREATE INDEX IF NOT EXISTS idx_invitation_codes_used_by ON invitation_codes(used_by);
CREATE INDEX IF NOT EXISTS idx_invitation_codes_is_used ON invitation_codes(is_used);

CREATE TABLE IF NOT EXISTS matchmaking_queues (
    id TEXT PRIMARY KEY,
    player_id TEXT NOT NULL UNIQUE REFERENCES players(id) ON DELETE CASCADE,
    preferred_count INTEGER NOT NULL DEFAULT 4,
    joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    timeout INTEGER NOT NULL DEFAULT 30000
);

CREATE INDEX IF NOT EXISTS idx_matchmaking_queues_player_id ON matchmaking_queues(player_id);
CREATE INDEX IF NOT EXISTS idx_matchmaking_queues_joined_at ON matchmaking_queues(joined_at);

CREATE TABLE IF NOT EXISTS custom_match_queues (
    id TEXT PRIMARY KEY,
    queue_id TEXT NOT NULL UNIQUE,
    queue_name TEXT NOT NULL,
    creator_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    max_players INTEGER NOT NULL DEFAULT 4,
    min_players INTEGER NOT NULL DEFAULT 3,
    status TEXT NOT NULL DEFAULT 'waiting',
    base_game_mode TEXT NOT NULL DEFAULT 'classic',
    custom_rules TEXT,
    map_id TEXT REFERENCES maps(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_custom_match_queues_queue_id ON custom_match_queues(queue_id);
CREATE INDEX IF NOT EXISTS idx_custom_match_queues_creator_id ON custom_match_queues(creator_id);
CREATE INDEX IF NOT EXISTS idx_custom_match_queues_status ON custom_match_queues(status);
CREATE INDEX IF NOT EXISTS idx_custom_match_queues_map_id ON custom_match_queues(map_id);

CREATE TABLE IF NOT EXISTS custom_match_queue_players (
    id TEXT PRIMARY KEY,
    queue_id TEXT NOT NULL REFERENCES custom_match_queues(id) ON DELETE CASCADE,
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_ready BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (queue_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_custom_match_queue_players_queue_id ON custom_match_queue_players(queue_id);
CREATE INDEX IF NOT EXISTS idx_custom_match_queue_players_player_id ON custom_match_queue_players(player_id);

CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    room_code TEXT NOT NULL UNIQUE,
    host_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'waiting',
    player_count INTEGER NOT NULL DEFAULT 4,
    ai_count INTEGER NOT NULL DEFAULT 0,
    winner_id TEXT,
    winner_type TEXT,
    total_turns INTEGER NOT NULL DEFAULT 0,
    duration INTEGER NOT NULL DEFAULT 0,
    started_at TEXT,
    finished_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    game_log TEXT
);

CREATE INDEX IF NOT EXISTS idx_matches_room_code ON matches(room_code);
CREATE INDEX IF NOT EXISTS idx_matches_host_id ON matches(host_id);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
CREATE INDEX IF NOT EXISTS idx_matches_created_at ON matches(created_at);
CREATE INDEX IF NOT EXISTS idx_matches_finished_at ON matches(finished_at);

CREATE TABLE IF NOT EXISTS match_players (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    player_number INTEGER NOT NULL,
    is_host BOOLEAN NOT NULL DEFAULT FALSE,
    position INTEGER NOT NULL,
    final_rank INTEGER,
    is_eliminated BOOLEAN NOT NULL DEFAULT FALSE,
    eliminated_turn INTEGER,
    energy INTEGER NOT NULL DEFAULT 3,
    destroyed_stars INTEGER NOT NULL DEFAULT 0,
    broadcast_count INTEGER NOT NULL DEFAULT 0,
    strike_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (match_id, player_id),
    UNIQUE (match_id, player_number)
);

CREATE INDEX IF NOT EXISTS idx_match_players_match_id ON match_players(match_id);
CREATE INDEX IF NOT EXISTS idx_match_players_player_id ON match_players(player_id);
CREATE INDEX IF NOT EXISTS idx_match_players_player_number ON match_players(player_number);

CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT,
    published BOOLEAN NOT NULL DEFAULT FALSE,
    author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_posts_author_id ON posts(author_id);
CREATE INDEX IF NOT EXISTS idx_posts_published ON posts(published);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at);

CREATE TABLE IF NOT EXISTS replays (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL UNIQUE REFERENCES matches(id) ON DELETE CASCADE,
    player_ids TEXT NOT NULL,
    player_names TEXT NOT NULL,
    actions TEXT NOT NULL,
    final_state TEXT,
    initial_state TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_replays_match_id ON replays(match_id);
CREATE INDEX IF NOT EXISTS idx_replays_created_at ON replays(created_at);

-- 部分唯一索引：确保最多一个管理员（原 Postgres 000005）
CREATE UNIQUE INDEX IF NOT EXISTS one_admin_only ON players(role) WHERE role = 'admin';
