const TwitchJS = require('twitch-js');
var request = require('request');

var options = {
	options: {
		debug: false
	},
	connection: {
		cluster: 'aws',
		reconnect: true,
		secure: true
	},
	identity:{
		username: 'WikiBot',
		password: process.env.oauth
	}
}

var bot = new TwitchJS.client(options);

var trysettings = 0;
var botsettings = {};

function getSettings() {
	request( {
		uri: process.env.read + process.env.file + process.env.access,
		json: true
	}, function( error, response, body ) {
		if ( error || !response || !body || body.error ) {
			console.log( trysettings + '. Fehler beim Erhalten der Einstellungen' + ( error ? ': ' + error.message : ( body ? ( body.error ? ': ' + body.error : '.' ) : '.' ) ) );
			if ( trysettings < 10 ) {
				trysettings++;
				getSettings();
			}
		}
		else {
			console.log( 'Einstellungen erfolgreich ausgelesen.' );
			botsettings = Object.assign({}, body);
			for (var channel in botsettings) {
				bot.join(channel).catch( error => console.log( channel + ': ' + error ) );
			}
		}
	} );
}

bot.on('connected', function(address, port) {
	console.log( 'Erfolgreich angemeldet!' );
	getSettings();
});

var cmds = {
	setwiki: bot_setwiki,
	eval: bot_eval,
	join: bot_join,
	leave: bot_leave
}

function bot_setwiki(channel, userstate, msg, args, wiki) {
	if ( args[0] && ( userstate.mod || userstate['user-id'] == userstate['room-id'] || userstate['user-id'] == process.env.owner ) ) {
		var regex = /^(?:(?:https?:)?\/\/)?([a-z\d-]{1,30})/
		if ( regex.test(args[0].toLowerCase()) ) {
			var wikinew = regex.exec(args[0].toLowerCase())[1];
			if ( wiki == wikinew ) {
				bot.say( channel, '@' + userstate['display-name'] + ', the default wiki is already set to: https://' + wiki + '.gamepedia.com/' );
			}
			else {
				var temp_settings = Object.assign({}, botsettings);
				temp_settings[channel] = wikinew;
				request.post( {
					uri: process.env.save + process.env.access,
					body: {
						branch: 'master',
						commit_message: 'WikiBot: Einstellungen aktualisiert.',
						actions: [
							{
								action: 'update',
								file_path: process.env.file,
								content: JSON.stringify( temp_settings, null, '\t' )
							}
						]
					},
					json: true
				}, function( error, response, body ) {
					if ( error || !response || response.statusCode != 201 || !body || body.error ) {
						console.log( 'Fehler beim Bearbeiten' + ( error ? ': ' + error.message : ( body ? ( body.message ? ': ' + body.message : ( body.error ? ': ' + body.error : '.' ) ) : '.' ) ) );
						bot.say( channel, '@' + userstate['display-name'] + ', I couldn\'t change the default wiki :(' );
					}
					else {
						botsettings = Object.assign({}, temp_settings);
						console.log( 'Einstellungen erfolgreich aktualisiert.' );
						bot.say( channel, '@' + userstate['display-name'] + ', I changed the default wiki to: https://' + botsettings[channel] + '.gamepedia.com/' );
					}
				} );
			}
		}
		else {
			bot_link(channel, msg, msg.split(' ').slice(1).join(' '), wiki);
		}
	}
	else {
		bot_link(channel, msg, msg.split(' ').slice(1).join(' '), wiki);
	}
}

function bot_eval(channel, userstate, msg, args, wiki) {
	if ( userstate['user-id'] == process.env.owner && args.length ) {
		try {
			var text = eval( args.join(' ') );
		} catch ( error ) {
			var text = error.name + ': ' + error.message;
		}
		console.log( text );
		bot.say( channel, 'timewaGGKit ' + text ).catch( err => bot.say( channel, err.name + ': ' + err.message ) );
	} else {
		bot_link(channel, msg, msg.split(' ').slice(1).join(' '), wiki);
	}
}

function bot_join(channel, userstate, msg, args, wiki) {
	if ( args[0] && args[0].toLowerCase() == '@' + userstate.username ) {
		if ( '#' + userstate.username in botsettings ) {
			bot.say( channel, 'I already joined your stream @' + userstate['display-name'] );
		}
		else {
			var temp_settings = Object.assign({}, botsettings);
			temp_settings['#' + userstate.username] = wiki;
			request.post( {
				uri: process.env.save + process.env.access,
				body: {
					branch: 'master',
					commit_message: 'WikiBot: Einstellungen hinzugefügt.',
					actions: [
						{
							action: 'update',
							file_path: process.env.file,
							content: JSON.stringify( temp_settings, null, '\t' )
						}
					]
				},
				json: true
			}, function( error, response, body ) {
				if ( error || !response || response.statusCode != 201 || !body || body.error ) {
					console.log( 'Fehler beim Bearbeiten' + ( error ? ': ' + error.message : ( body ? ( body.message ? ': ' + body.message : ( body.error ? ': ' + body.error : '.' ) ) : '.' ) ) );
					bot.say( channel, 'I couldn\'t join your stream @' + userstate['display-name'] + ' :(' );
				}
				else {
					botsettings = Object.assign({}, temp_settings);
					console.log( 'Ich wurde zu einem Stream hinzugefügt.' );
					bot.join('#' + userstate.username);
					bot.say( channel, 'I joined your stream @' + userstate['display-name'] );
				}
			} );
		}
	} else {
		bot_link(channel, msg, msg.split(' ').slice(1).join(' '), wiki);
	}
}

function bot_leave(channel, userstate, msg, args, wiki) {
	if ( userstate['user-id'] == userstate['room-id'] && args[0] && args[0].toLowerCase() == '@' + userstate.username ) {
		var temp_settings = Object.assign({}, botsettings);
		delete temp_settings['#' + userstate.username];
		request.post( {
			uri: process.env.save + process.env.access,
			body: {
				branch: 'master',
				commit_message: 'WikiBot: Einstellungen entfernt.',
				actions: [
					{
						action: 'update',
						file_path: process.env.file,
						content: JSON.stringify( temp_settings, null, '\t' )
					}
				]
			},
			json: true
		}, function( error, response, body ) {
			if ( error || !response || response.statusCode != 201 || !body || body.error ) {
				console.log( 'Fehler beim Bearbeiten' + ( error ? ': ' + error.message : ( body ? ( body.message ? ': ' + body.message : ( body.error ? ': ' + body.error : '.' ) ) : '.' ) ) );
				bot.say( channel, 'I couldn\'t leave your stream @' + userstate['display-name'] + ' :(' );
			}
			else {
				botsettings = Object.assign({}, temp_settings);
				bot.say( channel, 'I will leave your stream now @' + userstate['display-name'] );
				console.log( 'Ich wurde von einem Stream entfernt.' );
				bot.part('#' + userstate.username);
			}
		} );
	} else {
		bot_link(channel, msg, msg.split(' ').slice(1).join(' '), wiki);
	}
}

function bot_link(channel, msg, title, wiki) {
	var kit = ( channel == '#timewanderer33' ? 'timewaGGKit ' : '' );
	request( {
		uri: 'https://' + wiki + '.gamepedia.com/api.php?action=query&format=json&meta=siteinfo&siprop=general&iwurl=true&redirects=true&titles=' + encodeURI( title ),
		json: true
	}, function( error, response, body ) {
		if ( error || !response || !body || !body.query ) {
			console.log( 'Fehler beim Erhalten der Suchergebnisse' + ( error ? ': ' + error.message : ( body ? ( body.error ? ': ' + body.error.info : '.' ) : '.' ) ) );
			if ( response && response.request && response.request.uri && response.request.uri.href == 'https://www.gamepedia.com/' ) bot.say( channel, 'This wiki does not exist!' );
			else bot.say( channel, kit + 'I got an error while searching: https://' + wiki + '.gamepedia.com/Special:Search/' + title.toTitle() );
		}
		else {
			if ( body.query.pages ) {
				if ( body.query.pages['-1'] && ( ( body.query.pages['-1'].missing != undefined && body.query.pages['-1'].known == undefined ) || body.query.pages['-1'].invalid != undefined ) ) {
					request( {
						uri: 'https://' + wiki + '.gamepedia.com/api.php?action=query&format=json&list=search&srnamespace=0|4|12|14|10000|10002|10004|10006|10008|10010&srsearch=' + encodeURI( title ) + '&srlimit=1',
						json: true
					}, function( srerror, srresponse, srbody ) {
						if ( srerror || !srresponse || !srbody || !srbody.query || ( !srbody.query.search[0] && srbody.query.searchinfo.totalhits != 0 ) ) {
							console.log( 'Fehler beim Erhalten der Suchergebnisse' + ( srerror ? ': ' + srerror.message : ( srbody ? ( srbody.error ? ': ' + srbody.error.info : '.' ) : '.' ) ) );
							bot.say( channel, kit + 'I got an error while searching: https://' + wiki + '.gamepedia.com/Special:Search/' + title.toTitle() );
						}
						else {
							if ( srbody.query.searchinfo.totalhits == 0 ) {
								bot.say( channel, kit + 'I couldn\'t find a result for "' + title + '" on this wiki :( https://' + wiki + '.gamepedia.com/' );
							}
							else if ( title.toTitle().toLowerCase() == srbody.query.search[0].title.toTitle().toLowerCase() ) {
								bot.say( channel, 'https://' + wiki + '.gamepedia.com/' + srbody.query.search[0].title.toTitle() );
							}
							else if ( srbody.query.searchinfo.totalhits == 1 ) {
								bot.say( channel, kit + 'I found only this: https://' + wiki + '.gamepedia.com/' + srbody.query.search[0].title.toTitle() );
							}
							else {
								bot.say( channel, kit + 'I found this for you: https://' + wiki + '.gamepedia.com/' + srbody.query.search[0].title.toTitle() );
							}
						}
					} );
				}
				else {
					bot.say( channel, kit + 'https://' + wiki + '.gamepedia.com/' + Object.values(body.query.pages)[0].title.toTitle() + ( body.query.redirects && body.query.redirects[0].tofragment ? '#' + body.query.redirects[0].tofragment.toSection() : '' ) );
				}
			}
			else if ( body.query.interwiki ) {
				var inter = body.query.interwiki[0];
				var intertitle = inter.title.substr(inter.iw.length+1);
				var regex = /^(?:https?:)?\/\/(.*)\.gamepedia\.com\//.exec(inter.url);
				if ( regex != null ) {
					var iwtitle = decodeURIComponent( inter.url.replace( regex[0], '' ) ).replace( /\_/g, ' ' ).replace( intertitle.replace( /\_/g, ' ' ), intertitle );
					bot_link(channel, msg, iwtitle, regex[1]);
				} else bot.say( channel, kit + inter.url );
			}
			else {
				bot.say( channel, kit + 'https://' + wiki + '.gamepedia.com/' + body.query.general.mainpage.toTitle() );
			}
		}
	} );
}

String.prototype.toTitle = function() {
	return this.replace( / /g, '_' ).replace( /\%/g, '%25' ).replace( /\'/g, '%27' ).replace( /\!/g, '%21' ).replace( /\?/g, '%3F' );
};

String.prototype.toSection = function() {
	return encodeURIComponent( this.replace( / /g, '_' ) ).replace( /\'/g, '%27' ).replace( /\(/g, '%28' ).replace( /\)/g, '%29' ).replace( /\%/g, '.' );
};

bot.on( 'chat', function(channel, userstate, msg, self) {
	// Don't listen to my own messages..
	if ( self ) return;

	// Do your stuff.
	if ( msg.toLowerCase().startsWith( process.env.prefix + ' ' ) || msg.toLowerCase() == process.env.prefix ) {
		console.log( channel + ': ' + msg );
		var wiki = botsettings[channel];
		var args = msg.split(' ').slice(1);
		if ( args[0] ) {
			var invoke = args[0].toLowerCase()
			if ( invoke in cmds ) cmds[invoke](channel, userstate, msg, args.slice(1), wiki);
			else if ( invoke.startsWith('!') ) bot_link(channel, msg, args.slice(1).join(' '), invoke.substr(1));
			else bot_link(channel, msg, args.join(' '), wiki);
		}
		else {
			bot_link(channel, msg, args.join(' '), wiki);
		}
	}
} );

bot.connect();
