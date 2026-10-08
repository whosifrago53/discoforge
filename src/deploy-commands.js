const { REST, Routes } = require('discord.js');
const config = require('./config');
const { definitions } = require('./commands');

async function deploy() {
  const rest = new REST().setToken(config.token);
  const route = config.guildId
    ? Routes.applicationGuildCommands(config.clientId, config.guildId)
    : Routes.applicationCommands(config.clientId);
  await rest.put(route, { body: definitions });
  console.log(`Registered ${definitions.length} commands ${config.guildId ? `to guild ${config.guildId}` : 'globally'}.`);
}

if (require.main === module) deploy().catch((e) => { console.error(e); process.exit(1); });
module.exports = { deploy };
