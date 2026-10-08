const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

fs.mkdirSync(path.dirname(path.resolve(config.dbPath)), { recursive: true });
const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS channels (
  channel_id TEXT PRIMARY KEY,
  guild_id   TEXT NOT NULL,
  type       TEXT NOT NULL,          -- category | assignee | credentials
  name       TEXT,
  user_id    TEXT                    -- assignee channels only
);
CREATE TABLE IF NOT EXISTS tasks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT NOT NULL,
  origin        TEXT NOT NULL,       -- category | assignee (where the task was created)
  title         TEXT NOT NULL,
  description   TEXT,
  author_id     TEXT,
  author_name   TEXT,
  author_avatar TEXT,
  status        TEXT NOT NULL DEFAULT 'doing', -- doing | done | discarded
  bug           INTEGER NOT NULL DEFAULT 0,
  important     INTEGER NOT NULL DEFAULT 0,
  priority      TEXT,
  due_date      TEXT,                -- YYYY-MM-DD
  image_name    TEXT,
  details_open  INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  -- legacy single-channel columns (kept only so old databases migrate)
  assignee_id TEXT, category_channel_id TEXT, category_message_id TEXT,
  assignee_channel_id TEXT, assignee_message_id TEXT
);
-- every Discord message that shows a task (origin + mirrors in N category / assignee channels)
CREATE TABLE IF NOT EXISTS task_messages (
  message_id TEXT PRIMARY KEY,
  task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  kind       TEXT NOT NULL,          -- category | assignee
  is_origin  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tm_task ON task_messages(task_id);
CREATE INDEX IF NOT EXISTS idx_tm_channel ON task_messages(channel_id);
CREATE TABLE IF NOT EXISTS task_assignees (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  PRIMARY KEY (task_id, user_id)
);
`);
db.pragma('foreign_keys = ON');

// ---- migrations for databases created by older versions ----
try { db.exec('ALTER TABLE tasks ADD COLUMN details_open INTEGER NOT NULL DEFAULT 0'); } catch { /* exists */ }
db.transaction(() => {
  const old = db.prepare('SELECT * FROM tasks WHERE category_message_id IS NOT NULL OR assignee_message_id IS NOT NULL').all();
  const hasMsg = db.prepare('SELECT 1 FROM task_messages WHERE message_id = ?');
  const addMsg = db.prepare('INSERT INTO task_messages (message_id, task_id, channel_id, kind, is_origin) VALUES (?,?,?,?,?)');
  for (const t of old) {
    for (const kind of ['category', 'assignee']) {
      const mid = t[`${kind}_message_id`];
      if (mid && !hasMsg.get(mid)) addMsg.run(mid, t.id, t[`${kind}_channel_id`], kind, t.origin === kind ? 1 : 0);
    }
    if (t.assignee_id) db.prepare('INSERT OR IGNORE INTO task_assignees (task_id, user_id) VALUES (?,?)').run(t.id, t.assignee_id);
  }
})();

// ---- channels ----
const getChannel = (id) => db.prepare('SELECT * FROM channels WHERE channel_id = ?').get(id);
const listChannels = (guildId, type) =>
  db.prepare('SELECT * FROM channels WHERE guild_id = ? AND type = ?').all(guildId, type);
const assigneeChannelFor = (guildId, userId) =>
  db.prepare("SELECT * FROM channels WHERE guild_id = ? AND type = 'assignee' AND user_id = ?").get(guildId, userId);

function setChannel({ channelId, guildId, type, name, userId = null }) {
  db.transaction(() => {
    if (type === 'assignee') {
      db.prepare("DELETE FROM channels WHERE guild_id = ? AND type = 'assignee' AND user_id = ? AND channel_id != ?")
        .run(guildId, userId, channelId);
    }
    db.prepare(`INSERT INTO channels (channel_id, guild_id, type, name, user_id) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(channel_id) DO UPDATE SET type = excluded.type, name = excluded.name, user_id = excluded.user_id`)
      .run(channelId, guildId, type, name, userId);
  })();
}
const unsetChannel = (id) => db.prepare('DELETE FROM channels WHERE channel_id = ?').run(id).changes > 0;

// ---- tasks ----
/** Task row + `messages` [{message_id, channel_id, kind, is_origin}], `categories` [channelId], `assignees` [userId]. */
function getTask(id) {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!t) return null;
  t.messages = db.prepare('SELECT * FROM task_messages WHERE task_id = ? ORDER BY is_origin DESC, rowid').all(id);
  t.categories = t.messages.filter((m) => m.kind === 'category').map((m) => m.channel_id);
  t.assignees = db.prepare('SELECT user_id FROM task_assignees WHERE task_id = ?').all(id).map((r) => r.user_id);
  return t;
}
const findTaskByMessage = (mid) => {
  const r = db.prepare('SELECT task_id FROM task_messages WHERE message_id = ?').get(mid);
  return r ? getTask(r.task_id) : null;
};

function insertTask(t) {
  const cols = Object.keys(t);
  const info = db.prepare(`INSERT INTO tasks (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...cols.map((c) => t[c]));
  return Number(info.lastInsertRowid);
}
function updateTask(id, fields) {
  const cols = Object.keys(fields);
  if (!cols.length) return;
  db.prepare(`UPDATE tasks SET ${cols.map((c) => `${c} = ?`).join(',')} WHERE id = ?`)
    .run(...cols.map((c) => fields[c]), id);
}
const deleteTaskRow = (id) => db.prepare('DELETE FROM tasks WHERE id = ?').run(id);

const addTaskMessage = (taskId, channelId, messageId, kind, isOrigin = false) =>
  db.prepare('INSERT INTO task_messages (message_id, task_id, channel_id, kind, is_origin) VALUES (?,?,?,?,?)')
    .run(messageId, taskId, channelId, kind, isOrigin ? 1 : 0);
const removeTaskMessage = (messageId) => db.prepare('DELETE FROM task_messages WHERE message_id = ?').run(messageId);

function setTaskAssignees(taskId, userIds) {
  db.transaction(() => {
    db.prepare('DELETE FROM task_assignees WHERE task_id = ?').run(taskId);
    const ins = db.prepare('INSERT OR IGNORE INTO task_assignees (task_id, user_id) VALUES (?,?)');
    for (const u of userIds) ins.run(taskId, u);
  })();
}

/** Open tasks shown in a channel, each with the message id of the copy living there. */
function tasksInChannel(channelId, status = 'doing') {
  const rows = db.prepare(
    `SELECT t.id, m.message_id AS msg FROM tasks t JOIN task_messages m ON m.task_id = t.id
     WHERE m.channel_id = ? AND t.status = ?`,
  ).all(channelId, status);
  return rows.map((r) => ({ ...getTask(r.id), msg: r.msg }));
}

module.exports = {
  db, getChannel, listChannels, assigneeChannelFor, setChannel, unsetChannel,
  getTask, findTaskByMessage, insertTask, updateTask, deleteTaskRow,
  addTaskMessage, removeTaskMessage, setTaskAssignees, tasksInChannel,
};
