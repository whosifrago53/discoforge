// ℹ️ task settings panel: priority, due date, assignees, categories.
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, UserSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags,
} = require('discord.js');
const store = require('./db');
const T = require('./tasks');

const PANEL_TTL_MS = 5 * 60 * 1000;

function panelPayload(t, ownerId, note = '') {
  const id = (a) => `ti|${a}|${t.id}|${ownerId}`;
  const rows = [];
  const origin = t.messages.find((m) => m.is_origin);
  const originCat = origin?.kind === 'category' ? origin.channel_id : null;

  rows.push(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(id('prio'))
      .setPlaceholder(t.priority ? `Priority: ${T.PRIORITIES[t.priority].label}` : 'Set priority')
      .addOptions(
        ...Object.entries(T.PRIORITIES).map(([value, p]) => ({ label: p.label, value, emoji: p.emoji })),
        { label: 'No priority', value: 'none', emoji: '⚪' },
      ),
  ));

  const users = new UserSelectMenuBuilder().setCustomId(id('asg')).setPlaceholder('Assignees (one or more)…')
    .setMinValues(0).setMaxValues(25);
  if (t.assignees.length) users.setDefaultUsers(t.assignees.slice(0, 25));
  rows.push(new ActionRowBuilder().addComponents(users));

  const cats = store.listChannels(t.guild_id, 'category').filter((c) => c.channel_id !== originCat).slice(0, 25);
  if (cats.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(id('cat'))
        .setPlaceholder(originCat ? 'Subcategories (also show in…)' : 'Categories (one or more)…')
        .setMinValues(0).setMaxValues(cats.length)
        .addOptions(cats.map((c) => ({
          label: `#${c.name}`.slice(0, 100), value: c.channel_id, default: t.categories.includes(c.channel_id),
        }))),
    ));
  } else if (!originCat) {
    note += '\n⚠️ No category channels yet. Use `/set_category` in a channel first.';
  }

  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(id('duebtn')).setLabel(t.due_date ? 'Change due date' : 'Set due date')
      .setEmoji('📅').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(id('cleardue')).setLabel('Clear due').setStyle(ButtonStyle.Secondary)
      .setDisabled(!t.due_date),
    new ButtonBuilder().setCustomId(id('close')).setLabel('Close').setStyle(ButtonStyle.Danger),
  ));

  const fmt = (arr, f) => (arr.length ? arr.map(f).join(' ') : '—');
  const prio = t.priority ? `${T.PRIORITIES[t.priority].emoji} ${T.PRIORITIES[t.priority].label}` : '—';
  return {
    content: `<@${ownerId}> **Task #${t.id}** — ${T.trunc(t.title, 80)}\n` +
      `Priority: ${prio} · Due: ${t.due_date || '—'}\n` +
      `Assignees: ${fmt(t.assignees, (u) => `<@${u}>`)}\nCategories: ${fmt(t.categories, (c) => `<#${c}>`)}` +
      (note ? `\n${note}` : ''),
    components: rows,
    allowedMentions: { users: [ownerId] },
  };
}

/** Called when someone reacts with ℹ️. */
async function openPanel(channel, task, user) {
  const msg = await channel.send(panelPayload(task, user.id));
  setTimeout(() => msg.delete().catch(() => {}), PANEL_TTL_MS).unref();
}

function parseDate(input) {
  const s = input.trim();
  let y, m, d;
  let r = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (r) [, y, m, d] = r;
  else if ((r = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) [, d, m, y] = r;
  else return null;
  y = +y; m = +m; d = +d;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

async function handlePanel(i) {
  const [, action, taskId, owner] = i.customId.split('|');
  if (i.user.id !== owner) {
    return i.reply({ content: 'This panel belongs to someone else. React with ℹ️ on the task to open your own.', flags: MessageFlags.Ephemeral });
  }
  let t = store.getTask(taskId);
  if (!t) return i.reply({ content: 'Task no longer exists.', flags: MessageFlags.Ephemeral });

  if (action === 'close') return i.message.delete().catch(() => {});

  if (action === 'duebtn') {
    return i.showModal(
      new ModalBuilder().setCustomId(`ti|due|${t.id}|${owner}`).setTitle(`Due date — task #${t.id}`).addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('date').setLabel('Date (YYYY-MM-DD or DD/MM/YYYY)')
            .setStyle(TextInputStyle.Short).setRequired(true).setValue(t.due_date || '').setPlaceholder('2026-12-31'),
        ),
      ),
    );
  }

  let note = '';
  if (action === 'due') {
    const date = parseDate(i.fields.getTextInputValue('date'));
    if (!date) return i.reply({ content: '❌ Invalid date. Use `YYYY-MM-DD` or `DD/MM/YYYY`.', flags: MessageFlags.Ephemeral });
    store.updateTask(t.id, { due_date: date });
  }

  await i.deferUpdate();

  switch (action) {
    case 'prio': store.updateTask(t.id, { priority: i.values[0] === 'none' ? null : i.values[0] }); break;
    case 'cleardue': store.updateTask(t.id, { due_date: null }); break;
    case 'asg': {
      const { missing } = await T.syncMirrors(i.client, t.id, { assignees: i.values });
      if (missing.length) {
        note = `⚠️ ${missing.map((u) => `<@${u}>`).join(' ')} ${missing.length > 1 ? 'have' : 'has'} no assignee channel ` +
          '(`/set_assignee`). Saved on the task only.';
      }
      await T.syncPin(i.client, t.id);
      break;
    }
    case 'cat':
      await T.syncMirrors(i.client, t.id, { categories: i.values });
      await T.syncPin(i.client, t.id);
      break;
  }

  await T.refresh(i.client, t.id);
  t = store.getTask(t.id);
  await i.editReply(panelPayload(t, owner, note));
}

module.exports = { openPanel, handlePanel, parseDate };
