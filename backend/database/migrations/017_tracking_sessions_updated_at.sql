-- Add updated_at column to tracking_sessions table
ALTER TABLE tracking_sessions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();