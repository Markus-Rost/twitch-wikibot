const fs = require('fs');
const process = JSON.parse(fs.readFileSync('config.json', 'utf8'));

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
		password: process.env.token
	},
	channels: [process.env.channel]
}

var client = new TwitchJS.client(options);

var defaultWiki = process.env.wiki;

client.on('connected', function(address, port) {
	console.log( 'Erfolgreich angemeldet!' );
});

function cmd_link(channel, msg, title, wiki) {
	request( {
		uri: 'https://' + wiki + '.gamepedia.com/api.php?action=query&format=json&meta=siteinfo&siprop=interwikimap&redirects=true&titles=' + encodeURI( title ),
		json: true
	}, function( error, response, body ) {
		if ( error || !response || !body || !body.query ) {
			console.log( 'Fehler beim Erhalten der Suchergebnisse' + ( error ? ': ' + error.message : ( body ? ( body.error ? ': ' + body.error.info : '.' ) : '.' ) ) );
			if ( response && response.request && response.request.uri && response.request.uri.href == 'https://www.gamepedia.com/' ) client.say( channel, 'This wiki does not exist!' );
			else client.say( channel, 'I got an error while searching: https://' + wiki + '.gamepedia.com/' + title.replace( / /g, '_' ) );
		}
		else {
			if ( title == '' ) {
				client.say( channel, 'https://' + wiki + '.gamepedia.com/' );
			}
			else if ( body.query.pages ) {
				if ( body.query.pages['-1'] && body.query.pages['-1'].missing != undefined ) {
					request( {
						uri: 'https://' + wiki + '.gamepedia.com/api.php?action=query&format=json&list=search&srnamespace=0|4|6|10|12|14&srsearch=' + encodeURI( title ) + '&srlimit=1',
						json: true
					}, function( srerror, srresponse, srbody ) {
						if ( srerror || !srresponse || !srbody || !srbody.query || ( !srbody.query.search[0] && srbody.query.searchinfo.totalhits != 0 ) ) {
							console.log( 'Fehler beim Erhalten der Suchergebnisse' + ( srerror ? ': ' + srerror.message : ( srbody ? ( srbody.error ? ': ' + srbody.error.info : '.' ) : '.' ) ) );
							client.say( channel, 'I got an error while searching: https://' + wiki + '.gamepedia.com/' + title.replace( / /g, '_' ) );
						}
						else {
							if ( srbody.query.searchinfo.totalhits == 0 ) {
								cmd_nofound(channel, title, wiki)
							}
							else if ( srbody.query.searchinfo.totalhits == 1 ) {
								client.say( channel, 'I found only this: https://' + wiki + '.gamepedia.com/' + srbody.query.search[0].title.replace( / /g, '_' ) );
							}
							else {
								client.say( channel, 'I found this for you: https://' + wiki + '.gamepedia.com/' + srbody.query.search[0].title.replace( / /g, '_' ) );
							}
						}
					} );
				}
				else {
					client.say( channel, 'https://' + wiki + '.gamepedia.com/' + ( Object.values(body.query.pages)[0].title + ( body.query.redirects && body.query.redirects[0].tofragment ? '#' + encodeURI( body.query.redirects[0].tofragment ) : '' ) ).replace( / /g, '_' ) );
				}
			}
			else if ( body.query.interwiki ) {
				var inter = body.query.interwiki[0];
				var intertitle = inter.title.substr(inter.iw.length+1);
				var regex = /^(?:https?:)?\/\/(.*)\.gamepedia\.com\//
				var entry = body.query.interwikimap;
				for ( var i = 0; i < entry.length; i++ ) {
					if ( entry[i].prefix == inter.iw ) {
						if ( regex.test(entry[i].url) ) {
							var iwtitle = entry[i].url.replace( '$1', intertitle ).replace( regex.exec(entry[i].url)[0], '' );
							var link = regex.exec(entry[i].url)[1];
							cmd_link(channel, msg, iwtitle, link);
						}
						else client.say( channel, entry[i].url.replace( '$1', intertitle.replace( / /g, '_' ) ) );
						break;
					}
				}
			}
			else {
				cmd_nofound(channel, title, wiki);
			}
		}
	} );
}

function cmd_nofound(channel, title, wiki) {
	client.say( channel, 'I couldn\'t find a result for "' + title + '" on this wiki :( https://' + wiki + '.gamepedia.com/' );
}

client.on( 'chat', function(channel, userstate, msg, self) {
	// Don't listen to my own messages..
	if ( self ) return;

	// Do your stuff.
	if ( msg.toLowerCase().startsWith(process.env.prefix) ) {
		console.log( userstate['user-id'] + msg );
		var args = msg.split(' ').slice(1);
		if ( args[0] == 'setwiki' && args[1] && ( userstate.mod || userstate['user-id'] == userstate['room-id'] || userstate['user-id'] == process.env.owner ) ) {
			var regex = /^(?:(?:https?:)?\/\/)?([a-z\d-]{1,30})/
			if ( regex.test(args[1]) ) {
				defaultWiki = regex.exec(args[1])[1];
				client.say( channel, 'I changed the default wiki to: https://' + defaultWiki + '.gamepedia.com/' );
			}
			else {
				cmd_link(channel, msg, args.join(' '), defaultWiki);
			}
		}
		else {
			var wiki = defaultWiki;
			if ( args[0] && args[0].startsWith('!') ) {
				wiki = args[0].substr(1);
				args = args.slice(1);
			}
			cmd_link(channel, msg, args.join(' '), wiki);
		}
	}
} );

client.connect();