import db from '../util/database.js';

/**
 * Processes the "setcooldown" command.
 * @param {import('twitch-js').PrivateMessages} msg - The chat message.
 * @param {String} text - The command.
 * @param {Wiki} wiki - The wiki for the message.
 */
function cmd_setcooldown(msg, text, wiki) {
	if ( !/^(|\d+)$/.test(text) || !( msg.tags.isModerator || msg.tags.userId === msg.tags.roomId ) ) {
		return this.LINK(msg.channel, msg.message.split(' ').slice(1).join(' ').trim(), wiki);
	}
	if ( text.length ) db.query( 'UPDATE twitch SET cooldown = $1 WHERE id = $2', [text + '000', msg.tags.roomId] ).then( () => {
		client.chat.say( msg.channel, 'gamepediaWIKIBOT @' + msg.tags.displayName + ', I set the cooldown to ' + text + ' seconds.' );
		console.log( '- Cooldown successfully updated.' );
	}, dberror => {
		console.log( '- Error while setting the cooldown: ' + dberror );
		client.chat.say( msg.channel, 'gamepediaWIKIBOT @' + msg.tags.displayName + ', I couldn\'t set the cooldown :(' );
	} );
	else db.query( 'SELECT cooldown FROM twitch WHERE id = $1', [msg.tags.roomId] ).then( ({rows: [row]}) => {
		client.chat.say( msg.channel, 'gamepediaWIKIBOT @' + msg.tags.displayName + ', the cooldown is set to ' + ( row?.cooldown / 1000 ) + ' seconds.' );
	}, dberror => {
		console.log( '- Error while getting the cooldown: ' + dberror );
		client.chat.say( msg.channel, 'gamepediaWIKIBOT @' + msg.tags.displayName + ', I couldn\'t get the cooldown :(' );
	} );
}

export default {
	name: 'setcooldown',
	run: cmd_setcooldown
};