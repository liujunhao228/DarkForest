-- name: JoinMatchmakingQueue :one
INSERT INTO matchmaking_queues (id, player_id, preferred_count, timeout)
VALUES (?1, ?2, ?3, ?4)
ON CONFLICT (player_id) DO UPDATE
SET preferred_count = excluded.preferred_count, timeout = excluded.timeout, joined_at = CURRENT_TIMESTAMP
RETURNING id, player_id, preferred_count, joined_at, timeout;

-- name: LeaveMatchmakingQueue :exec
DELETE FROM matchmaking_queues
WHERE player_id = ?1;

-- name: GetPlayersInQueue :many
SELECT id, player_id, preferred_count, joined_at, timeout
FROM matchmaking_queues
WHERE preferred_count = ?1
ORDER BY joined_at ASC
LIMIT ?2;

-- name: CountPlayersInQueue :one
SELECT COUNT(*)
FROM matchmaking_queues
WHERE preferred_count = ?1;

-- name: GetPlayerInQueue :one
SELECT id, player_id, preferred_count, joined_at, timeout
FROM matchmaking_queues
WHERE player_id = ?1 LIMIT 1;

-- name: GetAllQueues :many
SELECT id, player_id, preferred_count, joined_at, timeout
FROM matchmaking_queues
ORDER BY joined_at ASC;

-- name: ClearMatchmakingQueue :exec
DELETE FROM matchmaking_queues
WHERE player_id IN (sqlc.slice('player_ids'));
