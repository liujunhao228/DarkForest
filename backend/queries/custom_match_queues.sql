-- Custom Match Queue queries (SQLite dialect)
-- Original plpgsql functions inlined as plain sqlc queries; id generated in app layer (google/uuid).

-- name: CreateCustomMatchQueue :one
INSERT INTO custom_match_queues (id, queue_id, queue_name, creator_id, min_players, max_players, status, base_game_mode, custom_rules, map_id)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'waiting', ?7, ?8, ?9)
RETURNING id;

-- name: GetCustomMatchQueueByQueueID :one
SELECT id, queue_id, queue_name, creator_id, max_players, min_players, status, created_at, updated_at, base_game_mode, custom_rules, map_id
FROM custom_match_queues
WHERE queue_id = ?1;

-- name: GetCustomMatchQueuePlayers :many
SELECT cmp.id, cmp.queue_id, cmp.player_id, cmp.joined_at, cmp.is_ready, p.display_name
FROM custom_match_queue_players cmp
JOIN players p ON p.id = cmp.player_id
WHERE cmp.queue_id = ?1
ORDER BY cmp.joined_at ASC;

-- name: AddPlayerToCustomQueue :exec
INSERT INTO custom_match_queue_players (id, queue_id, player_id, is_ready)
VALUES (?1, ?2, ?3, true)
ON CONFLICT (queue_id, player_id) DO NOTHING;

-- name: RemovePlayerFromCustomQueue :exec
DELETE FROM custom_match_queue_players
WHERE queue_id = ?1 AND player_id = ?2;

-- name: PlayerInCustomQueue :one
SELECT EXISTS(
	SELECT 1 FROM custom_match_queue_players
	WHERE queue_id = ?1 AND player_id = ?2
);

-- name: UpdateCustomQueueStatus :exec
UPDATE custom_match_queues
SET status = ?2, updated_at = CURRENT_TIMESTAMP
WHERE id = ?1;

-- name: DeleteEmptyCustomQueue :exec
DELETE FROM custom_match_queues
WHERE custom_match_queues.id = ?1
AND NOT EXISTS (SELECT 1 FROM custom_match_queue_players WHERE custom_match_queue_players.queue_id = custom_match_queues.id);

-- name: GetPlayerCustomQueues :many
SELECT cmq.queue_id, cmq.queue_name, cmq.min_players, cmq.max_players, cmq.status
FROM custom_match_queues cmq
JOIN custom_match_queue_players cmpq ON cmpq.queue_id = cmq.id
WHERE cmpq.player_id = ?1;

-- name: CountWaitingRoomsByMapID :one
-- Count waiting custom rooms referencing a given map.
-- Used by DELETE /api/maps/{id} to block deletion while a waiting room references the map.
SELECT COUNT(*) FROM custom_match_queues
WHERE map_id = ?1 AND status = 'waiting';
