-- PostgreSQL DDL Migration: Initial Schema
-- Translated from Prisma schema
-- Version: 001
-- Date: 2026-06-06

-- Enable UUID extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================
-- 用户与玩家系统
-- ============================

-- 用户表（预留，未来账号系统）
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255),
    password VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 玩家表
CREATE TABLE IF NOT EXISTS players (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(255) NOT NULL UNIQUE,
    display_name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'player',
    password VARCHAR(255),
    avatar INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    draws INTEGER NOT NULL DEFAULT 0,
    total_matches INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 玩家表索引
CREATE INDEX IF NOT EXISTS idx_players_user_id ON players(user_id);
CREATE INDEX IF NOT EXISTS idx_players_display_name ON players(display_name);
CREATE INDEX IF NOT EXISTS idx_players_role ON players(role);

-- ============================
-- 邀请码系统
-- ============================

-- 邀请码表
CREATE TABLE IF NOT EXISTS invitation_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(6) NOT NULL UNIQUE,
    created_by UUID NOT NULL,
    is_used BOOLEAN NOT NULL DEFAULT FALSE,
    used_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    used_at TIMESTAMP WITH TIME ZONE,
    
    CONSTRAINT fk_invitation_codes_created_by FOREIGN KEY (created_by) 
        REFERENCES players(id) ON DELETE CASCADE,
    CONSTRAINT fk_invitation_codes_used_by FOREIGN KEY (used_by) 
        REFERENCES players(id) ON DELETE SET NULL
);

-- 邀请码表索引
CREATE INDEX IF NOT EXISTS idx_invitation_codes_code ON invitation_codes(code);
CREATE INDEX IF NOT EXISTS idx_invitation_codes_created_by ON invitation_codes(created_by);
CREATE INDEX IF NOT EXISTS idx_invitation_codes_used_by ON invitation_codes(used_by);
CREATE INDEX IF NOT EXISTS idx_invitation_codes_is_used ON invitation_codes(is_used);

-- ============================
-- 匹配系统
-- ============================

-- 匹配队列表
CREATE TABLE IF NOT EXISTS matchmaking_queues (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    player_id UUID NOT NULL UNIQUE,
    preferred_count INTEGER NOT NULL DEFAULT 4,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    timeout INTEGER NOT NULL DEFAULT 30000,
    
    CONSTRAINT fk_matchmaking_queues_player_id FOREIGN KEY (player_id) 
        REFERENCES players(id) ON DELETE CASCADE
);

-- 匹配队列表索引
CREATE INDEX IF NOT EXISTS idx_matchmaking_queues_player_id ON matchmaking_queues(player_id);
CREATE INDEX IF NOT EXISTS idx_matchmaking_queues_joined_at ON matchmaking_queues(joined_at);

-- 自定义匹配队列表
CREATE TABLE IF NOT EXISTS custom_match_queues (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    queue_id VARCHAR(255) NOT NULL UNIQUE,
    queue_name VARCHAR(255) NOT NULL,
    creator_id UUID NOT NULL,
    max_players INTEGER NOT NULL DEFAULT 4,
    min_players INTEGER NOT NULL DEFAULT 3,
    status VARCHAR(50) NOT NULL DEFAULT 'waiting',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_custom_match_queues_creator_id FOREIGN KEY (creator_id) 
        REFERENCES players(id) ON DELETE CASCADE
);

-- 自定义匹配队列表索引
CREATE INDEX IF NOT EXISTS idx_custom_match_queues_queue_id ON custom_match_queues(queue_id);
CREATE INDEX IF NOT EXISTS idx_custom_match_queues_creator_id ON custom_match_queues(creator_id);
CREATE INDEX IF NOT EXISTS idx_custom_match_queues_status ON custom_match_queues(status);

-- 自定义匹配队列玩家关联表
CREATE TABLE IF NOT EXISTS custom_match_queue_players (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    queue_id UUID NOT NULL,
    player_id UUID NOT NULL,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_ready BOOLEAN NOT NULL DEFAULT FALSE,
    
    CONSTRAINT fk_custom_match_queue_players_queue_id FOREIGN KEY (queue_id) 
        REFERENCES custom_match_queues(id) ON DELETE CASCADE,
    CONSTRAINT fk_custom_match_queue_players_player_id FOREIGN KEY (player_id) 
        REFERENCES players(id) ON DELETE CASCADE,
    CONSTRAINT uq_custom_match_queue_players_queue_player UNIQUE (queue_id, player_id)
);

-- 自定义匹配队列玩家关联表索引
CREATE INDEX IF NOT EXISTS idx_custom_match_queue_players_queue_id ON custom_match_queue_players(queue_id);
CREATE INDEX IF NOT EXISTS idx_custom_match_queue_players_player_id ON custom_match_queue_players(player_id);

-- ============================
-- 对局系统
-- ============================

-- 对局表
CREATE TABLE IF NOT EXISTS matches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_code VARCHAR(6) NOT NULL UNIQUE,
    host_id UUID NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'waiting',
    player_count INTEGER NOT NULL DEFAULT 4,
    ai_count INTEGER NOT NULL DEFAULT 0,
    winner_id UUID,
    winner_type VARCHAR(50),
    total_turns INTEGER NOT NULL DEFAULT 0,
    duration INTEGER NOT NULL DEFAULT 0,
    started_at TIMESTAMP WITH TIME ZONE,
    finished_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    game_log TEXT
);

-- 对局表索引
CREATE INDEX IF NOT EXISTS idx_matches_room_code ON matches(room_code);
CREATE INDEX IF NOT EXISTS idx_matches_host_id ON matches(host_id);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
CREATE INDEX IF NOT EXISTS idx_matches_created_at ON matches(created_at);
CREATE INDEX IF NOT EXISTS idx_matches_finished_at ON matches(finished_at);

-- 对局玩家关联表
CREATE TABLE IF NOT EXISTS match_players (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id UUID NOT NULL,
    player_id UUID NOT NULL,
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
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_match_players_match_id FOREIGN KEY (match_id) 
        REFERENCES matches(id) ON DELETE CASCADE,
    CONSTRAINT fk_match_players_player_id FOREIGN KEY (player_id) 
        REFERENCES players(id) ON DELETE CASCADE,
    CONSTRAINT uq_match_players_match_player UNIQUE (match_id, player_id),
    CONSTRAINT uq_match_players_match_number UNIQUE (match_id, player_number)
);

-- 对局玩家关联表索引
CREATE INDEX IF NOT EXISTS idx_match_players_match_id ON match_players(match_id);
CREATE INDEX IF NOT EXISTS idx_match_players_player_id ON match_players(player_id);
CREATE INDEX IF NOT EXISTS idx_match_players_player_number ON match_players(player_number);

-- ============================
-- 预留模型 (未来扩展)
-- ============================

-- 文章表（预留）
CREATE TABLE IF NOT EXISTS posts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    content TEXT,
    published BOOLEAN NOT NULL DEFAULT FALSE,
    author_id UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT fk_posts_author_id FOREIGN KEY (author_id) 
        REFERENCES users(id) ON DELETE CASCADE
);

-- 文章表索引
CREATE INDEX IF NOT EXISTS idx_posts_author_id ON posts(author_id);
CREATE INDEX IF NOT EXISTS idx_posts_published ON posts(published);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at);

-- ============================
-- 触发器：自动更新 updated_at
-- ============================

-- 创建更新时间戳函数
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 为需要 updated_at 的表创建触发器
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_players_updated_at BEFORE UPDATE ON players
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_custom_match_queues_updated_at BEFORE UPDATE ON custom_match_queues
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_matches_updated_at BEFORE UPDATE ON matches
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_posts_updated_at BEFORE UPDATE ON posts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================
-- 注释
-- ============================

COMMENT ON TABLE users IS '用户表（预留，未来账号系统）';
COMMENT ON TABLE players IS '玩家表';
COMMENT ON TABLE invitation_codes IS '邀请码表';
COMMENT ON TABLE matchmaking_queues IS '匹配队列表';
COMMENT ON TABLE custom_match_queues IS '自定义匹配队列表';
COMMENT ON TABLE custom_match_queue_players IS '自定义匹配队列玩家关联表';
COMMENT ON TABLE matches IS '对局表';
COMMENT ON TABLE match_players IS '对局玩家关联表';
COMMENT ON TABLE posts IS '文章表（预留）';

COMMENT ON COLUMN players.user_id IS '客户端生成的临时用户 ID';
COMMENT ON COLUMN players.role IS '玩家角色：admin 或 player';
COMMENT ON COLUMN players.avatar IS '头像 ID';
COMMENT ON COLUMN invitation_codes.code IS '邀请码（6 位大写字母数字）';
COMMENT ON COLUMN matchmaking_queues.preferred_count IS '期望玩家数（3-5）';
COMMENT ON COLUMN matchmaking_queues.timeout IS '匹配超时（毫秒）';
COMMENT ON COLUMN custom_match_queues.max_players IS '最大玩家数（3-5）';
COMMENT ON COLUMN custom_match_queues.min_players IS '最小玩家数（3-5）';
COMMENT ON COLUMN custom_match_queues.status IS '队列状态：waiting, matching, full, started';
COMMENT ON COLUMN matches.room_code IS '房间号（6 位字母数字）';
COMMENT ON COLUMN matches.status IS '对局状态：waiting, playing, finished';
COMMENT ON COLUMN matches.winner_type IS '胜利者类型：human 或 ai';
COMMENT ON COLUMN matches.total_turns IS '总回合数';
COMMENT ON COLUMN matches.duration IS '对局时长（秒）';
COMMENT ON COLUMN matches.game_log IS '对局日志（JSON 格式存储关键事件）';
COMMENT ON COLUMN match_players.player_number IS '玩家编号（0-4）';
COMMENT ON COLUMN match_players.position IS '初始星系位置';
COMMENT ON COLUMN match_players.final_rank IS '最终排名';
COMMENT ON COLUMN match_players.eliminated_turn IS '被淘汰的回合';
COMMENT ON COLUMN match_players.energy IS '初始能量';
COMMENT ON COLUMN match_players.destroyed_stars IS '摧毁的恒星数';
COMMENT ON COLUMN match_players.broadcast_count IS '成功广播次数';
COMMENT ON COLUMN match_players.strike_count IS '成功打击次数';