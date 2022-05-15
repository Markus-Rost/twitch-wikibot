import db from '../util/database.js';

/**
 * Processes the "leave" command.
 * @param {import('twitch-js').PrivateMessages} msg - The chat message.
 * @param {String} text - The command.
 * @param {Wiki} wiki - The wiki for the message.
 */
function cmd_leave(msg, text, wiki) {
	if ( msg.tags.userId !== msg.tags.roomId || text.toLowerCase().replace( /^@/, '' ) !== msg.username ) {
		return this.LINK(msg.channel, msg.message.split(' ').slice(1).join(' ').trim(), wiki);
	}
	db.query( 'DELETE FROM twitch WHERE id = $1', [msg.tags.roomId] ).then( () => {
		client.chat.say( msg.channel, 'gamepediaWIKIBOT @' + msg.tags.displayName + ', I will leave your stream now.' );
		console.log( '- I\'ve been removed from a stream.' );
		client.chat.part(msg.username);
	}, dberror => {
		console.log( '- Error while removing the settings: ' + dberror );
		client.chat.say( msg.channel, 'gamepediaWIKIBOT @' + msg.tags.displayName + ', I couldn\'t leave your stream :(' );
	} );
}

export default {
	name: 'leave',
	run: cmd_leave
};