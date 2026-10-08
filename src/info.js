// /category_info — navigable stats + message-link lists.
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, UserSelectMenuBuilder,
} = require('discord.js');
const store = require('./db');
const T = require('./tasks');

const MAX_LINES = 25;

const openTasks = (row) => store.tasksInChannel(row.channel_id, 'doing');

const rank = (t) => (t.priority ? T.PRIORITIES[t.priority].rank : 9);
const bySoonest = (a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || rank(a) - rank(b) || a.id - b.id;
const byPriority = (a, b) => rank(a) - rank(b) || bySoonest(a, b);
const link = (row, t) => `https://discord.com/channels/${t.guild_id}/${row.channel_id}/${t.msg}`;

function line(row, t) {
  const p = t.priority ? T.PRIORITIES[t.priority].emoji : '⚪';
  const bits = [`${p} [#${t.id} ${T.trunc(t.title, 55)}](${link(row, t)})`];
  if (t.bug) bits.push('🐛');
  if (t.important) bits.push('📌');
  if (t.due_date) bits.push(`${T.isOverdue(t) ? '⚠️ ' : ''}<t:${T.dueTs(t.due_date)}:d>`);
  if (row.type === 'category' && t.assignees.length) bits.push(t.assignees.map((u) => `<@${u}>`).join(''));
  return bits.join(' · ');
}

function list(row, tasks, empty) {
  if (!tasks.length) return empty;
  const shown = tasks.slice(0, MAX_LINES).map((t) => line(row, t)).join('\n');
  return shown + (tasks.length > MAX_LINES ? `\n…and ${tasks.length - MAX_LINES} more` : '');
}

function overview(row, tasks) {
  const count = (fn) => tasks.filter(fn).length;
  const prio = Object.entries(T.PRIORITIES)
    .map(([k, p]) => `${p.emoji} ${count((t) => t.priority === k)}`).join('  ') +
    `  ⚪ ${count((t) => !t.priority)}`;

  const perUser = {};
  for (const t of tasks) for (const u of t.assignees) perUser[u] = (perUser[u] || 0) + 1;
  const users = Object.entries(perUser).sort((a, b) => b[1] - a[1]).slice(0, 15)
    .map(([u, n]) => `<@${u}> **${n}**`).join('\n') || '—';

  const soon = [...tasks].filter((t) => t.due_date).sort(bySoonest).slice(0, 5);
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📊 ${row.type === 'assignee' ? 'Assignee' : 'Category'}: #${row.name}`)
    .setDescription(`**${tasks.length}** open task${tasks.length === 1 ? '' : 's'} (done/discarded not counted)`)
    .addFields(
      { name: 'Priority', value: prio },
      { name: '🐛 Bugs', value: String(count((t) => t.bug)), inline: true },
      { name: '📌 Important', value: String(count((t) => t.important)), inline: true },
      { name: '⚠️ Overdue', value: String(count(T.isOverdue)), inline: true },
    );
  if (row.type === 'category') {
    embed.addFields(
      { name: 'Per user', value: users, inline: true },
      { name: 'Unassigned', value: String(count((t) => !t.assignees.length)), inline: true },
    );
  }
  embed.addFields({ name: '⏰ Most imminent', value: list(row, soon, 'No due dates set.') });
  return embed;
}

function view(row, kind, arg) {
  const tasks = openTasks(row);
  if (kind === 'ov') return overview(row, tasks);

  let title, items, empty;
  if (kind === 'bugs') { title = '🐛 Open bugs'; items = tasks.filter((t) => t.bug).sort(byPriority); empty = 'No open bugs.'; }
  else if (kind === 'imp') { title = '📌 Important'; items = tasks.filter((t) => t.important).sort(byPriority); empty = 'Nothing marked important.'; }
  else if (kind === 'due') { title = '⏰ Most imminent'; items = tasks.filter((t) => t.due_date).sort(bySoonest); empty = 'No due dates set.'; }
  else if (kind === 'prio') {
    const p = T.PRIORITIES[arg];
    title = `${p?.emoji ?? '⚪'} Priority: ${p?.label ?? 'none'}`;
    items = tasks.filter((t) => (t.priority || 'none') === arg).sort(bySoonest);
    empty = 'No tasks with this priority.';
  } else if (kind === 'user') {
    title = 'Tasks for user';
    items = tasks.filter((t) => t.assignees.includes(arg)).sort(byPriority);
    empty = 'No open tasks for this user.';
  }
  const e = new EmbedBuilder().setColor(0x5865f2).setTitle(`${title} — #${row.name}`)
    .setDescription(list(row, items, empty)).setFooter({ text: `${items.length} task(s) · links jump to the task message` });
  if (kind === 'user') e.setTitle(`Tasks for user — #${row.name}`).setAuthor({ name: `User ${arg}` });
  return e;
}

function payload(row, kind = 'ov', arg = '') {
  const id = (a) => `ci|${a}|${row.channel_id}`;
  const btn = (a, label, emoji, active) => new ButtonBuilder().setCustomId(id(a)).setLabel(label).setEmoji(emoji)
    .setStyle(active ? ButtonStyle.Primary : ButtonStyle.Secondary);
  const rows = [
    new ActionRowBuilder().addComponents(
      btn('ov', 'Overview', '📊', kind === 'ov'), btn('bugs', 'Bugs', '🐛', kind === 'bugs'),
      btn('due', 'Imminent', '⏰', kind === 'due'), btn('imp', 'Important', '📌', kind === 'imp'),
    ),
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(id('prio')).setPlaceholder('Filter by priority…').addOptions(
        ...Object.entries(T.PRIORITIES).map(([value, p]) => ({ label: p.label, value, emoji: p.emoji })),
        { label: 'No priority', value: 'none', emoji: '⚪' },
      ),
    ),
  ];
  if (row.type === 'category') {
    rows.push(new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder().setCustomId(id('user')).setPlaceholder('Show tasks for user…'),
    ));
  }
  return { embeds: [view(row, kind, arg)], components: rows, allowedMentions: { parse: [] } };
}

async function handleInfo(i) {
  const [, kind, channelId] = i.customId.split('|');
  const row = store.getChannel(channelId);
  if (!row || row.type === 'credentials') return i.update({ content: 'This channel is no longer tracked.', embeds: [], components: [] });
  const arg = i.isAnySelectMenu() ? i.values[0] : '';
  return i.update(payload(row, kind, arg));
}

module.exports = { payload, handleInfo };
