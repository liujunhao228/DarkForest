-- name: GetPlayerByID :one
SELECT id, user_id, display_name, role, password, avatar, wins, losses, draws, total_matches, created_at, updated_at
FROM players
WHERE id = $1 LIMIT 1;

-- name: GetPlayerByUserID :one
SELECT id, user_id, display_name, role, password, avatar, wins, losses, draws, total_matches, created_at, updated_at
FROM players
WHERE user_id = $1 LIMIT 1;

-- name: GetPlayerByDisplayName :one
SELECT id, user_id, display_name, role, password, avatar, wins, losses, draws, total_matches, created_at, updated_at
FROM players
WHERE display_name = $1 LIMIT 1;

-- name: ListPlayers :many
SELECT id, user_id, display_name, role, avatar, wins, losses, draws, total_matches, created_at, updated_at
FROM players
ORDER BY created_at DESC
LIMIT $1 OFFSET $2;

-- name: CreatePlayer :one
INSERT INTO players (id, user_id, display_name, role, password, avatar, wins, losses, draws, total_matches)
VALUES ($1, $2, $3, $4, $5, $6, 0, 0, 0, 0)
RETURNING id, user_id, display_name, role, password, avatar, wins, losses, draws, total_matches, created_at, updated_at;

-- name: UpdatePlayerStats :one
UPDATE players
SET wins = $2, losses = $3, draws = $4, total_matches = $5, updated_at = CURRENT_TIMESTAMP
WHERE id = $1
RETURNING id, wins, losses, draws, total_matches, updated_at;

-- name: UpdatePlayerPassword :one
UPDATE players
SET password = $2, updated_at = CURRENT_TIMESTAMP
WHERE id = $1
RETURNING id, updated_at;

-- name: GetPlayerByRole :one
SELECT id, user_id, display_name, role, password, avatar, wins, losses, draws, total_matches, created_at, updated_at
FROM players
WHERE role = $1
LIMIT 1;

-- name: DeletePlayer :exec
DELETE FROM players
WHERE id = $1;
