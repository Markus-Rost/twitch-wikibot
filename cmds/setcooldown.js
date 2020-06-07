function cmd_setcooldown(channel, userstate, msg, args, wiki) {
	if ( /^(|\d+)$/.test(args.join(' ')) && ( userstate.mod || userstate['user-id'] === userstate['room-id'] || userstate['user-id'] === process.env.owner ) ) {
		if ( args.join(' ').length ) db.run( 'UPDATE twitch SET cooldown = ? WHERE id = ?', [args[0] + '000', userstate['room-id']], function (dberror) {
			if ( dberror ) {
				console.log( '- Error while editing the settings: ' + dberror );
				bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', I couldn\'t set the cooldown :(' );
				return dberror;
			}
			bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', I set the cooldown to ' + args[0] + ' seconds.' );
			console.log( '- Settings successfully updated.' );
		} );
		else db.get( 'SELECT cooldown FROM twitch WHERE id = ?', [userstate['room-id']], (dberror, row) => {
			if ( dberror || !row ) {
				console.log( '- Error while getting the cooldown: ' + dberror );
				bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', I couldn\'t get the cooldown :(' );
				return dberror;
			}
			bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', the cooldown is set to ' + ( row.cooldown / 1000 ) + ' seconds.' );
		} );
	} else {
		this.LINK(channel, msg.split(' ').slice(1).join(' '), wiki);
	}
}

module.exports = {
    name: 'setcooldown',
    run: cmd_setcooldown
};