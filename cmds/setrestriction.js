import db from '../util/database.js';

const restrictions = {
	'everyone': 'everyone',
	'default': 'everyone',
	'normal': 'everyone',
	'reset': 'everyone',
	'all': 'everyone',
	'*': 'everyone',
	'subscribers': 'subscribers',
	'subscriber': 'subscribers',
	'subs': 'subscribers',
	'sub': 'subscribers',
	'moderators': 'moderators',
	'moderator': 'moderators',
	'mods': 'moderators',
	'mod': 'moderators'
}

/**
 * Processes the "setrestriction" command.
 * @param {import('twitch-js').PrivateMessages} msg - The chat message.
 * @param {String} text - The command.
 * @param {Wiki} wiki - The wiki for the message.
 */
function cmd_setrestriction(msg, text, wiki) {
	if ( !( msg.tags.isModerator || msg.tags.userId === msg.tags.roomId ) ) return this.LINK(msg.channel, msg.message.split(' ').slice(1).join(' ').trim(), wiki);
	text = text.toLowerCase();
	if ( !text.length ) return db.query( 'SELECT restriction FROM twitch WHERE id = $1', [msg.tags.roomId] ).then( ({rows: [row]}) => {
		client.chat.say( msg.channel, '@' + msg.tags.displayName + ', the restriction is set to ' + row?.restriction + '.' );
	}, dberror => {
		console.log( '- Error while getting the restriction: ' + dberror );
		client.chat.say( msg.channel, '@' + msg.tags.displayName + ', I couldn\'t get the restriction :(' );
	} );
	if ( restrictions.hasOwnProperty(text) ) return db.query( 'UPDATE twitch SET restriction = $1 WHERE id = $2', [restrictions[text], msg.tags.roomId] ).then( () => {
		client.chat.say( msg.channel, '@' + msg.tags.displayName + ', I set the restriction to ' + restrictions[text] + '.' );
		console.log( '- Restriction successfully updated.' );
	}, dberror => {
		console.log( '- Error while setting the restriction: ' + dberror );
		client.chat.say( msg.channel, '@' + msg.tags.displayName + ', I couldn\'t set the restriction :(' );
	} );
	client.chat.say( msg.channel, '@' + msg.tags.displayName + ', please provide a valid restriction type: everyone, subscribers or moderators' );
}

export default {
	name: 'setrestriction',
	run: cmd_setrestriction
};