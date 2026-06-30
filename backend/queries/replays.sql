-- name: GetReplayByID :one
SELECT id, match_id, player_ids, player_names, actions, initial_state, final_state, created_at
FROM replays
WHERE id = $1 LIMIT 1;

-- name: GetReplayByMatchID :one
SELECT id, match_id, player_ids, player_names, actions, initial_state, final_state, created_at
FROM replays
WHERE match_id = $1 LIMIT 1;

-- name: ListReplays :many
SELECT id, match_id, player_ids, player_names, actions, initial_state, final_state, created_at
FROM replays
ORDER BY created_at DESC
LIMIT $1 OFFSET $2;

-- name: ListReplaysByPlayer :many
SELECT r.id, r.match_id, r.player_ids, r.player_names, r.actions, r.initial_state, r.final_state, r.created_at
FROM replays r
JOIN match_players mp ON r.match_id = mp.match_id
WHERE mp.player_id = $1
ORDER BY r.created_at DESC
LIMIT $2 OFFSET $3;

-- name: CreateReplay :one
INSERT INTO replays (id, match_id, player_ids, player_names, actions, initial_state, final_state)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, match_id, player_ids, player_names, actions, initial_state, final_state, created_at;

-- name: DeleteReplay :exec
DELETE FROM replays
WHERE id = $1;

-- name: DeleteReplaysByMatchID :exec
DELETE FROM replays
WHERE match_id = $1;
