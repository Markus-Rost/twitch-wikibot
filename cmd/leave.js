const kraken = {
	Accept: 'application/vnd.twitchtv.v5+json',
	'Client-ID': process.env.client,
	Authorization: 'OAuth ' + process.env.oauth
}

function cmd_leave(channel, userstate, msg, args, wiki) {
	if ( userstate['user-id'] === userstate['room-id'] && args.join(' ').toLowerCase().replace( /^@/, '' ) === userstate.username ) {
		db.run( 'DELETE FROM twitch WHERE id = ?', [userstate['room-id']], function (dberror) {
			if ( dberror ) {
				console.log( '- Error while removing the settings: ' + dberror );
				bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', I couldn\'t leave your stream :(' );
				return dberror;
			}
			bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', I will leave your stream now.' );
			console.log( '- I\'ve been removed from a stream.' );
			bot.part(userstate.username);
			
			got.delete( 'https://api.twitch.tv/kraken/users/' + process.env.bot + '/follows/channels/' + userstate['user-id'], {
				headers: kraken,
				responseType: 'json'
			} ).then( response => {
				var body = response.body;
				if ( response.statusCode !== 204 || body ) {
					bot.whisper( process.env.ownername, 'Error while unfollowing ' + userstate['display-name'] );
					console.log( '- ' + response.statusCode + ': Error while unfollowing ' + userstate['display-name'] + ': ' + ( body && ( body.message || body.error ) ) );
				} else console.log( '- I\'m not following ' + userstate['display-name'] + ' anymore.' );
			}, error => {
				bot.whisper( process.env.ownername, 'Error while unfollowing ' + userstate['display-name'] );
				console.log( '- Error while unfollowing ' + userstate['display-name'] + ': ' + error );
			} );
		} );
	} else {
		this.LINK(channel, msg.split(' ').slice(1).join(' '), wiki);
	}
}

module.exports = {
    name: 'leave',
    run: cmd_leave
};