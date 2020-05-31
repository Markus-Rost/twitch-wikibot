const kraken = {
	Accept: 'application/vnd.twitchtv.v5+json',
	'Client-ID': process.env.client,
	Authorization: 'OAuth ' + process.env.oauth
}

function cmd_join(channel, userstate, msg, args, wiki) {
	if ( args.join(' ').toLowerCase().replace( /^@/, '' ) === userstate.username ) {
		db.run( 'INSERT INTO twitch(id, name, wiki) VALUES(?, ?, ?)', [userstate['user-id'], userstate.username, wiki], function (dberror) {
			if ( dberror ) {
				if ( dberror.message === 'SQLITE_CONSTRAINT: UNIQUE constraint failed: twitch.id' ) {
					bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', I already joined your stream.' );
				} else {
					console.log( '- Error while adding the settings: ' + dberror );
					bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', I couldn\'t join your stream :(' );
				}
				return dberror;
			}
			console.log( '- I\'ve been added to a stream.' );
			bot.join(userstate.username);
			bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', I joined your stream.' );
			
			module.parent.exports.checkGames([{id:parseInt(userstate['user-id'], 10),game:null}], [userstate.username,userstate['display-name']]);
			
			got.put( 'https://api.twitch.tv/kraken/users/' + process.env.bot + '/follows/channels/' + userstate['user-id'], {
				headers: kraken,
				responseType: 'json'
			} ).then( response => {
				var body = response.body;
				if ( response.statusCode !== 200 || !body || body.error ) {
					bot.whisper( process.env.ownername, 'Error while following ' + userstate['display-name'] );
					console.log( '- ' + response.statusCode + ': Error while following ' + userstate['display-name'] + ': ' + ( body && ( body.message || body.error ) ) );
				} else console.log( '- I\'m now following ' + userstate['display-name'] + '.' );
			}, error => {
				bot.whisper( process.env.ownername, 'Error while following ' + userstate['display-name'] );
				console.log( '- Error while following ' + userstate['display-name'] + ': ' + error );
			} );
		} );
	} else {
		this.LINK(channel, msg.split(' ').slice(1).join(' '), wiki);
	}
}

module.exports = {
    name: 'join',
    run: cmd_join
};