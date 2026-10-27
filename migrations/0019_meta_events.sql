CREATE TABLE meta_events ( id TEXT PRIMARY KEY, pixel_id TEXT NOT NULL, payload TEXT, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, run_at INTEGER NOT NULL, lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at INTEGER NOT NULL );
CREATE INDEX meta_events_due ON meta_events(status,run_at);
