CREATE TABLE campaign_links (   id TEXT PRIMARY KEY,   url TEXT NOT NULL UNIQUE,   target TEXT NOT NULL,   source TEXT NOT NULL,   campaign TEXT NOT NULL,   created_at TEXT NOT NULL );
CREATE INDEX campaign_links_created ON campaign_links(created_at DESC);
