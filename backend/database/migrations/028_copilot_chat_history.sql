-- Copilot chat history persistence
-- User-scoped conversation storage with 50-exchange limit per conversation

CREATE TABLE IF NOT EXISTS copilot_conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entities JSONB NOT NULL DEFAULT '[]'::jsonb,
  language TEXT NOT NULL DEFAULT 'en',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS copilot_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES copilot_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for efficient user conversation lookup
CREATE INDEX IF NOT EXISTS idx_copilot_conversations_user_id ON copilot_conversations(user_id, updated_at DESC);

-- Index for efficient message retrieval by conversation
CREATE INDEX IF NOT EXISTS idx_copilot_messages_conversation_id ON copilot_messages(conversation_id, created_at ASC);

-- Trigger to enforce 50-exchange limit per conversation (100 messages = 50 user + 50 assistant)
CREATE OR REPLACE FUNCTION enforce_copilot_message_limit()
RETURNS TRIGGER AS $$
DECLARE
  message_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO message_count
  FROM copilot_messages
  WHERE conversation_id = NEW.conversation_id;
  
  IF message_count >= 100 THEN
    -- Delete oldest messages to maintain 50-exchange limit (100 messages total)
    DELETE FROM copilot_messages
    WHERE conversation_id = NEW.conversation_id
    AND id IN (
      SELECT id FROM copilot_messages
      WHERE conversation_id = NEW.conversation_id
      ORDER BY created_at ASC
      LIMIT message_count - 99
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS copilot_messages_limit ON copilot_messages;
CREATE TRIGGER copilot_messages_limit
BEFORE INSERT ON copilot_messages
FOR EACH ROW EXECUTE FUNCTION enforce_copilot_message_limit();

-- Migration metadata
-- version: 028
-- name: copilot_chat_history
-- description: User-scoped Copilot chat history persistence with 50-exchange limit