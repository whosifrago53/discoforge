require('dotenv').config();

module.exports = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID || null,
  dbPath: process.env.DB_PATH || './data/discoforge.db',
  // 'webhook' = rich embed cards, 'plain' = lightweight text messages
  taskFormat: (process.env.TASK_FORMAT || 'webhook').trim().toLowerCase() === 'plain' ? 'plain' : 'webhook',
  warningDeleteSeconds: Number(process.env.WARNING_DELETE_SECONDS ?? 30),
};
