-- Esquema y datos de prueba para desarrollo local.

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text NOT NULL UNIQUE,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL
);

CREATE TABLE folders (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id  uuid REFERENCES folders(id) ON DELETE CASCADE,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (owner_id, parent_id, name)
);

CREATE TABLE files (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id  uuid REFERENCES folders(id) ON DELETE CASCADE,
  name       text NOT NULL,
  mime_type  text NOT NULL,
  size_bytes bigint NOT NULL,
  s3_key     text NOT NULL UNIQUE,
  status     text NOT NULL DEFAULT 'queued'
             CHECK (status IN ('queued', 'uploading', 'ready', 'cancelled', 'error')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- NULLS NOT DISTINCT para que tampoco se repitan nombres en la raíz.
  UNIQUE NULLS NOT DISTINCT (owner_id, folder_id, name)
);

CREATE INDEX files_owner_id_idx  ON files (owner_id);
CREATE INDEX files_folder_id_idx ON files (folder_id);

-- Usuarios y carpeta de prueba.
INSERT INTO users (id, username, email, password_hash) VALUES
  ('11111111-1111-4111-8111-111111111111', 'ana',   'ana@example.test',   'x'),
  ('22222222-2222-4222-8222-222222222222', 'bruno', 'bruno@example.test', 'x');

INSERT INTO folders (id, owner_id, parent_id, name) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', NULL, 'Fotos');
