const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');

const PAGES = [
  {
    label: 'Overview', emoji: '🏠',
    title: 'DiscoForge — Overview',
    text:
      'Project-management bot. Turn channels into **task boards** and a **credentials vault**.\n\n' +
      '**Channel types**\n' +
      '• **Category** (`/set_category`) — a macro module (dashboard, payments…)\n' +
      '• **Assignee** (`/set_assignee @user`) — one person\'s task list\n' +
      '• **Credentials** (`/credentials_channel`) — auto-formats shared logins/keys\n\n' +
      'Task/credential channels are **dedicated**: other messages get a polite reminder.\n' +
      'Use the menu below to browse pages.',
  },
  {
    label: 'Creating tasks', emoji: '📝',
    title: 'Creating tasks',
    text:
      'In a category/assignee channel send:\n```\n- Fix user dashboard authentication\n```\n' +
      '• The whole message becomes the task text (its first line is the short name shown in `/category_info`).\n' +
      '• Attach an **image** → shown inside the task. Other **files** are re-attached to it.\n' +
      '• Add `#other-category` mentions to file it under **subcategories** too, and `@user` mentions to **assign** it, e.g. `- Fix login #payments @anna`.\n' +
      '• The bot deletes your message and posts a task card (purple = in progress).\n' +
      '• Anything not starting with `- ` (or file-only posts) is rejected.',
  },
  {
    label: 'Reactions', emoji: '🎛️',
    title: 'Task reactions',
    text:
      '✅ **Done** → green (click again to reopen)\n' +
      '⏳ **Doing** → purple (default)\n' +
      '❌ **Discarded** → grey (click again to reopen)\n' +
      '🗑️ **Delete** → removes the task (every copy) and its database record. No confirmation!\n' +
      '🐛 **Bug** → toggle: orange-red card, *🐛 BUG* header and bug icon\n' +
      '📌 **Important** → toggle: gold card, *⚠️ IMPORTANT TASK* header, and the task is pinned (in the assignee channel(s) if it has any, else the category channel(s))\n' +
      '📝 **Show/hide data** → status, priority, due date, categories and assignees are hidden by default; toggle with 📝 (anyone)\n' +
      'ℹ️ **Details panel** → priority, due date, assignees, categories\n\n' +
      'Reactions work on **any copy** of a task and update all of them. Your reaction is removed once applied, so the buttons stay reusable.',
  },
  {
    label: 'Details panel (ℹ️)', emoji: 'ℹ️',
    title: 'ℹ️ Details panel',
    text:
      '**Priority:** 🔴 CRITICAL · 🟠 HIGH · 🟡 MEDIUM · 🟢 LOW\n' +
      '**Due date:** `YYYY-MM-DD` or `DD/MM/YYYY`. Reopen ℹ️ anytime to **extend/change/clear** it.\n\n' +
      '**Assignees** → pick **one or more** users. The task is copied into each user\'s assignee channel (users without one are saved on the task only).\n' +
      '**Subcategories** → pick **one or more** other category channels. The task is copied into each of them.\n' +
      'The channel the task was created in always keeps its copy. Deselect a user/category to remove its copy.\n\n' +
      'All copies stay in sync: reactions on any of them update all.\n' +
      'The panel is only usable by the person who opened it and auto-closes after 5 min.',
  },
  {
    label: 'Commands', emoji: '⌨️',
    title: 'Commands',
    text:
      '`/set_category [name]` — mark this channel as a category\n' +
      '`/set_assignee user` — mark this channel as a user\'s task list\n' +
      '`/credentials_channel` — mark as credentials channel (alias `/credientals_channel`)\n' +
      '`/unset_channel` — remove any marking from this channel\n' +
      '`/category_info [channel]` — stats + links. Buttons: overview, bugs, imminent, important; selects: by priority / by user. Only **open** tasks are counted.\n' +
      '`/help` — this guide (only visible to you)\n\n' +
      'Setup commands need **Manage Channels**.',
  },
  {
    label: 'Credentials', emoji: '🔑',
    title: 'Credentials channel',
    text:
      '**Login:** website + email/username + password (or an API key)\n```\nhttps://m365.cloud.microsoft/\nuser@mail.com\nmyPassw0rd\n```\n' +
      '**Named keys:** a name, then one key per line, optional description after it\n```\nOpenAI\n123504-b6d4...  Access Token\nAI-123504-9b3f...  AI KEY\n```\n' +
      'The bot deletes your message and reposts it formatted:\n' +
      '> ### Credentials OpenAI\n> \n> **Api Key - Access Token:** 123504-b6d4...\n> **Api Key - AI KEY:** AI-123504-9b3f...\n\n' +
      '• A login needs a **website** + (**email/username + password**) or an **API key**.\n' +
      '• Missing info → you get a reminder.\n' +
      '• Anything else is rejected.',
  },
];

function payload(page = 0) {
  const p = PAGES[page];
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(`${p.emoji} ${p.title}`)
    .setDescription(p.text).setFooter({ text: `Page ${page + 1}/${PAGES.length}` });
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId('help|page').setPlaceholder('Jump to page…').addOptions(
          PAGES.map((x, i) => ({ label: x.label, value: String(i), emoji: x.emoji, default: i === page })),
        ),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`help|go|${page - 1}`).setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
        new ButtonBuilder().setCustomId(`help|go|${page + 1}`).setLabel('Next ▶').setStyle(ButtonStyle.Primary).setDisabled(page === PAGES.length - 1),
      ),
    ],
  };
}

function handleHelp(i) {
  const [, kind, n] = i.customId.split('|');
  const page = kind === 'page' ? Number(i.values[0]) : Number(n);
  return i.update(payload(Math.min(Math.max(page, 0), PAGES.length - 1)));
}

module.exports = { payload, handleHelp };
