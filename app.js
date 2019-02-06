require('dotenv').config();
const TwitchJS = require('twitch-js');
var request = require('request');

const isDebug = ( process.argv[2] === 'debug' ? true : false );

var options = {
	options: {
		clientId: process.env.client,
		debug: isDebug
	},
	connection: {
		cluster: 'aws',
		reconnect: true,
		secure: true
	},
	identity: {
		username: 'WikiBot',
		password: process.env.oauth
	},
	channels: []
}

var bot = new TwitchJS.client(options);

var trysettings = 0;
var botsettings = {};

function getSettings() {
	request( {
		uri: process.env.read + process.env.file + process.env.raw,
		headers: {
			'PRIVATE-TOKEN': process.env.access
		},
		json: true
	}, function( error, response, body ) {
		if ( error || !response || response.statusCode !== 200 || !body || body.message || body.error ) {
			console.log( '- Fehler beim Erhalten der Einstellungen' + ( error ? ': ' + error : ( body ? ( body.message ? ': ' + body.message : ( body.error ? ': ' + body.error : '.' ) ) : '.' ) ) );
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

var defaultSites = [];
var allSites = defaultSites;
function getAllSites() {
	request( {
		uri: 'https://help.gamepedia.com/api.php?action=allsites&formatversion=2&do=getSiteStats&filter=wikis|wiki_domain,wiki_display_name,wiki_managers,official_wiki,created,ss_good_articles,ss_total_pages,ss_total_edits,ss_active_users&format=json',
		json: true
	}, function( error, response, body ) {
		if ( error || !response || response.statusCode !== 200 || !body || body.status !== 'okay' || !body.data || !body.data.wikis ) {
			console.log( '- Fehler beim Erhalten der Wikis' + ( error ? ': ' + error : ( body ? ( body.error ? ': ' + body.error.info : '.' ) : '.' ) ) );
		}
		else {
			console.log( '- Wikis erfolgreich ausgelesen.' );
			allSites = Object.assign([], body.data.wikis.filter( site => /^[a-z\d-]{1,30}\.gamepedia\.com$/.test(site.wiki_domain) ));
		}
	} );
}

bot.on('connected', function(address, port) {
	console.log( 'Erfolgreich angemeldet!' );
	getSettings();
	getAllSites()
});

var cmds = {
	setwiki: bot_setwiki,
	eval: bot_eval,
	join: bot_join,
	leave: bot_leave
}

function bot_setwiki(channel, userstate, msg, args, wiki) {
	if ( args[0] && ( userstate.mod || userstate['user-id'] === userstate['room-id'] || userstate['user-id'] === process.env.owner ) ) {
		args[0] = args[0].toLowerCase();
		var wikinew = '';
		if ( allSites.some( site => site.wiki_domain === args[0] + '.gamepedia.com' ) ) wikinew = 'https://' + args[0] + '.gamepedia.com/';
		else {
			var regex = args[0].match( /^(?:https?:\/\/)?(([a-z\d\.-]{1,30})\.(?:gamepedia|wikia|fandom)\.com(?:(?!\/wiki\/)\/[a-z-]{1,8})?)/ );
			if ( regex !== null ) wikinew = ( regex[2].includes( '.' ) ? 'http://' : 'https://' ) + regex[1] + '/';
			else if ( /^[a-z\d\.-]{1,30}$/.test( args[0] ) ) wikinew = ( args[0].includes( '.' ) ? 'http://' : 'https://' ) + args[0] + '.wikia.com/';
		}
		if ( wikinew ) {
			if ( wiki === wikinew ) {
				bot.say( channel, '@' + userstate['display-name'] + ', the default wiki is already set to: ' + wiki );
			}
			else {
				var temp_settings = Object.assign({}, botsettings);
				temp_settings[channel] = wikinew;
				request.post( {
					uri: process.env.save,
					headers: {
						'PRIVATE-TOKEN': process.env.access
					},
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
					if ( error || !response || response.statusCode !== 201 || !body || body.error ) {
						console.log( 'Fehler beim Bearbeiten' + ( error ? ': ' + error.message : ( body ? ( body.message ? ': ' + body.message : ( body.error ? ': ' + body.error : '.' ) ) : '.' ) ) );
						bot.say( channel, '@' + userstate['display-name'] + ', I couldn\'t change the default wiki :(' );
					}
					else {
						botsettings = Object.assign({}, temp_settings);
						console.log( 'Einstellungen erfolgreich aktualisiert.' );
						bot.say( channel, '@' + userstate['display-name'] + ', I changed the default wiki to: ' + botsettings[channel] );
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
	if ( userstate['user-id'] === process.env.owner && args.length ) {
		try {
			var text = eval( args.join(' ') );
		} catch ( error ) {
			var text = error.name + ': ' + error.message;
		}
		console.log( text );
		bot.say( channel, 'NomNom ' + text ).catch( err => bot.say( channel, err.name + ': ' + err.message ) );
	} else {
		bot_link(channel, msg, msg.split(' ').slice(1).join(' '), wiki);
	}
}

function bot_join(channel, userstate, msg, args, wiki) {
	if ( args[0] && args[0].toLowerCase() === '@' + userstate.username ) {
		if ( '#' + userstate.username in botsettings ) {
			bot.say( channel, 'I already joined your stream @' + userstate['display-name'] );
		}
		else {
			var temp_settings = Object.assign({}, botsettings);
			temp_settings['#' + userstate.username] = wiki;
			request.post( {
				uri: process.env.save,
				headers: {
					'PRIVATE-TOKEN': process.env.access
				},
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
				if ( error || !response || response.statusCode !== 201 || !body || body.error ) {
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
	if ( userstate['user-id'] === userstate['room-id'] && args[0] && args[0].toLowerCase() === '@' + userstate.username ) {
		var temp_settings = Object.assign({}, botsettings);
		delete temp_settings['#' + userstate.username];
		request.post( {
			uri: process.env.save,
			headers: {
				'PRIVATE-TOKEN': process.env.access
			},
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
			if ( error || !response || response.statusCode !== 201 || !body || body.error ) {
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
	if ( title.length > 300 ) title = title.substr(0, 300);
	request( {
		uri: wiki + '/api.php?action=query&format=json&meta=siteinfo&siprop=general|namespaces|specialpagealiases&iwurl=true&redirects=true&prop=extracts&exsentences=10&exintro=true&explaintext=true&titles=' + encodeURI( title ),
		json: true
	}, function( error, response, body ) {
		if ( error || !response || response.statusCode !== 200 || !body || !body.query ) {
			if ( response && response.request && response.request.uri && response.request.uri.href === wiki.noWiki() ) {
				console.log( '- Dieses Wiki existiert nicht! ' + ( error ? error.message : ( body ? ( body.error ? body.error.info : '' ) : '' ) ) );
				bot.say( channel, 'This wiki does not exist!' );
			}
			else {
				console.log( '- Fehler beim Erhalten der Suchergebnisse' + ( error ? ': ' + error : ( body ? ( body.error ? ': ' + body.error.info : '.' ) : '.' ) ) );
				bot.say( channel, 'I got an error while searching: ' + wiki.toLink() + 'Special:Search/' + title.toTitle() );
			}
		}
		else {
			if ( body.query.pages ) {
				var querypage = Object.values(body.query.pages)[0];
				if ( body.query.redirects && body.query.redirects[0].from.split(':')[0] === body.query.namespaces['-1']['*'] && body.query.specialpagealiases.filter( sp => ['Mypage','Mytalk','MyLanguage'].includes( sp.realname ) ).map( sp => sp.aliases[0] ).includes( body.query.redirects[0].from.split(':').slice(1).join(':').split('/')[0].replace( / /g, '_' ) ) ) {
					querypage.title = body.query.redirects[0].from;
					delete body.query.redirects[0].tofragment;
					delete querypage.missing;
					querypage.ns = -1;
				}
					
				if ( ( querypage.missing !== undefined && querypage.known === undefined ) || querypage.invalid !== undefined ) {
					request( {
						uri: wiki + '/api.php?action=query&format=json&prop=extracts&exsentences=10&exintro=true&explaintext=true&generator=search&gsrnamespace=4|12|14|' + Object.values(body.query.namespaces).filter( ns => ns.content !== undefined ).map( ns => ns.id ).join('|') + '&gsrsearch=' + encodeURI( title ) + '&gsrlimit=1',
						json: true
					}, function( srerror, srresponse, srbody ) {
						if ( srerror || !srresponse || srresponse.statusCode !== 200 || !srbody ) {
							console.log( 'Fehler beim Erhalten der Suchergebnisse' + ( srerror ? ': ' + srerror : ( srbody ? ( srbody.error ? ': ' + srbody.error.info : '.' ) : '.' ) ) );
							bot.say( channel, 'I got an error while searching: ' + wiki.toLink() + 'Special:Search/' + title.toTitle() );
						}
						else {
							if ( !srbody.query ) {
								bot.say( channel, 'I couldn\'t find a result for "' + title + '" on this wiki :( ' + wiki );
							}
							else {
								querypage = Object.values(srbody.query.pages)[0];
								var text = wiki.toLink() + querypage.title.toTitle() + ( querypage.extract ? ' – ' + querypage.extract : '' );
								if ( title.replace( /\-/g, ' ' ).toTitle().toLowerCase() === querypage.title.replace( /\-/g, ' ' ).toTitle().toLowerCase() ) {
									text = text;
								}
								else if ( !srbody.continue ) {
									text = 'I found only this: ' + text;
								}
								else {
									text = 'I found this for you: ' + text;
								}
								bot.say( channel, ( text.length < 450 ? text : text.substr(0, 450) + '\u2026' ) );
							}
						}
					} );
				}
				else {
					var text = wiki.toLink() + querypage.title.toTitle() + ( body.query.redirects && body.query.redirects[0].tofragment ? '#' + body.query.redirects[0].tofragment.toSection() : '' ) + ( querypage.extract ? ' – ' + querypage.extract : '' );
					bot.say( channel, ( text.length < 450 ? text : text.substr(0, 450) + '\u2026' ) );
				}
			}
			else if ( body.query.interwiki ) {
				var inter = body.query.interwiki[0];
				var intertitle = inter.title.substr(inter.iw.length+1);
				var regex = inter.url.match( /^(https?:\/\/[a-z\d\.-]{1,30}\.(?:gamepedia|wikia|fandom)\.com\/(?:(?!wiki\/)[a-z-]{1,8}\/)?)(?:wiki\/)?/ );
				if ( regex !== null ) {
					var iwtitle = decodeURIComponent( inter.url.replace( regex[0], '' ) ).replace( /\_/g, ' ' ).replaceSave( intertitle.replace( /\_/g, ' ' ), intertitle );
					bot_link(channel, msg, iwtitle, regex[1]);
				} else bot.say( channel, inter.url );
			}
			else {
				bot.say( channel, wiki.toLink() + body.query.general.mainpage.toTitle() );
			}
		}
	} );
}

String.prototype.noWiki = function() {
	if ( /^https:\/\/[a-z\d-]{1,30}\.gamepedia\.com\/$/.test(this) ) return 'https://www.gamepedia.com/';
	else return this.replace( /^https?:\/\/([a-z\d\.-]{1,30}\.(?:wikia|fandom)\.com)\/(?:[a-z-]{1,8}\/)?$/, 'http://community.wikia.com/wiki/Community_Central:Not_a_valid_community?from=$1' );
};

String.prototype.toLink = function() {
	if ( /^https:\/\/[a-z\d-]{1,30}\.gamepedia\.com\/$/.test(this) ) return this;
	else return this + 'wiki/';
};

String.prototype.toTitle = function() {
	return this.replace( / /g, '_' ).replace( /\%/g, '%25' ).replace( /\,/g, '%2C').replace( /\'/g, '%27' ).replace( /\!/g, '%21' ).replace( /\?/g, '%3F' );
};

String.prototype.toSection = function() {
	return encodeURIComponent( this.replace( / /g, '_' ) ).replace( /\'/g, '%27' ).replace( /\(/g, '%28' ).replace( /\)/g, '%29' ).replace( /\%/g, '.' );
};

String.prototype.replaceSave = function(pattern, replacement) {
	return this.replace( pattern, ( typeof replacement === 'string' ? replacement.replace( '$', '$$$$' ) : replacement ) );
};

bot.on( 'chat', function(channel, userstate, msg, self) {
	// Don't listen to my own messages..
	if ( self ) return;

	// Do your stuff.
	if ( msg.toLowerCase().startsWith( process.env.prefix + ' ' ) || msg.toLowerCase() === process.env.prefix ) {
		if ( allSites === defaultSites ) getAllSites();
		console.log( channel + ': ' + msg );
		var wiki = botsettings[channel];
		var args = msg.split(' ').slice(1);
		if ( args[0] ) {
			var invoke = args[0].toLowerCase()
			if ( invoke in cmds ) cmds[invoke](channel, userstate, msg, args.slice(1), wiki);
			else if ( invoke.startsWith('!') ) bot_link(channel, msg, args.slice(1).join(' '), 'https://' + invoke.substr(1) + '.gamepedia.com/');
			else if ( invoke.startsWith('?') ) bot_link(channel, msg, args.slice(1).join(' '), ( invoke.includes( '.' ) ? 'http://' : 'https://' ) + invoke.substr(1) + '.wikia.com/');
			else bot_link(channel, msg, args.join(' '), wiki);
		}
		else {
			bot_link(channel, msg, args.join(' '), wiki);
		}
	}
} );

bot.on( 'notice', function(channel, msgid, msg) {
	console.log( channel + ': ' + msg );
} );

bot.connect();