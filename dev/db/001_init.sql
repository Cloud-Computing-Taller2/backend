-- Copia de db/migrations/001_init.sql para desarrollo local.

CREATE TABLE users (
    id            BIGSERIAL PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE folders (
    id         BIGSERIAL PRIMARY KEY,
    owner_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id  BIGINT REFERENCES folders(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique name per folder for the same owner; root = parent_id NULL is treated as 0.
CREATE UNIQUE INDEX folders_unique_name_per_parent
    ON folders (owner_id, COALESCE(parent_id, 0), name);

CREATE TABLE files (
    id           BIGSERIAL PRIMARY KEY,
    owner_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    folder_id    BIGINT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    s3_key       TEXT UNIQUE, -- computed when creating the "queued" record, before upload
    size_bytes   BIGINT NOT NULL DEFAULT 0,
    content_type TEXT,
    status       TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'uploading', 'ready', 'error', 'cancelled')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (folder_id, name)
);

CREATE TABLE shares (
    id         BIGSERIAL PRIMARY KEY,
    owner_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_id    BIGINT REFERENCES files(id) ON DELETE CASCADE,
    folder_id  BIGINT REFERENCES folders(id) ON DELETE CASCADE,
    permission TEXT NOT NULL DEFAULT 'read' CHECK (permission IN ('read', 'edit')),
    token      TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT shares_exactly_one_target CHECK (
        (file_id IS NOT NULL) <> (folder_id IS NOT NULL)
    )
);

CREATE INDEX folders_owner_idx  ON folders (owner_id);
CREATE INDEX folders_parent_idx ON folders (parent_id);
CREATE INDEX files_owner_idx    ON files (owner_id);
CREATE INDEX files_folder_idx   ON files (folder_id);
CREATE INDEX files_status_idx   ON files (status);
CREATE INDEX shares_owner_idx   ON shares (owner_id);
CREATE INDEX shares_file_idx    ON shares (file_id);
CREATE INDEX shares_folder_idx  ON shares (folder_id);
