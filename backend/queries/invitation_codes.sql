-- name: CreateInvitationCode :one
INSERT INTO invitation_codes (id, code, created_by, is_used, used_by)
VALUES ($1, $2, $3, FALSE, NULL)
RETURNING id, code, created_by, is_used, used_by, created_at, used_at;

-- name: GetInvitationCode :one
SELECT id, code, created_by, is_used, used_by, created_at, used_at
FROM invitation_codes
WHERE code = $1 LIMIT 1;

-- name: UseInvitationCode :one
UPDATE invitation_codes
SET is_used = TRUE, used_by = $2, used_at = CURRENT_TIMESTAMP
WHERE code = $1 AND is_used = FALSE
RETURNING id, code, created_by, is_used, used_by, created_at, used_at;

-- name: ListInvitationCodesByCreator :many
SELECT id, code, created_by, is_used, used_by, created_at, used_at
FROM invitation_codes
WHERE created_by = $1
ORDER BY created_at DESC;

-- name: DeleteInvitationCode :exec
DELETE FROM invitation_codes
WHERE id = $1;
