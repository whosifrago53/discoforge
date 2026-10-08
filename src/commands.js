const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } = require('discord.js');
const store = require('./db');
const info = require('./info');
const help = require('./help');

const manage = PermissionFlagsBits.ManageChannels;
const credentialsCmd = (name) => new SlashCommandBuilder().setName(name)
  .setDescription('Mark this channel as the credentials channel (auto-formats credentials)')
  .setDefaultMemberPermissions(manage).setDMPermission(false);

const definitions = [
  new SlashCommandBuilder().setName('set_category')
    .setDescription('Mark this channel as a task category (module of the project)')
    .addStringOption((o) => o.setName('name').setDescription('Display name (defaults to the channel name)').setMaxLength(60))
    .setDefaultMemberPermissions(manage).setDMPermission(false),
  new SlashCommandBuilder().setName('set_assignee')
    .setDescription('Mark this channel as the task channel of a specific user')
    .addUserOption((o) => o.setName('user').setDescription('User this channel belongs to').setRequired(true))
    .setDefaultMemberPermissions(manage).setDMPermission(false),
  credentialsCmd('credentials_channel'),
  credentialsCmd('credientals_channel'),
  new SlashCommandBuilder().setName('unset_channel')
    .setDescription('Remove category/assignee/credentials marking from this channel')
    .setDefaultMemberPermissions(manage).setDMPermission(false),
  new SlashCommandBuilder().setName('category_info')
    .setDescription('Show open tasks, priorities, bugs and links for a category/assignee channel')
    .addChannelOption((o) => o.setName('channel').setDescription('Channel to inspect (defaults to current)')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.PrivateThread))
    .setDMPermission(false),
  new SlashCommandBuilder().setName('help').setDescription('How to use DiscoForge'),
].map((c) => c.toJSON());

const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral });

function mark(type, label) {
  return async (i) => {
    const ch = i.channel;
    if (!ch?.isTextBased() || ch.isDMBased()) return i.reply(ephemeral('Use this in a server text channel.'));
    const user = type === 'assignee' ? i.options.getUser('user', true) : null;
    const name = i.options.getString?.('name') || ch.name;
    const before = store.getChannel(ch.id);
    store.setChannel({ channelId: ch.id, guildId: i.guildId, type, name, userId: user?.id });
    const replaced = before && before.type !== type ? ` (was **${before.type}**)` : '';
    return i.reply({
      content: `✅ <#${ch.id}> is now ${label}${user ? ` for <@${user.id}>` : ''}${replaced}.`,
      allowedMentions: { parse: [] },
    });
  };
}

const handlers = {
  set_category: mark('category', 'a **category** channel'),
  set_assignee: mark('assignee', 'an **assignee** channel'),
  credentials_channel: mark('credentials', 'the **credentials** channel'),
  credientals_channel: mark('credentials', 'the **credentials** channel'),
  async unset_channel(i) {
    const ok = store.unsetChannel(i.channelId);
    return i.reply(ephemeral(ok ? '🗑️ Channel unmarked. Existing tasks are kept.' : 'This channel is not marked.'));
  },
  async category_info(i) {
    const target = i.options.getChannel('channel') || i.channel;
    const row = store.getChannel(target.id);
    if (!row || row.type === 'credentials') {
      return i.reply(ephemeral('That channel is not a category/assignee channel. Use `/set_category` or `/set_assignee` first.'));
    }
    return i.reply({ ...info.payload(row), flags: MessageFlags.Ephemeral });
  },
  async help(i) {
    return i.reply({ ...help.payload(0), flags: MessageFlags.Ephemeral });
  },
};

module.exports = { definitions, handlers };
