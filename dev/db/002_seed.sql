-- Copia de db/migrations/002_seed.sql para desarrollo local.

-- Demo password for all 3 users: "Password123!" (bcrypt cost 10).
INSERT INTO users (username, email, password_hash) VALUES
    ('alice', 'alice@example.com', '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'),
    ('bob',   'bob@example.com',   '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'),
    ('carol', 'carol@example.com', '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy');

INSERT INTO folders (id, owner_id, parent_id, name) VALUES
    (1, 1, NULL, 'Documentos'),
    (2, 1, NULL, 'Fotos'),
    (3, 1, 1,    'Contratos'),
    (4, 2, NULL, 'Proyectos'),
    (5, 2, 4,    'DriveClone'),
    (6, 3, NULL, 'Compartidos');

INSERT INTO files (id, owner_id, folder_id, name, s3_key, size_bytes, content_type, status) VALUES
    (1, 1, 3, 'contrato-2026.pdf', 'users/1/folders/3/contrato-2026.pdf', 204800, 'application/pdf', 'ready'),
    (2, 1, 2, 'playa.jpg',         'users/1/folders/2/playa.jpg',         1048576, 'image/jpeg',    'ready'),
    (3, 2, 5, 'arquitectura.md',   'users/2/folders/5/arquitectura.md',   8192, 'text/markdown',  'ready'),
    (4, 2, 5, 'presupuesto.xlsx',  'users/2/folders/5/presupuesto.xlsx',  51200, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'ready'),
    (5, 3, 6, 'notas.txt',         'users/3/folders/6/notas.txt',         1024, 'text/plain',    'ready');

INSERT INTO shares (owner_id, file_id, folder_id, permission, token, expires_at) VALUES
    (1, 1,    NULL, 'read',  'share-alice-contrato',    now() + interval '7 days'),
    (1, NULL, 2,    'edit',  'share-alice-fotos',       now() + interval '7 days'),
    (2, 3,    NULL, 'read',  'share-bob-arquitectura',  NULL),
    (3, 5,    NULL, 'read',  'share-carol-notas',       now() + interval '1 day');

-- Keep the BIGSERIAL sequences in sync with the manually inserted ids.
SELECT setval(pg_get_serial_sequence('users', 'id'),   (SELECT MAX(id) FROM users));
SELECT setval(pg_get_serial_sequence('folders', 'id'), (SELECT MAX(id) FROM folders));
SELECT setval(pg_get_serial_sequence('files', 'id'),   (SELECT MAX(id) FROM files));
SELECT setval(pg_get_serial_sequence('shares', 'id'),  (SELECT MAX(id) FROM shares));
