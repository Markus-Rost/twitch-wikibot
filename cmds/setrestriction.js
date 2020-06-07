const restrictions = {
    'everyone': 'everyone',
    'default': 'everyone',
    'normal': 'everyone',
    'reset': 'everyone',
    'all': 'everyone',
    '*': 'everyone',
    'subscribers': 'subscribers',
    'subscriber': 'subscribers',
    'subs': 'subscribers',
    'sub': 'subscribers',
    'moderators': 'moderators',
    'moderator': 'moderators',
    'mods': 'moderators',
    'mod': 'moderators'
}

function cmd_setrestriction(channel, userstate, msg, args, wiki) {
	if ( userstate.mod || userstate['user-id'] === userstate['room-id'] || userstate['user-id'] === process.env.owner ) {
        var restriction = args.join(' ').toLowerCase();
        if ( !restriction.trim().length ) return db.get( 'SELECT restriction FROM twitch WHERE id = ?', [userstate['room-id']], (dberror, row) => {
            if ( dberror || !row ) {
                console.log( '- Error while getting the restriction: ' + dberror );
                bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', I couldn\'t get the restriction :(' );
                return dberror;
            }
            bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', the restriction is set to ' + row.restriction + '.' );
        } );
		if ( restriction in restrictions ) return db.run( 'UPDATE twitch SET restriction = ? WHERE id = ?', [restrictions[restriction], userstate['room-id']], function (dberror) {
			if ( dberror ) {
				console.log( '- Error while editing the settings: ' + dberror );
				bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', I couldn\'t set the restriction :(' );
				return dberror;
			}
			bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', I set the restriction to ' + restrictions[restriction] + '.' );
			console.log( '- Settings successfully updated.' );
		} );
	}
	this.LINK(channel, msg.split(' ').slice(1).join(' '), wiki);
}

module.exports = {
    name: 'setrestriction',
    run: cmd_setrestriction
};