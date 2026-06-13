-- name: GetMatchPlayer :one
SELECT id, match_id, player_id, player_number, is_host, position, final_rank, is_eliminated, eliminated_turn, energy, destroyed_stars, broadcast_count, strike_count, created_at
FROM match_players
WHERE match_id = $1 AND player_id = $2 LIMIT 1;

-- name: ListPlayersByMatch :many
SELECT id, match_id, player_id, player_number, is_host, position, final_rank, is_eliminated, eliminated_turn, energy, destroyed_stars, broadcast_count, strike_count, created_at
FROM match_players
WHERE match_id = $1
ORDER BY player_number ASC;

-- name: AddPlayerToMatch :one
INSERT INTO match_players (id, match_id, player_id, player_number, is_host, position, is_eliminated, energy, destroyed_stars, broadcast_count, strike_count)
VALUES ($1, $2, $3, $4, $5, $6, FALSE, 3, 0, 0, 0)
RETURNING id, match_id, player_id, player_number, is_host, position, is_eliminated, energy, destroyed_stars, broadcast_count, strike_count, created_at;

-- name: UpdateMatchPlayerStats :one
UPDATE match_players
SET final_rank = $2, is_eliminated = $3, eliminated_turn = $4, energy = $5, destroyed_stars = $6, broadcast_count = $7, strike_count = $8
WHERE match_id = $1 AND player_id = $9
RETURNING match_id, player_id, final_rank, is_eliminated, eliminated_turn, energy, destroyed_stars, broadcast_count, strike_count;

-- name: CountPlayersInMatch :one
SELECT COUNT(*)
FROM match_players
WHERE match_id = $1;

-- name: RemovePlayerFromMatch :exec
DELETE FROM match_players
WHERE match_id = $1 AND player_id = $2;
