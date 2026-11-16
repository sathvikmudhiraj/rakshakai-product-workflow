-- Add missing data column to copilot tables for repository compatibility
-- The base repository expects a 'data JSONB NOT NULL DEFAULT '{}'::jsonb' column on all tables

ALTER TABLE copilot_conversations
    ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE copilot_messages
    ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Migration metadata
-- version: 029
-- name: copilot_data_column
-- description: Add missing data column to copilot tables for repository upsert compatibility