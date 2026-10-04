-- Reference-only concatenation of the existing migrations, not a new migration.
-- Re-read the target checkout before any database work. Do not execute for curation.

-- SOURCE: web/migrations/0001_multiuser.sql
PRAGMA foreign_keys = ON;
CREATE TABLE users (id TEXT PRIMARY KEY, provider_sub TEXT NOT NULL UNIQUE, username TEXT NOT NULL COLLATE NOCASE UNIQUE, display_name TEXT NOT NULL, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, banned INTEGER NOT NULL DEFAULT 0, ban_reason TEXT, permissions TEXT NOT NULL DEFAULT '[]', share_stats INTEGER NOT NULL DEFAULT 1, mutation_id TEXT);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO settings VALUES ('guestAllowed','true');
CREATE TABLE auth_flows (state_hash TEXT PRIMARY KEY, binding_hash TEXT NOT NULL, verifier TEXT NOT NULL, username TEXT, mode TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX auth_flow_expiry ON auth_flows(expires_at);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX session_user ON sessions(user_id);
CREATE INDEX session_expiry ON sessions(expires_at);
CREATE TABLE user_data (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, revision INTEGER NOT NULL DEFAULT 0, upload_id TEXT, stats TEXT NOT NULL DEFAULT '{}', updated_at TEXT);
CREATE TABLE user_data_chunks (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, chunk_index INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(user_id,chunk_index));
CREATE TABLE user_question_stats (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, question_id TEXT NOT NULL, bank_id TEXT NOT NULL, question_revision INTEGER NOT NULL, score REAL NOT NULL, possible REAL NOT NULL, last_practice_at TEXT NOT NULL, PRIMARY KEY(user_id,bank_id,question_id,question_revision));
CREATE TABLE stats_adjustments (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), actor_id TEXT NOT NULL REFERENCES users(id), xp INTEGER NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX stats_adjustment_user ON stats_adjustments(user_id);
CREATE TABLE devices (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, session_hash TEXT NOT NULL, label TEXT NOT NULL, browser TEXT NOT NULL, platform TEXT NOT NULL, time_zone TEXT NOT NULL, language TEXT NOT NULL, screen TEXT NOT NULL, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, UNIQUE(user_id,session_hash));
CREATE INDEX device_user ON devices(user_id);
CREATE TABLE teams (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', owner_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, leaderboard_enabled INTEGER NOT NULL DEFAULT 1);
CREATE TABLE team_members (team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, permissions TEXT NOT NULL DEFAULT '[]', joined_at TEXT NOT NULL, PRIMARY KEY(team_id,user_id));
CREATE INDEX membership_user ON team_members(user_id);
CREATE TABLE invitations (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, team_id TEXT REFERENCES teams(id) ON DELETE CASCADE, created_by TEXT NOT NULL REFERENCES users(id), permissions TEXT NOT NULL, created_at TEXT NOT NULL, expires_at INTEGER NOT NULL, max_uses INTEGER NOT NULL DEFAULT 1, uses INTEGER NOT NULL DEFAULT 0, revoked INTEGER NOT NULL DEFAULT 0);
CREATE TABLE invitation_acceptances (invitation_id TEXT NOT NULL REFERENCES invitations(id), user_id TEXT NOT NULL REFERENCES users(id), acceptance_id TEXT NOT NULL UNIQUE, PRIMARY KEY(invitation_id,user_id));
CREATE INDEX invitations_team ON invitations(team_id,created_at);
CREATE TABLE assignments (id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, due_at TEXT, question_set TEXT NOT NULL, assignee_ids TEXT NOT NULL DEFAULT '[]');
CREATE INDEX assignment_team ON assignments(team_id,created_at);
CREATE TABLE audit (id TEXT PRIMARY KEY, actor_id TEXT REFERENCES users(id), action TEXT NOT NULL, target_id TEXT, detail TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
CREATE INDEX audit_created ON audit(created_at DESC);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX rate_limit_expiry ON rate_limits(expires_at);

-- SOURCE: web/migrations/0002_progress_hash.sql
ALTER TABLE user_data ADD COLUMN progress_hash TEXT;

-- SOURCE: web/migrations/0003_question_lookup.sql
CREATE INDEX question_lookup ON user_question_stats(question_id,question_revision,user_id,bank_id);

-- SOURCE: web/migrations/0004_administration.sql
ALTER TABLE users ADD COLUMN is_owner INTEGER NOT NULL DEFAULT 0 CHECK (is_owner IN (0,1));
-- Only the audited operator bootstrap establishes ownership, never a username or
-- the order in which public visitors register.
UPDATE users SET is_owner=1 WHERE id=(SELECT target_id FROM audit WHERE action='operator.bootstrap' AND json_extract(detail,'$.scope')='full-platform' ORDER BY created_at LIMIT 1);
CREATE UNIQUE INDEX users_one_owner ON users(is_owner) WHERE is_owner=1;
CREATE TRIGGER protect_site_owner BEFORE UPDATE OF banned ON users WHEN OLD.is_owner=1 AND NEW.banned<>0 BEGIN SELECT RAISE(ABORT,'protected_owner'); END;
UPDATE users SET permissions=json_insert(permissions,'$[#]','users.admin_permissions','$[#]','teams.invitations.read','$[#]','teams.invitations.write') WHERE is_owner=1;
ALTER TABLE invitations ADD COLUMN paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0,1));
ALTER TABLE invitations ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
CREATE INDEX invitation_creator ON invitations(created_by,created_at);
CREATE INDEX invitation_team ON invitations(team_id,created_at);

UPDATE team_members SET permissions=json_insert(permissions,'$[#]','invitations.read','$[#]','invitations.write') WHERE user_id=(SELECT owner_id FROM teams WHERE id=team_members.team_id);
