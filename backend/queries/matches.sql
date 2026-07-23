-- name: GetMatchByID :one
SELECT id, room_code, host_id, status, player_count, ai_count, winner_id, winner_type, total_turns, duration, started_at, finished_at, created_at, updated_at
FROM matches
WHERE id = $1 LIMIT 1;

-- name: GetMatchByRoomCode :one
SELECT id, room_code, host_id, status, player_count, ai_count, winner_id, winner_type, total_turns, duration, started_at, finished_at, created_at, updated_at
FROM matches
WHERE room_code = $1 LIMIT 1;

-- name: ListMatches :many
SELECT id, room_code, host_id, status, player_count, ai_count, winner_id, winner_type, total_turns, duration, started_at, finished_at, created_at, updated_at
FROM matches
ORDER BY created_at DESC
LIMIT $1 OFFSET $2;

-- name: ListMatchesByPlayer :many
SELECT m.id, m.room_code, m.host_id, m.status, m.player_count, m.ai_count, m.winner_id, m.winner_type, m.total_turns, m.duration, m.started_at, m.finished_at, m.created_at, m.updated_at
FROM matches m
JOIN match_players mp ON m.id = mp.match_id
WHERE mp.player_id = $1
ORDER BY m.created_at DESC
LIMIT $2 OFFSET $3;

-- name: CreateMatch :one
INSERT INTO matches (id, room_code, host_id, status, player_count, ai_count)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, room_code, host_id, status, player_count, ai_count, created_at, updated_at;

-- name: StartMatch :one
UPDATE matches
SET status = 'playing', started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
WHERE id = $1
RETURNING id, status, started_at, updated_at;

-- name: FinishMatch :one
UPDATE matches
SET status = 'finished', finished_at = CURRENT_TIMESTAMP, winner_id = $2, winner_type = $3, total_turns = $4, duration = $5, game_log = $6, updated_at = CURRENT_TIMESTAMP
WHERE id = $1
RETURNING id, status, finished_at, winner_id, winner_type, total_turns, duration, updated_at;

-- name: DeleteMatch :exec
DELETE FROM matches
WHERE id = $1;
