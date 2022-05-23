import { load } from 'cheerio';
import db from '../util/database.js';
import Wiki from '../functions/wiki.js';
//import checkGames from '../functions/checkGames.js';

/**
 * Processes the "setwiki" command.
 * @param {import('twitch-js').PrivateMessages} msg - The chat message.
 * @param {String} text - The command.
 * @param {Wiki} wiki - The wiki for the message.
 */
function cmd_setwiki(msg, text, wiki) {
	if ( !text || !( msg.tags.isModerator || msg.tags.userId === msg.tags.roomId ) ) return this.LINK(msg.channel, msg.message.split(' ').slice(1).join(' ').trim(), wiki);

	if ( text === '--auto' ) return client.chat.say( msg.channel, 'gamepediaWIKIBOT @' + msg.tags.displayName + ', Automatic wiki detection is currently not available :(' );
	/*
	if ( text === '--auto' ) return db.query( 'SELECT game FROM twitch WHERE id = $1', [msg.tags.roomId] ).then( ({rows: [row]}) => {
		if ( !row?.game ) return checkGames([{id:parseInt(msg.tags.roomId, 10),game:null}], [msg.channel,msg.tags.displayName]);
		db.query( 'UPDATE twitch SET game = $1 WHERE id = $2', [null, msg.tags.roomId] ).then( () => {
			console.log( '- Game successfully updated.' );
			client.chat.say( msg.channel, 'gamepediaWIKIBOT @' + msg.tags.displayName + ', I will no longer automatically change the default wiki.' );
		}, dberror => {
			console.log( '- Error while resetting the game: ' + dberror );
			client.chat.say( msg.channel, 'gamepediaWIKIBOT @' + msg.tags.displayName + ', I couldn\'t stop changing the default wiki automatically :(' );
		} );
	}, dberror => {
		console.log( '- Error while getting the game: ' + dberror );
		client.chat.say( msg.channel, 'gamepediaWIKIBOT @' + msg.tags.displayName + ', I couldn\'t change the automatic wiki detection :(' );
	} );
	*/
	
	text = text.toLowerCase().trim().replace( /^<\s*(.*)\s*>$/, '$1' );
	var wikinew = Wiki.fromInput(text);
	if ( !wikinew ) return client.chat.say( msg.channel, 'gamepediaWIKIBOT @' + msg.tags.displayName + ', please provide a valid wiki URL!' );
	return got.get( wikinew + 'api.php?&action=query&meta=siteinfo&siprop=general&format=json' ).then( response => {
		if ( response.statusCode === 404 && typeof response.body === 'string' ) {
			let api = load(response.body, {baseURI: response.url})('head link[rel="EditURI"]').prop('href');
			if ( api ) {
				wikinew = new Wiki(api.split('api.php?')[0], wikinew);
				return got.get( wikinew + 'api.php?action=query&meta=siteinfo&siprop=general&format=json' );
			}
		}
		return response;
	} ).then( response => {
		var body = response.body;
		if ( response.statusCode !== 200 || !body?.query?.general ) {
			if ( wikinew.noWiki(response.url, response.statusCode) ) {
				console.log( '- This wiki doesn\'t exist!' );
				client.chat.say( msg.channel, 'gamepediaWIKIBOT @' + msg.tags.displayName + ', this wiki does not exist!' );
			}
			else {
				console.log( '- ' + response.statusCode + ': Error while testing the wiki: ' + body?.error?.info );
				client.chat.say( msg.channel, 'gamepediaWIKIBOT @' + msg.tags.displayName + ', please provide a valid wiki URL!' );
			}
			return;
		}
		wikinew.updateWiki(body.query.general);
		if ( wiki.href === wikinew.href ) {
			client.chat.say( msg.channel, 'gamepediaWIKIBOT @' + msg.tags.displayName + ', the default wiki is already set to: ' + wikinew.toLink() );
			return;
		}
		if ( body.query.general.generator.replace( /^MediaWiki 1\.(\d\d).*$/, '$1' ) < 30 ) {
			console.log( '- This wiki is using ' + body.query.general.generator + '.' );
			client.chat.say( msg.channel, 'gamepediaWIKIBOT @' + msg.tags.displayName + ', the wiki has to use at least MediaWiki 1.30!' );
			return;
		}
		return db.query( 'UPDATE twitch SET wiki = $1 WHERE id = $2', [wikinew.href, msg.tags.roomId] ).then( () => {
			console.log( '- Wiki successfully updated.' );
			client.chat.say( msg.channel, 'gamepediaWIKIBOT @' + msg.tags.displayName + ', I changed the default wiki to: ' + wikinew.toLink() );
		}, dberror => {
			console.log( '- Error while settings the wiki: ' + dberror );
			client.chat.say( msg.channel, 'gamepediaWIKIBOT @' + msg.tags.displayName + ', I couldn\'t change the default wiki :(' );
		} );
	}, ferror => {
		if ( wiki.noWiki(ferror.message) ) {
			console.log( '- This wiki doesn\'t exist!' );
			client.chat.say( msg.channel, 'gamepediaWIKIBOT @' + msg.tags.displayName + ', this wiki does not exist!' );
		}
		else {
			console.log( '- Error while testing the wiki: ' + ferror );
			client.chat.say( msg.channel, 'gamepediaWIKIBOT @' + msg.tags.displayName + ', please provide a valid wiki URL!' );
		}
	} );
}

export default {
	name: 'setwiki',
	run: cmd_setwiki
};