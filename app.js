require('dotenv').config();
const util = require('util');
util.inspect.defaultOptions = {compact:false,breakLength:Infinity};

global.isDebug = ( process.argv[2] === 'debug' );
global.stop = false;
const kraken = {
	Accept: 'application/vnd.twitchtv.v5+json',
	'Client-ID': process.env.client,
	Authorization: 'OAuth ' + process.env.oauth
}

global.got = require('got').extend( {
	throwHttpErrors: false,
	timeout: 5000,
	headers: {
		'user-agent': 'WikiBot/' + ( isDebug ? 'testing' : process.env.npm_package_version ) + ' (Twitch; ' + process.env.npm_package_name + ')'
	}
} );

const sqlite3 = require('sqlite3').verbose();
global.db = new sqlite3.Database( './wikibot.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, dberror => {
	if ( dberror ) {
		console.log( '- Error while connecting to the database: ' + dberror );
		return dberror;
	}
	console.log( '- Connected to the database.' );
} );

const tmi = require('tmi.js');
global.bot = new tmi.client( {
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

var allSites = [];
function getAllSites() {
	got.get( 'https://help.gamepedia.com/api.php?action=allsites&formatversion=2&do=getSiteStats&filter=wikis|wiki_domain,wiki_display_name,wiki_managers,official_wiki,wiki_crossover,ss_good_articles&format=json', {
		responseType: 'json'
	} ).then( response => {
		var body = response.body;
		if ( response.statusCode !== 200 || !body || body.status !== 'okay' || !body.data || !body.data.wikis ) {
			console.log( '- ' + response.statusCode + ': Error while gettings all sites: ' + ( body && body.error && body.error.info ) );
		}
		else {
			console.log( '- Sites successfully loaded.' );
			allSites = JSON.parse(JSON.stringify(body.data.wikis.filter( site => /^[a-z\d-]{1,50}\.gamepedia\.com$/.test(site.wiki_domain) )));
			allSites.filter( site => site.wiki_crossover ).forEach( site => site.wiki_crossover = site.wiki_crossover.replace( /^(?:https?:)?\/\/(([a-z\d-]{1,50})\.(?:fandom\.com|wikia\.org)(?:(?!\/wiki\/)\/([a-z-]{1,8}))?).*/, '$1' ) );
		}
	}, error => {
			console.log( '- Error while gettings all sites: ' + error );
	} );
}
getAllSites();

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
					var wiki = allSites.find( site => site.wiki_domain === game.toLowerCase().replace( / /g, '' ) + '.gamepedia.com' && ( site.ss_good_articles >= 100 || site.official_wiki || site.wiki_crossover ) );
					if ( wiki ) {
						channel.wiki = 'https://' + ( wiki.wiki_crossover || wiki.wiki_domain ) + '/';
						saveCheckedGames(channel, mention);
					}
					else {
						wiki = allSites.find( site => site.wiki_display_name === game + ' Wiki (EN)' && ( site.ss_good_articles >= 100 || site.official_wiki || site.wiki_crossover ) );
						if ( wiki ) {
							channel.wiki = 'https://' + ( wiki.wiki_crossover || wiki.wiki_domain ) + '/';
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
									wiki = allSites.find( site => site.wiki_domain === game.toLowerCase().replace( / /g, '' ) + '.gamepedia.com' && ( site.ss_good_articles >= 100 || site.official_wiki || site.wiki_crossover ) );
									if ( wiki ) {
										channel.wiki = 'https://' + ( wiki.wiki_crossover || wiki.wiki_domain ) + '/';
										saveCheckedGames(channel, mention);
									}
									else {
										wiki = allSites.find( site => site.wiki_display_name === game + ' Wiki (EN)' && ( site.ss_good_articles >= 100 || site.official_wiki || site.wiki_crossover ) );
										if ( wiki ) {
											channel.wiki = 'https://' + ( wiki.wiki_crossover || wiki.wiki_domain ) + '/';
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

const fs = require('fs');
var cmds = {};
fs.readdirSync('./cmd').filter( file => file.endsWith('.js') ).forEach( file => {
	var command = require('./cmd/' + file);
	cmds[command.name] = command.run;
} );

bot.on('connected', function(address, port) {
	console.log( '\n- Successfully logged in!' );
	getSettings();
});

var cooldown = {};
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
				else if ( /^![a-z\d-]{1,50}$/.test(invoke) ) cmds.LINK(channel, args.slice(1).join(' '), 'https://' + invoke.substring(1) + '.gamepedia.com/');
				else if ( /^\?(?:[a-z-]{1,8}\.)?[a-z\d-]{1,50}$/.test(invoke) ) {
					if ( invoke.includes( '.' ) ) wiki = 'https://' + invoke.split('.')[1] + '.fandom.com/' + invoke.substring(1).split('.')[0] + '/';
					else wiki = 'https://' + invoke.substring(1) + '.fandom.com/';
					cmds.LINK(channel, args.slice(1).join(' '), wiki);
				}
				else if ( /^\?\?(?:[a-z-]{1,8}\.)?[a-z\d-]{1,50}$/.test(invoke) ) {
					if ( invoke.includes( '.' ) ) wiki = 'https://' + invoke.split('.')[1] + '.wikia.org/' + invoke.substring(2).split('.')[0] + '/';
					else wiki = 'https://' + invoke.substring(2) + '.wikia.org/';
					cmds.LINK(channel, args.slice(1).join(' '), wiki);
				}
				else cmds.LINK(channel, args.join(' '), wiki);
			}
			else {
				cmds.LINK(channel, args.join(' '), wiki);
			}
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

bot.connect().catch( error => console.log( '- Error while connecting: ' + error ) );

module.exports = {
    checkGames
};


async function graceful(signal) {
	stop = true;
	console.log( '- ' + signal + ': Preparing to close...' );
	clearInterval(checkGamesInterval);
	setTimeout( async () => {
		console.log( '- ' + signal + ': Destroying client...' );
		await bot.disconnect();
		await db.close( dberror => {
			if ( dberror ) {
				console.log( '- ' + signal + ': Error while closing the database connection: ' + dberror );
				return dberror;
			}
			console.log( '- ' + signal + ': Closed the database connection.' );
		} );
		setTimeout( async () => {
			console.log( '- ' + signal + ': Closing takes too long, terminating!' );
			process.exit(0);
		}, 2000 ).unref();
	}, 1000 ).unref();
}

process.once( 'SIGINT', graceful );
process.once( 'SIGTERM', graceful );