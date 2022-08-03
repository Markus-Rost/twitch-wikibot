import 'dotenv/config';
import { readdir } from 'node:fs';
import { domainToASCII } from 'node:url';
import gotDefault from 'got';
import { gotSsrf } from 'got-ssrf';
import { default as TwitchJs, Events } from 'twitch-js';
import { inputToWikiProject } from 'mediawiki-projects-list';
import db from './util/database.js';
import Wiki from './functions/wiki.js';

globalThis.isDebug = ( process.argv[2] === 'debug' );

globalThis.got = gotDefault.extend( {
	throwHttpErrors: false,
	timeout: {
		request: 30_000
	},
	headers: {
		'User-Agent': 'Wiki-Bot/' + ( isDebug ? 'testing' : process.env.npm_package_version ) + ' (Twitch; ' + process.env.npm_package_name + ( process.env.invite ? '; ' + process.env.invite : '' ) + ')'
	},
	responseType: 'json'
}, gotSsrf );

/** @type {TwitchJs} */
globalThis.client = new TwitchJs.default( {
	username: process.env.botname,
	clientId: process.env.client,
	token: process.env.token,
	onAuthenticationFailure: () => {
		console.log( '- Authentication failed.' );
		return got.post( 'https://id.twitch.tv/oauth2/token', {
			form: {
				grant_type: 'refresh_token',
				refresh_token: process.env.refresh,
				client_id: process.env.client,
				client_secret: process.env.secret
			},
			throwHttpErrors: true
		}).then( ({body}) => {
			process.env.refresh = body.refresh_token;
			process.env.token = body.access_token;
			return body.access_token;
		}, error => console.log( '- Error during Authentication:', error ) );
	},
	log: {level: 'warn'}
} );

client.chat.connect().then( () => {
	console.log( '- Connected to Twitch.' );
	db.query( 'SELECT id, name FROM twitch' ).then( ({rows}) => {
		let channels = new Set();
		Promise.race([
			Promise.all(rows.map( row => client.chat.join(row.name).then( () => channels.add(row) ) )),
			new Promise( resolve => setTimeout(resolve, 300_000) )
		]).then( () => {
			console.log( '- Joined ' + channels.size + ' out of ' + rows.length + ' streams.' );
			if ( channels.size < rows.length ) {
				let missing = rows.filter( row => !channels.has( row ) ).slice(0, 100);
				client.api.get( 'channels', {search: {broadcaster_id: missing.map( row => row.id )}} ).then( ({data}) => {
					Promise.all(data.filter( channel => channel.broadcasterLogin ).map( channel => {
						let row = missing.find( row => row.id === +channel.broadcasterId );
						let new_name = channel.broadcasterLogin.toLowerCase();
						if ( !row || row.name === new_name ) return;
						return db.query( 'UPDATE twitch SET name = $1 WHERE id = $2', [new_name, row.id] ).then( () => {
							console.log( '- Updated #' + row.name + ' to #' + new_name + '.' );
							row.name = new_name;
						} )
					} )).then( () => {
						Promise.race([
							Promise.all(missing.map( row => client.chat.join(row.name).then( () => channels.add(row) ) )),
							new Promise( resolve => setTimeout(resolve, 300_000) )
						]).then( () => {
							console.log( '- Joined ' + channels.size + ' out of ' + rows.length + ' streams.' );
							if ( channels.size < rows.length ) {
								console.log( '- Unable to join: ' + missing.filter( row => !channels.has( row ) ).map( row => '#' + row.name ).join(', ') );
							}
						} );
					}, dberror => {
						console.log( '- Error while updating the missing channels: ', dberror );
					} );
				}, error => {
					console.log( '- Error while getting the missing channels: ' + error );
				} );
			}
		} );
	}, dberror => {
		console.log( '- Error while joining the streams: ', dberror );
		graceful('DBERROR');
	} );
} );

var cmds = {};
readdir( './cmds', (error, files) => {
	if ( error ) return error;
	files.filter( file => file.endsWith('.js') ).forEach( file => {
		import('./cmds/' + file).then( ({default: command}) => {
			cmds[command.name] = command.run;
		} );
	} );
} );

var isStop = false;
var cooldown = {};
client.chat.on( Events.PRIVATE_MESSAGE, msg => {
	if ( isStop || msg.isSelf ) return;
	
	if ( msg.message.toLowerCase().split(' ')[0] !== process.env.prefix ) return;
	console.log( msg.channel + ': ' + msg.message );
	db.query( 'SELECT wiki, restriction, cooldown FROM twitch WHERE id = $1', [msg.tags.roomId] ).then( ({rows: [row]}) => {
		if ( !row ) {
			console.log( '- Error while getting the wiki.' );
			client.chat.say( msg.channel, '@' + msg.tags.displayName + ', I got an error!' );
			return;
		}
		if ( !( msg.tags.isModerator || msg.tags.userId === msg.tags.roomId ) && ( row.restriction === 'moderators' || ( row.restriction === 'subscribers' && ( msg.tags.subscriber <= 0 || msg.tags.badges?.vip ) ) ) ) return console.log( '- ' + msg.channel + ' is restricted.' );
		if ( ( cooldown[msg.channel] || 0 ) + row.cooldown > Date.now() ) return console.log( '- ' + msg.channel + ' is still on cooldown.' );
		cooldown[msg.channel] = Date.now();

		var wiki = new Wiki(row.wiki)
		var [invoke, ...args] = msg.message.split(' ').slice(1);
		if ( invoke ) {
			invoke = invoke.toLowerCase();
			if ( cmds.hasOwnProperty(invoke) ) return cmds[invoke](msg, args.join(' ').trim(), wiki);
			if ( invoke.startsWith( '!' ) && /^![a-z\d-]{1,50}$/.test(invoke) ) {
				return cmds.LINK(msg, args.join(' '), new Wiki('https://' + invoke.substring(1) + '.gamepedia.com/'));
			}
			if ( invoke.startsWith( '?' ) && /^\?(?:[a-z-]{2,12}\.)?[a-z\d-]{1,50}$/.test(invoke) ) {
				let invokeWiki = wiki.href;
				if ( invoke.includes( '.' ) ) invokeWiki = 'https://' + invoke.split('.')[1] + '.fandom.com/' + invoke.substring(1).split('.')[0] + '/';
				else invokeWiki = 'https://' + invoke.substring(1) + '.fandom.com/';
				return cmds.LINK(msg, args.join(' '), new Wiki(invokeWiki));
			}
			if ( invoke.startsWith( '??' ) && /^\?\?(?:[a-z-]{2,12}\.)?[a-z\d-]{1,50}$/.test(invoke) ) {
				let invokeWiki = wiki.href;
				if ( invoke.includes( '.' ) ) invokeWiki = 'https://' + invoke.split('.')[1] + '.wikia.org/' + invoke.substring(2).split('.')[0] + '/';
				else invokeWiki = 'https://' + invoke.substring(2) + '.wikia.org/';
				return cmds.LINK(msg, args.join(' '), new Wiki(invokeWiki));
			}
			if ( invoke.startsWith( '!!' ) && /^!!(?:[a-z\d-]{1,50}\.)?(?:[a-z\d-]{1,50}\.)?[a-z\d-]{1,50}\.[a-z\d-]{1,10}$/.test(domainToASCII(invoke.split('/')[0])) ) {
				let project = inputToWikiProject(invoke.slice(2));
				if ( project ) return cmdmap.LINK(msg, args.join(' '), new Wiki(project.fullScriptPath));
			}
		}
		return cmds.LINK(msg, msg.message.split(' ').slice(1).join(' ').trim(), wiki);
	}, dberror => {
		console.log( '- Error while getting the wiki: ' + dberror );
		client.chat.say( msg.channel, '@' + msg.tags.displayName + ', I got an error!' );
	} ).catch( error => {
		console.log( '- Error while processing the command: ' + error );
		client.chat.say( msg.channel, '@' + msg.tags.displayName + ', I got an error!' );
	} );
} );

client.chat.on( Events.WHISPER, msg => {
	if ( isStop || msg.isSelf ) return;
	
	console.log( 'DM - #' + msg.username + ': ' + msg.message );
	if ( msg.tags.userId === process.env.owner ) {
		if ( msg.message.startsWith( '#' ) && msg.message.split(' ').length >= 2 ) {
			client.chat.say( process.env.botname, '/w ' + msg.message.slice(1) );
		}
	}
	else client.chat.say( process.env.botname, '/w ' + process.env.ownername + ' #' + msg.username + ': ' + msg.message );
} );

client.chat.on( Events.NOTICE, msg => {
	if ( msg.event === 'HOST_ON' || msg.event === 'HOST_TARGET_WENT_OFFLINE' ) return;
	console.log( msg.channel + ': ' + msg.event + ' - ' + msg.message );
	if ( msg.event === 'MSG_BANNED' || msg.event === 'MSG_CHANNEL_SUSPENDED' || msg.event === 'MSG_CHANNEL_BLOCKED' || msg.event === 'TOS_BAN' ) {
		db.query( 'DELETE FROM twitch WHERE name = $1', [msg.channel.substring(1)] ).then( ({rowCount}) => {
			if ( rowCount ) console.log( '- ' + msg.channel + ' has been removed.' );
		}, dberror => {
			console.log( '- Error while removing ' + msg.channel + ': ' + dberror );
		} );
	}
} );

async function graceful(signal) {
	isStop = true;
	console.log( '- ' + signal + ': Preparing to close...' );
	setTimeout( () => {
		console.log( '- ' + signal + ': Disconnecting from Twitch...' );
		client.chat.disconnect();
		db.end().then( () => {
			console.log( '- ' + signal + ': Closed the database connection.' );
			process.exit(0);
		}, dberror => {
			console.log( '- ' + signal + ': Error while closing the database connection: ' + dberror );
		} );
	}, 1_000 ).unref();
}

process.once( 'SIGINT', graceful );
process.once( 'SIGTERM', graceful );


/*
const Wiki = require('./functions/wiki.js');
const checkGames = require('./functions/checkGames.js');

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
		bot.join(row.name).catch( error => ( error === 'No response from Twitch.' ? {} : console.log( '#' + row.name + ': ' + error ) ) );
		channels.push(row);
	}, (dberror) => {
		if ( dberror ) {
			console.log( '- ' + trysettings + '. Error while getting the settings: ' + dberror );
			if ( dberror.message === 'SQLITE_ERROR: no such table: twitch' ) {
				db.run( 'CREATE TABLE IF NOT EXISTS twitch(id INTEGER PRIMARY KEY UNIQUE NOT NULL, name TEXT NOT NULL, wiki TEXT NOT NULL DEFAULT [https://help.gamepedia.com/], game TEXT, restriction TEXT NOT NULL DEFAULT [everyone], cooldown INTEGER NOT NULL DEFAULT [0]) WITHOUT ROWID', [], function (error) {
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
	if ( isStop ) return;
	if ( channels.length > 100 ) {
		checkChannels(channels.slice(100));
		channels = channels.slice(0, 100);
	}
	if ( channels.length ) got.get( 'https://api.twitch.tv/kraken/channels?id=' + channels.map( channel => channel.id ).join(','), {
		headers: kraken
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
							headers: kraken
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
					else console.log( '#' + user.name + ': ' + error );
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
*/