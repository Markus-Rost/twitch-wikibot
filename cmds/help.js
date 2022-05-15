/**
 * Processes the "help" command.
 * @param {import('twitch-js').PrivateMessages} msg - The chat message.
 * @param {String} text - The command.
 * @param {Wiki} wiki - The wiki for the message.
 */
function cmd_help(msg, text, wiki) {
	if ( text.length ) return this.LINK(msg, msg.message.split(' ').slice(1).join(' ').trim(), wiki);
	client.chat.say( msg.channel, 'gamepediaWIKIBOT WikiBot is a Twitch chat bot with the purpose to easily link to Gamepedia and Fandom wikis, for a list of all chat commands see the Twitch page: https://www.twitch.tv/WikiBot/about' );
}

export default {
	name: 'help',
	run: cmd_help
};