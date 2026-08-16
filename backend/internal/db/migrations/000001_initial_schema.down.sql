-- SQLite DDL Migration: Drop Initial Schema
-- Version: 000001
-- 子表先删，避免外键顺序问题

DROP TABLE IF EXISTS replays;
DROP TABLE IF EXISTS posts;
DROP TABLE IF EXISTS match_players;
DROP TABLE IF EXISTS matches;
DROP TABLE IF EXISTS custom_match_queue_players;
DROP TABLE IF EXISTS custom_match_queues;
DROP TABLE IF EXISTS matchmaking_queues;
DROP TABLE IF EXISTS invitation_codes;
DROP TABLE IF EXISTS maps;
DROP TABLE IF EXISTS players;
DROP TABLE IF EXISTS users;
