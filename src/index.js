const { Client, GatewayIntentBits, Partials, MessageFlags, MessageType } = require('discord.js');
const config = require('./config');
const store = require('./db');
const T = require('./tasks');
const panel = require('./panel');
const info = require('./info');
const help = require('./help');
const { handlers } = require('./commands');
const { parseCredentials } = require('./credentials');

if (!config.token || !config.clientId) {
  console.error('Missing DISCORD_TOKEN / CLIENT_ID. Copy .env.example to .env and fill it.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent, // privileged: enable in the Developer Portal
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

const MSG = {
  tasks: 'This channel is exclusively for assigning tasks. Please use the appropriate channels for other requests.\n' +
    'Format: `- Fix user dashboard authentication`',
  creds: 'This channel is exclusively for providing credentials. Please use the appropriate channels for other requests.',
  missing: 'It looks like you\'re trying to send some credentials, but some required information is missing.\n' +
    'Provide a **website** plus either **email/username + password** or an **API key**.',
};

async function warn(message, text) {
  const reply = await message.reply({ content: text, allowedMentions: { repliedUser: false } }).catch(() => null);
  if (reply && config.warningDeleteSeconds > 0) setTimeout(() => reply.delete().catch(() => {}), config.warningDeleteSeconds * 1000).unref();
}

const TASK_RE = /^\s*-\s+(\S[\s\S]*)$/;

async function onTaskChannel(message, row) {
  const m = message.content.match(TASK_RE);
  if (!m) return warn(message, MSG.tasks);
  const title = m[1].trim().split(/\r?\n/)[0].trim().slice(0, 200); // short label for /category_info
  try {
    const content = message.content;
    const task = await T.createTask(client, message, row, { title, description: content.trim() });
    // #category-channel mentions = subcategories, @user mentions = assignees
    const cats = [...content.matchAll(/<#(\d+)>/g)].map((x) => x[1])
      .filter((id) => id !== message.channelId && store.getChannel(id)?.type === 'category');
    const users = [...content.matchAll(/<@!?(\d+)>/g)].map((x) => x[1]);
    if (cats.length || users.length) {
      await T.syncMirrors(client, task.id, { categories: [...new Set(cats)], assignees: [...new Set(users)] });
      await T.syncPin(client, task.id);
    }
  } catch (err) {
    console.error('createTask failed:', err);
    await warn(message, `❌ Could not create the task: ${err.message}`);
  }
}

async function onCredentialsChannel(message) {
  const res = parseCredentials(message.content);
  if (res.status === 'none') return warn(message, MSG.creds);
  if (res.status === 'incomplete') return warn(message, MSG.missing);
  await message.channel.send({ content: res.text, allowedMentions: { parse: [] } });
  await message.delete().catch(() => {});
}

client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot || !message.guild) return;
    if (message.type !== MessageType.Default && message.type !== MessageType.Reply) return;
    const row = store.getChannel(message.channelId);
    if (!row) return;
    if (row.type === 'credentials') await onCredentialsChannel(message);
    else await onTaskChannel(message, row);
  } catch (err) {
    console.error('messageCreate error:', err);
  }
});

async function onReaction(reaction, user) {
  if (user.bot) return;
  if (reaction.partial) await reaction.fetch().catch(() => {});
  const message = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
  if (!message || message.author?.id !== client.user.id) return;
  const task = store.findTaskByMessage(message.id);
  if (!task) return;

  const key = T.normEmoji(reaction.emoji.name);
  if (!T.REACTIONS.map(T.normEmoji).includes(key)) {
    await reaction.users.remove(user.id).catch(() => {});
    return;
  }
  await reaction.users.remove(user.id).catch(() => {}); // keep the bot's reaction as a reusable "button"

  const t = task;
  const toggle = (status) => (t.status === status ? 'doing' : status);
  switch (key) {
    case '✅': store.updateTask(t.id, { status: toggle('done') }); break;
    case '❌': store.updateTask(t.id, { status: toggle('discarded') }); break;
    case '⏳': store.updateTask(t.id, { status: 'doing' }); break;
    case '📝': store.updateTask(t.id, { details_open: t.details_open ? 0 : 1 }); break;
    case '🐛': store.updateTask(t.id, { bug: t.bug ? 0 : 1 }); break;
    case '📌': store.updateTask(t.id, { important: t.important ? 0 : 1 }); break;
    case 'ℹ': return panel.openPanel(message.channel, t, user);
    case '🗑': return T.deleteTask(client, t.id);
  }
  await T.refresh(client, t.id);
  if (key === '📌') await T.syncPin(client, t.id);
}

client.on('messageReactionAdd', (reaction, user) =>
  onReaction(reaction, user).catch((err) => console.error('reaction error:', err)));

client.on('interactionCreate', async (i) => {
  try {
    if (i.isChatInputCommand()) return await handlers[i.commandName]?.(i);
    if (i.isMessageComponent() || i.isModalSubmit()) {
      const ns = i.customId.split('|')[0];
      if (ns === 'ti') return await panel.handlePanel(i);
      if (ns === 'ci') return await info.handleInfo(i);
      if (ns === 'help') return await help.handleHelp(i);
    }
  } catch (err) {
    console.error('interaction error:', err);
    const body = { content: '❌ Something went wrong.', flags: MessageFlags.Ephemeral };
    if (i.deferred || i.replied) await i.followUp(body).catch(() => {});
    else await i.reply(body).catch(() => {});
  }
});

client.once('clientReady', () => console.log(`DiscoForge online as ${client.user.tag}`));
client.login(config.token);
