import db from '../util/database.js';

/**
 * Processes the "join" command.
 * @param {import('twitch-js').PrivateMessages} msg - The chat message.
 * @param {String} text - The command.
 * @param {Wiki} wiki - The wiki for the message.
 */
function cmd_join(msg, text, wiki) {
	if ( text.toLowerCase().replace( /^@/, '' ) !== msg.username ) return this.LINK(msg.channel, msg.message.split(' ').slice(1).join(' ').trim(), wiki);
	db.query( 'INSERT INTO twitch(id, name, wiki) VALUES($1, $2, $3) ON CONFLICT DO NOTHING', [msg.tags.userId, msg.username, wiki.href] ).then( ({rowCount}) => {
		if ( !rowCount ) return client.chat.say( msg.channel, '@' + msg.tags.displayName + ', I already joined your stream.' );
		console.log( '- I\'ve been added to a stream.' );
		client.chat.join(msg.username);
		client.chat.say( msg.channel, '@' + msg.tags.displayName + ', I joined your stream.' );
	}, dberror => {
		console.log( '- Error while adding the settings: ' + dberror );
		client.chat.say( msg.channel, '@' + msg.tags.displayName + ', I couldn\'t join your stream :(' );
	} );
}

export default {
	name: 'join',
	run: cmd_join
};