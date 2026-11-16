CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('CRITICAL','HIGH','MEDIUM','LOW','INFO')),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  source TEXT,
  recipient_roles TEXT[] NOT NULL DEFAULT ARRAY['Admin','Police Officer']::TEXT[],
  created_at TIMESTAMPTZ NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS notification_receipts (
  notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (notification_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_entity ON notifications(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_notification_receipts_user ON notification_receipts(user_id, read_at DESC);
