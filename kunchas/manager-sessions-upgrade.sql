-- Bind manager dashboard sessions to the branch selected at PIN verification.
CREATE TABLE IF NOT EXISTS access_manager_sessions (
  token_hash TEXT PRIMARY KEY REFERENCES access_sessions(token_hash) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE
);
