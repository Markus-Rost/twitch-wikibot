require('dotenv').config();
const util = require('util');
util.inspect.defaultOptions = {compact:false,breakLength:Infinity};

const TwitchJS = require('twitch-js');
var request = require('request');
var htmlparser = require('htmlparser2');

var stop = false;
var isDebug = ( process.argv[2] === 'debug' );

const sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database( './wikibot.db', 'OPEN_READWRITE | OPEN_CREATE', error => {
	if ( error ) {
		console.log( '- Error while connecting to the database: ' + error );
		return error;
	}
	console.log( '- Connected to the database.' );
} )

var bot = new TwitchJS.client( {
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

function getSettings(trysettings = 1) {
	db.all( 'SELECT id, name FROM twitch', [], (dberror, rows) => {
		if ( dberror ) {
			console.log( '- ' + trysettings + '. Error while getting the settings: ' + dberror );
			if ( dberror.message === 'SQLITE_ERROR: no such table: twitch' ) {
				db.run( 'CREATE TABLE IF NOT EXISTS twitch(id INTEGER PRIMARY KEY UNIQUE NOT NULL, name STRING NOT NULL, wiki STRING NOT NULL DEFAULT [https://help.gamepedia.com/], game STRING) WITHOUT ROWID;', [], function (error) {
					if ( error ) {
						console.log( '- Error while creating the table: ' + error );
						return error;
					}
					console.log( '- Created the table.' );
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
		rows.forEach( channel => {
			bot.join(channel.name).catch( error => ( error === 'No response from Twitch.' ? {} : console.log( '#' + channel.name + ': ' + error ) ) );
		} );
		
		setTimeout( () => {
			console.log( '- Joined ' + bot.getChannels().length + ' out of ' + rows.length + ' streams.' );
			var channels = rows.filter( channel => !bot.getChannels().includes( '#' + channel.name ) );
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
	if ( channels.length ) request( {
		uri: 'https://api.twitch.tv/kraken/channels?id=' + channels.map( channel => channel.id ).join(','),
		headers: kraken,
		json: true
	}, function( error, response, body ) {
		if ( error || !response || response.statusCode !== 200 || !body || body.error || !body.channels ) {
			console.log( '- ' + ( response && response.statusCode ) + ': Error while checking missing streams: ' + ( error || body && ( body.message || body.error ) ) );
		}
		else {
			body.channels.forEach( user => {
				bot.join(user.name).catch( error => ( error === 'No response from Twitch.' ? {} : console.log( '#' + user.name + ': ' + error ) ) );
				if ( channels.find( channel => channel.id === user._id ).name !== user.name ) {
					db.run( 'UPDATE twitch SET name = ? WHERE id = ?', [user.name, user._id], function (dberror) {
						if ( dberror ) {
							console.log( '- Error while changing the name to #' + user.name + ': ' + dberror );
							return dberror;
						}
						console.log( '- Name successfully changed to #' + user.name + '.' );
					} );
				}
			} );
			if ( body.channels.length !== channels.length ) {
				channels = channels.filter( channel => !body.channels.some( user => user._id === channel.id ) );
				db.run( 'DELETE FROM twitch WHERE id IN (' + channels.map( channel => '?' ).join(', ') + ')', channels.map( channel => channel.id ), function (dberror) {
					if ( dberror ) {
						console.log( '- Error while removing names: ' + dberror );
						return dberror;
					}
					bot.whisper( process.env.ownername, 'I removed streams, that didn\'t exist anymore: ' + channels.map( channel => '#' + channel.name ).join(', ') );
					console.log( '- I removed streams, that didn\'t exist anymore: ' + channels.map( channel => '#' + channel.name ).join(', ') );
				} );
			}
		}
	} );
}

var allSites = [];

function getAllSites() {
	request( {
		uri: 'https://help.gamepedia.com/api.php?action=allsites&formatversion=2&do=getSiteStats&filter=wikis|wiki_domain,wiki_display_name,wiki_managers,official_wiki,created,ss_good_articles&format=json',
		json: true
	}, function( error, response, body ) {
		if ( error || !response || response.statusCode !== 200 || !body || body.status !== 'okay' || !body.data || !body.data.wikis ) {
			console.log( '- ' + ( response && response.statusCode ) + ': Error while gettings all sites: ' + ( error || body && body.error && body.error.info ) );
		}
		else {
			console.log( '- Sites successfully loaded.' );
			allSites = JSON.parse(JSON.stringify(body.data.wikis.filter( site => /^[a-z\d-]{1,50}\.gamepedia\.com$/.test(site.wiki_domain) )));
		}
	} );
}

bot.on('connected', function(address, port) {
	console.log( '\n- Successfully logged in!' );
	getSettings();
	getAllSites();
});

var cmds = {
	setwiki: bot_setwiki,
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
				else request( {
					uri: wikinew + 'api.php?action=query&format=json',
					json: true
				}, function( error, response, body ) {
					if ( error || !response || response.statusCode !== 200 || !body || !( body instanceof Object ) ) {
						if ( forced || ( response && ( response.request && response.request.uri && wikinew.noWiki(response.request.uri.href) || response.statusCode === 410 ) ) ) {
							console.log( '- This wiki doesn\'t exist!' );
							bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', this wiki does not exist!' );
							var nowiki = true;
						}
						else {
							console.log( '- ' + ( response && response.statusCode ) + ': Error while reaching the wiki: ' + ( error || body && body.error && body.error.info ) );
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
			
			request.put( {
				uri: 'https://api.twitch.tv/kraken/users/' + process.env.bot + '/follows/channels/' + userstate['user-id'],
				headers: kraken,
				json: true
			}, function( error, response, body ) {
				if ( error || !response || response.statusCode !== 200 || !body || body.error ) {
					bot.whisper( process.env.ownername, 'Error while following ' + userstate['display-name'] );
					console.log( '- ' + ( response && response.statusCode ) + ': Error while following ' + userstate['display-name'] + ': ' + ( error || body && ( body.message || body.error ) ) );
				} else console.log( '- I\'m now following ' + userstate['display-name'] + '.' );
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
			
			request.delete( {
				uri: 'https://api.twitch.tv/kraken/users/' + process.env.bot + '/follows/channels/' + userstate['user-id'],
				headers: kraken,
				json: true
			}, function( error, response, body ) {
				if ( error || !response || response.statusCode !== 204 || body ) {
					bot.whisper( process.env.ownername, 'Error while unfollowing ' + userstate['display-name'] );
					console.log( '- ' + ( response && response.statusCode ) + ': Error while unfollowing ' + userstate['display-name'] + ': ' + ( error || body && ( body.message || body.error ) ) );
				} else console.log( '- I\'m not following ' + userstate['display-name'] + ' anymore.' );
			} );
		} );
	} else {
		bot_link(channel, msg.split(' ').slice(1).join(' '), wiki);
	}
}

function bot_link(channel, title, wiki) {
	if ( title.length > 300 ) title = title.substring(0, 300);
	if ( title.toLowerCase() === 'random' ) bot_random(channel, wiki);
	else request( {
		uri: wiki + 'api.php?action=query&meta=allmessages|siteinfo&ammessages=description&amenableparser=true&siprop=general|namespaces|specialpagealiases&iwurl=true&redirects=true&prop=pageprops|extracts&ppprop=description&exsentences=10&exintro=true&explaintext=true&titles=' + encodeURIComponent( title ) + '&format=json',
		json: true
	}, function( error, response, body ) {
		if ( error || !response || response.statusCode !== 200 || !body || !body.query ) {
			if ( response && ( response.request && response.request.uri && wiki.noWiki(response.request.uri.href) || response.statusCode === 410 ) ) {
				console.log( '- This wiki doesn\'t exist!' );
				bot.say( channel, 'This wiki does not exist!' );
			}
			else {
				console.log( '- ' + ( response && response.statusCode ) + ': Error while getting the search results: ' + ( error || body && body.error && body.error.info ) );
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
							request( {
								uri: wiki + 'api.php?action=query&pageids=' + thread.slice(1).join(':') + '&format=json',
								json: true
							}, function( therror, thresponse, thbody ) {
								if ( therror || !thresponse || thresponse.statusCode !== 200 || !thbody || !thbody.query || !thbody.query.pages ) {
									console.log( '- ' + ( thresponse && thresponse.statusCode ) + ': Error while getting the thread: ' + ( therror || thbody && thbody.error && thbody.error.info ) );
									bot.say( channel, 'I got an error while searching: ' + wiki.toLink(querypage.title, '', '', body) );
								}
								else {
									querypage = thbody.query.pages[thread.slice(1).join(':')];
									if ( querypage.missing !== undefined ) {
										bot.say( channel, 'I couldn\'t find a result for "' + title + '" on this wiki :( ' + wiki );
									}
									else {
										var text = wiki.toLink(thread.join(':'), '', '', body);
										request( {
											uri: wiki.toDescLink(querypage.title)
										}, function( descerror, descresponse, descbody ) {
											if ( descerror || !descresponse || descresponse.statusCode !== 200 || !descbody ) {
												console.log( '- ' + ( descresponse && descresponse.statusCode ) + ': Error while getting the description: ' + descerror );
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
										} );
									}
								}
							} );
						}
						else request( {
							uri: wiki + 'api/v1/Search/List?minArticleQuality=0&namespaces=' + Object.values(body.query.namespaces).filter( ns => ns.content !== undefined ).map( ns => ns.id ).join(',') + '&limit=10&query=' + encodeURIComponent( title ) + '&format=json',
							json: true
						}, function( wserror, wsresponse, wsbody ) {
							if ( wserror || !wsresponse || wsresponse.statusCode !== 200 || !wsbody || wsbody.exception || !wsbody.total || !wsbody.items || !wsbody.items.length ) {
								if ( wsbody && ( !wsbody.total || ( wsbody.items && !wsbody.items.length ) || ( wsbody.exception && wsbody.exception.code === 404 ) ) ) {
									bot.say( channel, 'I couldn\'t find a result for "' + title + '" on this wiki :( ' + wiki );
								}
								else {
									console.log( '- ' + ( wsresponse && wsresponse.statusCode ) + ': Error while getting the search results: ' + ( wserror || wsbody && wsbody.exception && wsbody.exception.details ) );
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
								else request( {
									uri: wiki.toDescLink(querypage.title)
								}, function( descerror, descresponse, descbody ) {
									if ( descerror || !descresponse || descresponse.statusCode !== 200 || !descbody ) {
										console.log( '- ' + ( descresponse && descresponse.statusCode ) + ': Error while getting the description: ' + descerror );
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
								} );
							}
						} );
					}
					else {
						request( {
							uri: wiki + 'api.php?action=query&prop=pageprops|extracts&ppprop=description&exsentences=10&exintro=true&explaintext=true&generator=search&gsrnamespace=' + Object.values(body.query.namespaces).filter( ns => ns.content !== undefined ).map( ns => ns.id ).join('|') + '&gsrlimit=1&gsrsearch=' + encodeURIComponent( title ) + '&format=json',
							json: true
						}, function( srerror, srresponse, srbody ) {
							if ( srerror || !srresponse || srresponse.statusCode !== 200 || !srbody ) {
								console.log( '- ' + ( srresponse && srresponse.statusCode ) + ': Error while getting the search results: ' + ( srerror || srbody && srbody.error && srbody.error.info ) );
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
					if ( !text.includes( ' – ' ) && wiki.isFandom() ) request( {
						uri: wiki.toDescLink(querypage.title)
					}, function( descerror, descresponse, descbody ) {
						if ( descerror || !descresponse || descresponse.statusCode !== 200 || !descbody ) {
							console.log( '- ' + ( descresponse && descresponse.statusCode ) + ': Error while getting the description: ' + descerror );
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
				else if ( wiki.isFandom() ) request( {
					uri: wiki.toDescLink(body.query.general.mainpage)
				}, function( descerror, descresponse, descbody ) {
					if ( descerror || !descresponse || descresponse.statusCode !== 200 || !descbody ) {
						console.log( '- ' + ( descresponse && descresponse.statusCode ) + ': Error while getting the description: ' + descerror );
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
				} );
				else request( {
					uri: wiki + 'api.php?action=query&redirects=true&prop=pageprops|extracts&ppprop=description&exsentences=10&exintro=true&explaintext=true&titles=' + encodeURIComponent( body.query.general.mainpage ) + '&format=json',
					json: true
				}, function( mperror, mpresponse, mpbody ) {
					if ( mperror || !mpresponse || mpresponse.statusCode !== 200 || !mpbody || !mpbody.query ) {
						console.log( '- ' + ( mpresponse && mpresponse.statusCode ) + ': Error while getting the main page: ' + ( mperror || mpbody && mpbody.error && mpbody.error.info ) );
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
				} );
			}
		}
	} );
}

function bot_random(channel, wiki) {
	request( {
		uri: wiki + 'api.php?action=query&meta=allmessages|siteinfo&ammessages=description&amenableparser=true&siprop=general&prop=pageprops|extracts&ppprop=description&exsentences=10&exintro=true&explaintext=true&generator=random&grnnamespace=0&format=json',
		json: true
	}, function( error, response, body ) {
		if ( error || !response || response.statusCode !== 200 || !body || !body.query || !body.query.pages ) {
			if ( response && ( response.request && response.request.uri && wiki.noWiki(response.request.uri.href) || response.statusCode === 410 ) ) {
				console.log( '- This wiki doesn\'t exist!' );
				bot.say( channel, 'This wiki does not exist!' );
			}
			else {
				console.log( '- ' + ( response && response.statusCode ) + ': Error while getting the search results: ' + ( error || body && body.error && body.error.info ) );
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
				request( {
					uri: wiki.toDescLink(querypage.title)
				}, function( descerror, descresponse, descbody ) {
					if ( descerror || !descresponse || descresponse.statusCode !== 200 || !descbody ) {
						console.log( '- ' + ( descresponse && descresponse.statusCode ) + ': Error while getting the description: ' + descerror );
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
				} );
			}
			
			if ( !nosend ) bot.say( channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
		}
	} );
}

String.prototype.noWiki = function(href) {
	if ( !href ) return false;
	else if ( this.endsWith( '.gamepedia.com/' ) ) return 'https://www.gamepedia.com/' === href;
	else return [
		this.replace( /^https:\/\/([a-z\d-]{1,50}\.(?:fandom\.com|wikia\.org))\/(?:[a-z-]{1,8}\/)?$/, 'https://community.fandom.com/wiki/Community_Central:Not_a_valid_community?from=$1' ),
		this + 'language-wikis'
	].includes( href );
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
	return this.replace( pattern, ( typeof replacement === 'string' ? replacement.replace( '$', '$$$$' ) : replacement ) );
};

bot.on( 'chat', function(channel, userstate, msg, self) {
	// Don't listen to my own messages..
	if ( stop || self ) return;

	// Do your stuff.
	if ( msg.toLowerCase().startsWith( process.env.prefix + ' ' ) || msg.toLowerCase() === process.env.prefix ) {
		if ( !allSites.length ) getAllSites();
		console.log( channel + ': ' + msg );
		db.get( 'SELECT wiki FROM twitch WHERE id = ?', [userstate['room-id']], (dberror, row) => {
			if ( dberror || !row ) {
				console.log( '- Error while getting the wiki: ' + dberror );
				bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', I got an error!' )
				return dberror;
			}
			var wiki = row.wiki;
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
		} );
	}
} );

bot.on( 'notice', function(channel, msgid, msg) {
	if ( msgid !== 'host_target_went_offline' ) console.log( channel + ': ' + msg );
} );

const checkGamesInterval = setInterval( () => {
	db.all( 'SELECT id, game FROM twitch WHERE game IS NOT NULL', [], (dberror, rows) => {
		if ( dberror ) {
			console.log( '- Error while getting the game settings: ' + dberror );
			return dberror;
		}
		checkGames(rows);
	} );
}, 60000 );

function checkGames(channels, mention) {
	if ( channels.length > 100 ) {
		checkGames(channels.slice(100), mention);
		channels = channels.slice(0, 100);
	}
	if ( channels.length ) request( {
		uri: 'https://api.twitch.tv/kraken/channels?id=' + channels.map( channel => channel.id ).join(','),
		headers: kraken,
		json: true
	}, function( error, response, body ) {
		if ( error || !response || response.statusCode !== 200 || !body || body.error || !body.channels ) {
			console.log( '- ' + ( response && response.statusCode ) + ': Error while checking games: ' + ( error || body && ( body.message || body.error ) ) );
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
						else request( {
							uri: 'https://community.fandom.com/api/v1/Wikis/ByString?expand=true&includeDomain=true&lang=en&limit=10&string=' + encodeURIComponent( game ) + '&format=json',
							json: true
						}, function( wserror, wsresponse, wsbody ) {
							if ( wserror || !wsresponse || wsresponse.statusCode !== 200 || !wsbody || wsbody.exception || !wsbody.items ) {
								console.log( '- ' + ( wsresponse && wsresponse.statusCode ) + ': Error while getting the wiki results: ' + ( wserror || wsbody && wsbody.exception && wsbody.exception.details ) );
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
										else request( {
											uri: 'https://community.fandom.com/api/v1/Wikis/ByString?expand=true&includeDomain=true&lang=en&limit=10&string=' + encodeURIComponent( game ) + '&format=json',
											json: true
										}, function( ws2error, ws2response, ws2body ) {
											if ( ws2error || !ws2response || ws2response.statusCode !== 200 || !ws2body || ws2body.exception || !ws2body.items ) {
												console.log( '- ' + ( ws2response && ws2response.statusCode ) + ': Error while getting the wiki results: ' + ( ws2error || ws2body && ws2body.exception && ws2body.exception.details ) );
												channel.text = 'I got an error while searching for a wiki, I kept the current default wiki.';
											}
											else {
												wiki = ws2body.items.find( site => site.stats.articles >= 100 );
												if ( wiki ) channel.wiki = wiki.url + '/';
												else channel.text = 'I couldn\'t find a wiki for this game, I kept the current default wiki.';
											}
											saveCheckedGames(channel, mention);
										} );
									}
								}
								else {
									channel.text = 'I couldn\'t find a wiki for this game, I kept the current default wiki.';
									saveCheckedGames(channel, mention);
								}
							}
						} );
					}
				}
				else {
					channel.text = 'No game is set, I kept the current default wiki.';
					saveCheckedGames(channel, mention);
				}
			} );
		}
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
				console.log( '- SIGTERM: Error while closing the database: ' + dberror );
				return dberror;
			}
			console.log( '- SIGTERM: Closed the database.' );
		} );
		setTimeout( async () => {
			console.log( '- SIGTERM: Closing takes too long, terminating!' );
			process.exit(code);
		}, 2000 ).unref();
	}, 1000 ).unref();
}

process.once( 'SIGINT', graceful );
process.once( 'SIGTERM', graceful );