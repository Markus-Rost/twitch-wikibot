require('dotenv').config();
const util = require('util');
util.inspect.defaultOptions = {compact:false,breakLength:Infinity};

var isDebug = ( process.argv[2] === 'debug' );

const tmi = require('tmi.js');
const got = require('got').extend( {
	throwHttpErrors: false,
	headers: {
		'user-agent': 'WikiBot/' + ( isDebug ? 'testing' : process.env.npm_package_version ) + ' (Twitch; ' + process.env.npm_package_name + ')'
	}
} );
const htmlparser = require('htmlparser2');

var stop = false;

const sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database( './wikibot.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, dberror => {
	if ( dberror ) {
		console.log( '- Error while connecting to the database: ' + dberror );
		return dberror;
	}
	console.log( '- Connected to the database.' );
} );

var bot = new tmi.client( {
	options: {
		clientId: process.env.client,
		debug: isDebug
	},
	connection: {
		reconnect: true,
		secure: true
	},
	identity: {
		username: process.env.botname,
		password: 'oauth:' + process.env.oauth
	},
	channels: []
} );

const kraken = {
	Accept: 'application/vnd.twitchtv.v5+json',
	'Client-ID': process.env.client,
	Authorization: 'OAuth ' + process.env.oauth
}

var cooldown = {};

function getSettings(trysettings = 1) {
	var channels = [];
	db.each( 'SELECT id, name FROM twitch', [], (dberror, row) => {
		if ( dberror ) {
			console.log( '- ' + trysettings + '. Error while getting the setting: ' + dberror );
			if ( trysettings < 10 ) {
				trysettings++;
				getSettings(trysettings);
			}
			return dberror;
		}
		bot.join(row.name).catch( error => ( error === 'No response from Twitch.' ? {} : console.log( '#' + row.name + ': ', error ) ) );
		channels.push(row);
	}, (dberror) => {
		if ( dberror ) {
			console.log( '- ' + trysettings + '. Error while getting the settings: ' + dberror );
			if ( dberror.message === 'SQLITE_ERROR: no such table: twitch' ) {
				db.run( 'CREATE TABLE IF NOT EXISTS twitch(id INTEGER PRIMARY KEY UNIQUE NOT NULL, name TEXT NOT NULL, wiki TEXT NOT NULL DEFAULT [https://help.gamepedia.com/], game TEXT, cooldown INTEGER NOT NULL DEFAULT [0]) WITHOUT ROWID', [], function (error) {
					if ( error ) {
						console.log( '- Error while creating the table: ' + error );
						return error;
					}
					console.log( '- Created the table.' );
					db.run( 'CREATE INDEX idx_twitch_channel ON twitch(id)', [], function (idxerror) {
						if ( idxerror ) {
							console.log( '- Error while creating the index: ' + idxerror );
							return error;
						}
						console.log( '- Created the index.' );
					} );
					if ( trysettings < 10 ) {
						trysettings++;
						getSettings(trysettings);
					}
				} );
			}
			else {
				if ( trysettings < 10 ) {
					trysettings++;
					getSettings(trysettings);
				}
			}
			return dberror;
		}
		console.log( '- Settings successfully loaded.' );
		
		setTimeout( () => {
			console.log( '- Joined ' + bot.getChannels().length + ' out of ' + channels.length + ' streams.' );
			channels = channels.filter( channel => !bot.getChannels().includes( '#' + channel.name ) );
			checkChannels(channels);
		}, 10000 ).unref();
	} );
}

function checkChannels(channels) {
	if ( stop ) return;
	if ( channels.length > 100 ) {
		checkChannels(channels.slice(100));
		channels = channels.slice(0, 100);
	}
	if ( channels.length ) got.get( 'https://api.twitch.tv/kraken/channels?id=' + channels.map( channel => channel.id ).join(','), {
		headers: kraken,
		responseType: 'json'
	} ).then( response => {
		var body = response.body;
		if ( response.statusCode !== 200 || !body || body.error || !body.channels ) {
			console.log( '- ' + response.statusCode + ': Error while checking missing streams: ' + ( body && ( body.message || body.error ) ) );
		}
		else {
			body.channels.forEach( user => {
				var oldname = channels.find( channel => channel.id === user._id ).name;
				bot.join(user.name).catch( error => {
					if ( ['msg_channel_suspended','tos_ban','msg_banned','msg_room_not_found'].includes(error) ) {
						db.run( 'DELETE FROM twitch WHERE id = ?', [user._id], function (dberror) {
							if ( dberror ) {
								console.log( '- Error while removing ' + user.name + ' for ' + error + ': ' + dberror );
								return dberror;
							}
							bot.whisper( process.env.ownername, 'I removed ' + user.name + ' for: ' + error );
							console.log( '- I removed #' + user.name + ' for: ' + error );
						} );
						
						got.delete( 'https://api.twitch.tv/kraken/users/' + process.env.bot + '/follows/channels/' + user._id, {
							headers: kraken,
							responseType: 'json'
						} ).then( delresponse => {
							var delbody = delresponse.body;
							if ( delresponse.statusCode !== 204 || delbody ) {
								bot.whisper( process.env.ownername, 'Error while unfollowing ' + user.name );
								console.log( '- ' + delresponse.statusCode + ': Error while unfollowing ' + user.name + ': ' + ( delbody && ( delbody.message || delbody.error ) ) );
							} else console.log( '- I\'m not following ' + user.name + ' anymore.' );
						}, delerror => {
							bot.whisper( process.env.ownername, 'Error while unfollowing ' + user.name );
							console.log( '- Error while unfollowing ' + user.name + ': ' + delerror );
						} );
					}
					else console.log( '#' + user.name + ': ', error );
				} );
				if ( oldname !== user.name ) {
					db.run( 'UPDATE twitch SET name = ? WHERE id = ?', [user.name, user._id], function (dberror) {
						if ( dberror ) {
							console.log( '- Error while changing the name from ' + oldname + ' to #' + user.name + ': ' + dberror );
							return dberror;
						}
						console.log( '- Name successfully changed from #' + oldname + ' to #' + user.name + '.' );
					} );
				}
			} );
			if ( body.channels.length !== channels.length ) {
				channels = channels.filter( channel => !body.channels.some( user => user._id === channel.id ) );
				db.run( 'DELETE FROM twitch WHERE id IN (' + channels.map( channel => '?' ).join(', ') + ')', channels.map( channel => channel.id ), function (dberror) {
					if ( dberror ) {
						console.log( '- Error while removing non-existing streams ' + channels.map( channel => '#' + channel.name ).join(', ') + ': ' + dberror );
						return dberror;
					}
					bot.whisper( process.env.ownername, 'I removed streams, that didn\'t exist anymore: ' + channels.map( channel => '#' + channel.name ).join(', ') );
					console.log( '- I removed streams, that didn\'t exist anymore: ' + channels.map( channel => '#' + channel.name ).join(', ') );
				} );
			}
		}
	}, error => {
		console.log( '- Error while checking missing streams: ' + error );
	} );
}

var allSites = [];

function getAllSites() {
	got.get( 'https://help.gamepedia.com/api.php?action=allsites&formatversion=2&do=getSiteStats&filter=wikis|wiki_domain,wiki_display_name,wiki_managers,official_wiki,created,ss_good_articles&format=json', {
		responseType: 'json'
	} ).then( response => {
		var body = response.body;
		if ( response.statusCode !== 200 || !body || body.status !== 'okay' || !body.data || !body.data.wikis ) {
			console.log( '- ' + response.statusCode + ': Error while gettings all sites: ' + ( body && body.error && body.error.info ) );
		}
		else {
			console.log( '- Sites successfully loaded.' );
			allSites = JSON.parse(JSON.stringify(body.data.wikis.filter( site => /^[a-z\d-]{1,50}\.gamepedia\.com$/.test(site.wiki_domain) )));
		}
	}, error => {
			console.log( '- Error while gettings all sites: ' + error );
	} );
}

bot.on('connected', function(address, port) {
	console.log( '\n- Successfully logged in!' );
	getSettings();
	getAllSites();
});

var cmds = {
	setwiki: bot_setwiki,
	setcooldown: bot_cooldown,
	eval: bot_eval,
	join: bot_join,
	leave: bot_leave
}

function bot_setwiki(channel, userstate, msg, args, wiki) {
	if ( args[0] && ( userstate.mod || userstate['user-id'] === userstate['room-id'] || userstate['user-id'] === process.env.owner ) ) {
		if ( args.length === 1 && args[0] === '--auto' ) db.get( 'SELECT game FROM twitch WHERE id = ?', [userstate['room-id']], (dberror, row) => {
			if ( dberror || !row ) {
				console.log( '- Error while getting the game: ' + dberror );
				bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', I couldn\'t change the automatic wiki detection :(' );
				return dberror;
			}
			if ( row.game === null ) checkGames([{id:parseInt(userstate['room-id'], 10),game:null}], [channel,userstate['display-name']]);
			else db.run( 'UPDATE twitch SET game = NULL WHERE id = ?', [userstate['room-id']], function (dberror) {
				if ( dberror ) {
					console.log( '- Error while editing the settings: ' + dberror );
					bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', I couldn\'t stop changing the default wiki automatically :(' );
					return dberror;
				}
				console.log( '- Games successfully updated.' );
				bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', I will no longer automatically change the default wiki.' );
			} );
		} );
		else {
			args[0] = args[0].toLowerCase();
			var wikinew = '';
			var comment = '';
			if ( args.length === 2 && args[1] === '--force' ) {
				var forced = 'forced';
				wikinew = args[0];
			}
			else if ( allSites.some( site => site.wiki_domain === args[0] + '.gamepedia.com' ) ) wikinew = 'https://' + args[0] + '.gamepedia.com/';
			else {
				var regex = args[0].match( /^(?:https:\/\/)?([a-z\d-]{1,50}\.(?:gamepedia\.com|(?:fandom\.com|wikia\.org)(?:(?!\/wiki\/)\/[a-z-]{1,8})?))(?:\/|$)/ );
				if ( regex !== null ) wikinew = 'https://' + regex[1] + '/';
				else if ( /^(?:[a-z-]{1,8}\.)?[a-z\d-]{1,50}$/.test(args[0]) ) {
					if ( args[0].includes( '.' ) ) wikinew = 'https://' + args[0].split('.')[1] + '.fandom.com/' + args[0].split('.')[0] + '/';
					else wikinew = 'https://' + args[0] + '.fandom.com/';
				}
			}
			if ( wikinew ) {
				if ( wiki === wikinew && !forced ) {
					bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', the default wiki is already set to: ' + wiki );
				}
				else got.get( wikinew + 'api.php?action=query&format=json', {
					responseType: 'json'
				} ).then( response => {
					var body = response.body;
					if ( response.statusCode !== 200 || !body || !( body instanceof Object ) ) {
						if ( forced || wikinew.noWiki(response.url) || response.statusCode === 410 ) {
							console.log( '- This wiki doesn\'t exist!' );
							bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', this wiki does not exist!' );
							var nowiki = true;
						}
						else {
							console.log( '- ' + response.statusCode + ': Error while reaching the wiki: ' + ( body && body.error && body.error.info ) );
							comment = ' I got an error while checking if the wiki exists!';
						}
					}
					if ( !nowiki ) {
						db.run( 'UPDATE twitch SET wiki = ? WHERE id = ?', [wikinew, userstate['room-id']], function (dberror) {
							if ( dberror ) {
								console.log( '- Error while editing the settings: ' + dberror );
								bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', I couldn\'t change the default wiki :(' );
								return dberror;
							}
							console.log( '- Settings successfully updated.' );
							bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', I ' + ( forced || 'changed' ) + ' the default wiki to: ' + wikinew + comment );
						} );
					}
				}, error => {
					if ( forced || wikinew.noWiki(error.message) ) {
						console.log( '- This wiki doesn\'t exist!' );
						bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', this wiki does not exist!' );
						var nowiki = true;
					}
					else {
						console.log( '- Error while reaching the wiki: ' + error );
						comment = ' I got an error while checking if the wiki exists!';
					}
					if ( !nowiki ) {
						db.run( 'UPDATE twitch SET wiki = ? WHERE id = ?', [wikinew, userstate['room-id']], function (dberror) {
							if ( dberror ) {
								console.log( '- Error while editing the settings: ' + dberror );
								bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', I couldn\'t change the default wiki :(' );
								return dberror;
							}
							console.log( '- Settings successfully updated.' );
							bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', I ' + ( forced || 'changed' ) + ' the default wiki to: ' + wikinew + comment );
						} );
					}
				} );
			}
			else {
				bot_link(channel, msg.split(' ').slice(1).join(' '), wiki);
			}
		}
	}
	else {
		bot_link(channel, msg.split(' ').slice(1).join(' '), wiki);
	}
}

async function bot_eval(channel, userstate, msg, args, wiki) {
	if ( userstate['user-id'] === process.env.owner && args.length ) {
		try {
			var text = util.inspect( await eval( args.join(' ') ) );
		} catch ( error ) {
			var text = error.toString();
		}
		if ( isDebug ) console.log( '--- EVAL START ---\n' + text + '\n--- EVAL END ---' );
		if ( text.length > 450 ) bot.say( channel, 'gamepediaWIKIBOT ✅' );
		else bot.say( channel, 'gamepediaWIKIBOT ' + text );
	} else {
		bot_link(channel, msg.split(' ').slice(1).join(' '), wiki);
	}
}

function bot_join(channel, userstate, msg, args, wiki) {
	if ( args[0] && args[0].toLowerCase() === '@' + userstate.username ) {
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
			
			checkGames([{id:parseInt(userstate['user-id'], 10),game:null}], [userstate.username,userstate['display-name']]);
			
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
		bot_link(channel, msg.split(' ').slice(1).join(' '), wiki);
	}
}

function bot_leave(channel, userstate, msg, args, wiki) {
	if ( userstate['user-id'] === userstate['room-id'] && args[0] && args[0].toLowerCase() === '@' + userstate.username ) {
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
		bot_link(channel, msg.split(' ').slice(1).join(' '), wiki);
	}
}

function bot_cooldown(channel, userstate, msg, args, wiki) {
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
		bot_link(channel, msg.split(' ').slice(1).join(' '), wiki);
	}
}

function bot_link(channel, title, wiki) {
	if ( title.length > 300 ) title = title.substring(0, 300);
	if ( title.toLowerCase() === 'random' ) bot_random(channel, wiki);
	else got.get( wiki + 'api.php?action=query&meta=allmessages|siteinfo&ammessages=description&amenableparser=true&siprop=general|namespaces|specialpagealiases&iwurl=true&redirects=true&prop=pageprops|extracts&ppprop=description&exsentences=10&exintro=true&explaintext=true&titles=' + encodeURIComponent( title ) + '&format=json', {
		responseType: 'json'
	} ).then( response => {
		var body = response.body;
		if ( response.statusCode !== 200 || !body || !body.query ) {
			if ( wiki.noWiki(response.url) || response.statusCode === 410 ) {
				console.log( '- This wiki doesn\'t exist!' );
				bot.say( channel, 'This wiki does not exist!' );
			}
			else {
				console.log( '- ' + response.statusCode + ': Error while getting the search results: ' + ( body && body.error && body.error.info ) );
				bot.say( channel, 'I got an error while searching: ' + wiki.toLink(( title ? 'Special:Search' : '' ), ( title ? 'search=' + title.toSearch() : '' )) );
			}
		}
		else {
			if ( body.query.pages ) {
				var querypages = Object.values(body.query.pages);
				var querypage = querypages[0];
				if ( body.query.redirects && body.query.redirects[0].from.split(':')[0] === body.query.namespaces['-1']['*'] && body.query.specialpagealiases.filter( sp => ['Mypage','Mytalk','MyLanguage'].includes( sp.realname ) ).map( sp => sp.aliases[0] ).includes( body.query.redirects[0].from.split(':').slice(1).join(':').split('/')[0].replace( / /g, '_' ) ) ) {
					querypage.title = body.query.redirects[0].from;
					delete body.query.redirects[0].tofragment;
					delete querypage.missing;
					querypage.ns = -1;
				}
				if ( querypages.length !== 1 ) querypage = {
					title: title,
					invalidreason: 'The requested page title contains invalid characters: "|".',
					invalid: ''
				}
					
				if ( ( querypage.missing !== undefined && querypage.known === undefined ) || querypage.invalid !== undefined ) {
					if ( wiki.isFandom() ) {
						if ( querypage.ns === 1201 ) {
							var thread = querypage.title.split(':');
							got.get( wiki + 'api.php?action=query&pageids=' + thread.slice(1).join(':') + '&format=json', {
								responseType: 'json'
							} ).then( thresponse => {
								var thbody = thresponse.body;
								if ( thresponse.statusCode !== 200 || !thbody || !thbody.query || !thbody.query.pages ) {
									console.log( '- ' + thresponse.statusCode + ': Error while getting the thread: ' + ( thbody && thbody.error && thbody.error.info ) );
									bot.say( channel, 'I got an error while searching: ' + wiki.toLink(querypage.title, '', '', body) );
								}
								else {
									querypage = thbody.query.pages[thread.slice(1).join(':')];
									if ( querypage.missing !== undefined ) {
										bot.say( channel, 'I couldn\'t find a result for "' + title + '" on this wiki :( ' + wiki );
									}
									else {
										var text = wiki.toLink(thread.join(':'), '', '', body);
										got.get( wiki.toDescLink(querypage.title) ).then( descresponse => {
											var descbody = descresponse.body;
											if ( descresponse.statusCode !== 200 || !descbody ) {
												console.log( '- ' + descresponse.statusCode + ': Error while getting the description!' );
											} else {
												var parser = new htmlparser.Parser( {
													onopentag: (tagname, attribs) => {
														if ( tagname === 'meta' && attribs.property === 'og:description' ) text += ' – ' + attribs.content;
													}
												}, {decodeEntities:true} );
												parser.write( descbody );
												parser.end();
											}
											bot.say( channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
										}, descerror => {
											console.log( '- Error while getting the description: ' + descerror );
											bot.say( channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
										} );
									}
								}
							}, therror => {
								console.log( '- Error while getting the thread: ' + therror );
								bot.say( channel, 'I got an error while searching: ' + wiki.toLink(querypage.title, '', '', body) );
							} );
						}
						else got.get( wiki + 'api/v1/Search/List?minArticleQuality=0&namespaces=' + Object.values(body.query.namespaces).filter( ns => ns.content !== undefined ).map( ns => ns.id ).join(',') + '&limit=10&query=' + encodeURIComponent( title ) + '&format=json', {
							responseType: 'json'
						} ).then( wsresponse => {
							var wsbody = wsresponse.body;
							if ( wsresponse.statusCode !== 200 || !wsbody || wsbody.exception || !wsbody.total || !wsbody.items || !wsbody.items.length ) {
								if ( wsbody && ( !wsbody.total || ( wsbody.items && !wsbody.items.length ) || ( wsbody.exception && wsbody.exception.code === 404 ) ) ) {
									bot.say( channel, 'I couldn\'t find a result for "' + title + '" on this wiki :( ' + wiki );
								}
								else {
									console.log( '- ' + wsresponse.statusCode + ': Error while getting the search results: ' + ( wsbody && wsbody.exception && wsbody.exception.details ) );
									bot.say( channel, 'I got an error while searching: ' + wiki.toLink('Special:Search', 'search=' + title.toSearch(), '', body) );
								}
							}
							else {
								querypage = wsbody.items[0];
								if ( querypage.ns && !querypage.title.startsWith( body.query.namespaces[querypage.ns]['*'] + ':' ) ) {
									querypage.title = body.query.namespaces[querypage.ns]['*'] + ':' + querypage.title;
								}
								var text = '';
								if ( title.replace( /\-/g, ' ' ).toTitle().toLowerCase() === querypage.title.replace( /\-/g, ' ' ).toTitle().toLowerCase() ) {
									text = '';
								}
								else if ( wsbody.total === 1 ) {
									text = 'I found only this: ';
								}
								else {
									text = 'I found this for you: ';
								}
								text += wiki.toLink(querypage.title, '', '', body);
								if ( querypage.title === body.query.general.mainpage && body.query.allmessages[0]['*'] ) {
										text += ' – ' + body.query.allmessages[0]['*'];
										bot.say( channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
								}
								else got.get( wiki.toDescLink(querypage.title) ).then( descresponse => {
									var descbody = descresponse.body;
									if ( descresponse.statusCode !== 200 || !descbody ) {
										console.log( '- ' + descresponse.statusCode + ': Error while getting the description!' );
									} else {
										var parser = new htmlparser.Parser( {
											onopentag: (tagname, attribs) => {
												if ( tagname === 'meta' && attribs.property === 'og:description' ) text += ' – ' + attribs.content;
											}
										}, {decodeEntities:true} );
										parser.write( descbody );
										parser.end();
									}
									bot.say( channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
								}, descerror => {
									console.log( '- Error while getting the description: ' + descerror );
									bot.say( channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
								} );
							}
						}, wserror => {
							console.log( '- Error while getting the search results: ' + wserror );
							bot.say( channel, 'I got an error while searching: ' + wiki.toLink('Special:Search', 'search=' + title.toSearch(), '', body) );
						} );
					}
					else {
						got.get( wiki + 'api.php?action=query&prop=pageprops|extracts&ppprop=description&exsentences=10&exintro=true&explaintext=true&generator=search&gsrnamespace=' + Object.values(body.query.namespaces).filter( ns => ns.content !== undefined ).map( ns => ns.id ).join('|') + '&gsrlimit=1&gsrsearch=' + encodeURIComponent( title ) + '&format=json', {
							responseType: 'json'
						} ).then( srresponse => {
							var srbody = srresponse.body;
							if ( srresponse.statusCode !== 200 || !srbody ) {
								console.log( '- ' + srresponse.statusCode + ': Error while getting the search results: ' + ( srbody && srbody.error && srbody.error.info ) );
								bot.say( channel, 'I got an error while searching: ' + wiki.toLink('Special:Search', 'search=' + title.toSearch(), '', body) );
							}
							else {
								if ( !srbody.query ) {
									bot.say( channel, 'I couldn\'t find a result for "' + title + '" on this wiki :( ' + wiki );
								}
								else {
									querypage = Object.values(srbody.query.pages)[0];
									var text = '';
									if ( title.replace( /\-/g, ' ' ).toTitle().toLowerCase() === querypage.title.replace( /\-/g, ' ' ).toTitle().toLowerCase() ) {
										text = '';
									}
									else if ( !srbody.continue ) {
										text = 'I found only this: ';
									}
									else {
										text = 'I found this for you: ';
									}
									text += wiki.toLink(querypage.title, '', '', body);
									if ( querypage.pageprops && querypage.pageprops.description ) {
										var parser = new htmlparser.Parser( {
											ontext: (htmltext) => {
												text += htmltext;
											}
										}, {decodeEntities:true} );
										parser.write( ' – ' + querypage.pageprops.description );
										parser.end();
									}
									else if ( querypage.extract ) text += ' – ' + querypage.extract;
									bot.say( channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
								}
							}
						}, srerror => {
							console.log( '- Error while getting the search results: ' + srerror );
							bot.say( channel, 'I got an error while searching: ' + wiki.toLink('Special:Search', 'search=' + title.toSearch(), '', body) );
						} );
					}
				}
				else {
					var text = wiki.toLink(querypage.title, '', ( body.query.redirects ? body.query.redirects[0].tofragment : '' ), body);
					if ( querypage.pageprops && querypage.pageprops.description ) {
						var parser = new htmlparser.Parser( {
							ontext: (htmltext) => {
								text += htmltext;
							}
						}, {decodeEntities:true} );
						parser.write( ' – ' + querypage.pageprops.description );
						parser.end();
					}
					else if ( querypage.extract ) text += ' – ' + querypage.extract;
					else if ( querypage.title === body.query.general.mainpage && body.query.allmessages[0]['*'] ) {
						text += ' – ' + body.query.allmessages[0]['*'];
					}
					if ( !text.includes( ' – ' ) && wiki.isFandom() ) got.get( wiki.toDescLink(querypage.title) ).then( descresponse => {
						var descbody = descresponse.body;
						if ( descresponse.statusCode !== 200 || !descbody ) {
							console.log( '- ' + descresponse.statusCode + ': Error while getting the description!' );
						} else {
							var parser = new htmlparser.Parser( {
								onopentag: (tagname, attribs) => {
									if ( tagname === 'meta' && attribs.property === 'og:description' ) text += ' – ' + attribs.content;
								}
							}, {decodeEntities:true} );
							parser.write( descbody );
							parser.end();
						}
						bot.say( channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
					}, descerror => {
						console.log( '- Error while getting the description: ' + descerror );
						bot.say( channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
					} );
					else bot.say( channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
				}
			}
			else if ( body.query.interwiki ) {
				var inter = body.query.interwiki[0];
				var intertitle = inter.title.substring(inter.iw.length+1);
				var regex = inter.url.match( /^(?:https?:)?\/\/([a-z\d-]{1,50}\.(?:gamepedia\.com|(?:fandom\.com|wikia\.org)(?:(?!\/wiki\/)\/[a-z-]{1,8})?(\/wiki))\/)/ );
				if ( regex !== null ) {
					var iwtitle = decodeURIComponent( inter.url.replace( regex[0], '' ) ).replace( /\_/g, ' ' ).replaceSave( intertitle.replace( /\_/g, ' ' ), intertitle );
					bot_link(channel, iwtitle, 'https://' + regex[1].replace( regex[2], '' ));
				} else {
					regex = inter.url.match( /^(?:https?:)?\/\/([a-z\d-]{1,50}\.(?:wikipedia|mediawiki|wiktionary|wikimedia|wikibooks|wikisource|wikidata|wikiversity|wikiquote|wikinews|wikivoyage)\.org\/)wiki\// );
					if ( regex !== null ) {
						var iwtitle = decodeURIComponent( inter.url.replace( regex[0], '' ) ).replace( /\_/g, ' ' ).replaceSave( intertitle.replace( /\_/g, ' ' ), intertitle );
						bot_link(channel, iwtitle, 'https://' + regex[1] + 'w/');
					} else bot.say( channel, inter.url );
				}
			}
			else {
				var text = wiki.toLink(body.query.general.mainpage, '', '', body);
				if ( body.query.allmessages[0]['*'] ) {
					text += ' – ' + body.query.allmessages[0]['*'];
					bot.say( channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
				}
				else if ( wiki.isFandom() ) got.get( wiki.toDescLink(body.query.general.mainpage) ).then( descresponse => {
					var descbody = descresponse.body;
					if ( descresponse.statusCode !== 200 || !descbody ) {
						console.log( '- ' + descresponse.statusCode + ': Error while getting the description!' );
					} else {
						var parser = new htmlparser.Parser( {
							onopentag: (tagname, attribs) => {
								if ( tagname === 'meta' && attribs.property === 'og:description' ) text += ' – ' + attribs.content;
							}
						}, {decodeEntities:true} );
						parser.write( descbody );
						parser.end();
					}
					bot.say( channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
				}, descerror => {
					console.log( '- Error while getting the description: ' + descerror );
					bot.say( channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
				} );
				else got.get( wiki + 'api.php?action=query&redirects=true&prop=pageprops|extracts&ppprop=description&exsentences=10&exintro=true&explaintext=true&titles=' + encodeURIComponent( body.query.general.mainpage ) + '&format=json', {
					responseType: 'json'
				} ).then( mpresponse => {
					var mpbody = mpresponse.body;
					if ( mpresponse.statusCode !== 200 || !mpbody || !mpbody.query ) {
						console.log( '- ' + mpresponse.statusCode + ': Error while getting the main page: ' + ( mpbody && mpbody.error && mpbody.error.info ) );
					} else {
						querypage = Object.values(mpbody.query.pages)[0];
						if ( querypage.pageprops && querypage.pageprops.description ) {
							var parser = new htmlparser.Parser( {
								ontext: (htmltext) => {
									text += htmltext;
								}
							}, {decodeEntities:true} );
							parser.write( ' – ' + querypage.pageprops.description );
							parser.end();
						}
						else if ( querypage.extract ) text += ' – ' + querypage.extract;
					}
					bot.say( channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
				}, mperror => {
					console.log( '- Error while getting the main page: ' + mperror );
					bot.say( channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
				} );
			}
		}
	}, error => {
		if ( wiki.noWiki(error.message) ) {
			console.log( '- This wiki doesn\'t exist!' );
			bot.say( channel, 'This wiki does not exist!' );
		}
		else {
			console.log( '- Error while getting the search results: ' + error );
			bot.say( channel, 'I got an error while searching: ' + wiki.toLink(( title ? 'Special:Search' : '' ), ( title ? 'search=' + title.toSearch() : '' )) );
		}
	} );
}

function bot_random(channel, wiki) {
	got.get( wiki + 'api.php?action=query&meta=allmessages|siteinfo&ammessages=description&amenableparser=true&siprop=general&prop=pageprops|extracts&ppprop=description&exsentences=10&exintro=true&explaintext=true&generator=random&grnnamespace=0&format=json', {
		responseType: 'json'
	} ).then( response => {
		var body = response.body;
		if ( response.statusCode !== 200 || !body || !body.query || !body.query.pages ) {
			if ( wiki.noWiki(response.url) || response.statusCode === 410 ) {
				console.log( '- This wiki doesn\'t exist!' );
				bot.say( channel, 'This wiki does not exist!' );
			}
			else {
				console.log( '- ' + response.statusCode + ': Error while getting the search results: ' + ( body && body.error && body.error.info ) );
				bot.say( channel, 'I got an error while searching: ' + wiki.toLink('Special:Random') );
			}
		}
		else {
			var querypage = Object.values(body.query.pages)[0];
			var text = '🎲 ' + wiki.toLink(querypage.title, '', '', body);
			if ( querypage.pageprops && querypage.pageprops.description ) {
				var parser = new htmlparser.Parser( {
					ontext: (htmltext) => {
						text += htmltext;
					}
				}, {decodeEntities:true} );
				parser.write( ' – ' + querypage.pageprops.description );
				parser.end();
			}
			else if ( querypage.extract ) text += ' – ' + querypage.extract;
			else if ( querypage.title === body.query.general.mainpage && body.query.allmessages[0]['*'] ) text += ' – ' + body.query.allmessages[0]['*'];
			else if ( wiki.isFandom() ) {
				var nosend = true;
				got.get( wiki.toDescLink(querypage.title) ).then( descresponse => {
					var descbody = descresponse.body;
					if ( descresponse.statusCode !== 200 || !descbody ) {
						console.log( '- ' + descresponse.statusCode + ': Error while getting the description!' );
					} else {
						var parser = new htmlparser.Parser( {
							onopentag: (tagname, attribs) => {
								if ( tagname === 'meta' && attribs.property === 'og:description' ) text += ' – ' + attribs.content;
							}
						}, {decodeEntities:true} );
						parser.write( descbody );
						parser.end();
					}
					bot.say( channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
				}, descerror => {
					console.log( '- Error while getting the description: ' + descerror );
					bot.say( channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
				} );
			}
			
			if ( !nosend ) bot.say( channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
		}
	}, error => {
		if ( wiki.noWiki(error.message) ) {
			console.log( '- This wiki doesn\'t exist!' );
			bot.say( channel, 'This wiki does not exist!' );
		}
		else {
			console.log( '- Error while getting the search results: ' + error );
			bot.say( channel, 'I got an error while searching: ' + wiki.toLink('Special:Random') );
		}
	} );
}

String.prototype.noWiki = function(href) {
	if ( !href ) return false;
	else if ( this.startsWith( 'https://www.' ) ) return true;
	else if ( this.endsWith( '.gamepedia.com/' ) ) return 'https://www.gamepedia.com/' === href;
	else return [
		this.replace( /^https:\/\/([a-z\d-]{1,50}\.(?:fandom\.com|wikia\.org))\/(?:[a-z-]{1,8}\/)?$/, 'https://community.fandom.com/wiki/Community_Central:Not_a_valid_community?from=$1' ),
		this + 'language-wikis'
	].includes( href.replace( /Unexpected token < in JSON at position 0 in "([^ ]+)"/, '$1' ) );
};

String.prototype.isFandom = function() {
	return /^https:\/\/[a-z\d-]{1,50}\.(?:fandom\.com|wikia\.org)\/(?:[a-z-]{1,8}\/)?$/.test(this);
};

String.prototype.toLink = function(title = '', querystring = '', fragment = '', path) {
	var linksuffix = ( querystring ? '?' + querystring.toTitle(true) : '' ) + ( fragment ? '#' + fragment.toSection() : '' );
	if ( this.endsWith( '.gamepedia.com/' ) ) return this + title.toTitle() + linksuffix;
	else if ( this.isFandom() ) return this + 'wiki/' + title.toTitle() + linksuffix;
	else if ( path ) return this.substring(0, this.length - path.query.general.scriptpath.length - 1) + path.query.general.articlepath.replaceSave( '$1', title.toTitle() ) + linksuffix;
	else return this + 'index.php?title=' + title.toTitle(true) + ( linksuffix.startsWith( '?' ) ? '&' + linksuffix.substring(1) : linksuffix );
};

String.prototype.toTitle = function(inQuery) {
	var title = encodeURI( this.replace( / /g, '_' ) ).replace( /\,/g, '%2C').replace( /\'/g, '%27' ).replace( /\!/g, '%21' );
	if ( inQuery ) return title.replace( /\&/g, '%26' );
	else return title.replace( /\?/g, '%3F' );
};

String.prototype.toSearch = function() {
	return this.replace( / /g, '+' );
};

String.prototype.toSection = function() {
	return encodeURIComponent( this.replace( / /g, '_' ) ).replace( /\'/g, '%27' ).replace( /\(/g, '%28' ).replace( /\)/g, '%29' ).replace( /\%/g, '.' );
};

String.prototype.toDescLink = function(title = '') {
	return this + 'wiki/' + encodeURIComponent( title.replace( / /g, '_' ) );
};

String.prototype.replaceSave = function(pattern, replacement) {
	return this.replace( pattern, ( typeof replacement === 'string' ? replacement.replace( /\$/g, '$$$$' ) : replacement ) );
};

String.prototype.splitText = function(length, split = '\n', messages = []) {
	var snippet = this.substring(0, length);
	var message = snippet.split(split);
	var text = message.pop() + this.substring(length);
	messages.push( message.join(split) );
	if ( text > length ) text.splitText(length, split, messages);
	else {
		messages.push( text );
		return messages
	}
}

bot.on( 'chat', function(channel, userstate, msg, self) {
	if ( stop || self ) return;
	
	if ( !( msg.toLowerCase().startsWith( process.env.prefix + ' ' ) || msg.toLowerCase() === process.env.prefix || msg.includes( '[[' ) || msg.includes( '{{' ) ) ) return;
	if ( !allSites.length ) getAllSites();
	console.log( channel + ': ' + msg );
	db.get( 'SELECT wiki, cooldown FROM twitch WHERE id = ?', [userstate['room-id']], (dberror, row) => {
		if ( dberror || !row ) {
			console.log( '- Error while getting the wiki: ' + dberror );
			bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', I got an error!' );
			return dberror;
		}
		if ( ( cooldown[channel] || 0 ) + row.cooldown > Date.now() ) return console.log( '- ' + channel + ' is still on cooldown.' );
		cooldown[channel] = Date.now();
		var wiki = row.wiki;

		if ( msg.toLowerCase().startsWith( process.env.prefix + ' ' ) || msg.toLowerCase() === process.env.prefix ) {
			var args = msg.split(' ').slice(1);
			if ( args[0] ) {
				var invoke = args[0].toLowerCase();
				if ( invoke in cmds ) cmds[invoke](channel, userstate, msg, args.slice(1), wiki);
				else if ( /^![a-z\d-]{1,50}$/.test(invoke) ) bot_link(channel, args.slice(1).join(' '), 'https://' + invoke.substring(1) + '.gamepedia.com/');
				else if ( /^\?(?:[a-z-]{1,8}\.)?[a-z\d-]{1,50}$/.test(invoke) ) {
					if ( invoke.includes( '.' ) ) wiki = 'https://' + invoke.split('.')[1] + '.fandom.com/' + invoke.substring(1).split('.')[0] + '/';
					else wiki = 'https://' + invoke.substring(1) + '.fandom.com/';
					bot_link(channel, args.slice(1).join(' '), wiki);
				}
				else if ( /^\?\?(?:[a-z-]{1,8}\.)?[a-z\d-]{1,50}$/.test(invoke) ) {
					if ( invoke.includes( '.' ) ) wiki = 'https://' + invoke.split('.')[1] + '.wikia.org/' + invoke.substring(2).split('.')[0] + '/';
					else wiki = 'https://' + invoke.substring(2) + '.wikia.org/';
					bot_link(channel, args.slice(1).join(' '), wiki);
				}
				else bot_link(channel, args.join(' '), wiki);
			}
			else {
				bot_link(channel, args.join(' '), wiki);
			}
		}
		else if ( msg.includes( '[[' ) || msg.includes( '{{' ) ) {
			var regex = new RegExp( '(?<!\\\\)\\[\\[([^' + "<>\\[\\]\\|{}\\x01-\\x1F\\x7F" + ']+)(?<!\\\\)\\]\\]', 'g' );
			var entry = null;
			var links = [];
			var count = 0;
			var maxcount = 5;
			while ( ( entry = regex.exec(msg) ) !== null ) {
				if ( count < maxcount ) {
					let title = entry[1].split('#')[0];
					let section = ( entry[1].includes( '#' ) ? entry[1].split('#').slice(1).join('#') : '' )
					links.push({title,section});
				}
				else if ( count === maxcount ) {
					console.log( '- Message contains too many links!' );
					break;
				}
				count++;
			}
			if ( links.length ) got.get( wiki + 'api.php?action=query&iwurl=true&titles=' + encodeURIComponent( links.map( link => link.title ).join('|') ) + '&format=json', {
				responseType: 'json'
			} ).then( response => {
				var body = response.body;
				if ( response.statusCode !== 200 || !body || !body.query ) {
					if ( wiki.noWiki(response.url) || response.statusCode === 410 ) {
						console.log( '- This wiki doesn\'t exist!' );
						bot.say( channel, 'This wiki does not exist!' );
						return;
					}
					console.log( '- ' + response.statusCode + ': Error while following the links: ' + ( body && body.error && body.error.info ) );
					return;
				}
				if ( body.query.normalized ) {
					body.query.normalized.forEach( title => links.filter( link => link.title === title.from ).forEach( link => link.title = title.to ) );
				}
				if ( body.query.interwiki ) {
					body.query.interwiki.forEach( interwiki => links.filter( link => link.title === interwiki.title ).forEach( link => {
						link.url = interwiki.url + ( link.section ? '#' + link.section.toSection() : '' );
					} ) );
				}
				if ( body.query.pages ) {
					var querypages = Object.values(body.query.pages);
					querypages.filter( page => page.invalid !== undefined ).forEach( page => links.filter( link => link.title === page.title ).forEach( link => {
						links.splice(links.indexOf(link), 1);
					} ) );
					querypages.filter( page => page.missing !== undefined && page.known === undefined ).forEach( page => links.filter( link => link.title === page.title ).forEach( link => {
						if ( ( page.ns === 2 || page.ns === 202 ) && !page.title.includes( '/' ) ) return;
						link.url = wiki.toLink() + link.title.toTitle() + '?action=edit&redlink=1';
					} ) );
				}
				if ( links.length ) {
					var messages = links.map( link => ( link.url || wiki.toLink() + link.title.toTitle() + ( link.section ? '#' + link.section.toSection() : '' ) ) ).join(' – ').splitText(450, ' – ');
					messages.forEach( message => bot.say( channel, message ) );
				}
			}, error => {
				if ( wiki.noWiki(error.message) ) {
					console.log( '- This wiki doesn\'t exist!' );
					bot.say( channel, 'This wiki does not exist!' );
					return;
				}
				console.log( '- Error while following the links: ' + error );
			} );
			
			regex = new RegExp( '(?<!\\\\)(?<!\\{)\\{\\{([^' + "<>\\[\\]\\|{}\\x01-\\x1F\\x7F" + ']+)(?<!\\\\)\\}\\}', 'g' );
			var embeds = [];
			count = 0;
			maxcount = 3;
			while ( ( entry = regex.exec(msg) ) !== null ) {
				if ( count < maxcount ) {
					let title = entry[1].split('#')[0];
					let section = ( entry[1].includes( '#' ) ? entry[1].split('#').slice(1).join('#') : '' )
					embeds.push({title,section});
				}
				else if ( count === maxcount ) {
					console.log( '- Message contains too many links!' );
					break;
				}
				count++;
			}
			if ( embeds.length ) got.get( wiki + 'api.php?action=query&titles=' + encodeURIComponent( embeds.map( embed => embed.title ).join('|') ) + '&format=json', {
				responseType: 'json'
			} ).then( response => {
				var body = response.body;
				if ( response.statusCode !== 200 || !body || !body.query ) {
					if ( wiki.noWiki(response.url) || response.statusCode === 410 ) {
						console.log( '- This wiki doesn\'t exist!' );
						bot.say( channel, 'This wiki does not exist!' );
						return;
					}
					console.log( '- ' + response.statusCode + ': Error while following the links: ' + ( body && body.error && body.error.info ) );
					return;
				}
				if ( body.query.normalized ) {
					body.query.normalized.forEach( title => embeds.filter( embed => embed.title === title.from ).forEach( embed => embed.title = title.to ) );
				}
				if ( body.query.pages ) {
					var querypages = Object.values(body.query.pages);
					querypages.filter( page => page.invalid !== undefined ).forEach( page => embeds.filter( embed => embed.title === page.title ).forEach( embed => {
						embeds.splice(embeds.indexOf(embed), 1);
					} ) );
					querypages.filter( page => page.missing !== undefined && page.known === undefined ).forEach( page => embeds.filter( embed => embed.title === page.title ).forEach( embed => {
						if ( ( page.ns === 2 || page.ns === 202 ) && !page.title.includes( '/' ) ) return;
						bot.say( channel, wiki.toLink() + embed.title.toTitle() + '?action=edit&redlink=1' );
						embeds.splice(embeds.indexOf(embed), 1);
					} ) );
				}
				if ( embeds.length ) embeds.forEach( embed => bot_link(channel, embed.title + embed.section, wiki) );
			}, error => {
				if ( wiki.noWiki(error.message) ) {
					console.log( '- This wiki doesn\'t exist!' );
					bot.say( channel, 'This wiki does not exist!' );
					return;
				}
				console.log( '- Error while following the links: ' + error );
			} );
		}
	} );
} );

bot.on( 'whisper', function(channel, userstate, msg, self) {
	if ( stop || self ) return;
	
	if ( channel === '#' + process.env.ownername.toLowerCase() ) {
		var args = msg.split(' ');
		if ( args[0].startsWith( '#' ) && args.length >= 2 ) bot.whisper( args[0], args.splice(1).join(' ') );
	}
	else bot.whisper( process.env.ownername, channel + ': ' + msg );
} );

bot.on( 'notice', function(channel, msgid, msg) {
	if ( msgid !== 'host_target_went_offline' ) console.log( channel + ': ' + msg );
} );

const checkGamesInterval = setInterval( () => {
	var channels = [];
	db.each( 'SELECT id, game FROM twitch WHERE game IS NOT NULL', [], (dberror, row) => {
		if ( dberror ) {
			console.log( '- Error while getting the game setting: ' + dberror );
			return dberror;
		}
		channels.push(row);
	}, (dberror) => {
		if ( dberror ) {
			console.log( '- Error while getting the game settings: ' + dberror );
			return dberror;
		}
		checkGames(channels);
	} );
}, 60000 );

function checkGames(channels, mention) {
	if ( channels.length > 100 ) {
		checkGames(channels.slice(100), mention);
		channels = channels.slice(0, 100);
	}
	if ( channels.length ) got.get( 'https://api.twitch.tv/kraken/channels?id=' + channels.map( channel => channel.id ).join(','), {
		headers: kraken,
		responseType: 'json'
	} ).then( response => {
		var body = response.body;
		if ( response.statusCode !== 200 || !body || body.error || !body.channels ) {
			console.log( '- ' + response.statusCode + ': Error while checking games: ' + ( body && ( body.message || body.error ) ) );
			if ( mention ) bot.say( mention[0], 'gamepediaWIKIBOT @' + mention[1] + ', I couldn\'t start changing the default wiki automatically :(' );
		}
		else {
			var updated = body.channels.filter( user => user.game !== channels.find( channel => channel.id === user._id ).game );
			if ( updated.length ) updated.forEach( channel => {
				var game = channel.game;
				if ( game ) {
					channel.text = 'I automatically changed the default wiki to: ';
					if ( allSites.some( site => site.wiki_domain === game.toLowerCase().replace( / /g, '' ) + '.gamepedia.com' && ( site.ss_good_articles >= 100 || site.official_wiki ) ) ) {
						channel.wiki = 'https://' + game.toLowerCase().replace( / /g, '' ) + '.gamepedia.com/';
						saveCheckedGames(channel, mention);
					}
					else {
						var wiki = allSites.find( site => site.wiki_display_name === game + ' Wiki (EN)' && ( site.ss_good_articles >= 100 || site.official_wiki ) );
						if ( wiki ) {
							channel.wiki = 'https://' + wiki.wiki_domain + '/';
							saveCheckedGames(channel, mention);
						}
						else got.get( 'https://community.fandom.com/api/v1/Wikis/ByString?expand=true&includeDomain=true&lang=en&limit=10&string=' + encodeURIComponent( game ) + '&format=json', {
							responseType: 'json'
						} ).then( wsresponse => {
							var wsbody = wsresponse.body;
							if ( wsresponse.statusCode !== 200 || !wsbody || wsbody.exception || !wsbody.items ) {
								console.log( '- ' + wsresponse.statusCode + ': Error while getting the wiki results: ' + ( wsbody && wsbody.exception && wsbody.exception.details ) );
								channel.text = 'I got an error while searching for a wiki, I kept the current default wiki.';
								saveCheckedGames(channel, mention);
							}
							else {
								wiki = wsbody.items.find( site => site.stats.articles >= 100 );
								if ( wiki ) {
									channel.wiki = wiki.url + '/';
									saveCheckedGames(channel, mention);
								}
								else if ( /(?: \d{1,2}| [IV]{1,3}|: .+)$/.test(game) ) {
									game = game.replace( /(?: \d{1,2}| [IV]{1,3}|: .+)$/, '' );
									if ( allSites.some( site => site.wiki_domain === game.toLowerCase().replace( / /g, '' ) + '.gamepedia.com' && ( site.ss_good_articles >= 100 || site.official_wiki ) ) ) {
										channel.wiki = 'https://' + game.toLowerCase().replace( / /g, '' ) + '.gamepedia.com/';
										saveCheckedGames(channel, mention);
									}
									else {
										wiki = allSites.find( site => site.wiki_display_name === game + ' Wiki (EN)' && ( site.ss_good_articles >= 100 || site.official_wiki ) );
										if ( wiki ) {
											channel.wiki = 'https://' + wiki.wiki_domain + '/';
											saveCheckedGames(channel, mention);
										}
										else got.get( 'https://community.fandom.com/api/v1/Wikis/ByString?expand=true&includeDomain=true&lang=en&limit=10&string=' + encodeURIComponent( game ) + '&format=json', {
											responseType: 'json'
										} ).then( ws2response => {
											var ws2body = ws2response.body;
											if ( ws2response.statusCode !== 200 || !ws2body || ws2body.exception || !ws2body.items ) {
												console.log( '- ' + ws2response.statusCode + ': Error while getting the wiki results: ' + ( ws2body && ws2body.exception && ws2body.exception.details ) );
												channel.text = 'I got an error while searching for a wiki, I kept the current default wiki.';
											}
											else {
												wiki = ws2body.items.find( site => site.stats.articles >= 100 );
												if ( wiki ) channel.wiki = wiki.url + '/';
												else channel.text = 'I couldn\'t find a wiki for "' + channel.game + '", I kept the current default wiki.';
											}
											saveCheckedGames(channel, mention);
										}, ws2error => {
											console.log( '- Error while getting the wiki results: ' + ws2error );
											channel.text = 'I got an error while searching for a wiki, I kept the current default wiki.';
											saveCheckedGames(channel, mention);
										} );
									}
								}
								else {
									channel.text = 'I couldn\'t find a wiki for "' + channel.game + '", I kept the current default wiki.';
									saveCheckedGames(channel, mention);
								}
							}
						}, wserror => {
							console.log( '- Error while getting the wiki results: ' + wserror );
							channel.text = 'I got an error while searching for a wiki, I kept the current default wiki.';
							saveCheckedGames(channel, mention);
						} );
					}
				}
				else {
					channel.text = 'No game is set, I kept the current default wiki.';
					saveCheckedGames(channel, mention);
				}
			} );
		}
	}, error => {
		console.log( '- Error while checking games: ' + error );
		if ( mention ) bot.say( mention[0], 'gamepediaWIKIBOT @' + mention[1] + ', I couldn\'t start changing the default wiki automatically :(' );
	} );
}

function saveCheckedGames(channel, mention) {
	var sql = 'UPDATE twitch SET game = ? WHERE id = ?';
	var args = [channel.game, channel._id];
	if ( channel.wiki ) {
		sql = 'UPDATE twitch SET wiki = ?, game = ? WHERE id = ?';
		args.unshift(channel.wiki);
	}
	db.run( sql, args, function (dberror) {
		if ( dberror ) {
			console.log( '- Error while updating the game for #' + channel.name + ': ' + dberror );
			if ( mention ) bot.say( mention[0], 'gamepediaWIKIBOT @' + mention[1] + ', I couldn\'t start changing the default wiki automatically :(' );
			return dberror;
		}
		console.log( '- Game successfully updated for #' + channel.name );
		bot.say( channel.name, 'gamepediaWIKIBOT ' + ( mention ? '@' + mention[1] + ', ' : '' ) + channel.text + ( channel.wiki || '' ) );
	} );
}

bot.connect().catch( error => console.log( '- Error while connecting: ' + error ) );


async function graceful(code = 0) {
	stop = true;
	console.log( '- SIGTERM: Preparing to close...' );
	clearInterval(checkGamesInterval);
	setTimeout( async () => {
		console.log( '- SIGTERM: Destroying client...' );
		await bot.disconnect();
		await db.close( dberror => {
			if ( dberror ) {
				console.log( '- SIGTERM: Error while closing the database connection: ' + dberror );
				return dberror;
			}
			console.log( '- SIGTERM: Closed the database connection.' );
		} );
		setTimeout( async () => {
			console.log( '- SIGTERM: Closing takes too long, terminating!' );
			process.exit(code);
		}, 2000 ).unref();
	}, 1000 ).unref();
}

process.once( 'SIGINT', graceful );
process.once( 'SIGTERM', graceful );