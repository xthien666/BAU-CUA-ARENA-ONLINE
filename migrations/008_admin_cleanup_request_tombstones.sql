-- Preserve replay protection when old administrative audit records are purged.
CREATE TABLE admin_request_tombstones (
  admin_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_id VARCHAR(100) NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (admin_id, request_id)
);
