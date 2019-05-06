require('dotenv').config();
const util = require('util');
util.inspect.defaultOptions = {compact:false,breakLength:Infinity};

const TwitchJS = require('twitch-js');
var request = require('request');
var htmlparser = require('htmlparser2');

var isDebug = ( process.argv[2] === 'debug' ? true : false );

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
		password: 'oauth:' + process.env.oauth
	},
	channels: []
}

var bot = new TwitchJS.client(options);

const access = {'PRIVATE-TOKEN': process.env.access};
const kraken = {
	Accept: 'application/vnd.twitchtv.v5+json',
	'Client-ID': process.env.client,
	Authorization: 'OAuth ' + process.env.oauth
}

var trysettings = 1;
var botsettings = {};

function getSettings() {
	request( {
		uri: process.env.read + process.env.file + process.env.raw,
		headers: access,
		json: true
	}, function( error, response, body ) {
		if ( error || !response || response.statusCode !== 200 || !body || body.message || body.error ) {
			console.log( '- ' + ( response ? response.statusCode + ': ' : '' ) + trysettings + '. Error while getting the settings' + ( error ? ': ' + error : ( body ? ( body.message ? ': ' + body.message : ( body.error ? ': ' + body.error : '.' ) ) : '.' ) ) );
			if ( trysettings < 10 ) {
				trysettings++;
				getSettings();
			}
		}
		else {
			console.log( '- Settings successfully loaded.' );
			botsettings = Object.assign({}, body);
			Object.keys(botsettings).forEach( channel => {
				bot.join(channel).catch( error => ( error === 'No response from Twitch.' ? {} : console.log( channel + ': ' + error ) ) );
			} );
			
			var timeout = setTimeout( checkChannels, 10000 );
		}
	} );
}

function checkChannels() {
	var channels = Object.keys(botsettings);
	var streams = bot.getChannels();
	console.log( '- Joined ' + streams.length + ' out of ' + channels.length + ' streams.' );
	channels = channels.filter( channel => !streams.includes( channel ) );
	if ( channels.length ) request( {
		uri: 'https://api.twitch.tv/kraken/users?login=' + channels.join(',').replace( '#', '' ),
		headers: kraken,
		json: true
	}, function( delerror, delresponse, delbody ) {
		if ( delerror || !delresponse || delresponse.statusCode !== 200 || !delbody || delbody.error || !delbody.users ) {
			console.log( '- ' + ( delresponse ? delresponse.statusCode + ': ' : '' ) + 'Error while checking missing streams' + ( delerror ? ': ' + delerror.message : ( delbody ? ( delbody.message ? ': ' + delbody.message : ( delbody.error ? ': ' + delbody.error : '.' ) ) : '.' ) ) );
		}
		else {
			delbody.users.forEach( channel => {
				bot.join(channel.name).catch( error => console.log( '#' + channel.name + ': ' + error ) );
			} );
			if ( delbody.users.length !== channels.length ) {
				channels = channels.filter( channel => !delbody.users.some( user => '#' + user.name === channel ) );
				var temp_settings = Object.assign({}, botsettings);
				channels.forEach( channel => delete temp_settings[channel] );
				request.post( {
					uri: process.env.save,
					headers: access,
					body: {
						branch: 'master',
						commit_message: 'WikiBot: Settings removed.',
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
						console.log( '- ' + ( response ? response.statusCode + ': ' : '' ) + 'Error while removing the settings' + ( error ? ': ' + error.message : ( body ? ( body.message ? ': ' + body.message : ( body.error ? ': ' + body.error : '.' ) ) : '.' ) ) );
					}
					else {
						botsettings = Object.assign({}, temp_settings);
						bot.whisper( '#Markus_Rost', 'I removed streams, that didn\'t exist anymore: ' + channels.join(', ') );
						console.log( '- I removed streams, that didn\'t exist anymore: ' + channels.join(', ') );
						checkChannels();
					}
				} );
			}
		}
	} );
}

var allSites = [];

function getAllSites() {
	request( {
		uri: 'https://help.gamepedia.com/api.php?action=allsites&formatversion=2&do=getSiteStats&filter=wikis|wiki_domain,wiki_display_name,wiki_managers,official_wiki,created,ss_good_articles,ss_total_pages,ss_total_edits,ss_active_users&format=json',
		json: true
	}, function( error, response, body ) {
		if ( error || !response || response.statusCode !== 200 || !body || body.status !== 'okay' || !body.data || !body.data.wikis ) {
			console.log( '- ' + ( response ? response.statusCode + ': ' : '' ) + 'Error while gettings all sites' + ( error ? ': ' + error : ( body ? ( body.error ? ': ' + body.error.info : '.' ) : '.' ) ) );
		}
		else {
			console.log( '- Sites successfully loaded.' );
			allSites = JSON.parse(JSON.stringify(body.data.wikis.filter( site => /^[a-z\d-]{1,50}\.gamepedia\.com$/.test(site.wiki_domain) )));
		}
	} );
}

bot.on('connected', function(address, port) {
	console.log( '- Successfully logged in!' );
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
		if ( args[1] === '--force' ) {
			var forced = true;
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
					if ( forced || ( response && response.request && response.request.uri && response.request.uri.href === wikinew.noWiki() ) ) {
						console.log( '- This wiki doesn\'t exist! ' + ( error ? error.message : ( body ? ( body.error ? body.error.info : '' ) : '' ) ) );
						bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', this wiki does not exist!' );
						var nowiki = true;
					} else {
						console.log( '- ' + ( response ? response.statusCode + ': ' : '' ) + 'Error while reaching the wiki' + ( error ? ': ' + error : ( body ? ( body.error ? ': ' + body.error.info : '.' ) : '.' ) ) );
						var comment = ' I got an error while checking if the wiki exists!';
					}
				}
				if ( !nowiki ) {
					var temp_settings = Object.assign({}, botsettings);
					temp_settings[channel] = wikinew;
					request.post( {
						uri: process.env.save,
						headers: access,
						body: {
							branch: 'master',
							commit_message: 'WikiBot: Settings updated.',
							actions: [
								{
									action: 'update',
									file_path: process.env.file,
									content: JSON.stringify( temp_settings, null, '\t' )
								}
							]
						},
						json: true
					}, function( serror, sresponse, sbody ) {
						if ( serror || !sresponse || sresponse.statusCode !== 201 || !sbody || sbody.error ) {
							console.log( '- ' + ( sresponse ? sresponse.statusCode + ': ' : '' ) + 'Error while editing the settings' + ( serror ? ': ' + serror.message : ( sbody ? ( sbody.message ? ': ' + sbody.message : ( sbody.error ? ': ' + sbody.error : '.' ) ) : '.' ) ) );
							bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', I couldn\'t change the default wiki :(' );
						}
						else {
							botsettings = Object.assign({}, temp_settings);
							console.log( '- Settings successfully updated.' );
							bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', I ' + ( forced ? 'forced' : 'changed' ) + ' the default wiki to: ' + botsettings[channel] + ( comment ? comment : '' ) );
						}
					} );
				}
			} );
		}
		else {
			bot_link(channel, msg.split(' ').slice(1).join(' '), wiki);
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
			var text = error.name + ': ' + error.message;
		}
		if ( isDebug ) console.log( '--- EVAL START ---\n\u200b' + text.replace( /\n/g, '\n\u200b' ) + '\n--- EVAL END ---' );
		if ( text.length > 450 ) bot.say( channel, 'gamepediaWIKIBOT ✅' ).catch( err => bot.say( channel, err.name + ': ' + err.message ) );
		else bot.say( channel, 'gamepediaWIKIBOT ' + text ).catch( err => bot.say( channel, err.name + ': ' + err.message ) );
	} else {
		bot_link(channel, msg.split(' ').slice(1).join(' '), wiki);
	}
}

function bot_join(channel, userstate, msg, args, wiki) {
	if ( args[0] && args[0].toLowerCase() === '@' + userstate.username ) {
		if ( '#' + userstate.username in botsettings ) {
			bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', I already joined your stream.' );
		}
		else {
			var temp_settings = Object.assign({}, botsettings);
			temp_settings['#' + userstate.username] = wiki;
			request.post( {
				uri: process.env.save,
				headers: access,
				body: {
					branch: 'master',
					commit_message: 'WikiBot: Settings added.',
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
					console.log( '- ' + ( response ? response.statusCode + ': ' : '' ) + 'Error while adding the settings' + ( error ? ': ' + error.message : ( body ? ( body.message ? ': ' + body.message : ( body.error ? ': ' + body.error : '.' ) ) : '.' ) ) );
					bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', I couldn\'t join your stream :(' );
				}
				else {
					botsettings = Object.assign({}, temp_settings);
					console.log( '- I\'ve been added to a stream.' );
					bot.join('#' + userstate.username);
					bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', I joined your stream.' );
					
					request.put( {
						uri: 'https://api.twitch.tv/kraken/users/' + process.env.bot + '/follows/channels/' + userstate['user-id'],
						headers: kraken,
						json: true
					}, function( fwerror, fwresponse, fwbody ) {
						if ( fwerror || !fwresponse || fwresponse.statusCode !== 200 || !fwbody || fwbody.error ) {
							bot.whisper( '#Markus_Rost', 'Error while following ' + userstate['display-name'] );
							console.log( '- ' + ( fwresponse ? fwresponse.statusCode + ': ' : '' ) + 'Error while following ' + userstate['display-name'] + ( fwerror ? ': ' + fwerror.message : ( fwbody ? ( fwbody.message ? ': ' + fwbody.message : ( fwbody.error ? ': ' + fwbody.error : '.' ) ) : '.' ) ) );
						} else console.log( '- I\'m now following ' + userstate['display-name'] + '.' );
					} );
				}
			} );
		}
	} else {
		bot_link(channel, msg.split(' ').slice(1).join(' '), wiki);
	}
}

function bot_leave(channel, userstate, msg, args, wiki) {
	if ( userstate['user-id'] === userstate['room-id'] && args[0] && args[0].toLowerCase() === '@' + userstate.username ) {
		var temp_settings = Object.assign({}, botsettings);
		delete temp_settings['#' + userstate.username];
		request.post( {
			uri: process.env.save,
			headers: access,
			body: {
				branch: 'master',
				commit_message: 'WikiBot: Settings removed.',
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
				console.log( '- ' + ( response ? response.statusCode + ': ' : '' ) + 'Error while removing the settings' + ( error ? ': ' + error.message : ( body ? ( body.message ? ': ' + body.message : ( body.error ? ': ' + body.error : '.' ) ) : '.' ) ) );
				bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', I couldn\'t leave your stream :(' );
			}
			else {
				botsettings = Object.assign({}, temp_settings);
				bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', I will leave your stream now.' );
				console.log( '- I\'ve been removed from a stream.' );
				bot.part('#' + userstate.username);
				
				request.delete( {
					uri: 'https://api.twitch.tv/kraken/users/' + process.env.bot + '/follows/channels/' + userstate['user-id'],
					headers: kraken,
					json: true
				}, function( fwerror, fwresponse, fwbody ) {
					if ( fwerror || !fwresponse || fwresponse.statusCode !== 204 || !fwbody || fwbody.error ) {
						bot.whisper( '#Markus_Rost', 'Error while unfollowing ' + userstate['display-name'] );
						console.log( '- ' + ( fwresponse ? fwresponse.statusCode + ': ' : '' ) + 'Error while unfollowing ' + userstate['display-name'] + ( fwerror ? ': ' + fwerror.message : ( fwbody ? ( fwbody.message ? ': ' + fwbody.message : ( fwbody.error ? ': ' + fwbody.error : '.' ) ) : '.' ) ) );
					} else console.log( '- I\'m not following ' + userstate['display-name'] + ' anymore.' );
				} );
			}
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
			if ( response && response.request && response.request.uri && response.request.uri.href === wiki.noWiki() ) {
				console.log( '- This wiki doesn\'t exist! ' + ( error ? error.message : ( body ? ( body.error ? body.error.info : '' ) : '' ) ) );
				bot.say( channel, 'This wiki does not exist!' );
			}
			else {
				console.log( '- ' + ( response ? response.statusCode + ': ' : '' ) + 'Error while getting the search results' + ( error ? ': ' + error : ( body ? ( body.error ? ': ' + body.error.info : '.' ) : '.' ) ) );
				bot.say( channel, 'I got an error while searching: ' + wiki.toLink() + ( title ? 'Special:Search?search=' + title.toSearch() : '' ) );
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
					if ( /^https:\/\/[a-z\d-]{1,50}\.(?:fandom\.com|wikia\.org)\/(?:[a-z-]{1,8}\/)?$/.test(wiki) ) {
						request( {
							uri: wiki + 'api/v1/Search/List?minArticleQuality=0&namespaces=' + Object.values(body.query.namespaces).filter( ns => ns.content !== undefined ).map( ns => ns.id ).join(',') + '&limit=1&query=' + encodeURIComponent( title ) + '&format=json',
							json: true
						}, function( wserror, wsresponse, wsbody ) {
							if ( wserror || !wsresponse || wsresponse.statusCode !== 200 || !wsbody || wsbody.exception || !wsbody.items ) {
								if ( wsbody && wsbody.exception && wsbody.exception.code === 404 ) {
									bot.say( channel, 'I couldn\'t find a result for "' + title + '" on this wiki :( ' + wiki );
								}
								else {
									console.log( '- ' + ( wsresponse ? wsresponse.statusCode + ': ' : '' ) + 'Error while getting the search results' + ( wserror ? ': ' + wserror : ( wsbody ? ( wsbody.exception ? ': ' + wsbody.exception.message : '.' ) : '.' ) ) );
									bot.say( channel, 'I got an error while searching: ' + wiki.toLink() + 'Special:Search?search=' + title.toSearch() );
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
								text += wiki.toLink() + querypage.title.toTitle();
								if ( querypage.title === body.query.general.mainpage && body.query.allmessages[0]['*'] ) {
										text += ' – ' + body.query.allmessages[0]['*'];
										bot.say( channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
								}
								else request( {
									uri: wiki.toLink() + querypage.title.toTitle()
								}, function( descerror, descresponse, descbody ) {
									if ( descerror || !descresponse || descresponse.statusCode !== 200 || !descbody ) {
										console.log( '- ' + ( descresponse ? descresponse.statusCode + ': ' : '' ) + 'Error while getting the description' + ( descerror ? ': ' + descerror : '.' ) );
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
								console.log( '- ' + ( srresponse ? srresponse.statusCode + ': ' : '' ) + 'Error while getting the search results' + ( srerror ? ': ' + srerror : ( srbody ? ( srbody.error ? ': ' + srbody.error.info : '.' ) : '.' ) ) );
								bot.say( channel, 'I got an error while searching: ' + wiki.toLink() + 'Special:Search?search=' + title.toSearch() );
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
									text += wiki.toLink() + querypage.title.toTitle();
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
					var text = wiki.toLink() + querypage.title.toTitle() + ( body.query.redirects && body.query.redirects[0].tofragment ? '#' + body.query.redirects[0].tofragment.toSection() : '' );
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
					if ( !text.includes( ' – ' ) && /^https:\/\/[a-z\d-]{1,50}\.(?:fandom\.com|wikia\.org)\/(?:[a-z-]{1,8}\/)?$/.test(wiki) ) request( {
						uri: wiki.toLink() + querypage.title.toTitle()
					}, function( descerror, descresponse, descbody ) {
						if ( descerror || !descresponse || descresponse.statusCode !== 200 || !descbody ) {
							console.log( '- ' + ( descresponse ? descresponse.statusCode + ': ' : '' ) + 'Error while getting the description' + ( descerror ? ': ' + descerror : '.' ) );
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
				var text = wiki.toLink() + body.query.general.mainpage.toTitle();
				if ( body.query.allmessages[0]['*'] ) {
					text += ' – ' + body.query.allmessages[0]['*'];
					bot.say( channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
				}
				else if ( /^https:\/\/[a-z\d-]{1,50}\.(?:fandom\.com|wikia\.org)\/(?:[a-z-]{1,8}\/)?$/.test(wiki) ) request( {
					uri: wiki.toLink() + body.query.general.mainpage.toTitle()
				}, function( descerror, descresponse, descbody ) {
					if ( descerror || !descresponse || descresponse.statusCode !== 200 || !descbody ) {
						console.log( '- ' + ( descresponse ? descresponse.statusCode + ': ' : '' ) + 'Error while getting the description' + ( descerror ? ': ' + descerror : '.' ) );
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
						console.log( '- ' + ( mpresponse ? mpresponse.statusCode + ': ' : '' ) + 'Error while getting the main page' + ( mperror ? ': ' + mperror : ( mpbody ? ( mpbody.error ? ': ' + mpbody.error.info : '.' ) : '.' ) ) );
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
		uri: wiki + 'api.php?action=query&prop=pageprops|extracts&ppprop=description&exsentences=10&exintro=true&explaintext=true&generator=random&grnnamespace=0&format=json',
		json: true
	}, function( error, response, body ) {
		if ( error || !response || response.statusCode !== 200 || !body || !body.query || !body.query.pages ) {
			if ( response && response.request && response.request.uri && response.request.uri.href === wiki.noWiki() ) {
				console.log( '- This wiki doesn\'t exist! ' + ( error ? error.message : ( body ? ( body.error ? body.error.info : '' ) : '' ) ) );
				bot.say( channel, 'This wiki does not exist!' );
			}
			else {
				console.log( '- ' + ( response ? response.statusCode + ': ' : '' ) + 'Error while getting the search results' + ( error ? ': ' + error : ( body ? ( body.error ? ': ' + body.error.info : '.' ) : '.' ) ) );
				bot.say( channel, 'I got an error while searching: ' + wiki.toLink() + 'Special:Random' );
			}
		}
		else {
			var querypage = Object.values(body.query.pages)[0];
			var text = '🎲 ' + wiki.toLink() + querypage.title.toTitle();
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
			else if ( /^https:\/\/[a-z\d-]{1,50}\.(?:fandom\.com|wikia\.org)\/(?:[a-z-]{1,8}\/)?$/.test(wiki) ) {
				var nosend = true;
				request( {
					uri: wiki.toLink() + querypage.title.toTitle()
				}, function( descerror, descresponse, descbody ) {
					if ( descerror || !descresponse || descresponse.statusCode !== 200 || !descbody ) {
						console.log( '- ' + ( descresponse ? descresponse.statusCode + ': ' : '' ) + 'Error while getting the description' + ( descerror ? ': ' + descerror : '.' ) );
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

String.prototype.noWiki = function() {
	if ( this.endsWith( '.gamepedia.com/' ) ) return 'https://www.gamepedia.com/';
	else return this.replace( /^https:\/\/([a-z\d-]{1,50}\.(?:fandom\.com|wikia\.org))\/(?:[a-z-]{1,8}\/)?$/, 'https://community.fandom.com/wiki/Community_Central:Not_a_valid_community?from=$1' );
};

String.prototype.toLink = function() {
	if ( this.endsWith( '.gamepedia.com/' ) ) return this;
	else if ( this.endsWith( '.org/w/' ) && !this.endsWith( '.wikia.org/w/' ) ) return this.substring(0, this.length - 2) + 'wiki/';
	else return this + 'wiki/';
};

String.prototype.toTitle = function() {
	return this.replace( / /g, '_' ).replace( /\%/g, '%25' ).replace( /\,/g, '%2C').replace( /\'/g, '%27' ).replace( /\!/g, '%21' ).replace( /\?/g, '%3F' );
};

String.prototype.toSearch = function() {
	return encodeURIComponent( this ).replace( /%20/g, '+' );
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
		if ( !allSites.length ) getAllSites();
		console.log( channel + ': ' + msg );
		var wiki = botsettings[channel];
		var args = msg.split(' ').slice(1);
		if ( args[0] ) {
			var invoke = args[0].toLowerCase()
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
} );

bot.on( 'notice', function(channel, msgid, msg) {
	if ( msgid !== 'host_target_went_offline' ) console.log( channel + ': ' + msg );
} );

bot.connect();