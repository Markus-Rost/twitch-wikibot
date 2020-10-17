function cmd_help(channel, userstate, msg, args, wiki) {
	if ( !args.length ) {
		bot.say( channel, 'gamepediaWIKIBOT WikiBot is a Twitch chat bot with the purpose to easily link to Gamepedia and Fandom wikis, for a list of all chat commands see the Twitch page: https://www.twitch.tv/WikiBot/about' );
	} else {
		this.LINK(channel, msg.split(' ').slice(1).join(' '), wiki);
	}
}

module.exports = {
    name: 'help',
    run: cmd_help
};