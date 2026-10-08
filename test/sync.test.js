// Mocked-Discord test for multi-category / multi-assignee mirroring.
const os = require('os');
const path = require('path');
process.env.DB_PATH = path.join(os.tmpdir(), `discoforge-test-${process.pid}.db`);

const assert = require('assert');
const store = require('../src/db');
const T = require('../src/tasks');

let seq = 0;
const channels = new Map();
const mkChannel = (id) => {
  const msgs = new Map();
  const ch = {
    id, msgs,
    async send(opts) {
      const m = {
        id: `m${++seq}`, pinned: false, attachments: new Map(), embeds: opts.embeds,
        react: async () => {}, edit: async (o) => { m.embeds = o.embeds; },
        delete: async () => { msgs.delete(m.id); },
        pin: async () => { m.pinned = true; }, unpin: async () => { m.pinned = false; },
      };
      msgs.set(m.id, m);
      return m;
    },
    messages: { fetch: async (id) => { if (!msgs.has(id)) throw new Error('unknown'); return msgs.get(id); } },
  };
  channels.set(id, ch);
  return ch;
};
const client = { channels: { fetch: async (id) => channels.get(id) } };

['cat1', 'cat2', 'cat3', 'asgA', 'asgB'].forEach(mkChannel);
store.setChannel({ channelId: 'cat1', guildId: 'g', type: 'category', name: 'dash' });
store.setChannel({ channelId: 'cat2', guildId: 'g', type: 'category', name: 'pay' });
store.setChannel({ channelId: 'cat3', guildId: 'g', type: 'category', name: 'bugs' });
store.setChannel({ channelId: 'asgA', guildId: 'g', type: 'assignee', name: 'a', userId: 'A' });
store.setChannel({ channelId: 'asgB', guildId: 'g', type: 'assignee', name: 'b', userId: 'B' });

(async () => {
  // category-origin task created in cat1
  const id = store.insertTask({ guild_id: 'g', origin: 'category', title: 't', description: '- t', author_name: 'x', created_at: 1 });
  const m0 = await channels.get('cat1').send({ embeds: [] });
  store.addTaskMessage(id, 'cat1', m0.id, 'category', true);

  // multiple assignees (one without a channel) + extra categories
  let r = await T.syncMirrors(client, id, { assignees: ['A', 'B', 'C'], categories: ['cat2', 'cat3'] });
  assert.deepEqual(r.missing, ['C']);
  let t = store.getTask(id);
  assert.deepEqual(t.messages.map((m) => m.channel_id).sort(), ['asgA', 'asgB', 'cat1', 'cat2', 'cat3']);
  assert.deepEqual(t.assignees.sort(), ['A', 'B', 'C']);
  assert.deepEqual(t.categories.sort(), ['cat1', 'cat2', 'cat3']);

  // status change via refresh reaches every copy
  store.updateTask(id, { status: 'done' });
  await T.refresh(client, id);
  for (const m of t.messages) assert.equal(channels.get(m.channel_id).msgs.get(m.message_id).embeds[0].data.color, 0x2ecc71);

  // remove B and cat3 -> their copies are deleted, origin stays
  await T.syncMirrors(client, id, { assignees: ['A'], categories: ['cat2'] });
  t = store.getTask(id);
  assert.deepEqual(t.messages.map((m) => m.channel_id).sort(), ['asgA', 'cat1', 'cat2']);
  assert.equal(channels.get('asgB').msgs.size, 0);
  assert.equal(channels.get('cat3').msgs.size, 0);

  // pin goes to assignee channel(s) only
  store.updateTask(id, { important: 1 });
  await T.syncPin(client, id);
  const pinned = t.messages.filter((m) => channels.get(m.channel_id).msgs.get(m.message_id).pinned).map((m) => m.channel_id);
  assert.deepEqual(pinned, ['asgA']);

  // lookup by any copy + channel listing
  assert.equal(store.findTaskByMessage(t.messages[1].message_id).id, id);
  store.updateTask(id, { status: 'doing' });
  assert.equal(store.tasksInChannel('cat2').length, 1);

  // assignee-origin task gets categories
  const id2 = store.insertTask({ guild_id: 'g', origin: 'assignee', title: 'u', author_name: 'x', created_at: 1 });
  const m1 = await channels.get('asgB').send({ embeds: [] });
  store.addTaskMessage(id2, 'asgB', m1.id, 'assignee', true);
  await T.syncMirrors(client, id2, { categories: ['cat1', 'cat2'] });
  t = store.getTask(id2);
  assert.deepEqual(t.assignees, ['B']);
  assert.deepEqual(t.messages.map((m) => m.channel_id).sort(), ['asgB', 'cat1', 'cat2']);

  // delete removes all copies + rows
  await T.deleteTask(client, id);
  assert.equal(store.getTask(id), null);
  assert.equal(store.db.prepare('SELECT COUNT(*) c FROM task_messages WHERE task_id = ?').get(id).c, 0);
  assert.equal(channels.get('asgA').msgs.size, 0);

  console.log('sync ok');
})().catch((e) => { console.error(e); process.exit(1); }).finally(() => {
  try { store.db.close(); for (const s of ['', '-wal', '-shm']) require('fs').rmSync(process.env.DB_PATH + s, { force: true }); } catch {}
});
