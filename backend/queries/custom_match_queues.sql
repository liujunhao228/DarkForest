-- Custom Match Queue queries

-- Create a custom match queue
CREATE OR REPLACE FUNCTION create_custom_match_queue(
    p_queue_id VARCHAR,
    p_queue_name VARCHAR,
    p_creator_id UUID,
    p_min_players INTEGER,
    p_max_players INTEGER
) RETURNS UUID AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO custom_match_queues (id, queue_id, queue_name, creator_id, min_players, max_players, status)
    VALUES (uuid_generate_v4(), p_queue_id, p_queue_name, p_creator_id, p_min_players, p_max_players, 'waiting')
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- Name: create_custom_match_queue(character varying, character varying, uuid, integer, integer):uuid

-- Get custom match queue by queue_id
CREATE OR REPLACE FUNCTION get_custom_match_queue_by_queue_id(
    p_queue_id VARCHAR
) RETURNS TABLE (
    id UUID,
    queue_id VARCHAR,
    queue_name VARCHAR,
    creator_id UUID,
    max_players INTEGER,
    min_players INTEGER,
    status VARCHAR,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT cmq.id, cmq.queue_id, cmq.queue_name, cmq.creator_id, cmq.max_players, cmq.min_players, cmq.status, cmq.created_at, cmq.updated_at
    FROM custom_match_queues cmq
    WHERE cmq.queue_id = p_queue_id;
END;
$$ LANGUAGE plpgsql;

-- Name: get_custom_match_queue_by_queue_id(character varying); type: record

-- Get custom match queue players
CREATE OR REPLACE FUNCTION get_custom_match_queue_players(
    p_queue_id UUID
) RETURNS TABLE (
    id UUID,
    queue_id UUID,
    player_id UUID,
    joined_at TIMESTAMPTZ,
    is_ready BOOLEAN,
    display_name VARCHAR,
    is_host BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT cmp.id, cmp.queue_id, cmp.player_id, cmp.joined_at, cmp.is_ready, p.display_name, FALSE
    FROM custom_match_queue_players cmp
    JOIN players p ON p.id = cmp.player_id
    WHERE cmp.queue_id = p_queue_id
    ORDER BY cmp.joined_at ASC;
END;
$$ LANGUAGE plpgsql;

-- Name: get_custom_match_queue_players(uuid); type: record

-- Add player to custom match queue
CREATE OR REPLACE FUNCTION add_player_to_custom_queue(
    p_queue_id UUID,
    p_player_id UUID
) RETURNS BOOLEAN AS $$
BEGIN
    INSERT INTO custom_match_queue_players (id, queue_id, player_id, is_ready)
    VALUES (uuid_generate_v4(), p_queue_id, p_player_id, TRUE)
    ON CONFLICT (queue_id, player_id) DO NOTHING;
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Name: add_player_to_custom_queue(uuid, uuid): boolean

-- Remove player from custom match queue
CREATE OR REPLACE FUNCTION remove_player_from_custom_queue(
    p_queue_id UUID,
    p_player_id UUID
) RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    DELETE FROM custom_match_queue_players
    WHERE queue_id = p_queue_id AND player_id = p_player_id;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Name: remove_player_from_custom_queue(uuid, uuid): integer

-- Get full custom queues (queues with max players reached)
CREATE OR REPLACE FUNCTION get_full_custom_queues()
RETURNS TABLE (
    queue_id VARCHAR,
    queue_name VARCHAR,
    min_players INTEGER,
    max_players INTEGER,
    status VARCHAR,
    player_count INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT cmq.queue_id, cmq.queue_name, cmq.min_players, cmq.max_players, cmq.status,
           (SELECT COUNT(*) FROM custom_match_queue_players cmp WHERE cmp.queue_id = cmq.id)::INTEGER as player_count
    FROM custom_match_queues cmq
    WHERE cmq.status = 'full';
END;
$$ LANGUAGE plpgsql;

-- Name: get_full_custom_queues; type: record

-- Update custom queue status
CREATE OR REPLACE FUNCTION update_custom_queue_status(
    p_queue_id UUID,
    p_status VARCHAR
) RETURNS VOID AS $$
BEGIN
    UPDATE custom_match_queues
    SET status = p_status
    WHERE id = p_queue_id;
END;
$$ LANGUAGE plpgsql;

-- Name: update_custom_queue_status(uuid, character varying)

-- Get player queues (queues a player is in)
CREATE OR REPLACE FUNCTION get_player_custom_queues(
    p_player_id UUID
) RETURNS TABLE (
    queue_id VARCHAR,
    queue_name VARCHAR,
    min_players INTEGER,
    max_players INTEGER,
    status VARCHAR,
    player_count INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT cmq.queue_id, cmq.queue_name, cmq.min_players, cmq.max_players, cmq.status,
           (SELECT COUNT(*) FROM custom_match_queue_players cmp WHERE cmp.queue_id = cmq.id)::INTEGER as player_count
    FROM custom_match_queues cmq
    JOIN custom_match_queue_players cmpq ON cmpq.queue_id = cmq.id
    WHERE cmpq.player_id = p_player_id;
END;
$$ LANGUAGE plpgsql;

-- Name: get_player_custom_queues(uuid); type: record

-- Check if player is in queue
CREATE OR REPLACE FUNCTION player_in_custom_queue(
    p_queue_id UUID,
    p_player_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM custom_match_queue_players
    WHERE queue_id = p_queue_id AND player_id = p_player_id;
    RETURN v_count > 0;
END;
$$ LANGUAGE plpgsql;

-- Name: player_in_custom_queue(uuid, uuid): boolean

-- Delete empty custom queue
CREATE OR REPLACE FUNCTION delete_empty_custom_queue(
    p_queue_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM custom_match_queue_players
    WHERE queue_id = p_queue_id;

    IF v_count = 0 THEN
        DELETE FROM custom_match_queues WHERE id = p_queue_id;
        RETURN TRUE;
    END IF;
    RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

-- Name: delete_empty_custom_queue(uuid): boolean
