CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_room ON messages(room_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_room_id ON messages(room_id, id);

CREATE TABLE IF NOT EXISTS presence (
    room_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    seen_at INTEGER NOT NULL,
    PRIMARY KEY (room_id, user_id)
);
