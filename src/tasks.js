const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const store = require('./db');

const COLORS = { doing: 0x9b59b6, done: 0x2ecc71, discarded: 0x646261, important: 0xe4bc1b, bug: 0xe4431b };
const BUG_THUMB = 'https://cdn3d.iconscout.com/3d/premium/thumb/bug-3d-icon-png-download-4037826.png';
const STATUS_LABEL = { doing: '⏳ In progress', done: '✅ Done', discarded: '❌ Discarded' };
const PRIORITIES = {
  critical: { emoji: '🔴', label: 'CRITICAL', rank: 0 },
  high: { emoji: '🟠', label: 'HIGH', rank: 1 },
  medium: { emoji: '🟡', label: 'MEDIUM', rank: 2 },
  low: { emoji: '🟢', label: 'LOW', rank: 3 },
};
const REACTIONS = ['✅', '⏳', '❌', '🗑️', '🐛', '📌', '📝', 'ℹ️'];
const normEmoji = (e) => (e || '').replace(/️/g, '');

const trunc = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');
const todayIso = () => new Date().toISOString().slice(0, 10);
const dueTs = (iso) => Math.floor(Date.parse(`${iso}T12:00:00Z`) / 1000);
const isOverdue = (t) => t.status === 'doing' && t.due_date && t.due_date < todayIso();

function dueText(t) {
  if (!t.due_date) return '—';
  const ts = dueTs(t.due_date);
  return `<t:${ts}:D> (<t:${ts}:R>)${isOverdue(t) ? ' ⚠️ overdue' : ''}`;
}

function buildEmbed(t) {
  const prio = t.priority ? `${PRIORITIES[t.priority].emoji} ${PRIORITIES[t.priority].label}` : '-';
  // discarded/done always win; while in progress: important > bug > default
  const color = t.status !== 'doing' ? COLORS[t.status] : t.important ? COLORS.important : t.bug ? COLORS.bug : COLORS.doing;
  const list = (items, fmt) => (items?.length ? items.map(fmt).join(' ') : '-');
  const embed = new EmbedBuilder()
    .setColor(color)
    .setDescription(trunc(t.description || t.title, 4000))
    .setFooter({
      text: `⬅️ assigned by: ${t.author_name || 'Unknown'} | Task #${t.id}`,
      iconURL: t.author_avatar || undefined,
    })
    .setTimestamp(t.created_at);
  if (t.details_open) {
    embed.addFields(
      {
        name: '[Data]',
        value: `**Status:** ${STATUS_LABEL[t.status]}
**Priority:** ${prio}
**Due date:** ${t.due_date ? dueText(t) : '-'}`,
        inline: true,
      },
      {
        name: '[Details]',
        value: `**Category:** ${list(t.categories, (c) => `<#${c}>`)}
**Assigned to:** ${list(t.assignees, (u) => `<@${u}>`)}`,
        inline: true,
      },
    );
  }
  const tags = [t.important && '⚠️ IMPORTANT TASK', t.bug && '🐛 BUG'].filter(Boolean);
  if (tags.length) embed.setAuthor({ name: tags.join(' | ') });
  if (t.bug) embed.setThumbnail(BUG_THUMB);
  if (t.image_name) embed.setImage(`attachment://${t.image_name}`);
  return embed;
}

async function fetchMsg(client, channelId, messageId) {
  if (!channelId || !messageId) return null;
  const ch = await client.channels.fetch(channelId).catch(() => null);
  return ch?.messages?.fetch(messageId).catch(() => null) ?? null;
}

const safeName = (n, i) => `${i}-${n.replace(/[^\w.-]/g, '_')}`.slice(0, 100);

/** Download every attachment of a message so it can be re-uploaded (original CDN links die on delete). */
async function downloadFiles(message, rename = true) {
  const files = [];
  let imageName = null;
  let i = 0;
  for (const att of message.attachments.values()) {
    const res = await fetch(att.url);
    if (!res.ok) throw new Error(`Could not download ${att.name} (${res.status})`);
    const name = !rename ? att.name
      : message.attachments.size > 1 ? safeName(att.name, i++) : att.name.replace(/[^\w.-]/g, '_');
    files.push(new AttachmentBuilder(Buffer.from(await res.arrayBuffer()), { name }));
    if (!imageName && att.contentType?.startsWith('image/')) imageName = name;
  }
  return { files, imageName };
}

async function addReactions(msg) {
  for (const r of REACTIONS) await msg.react(r).catch(() => {});
}

async function postTask(channel, task, files) {
  const msg = await channel.send({ embeds: [buildEmbed(task)], files });
  addReactions(msg); // fire & forget; ordering preserved internally
  return msg;
}

/** Create a task from a validated user message. Throws before touching anything if files can't be fetched. */
async function createTask(client, message, channelRow, { title, description }) {
  const { files, imageName } = await downloadFiles(message);
  const kind = channelRow.type; // category | assignee
  const task = {
    guild_id: message.guildId,
    origin: kind,
    title,
    description: description || null,
    author_id: message.author.id,
    author_name: message.member?.displayName || message.author.username,
    author_avatar: (message.member || message.author).displayAvatarURL({ size: 64 }),
    image_name: imageName,
    created_at: Date.now(),
  };
  const id = store.insertTask(task);
  try {
    const preview = {
      ...task, id, status: 'doing', bug: 0, important: 0, details_open: 0,
      categories: kind === 'category' ? [message.channelId] : [],
      assignees: kind === 'assignee' ? [channelRow.user_id] : [],
    };
    const msg = await postTask(message.channel, preview, files);
    store.addTaskMessage(id, message.channelId, msg.id, kind, true);
    if (kind === 'assignee') store.setTaskAssignees(id, [channelRow.user_id]);
  } catch (err) {
    store.deleteTaskRow(id);
    throw err;
  }
  await message.delete().catch(() => {});
  return store.getTask(id);
}

async function fetchTaskMsgs(client, t) {
  const out = [];
  for (const m of t.messages) {
    const msg = await fetchMsg(client, m.channel_id, m.message_id);
    if (msg) out.push({ m, msg });
  }
  return out;
}

/** Re-render every message that belongs to the task. */
async function refresh(client, id) {
  const t = store.getTask(id);
  if (!t) return;
  const embed = buildEmbed(t);
  for (const { msg } of await fetchTaskMsgs(client, t)) await msg.edit({ embeds: [embed] }).catch(() => {});
}

/** Pin in the assignee channel(s) when the task has any, otherwise in the category channel(s). */
async function syncPin(client, id) {
  const t = store.getTask(id);
  if (!t) return;
  const hasAssignee = t.messages.some((m) => m.kind === 'assignee');
  const targetKind = hasAssignee ? 'assignee' : 'category';
  for (const { m, msg } of await fetchTaskMsgs(client, t)) {
    if (t.important && m.kind === targetKind) { if (!msg.pinned) await msg.pin().catch(() => {}); }
    else if (msg.pinned) await msg.unpin().catch(() => {});
  }
}

/**
 * Make the set of mirror copies match `want` ({categories?: channelIds, assignees?: userIds};
 * omitted = keep current). The origin copy and its category/user are always kept.
 * @returns {{missing: string[]}} assignees that have no assignee channel yet
 */
async function syncMirrors(client, id, want = {}) {
  const t = store.getTask(id);
  const origin = t.messages.find((m) => m.is_origin);
  if (!origin) return { missing: [] };

  const users = new Set(want.assignees ?? t.assignees);
  const cats = new Set(want.categories ?? t.categories);
  if (origin.kind === 'assignee') { const u = store.getChannel(origin.channel_id)?.user_id; if (u) users.add(u); }
  else cats.add(origin.channel_id);
  store.setTaskAssignees(id, [...users]);

  const wanted = new Map([[origin.channel_id, origin.kind]]);
  for (const c of cats) if (!wanted.has(c)) wanted.set(c, 'category');
  const missing = [];
  for (const u of users) {
    const ch = store.assigneeChannelFor(t.guild_id, u);
    if (!ch) missing.push(u);
    else if (!wanted.has(ch.channel_id)) wanted.set(ch.channel_id, 'assignee');
  }

  for (const m of t.messages) {
    if (m.is_origin || wanted.get(m.channel_id) === m.kind) continue;
    const msg = await fetchMsg(client, m.channel_id, m.message_id);
    await msg?.delete().catch(() => {});
    store.removeTaskMessage(m.message_id);
  }

  const have = new Set(t.messages.map((m) => m.channel_id));
  const toCreate = [...wanted].filter(([ch]) => !have.has(ch));
  if (toCreate.length) {
    const source = await fetchMsg(client, origin.channel_id, origin.message_id);
    const { files } = source ? await downloadFiles(source, false).catch(() => ({ files: [] })) : { files: [] };
    for (const [chId, kind] of toCreate) {
      const channel = await client.channels.fetch(chId).catch(() => null);
      if (!channel) continue;
      const msg = await postTask(channel, store.getTask(id), files).catch(() => null);
      if (msg) store.addTaskMessage(id, chId, msg.id, kind);
    }
  }
  await refresh(client, id);
  return { missing };
}

/** Delete every message of the task and its DB row. */
async function deleteTask(client, id) {
  const t = store.getTask(id);
  if (!t) return;
  for (const { msg } of await fetchTaskMsgs(client, t)) await msg.delete().catch(() => {});
  store.deleteTaskRow(id);
}

module.exports = {
  PRIORITIES, REACTIONS, normEmoji, trunc, dueTs, todayIso, isOverdue, buildEmbed,
  createTask, refresh, syncPin, syncMirrors, deleteTask, fetchMsg,
};
