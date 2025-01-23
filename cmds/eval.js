import { inspect } from 'node:util';
import db from '../util/database.js';

inspect.defaultOptions = {compact: true, breakLength: Infinity};

/**
 * Processes the "eval" command.
 * @param {import('twitch-js').PrivateMessages} msg - The chat message.
 * @param {String} text - The command.
 * @param {Wiki} wiki - The wiki for the message.
 * @async
 */
async function cmd_eval(msg, text, wiki) {
	if ( msg.tags.userId !== process.env.owner || !text.length ) return this.LINK(msg, msg.message.split(' ').slice(1).join(' ').trim(), wiki);
	try {
		text = inspect( await eval( text ) );
	} catch ( error ) {
		text = error.toString();
	}
	if ( isDebug ) console.log( '--- EVAL START ---\n' + text + '\n--- EVAL END ---' );
	if ( text.length > 450 ) client.chat.say( msg.channel, '✅' );
	else client.chat.say( msg.channel, text );
}

/**
 * Runs database queries.
 * @param {String} sql - The SQL command.
 * @param {String[]} [sqlargs] - The command arguments.
 */
function database(sql, sqlargs = []) {
	return db.query( sql, sqlargs ).then( ({rows}) => {
		return rows;
	} );
}

export default {
	name: 'eval',
	run: cmd_eval
};