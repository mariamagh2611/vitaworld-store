CREATE TABLE auth_challenges (hash TEXT PRIMARY KEY,kind TEXT NOT NULL,admin_id TEXT,challenge TEXT NOT NULL,binding TEXT NOT NULL DEFAULT '',expires_at INTEGER NOT NULL);
CREATE INDEX auth_challenges_expiry ON auth_challenges(expires_at);
CREATE TABLE passkeys (id TEXT PRIMARY KEY,admin_id TEXT NOT NULL REFERENCES admins(id),public_key TEXT NOT NULL,counter INTEGER NOT NULL DEFAULT 0,transports TEXT NOT NULL DEFAULT '[]',rp_id TEXT NOT NULL,name TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX passkeys_owner ON passkeys(admin_id,rp_id);
