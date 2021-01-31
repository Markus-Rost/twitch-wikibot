const util = require('util');
util.inspect.defaultOptions = {compact:false,breakLength:Infinity};

async function cmd_eval(channel, userstate, msg, args, wiki) {
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
		this.LINK(channel, msg.split(' ').slice(1).join(' '), wiki);
	}
}
		
function database(sql, sqlargs = []) {
	return new Promise( function (resolve, reject) {
		db.all( sql, sqlargs, (error, rows) => {
			if (error) reject(error);
			resolve(rows);
		} );
	} );
}

module.exports = {
	name: 'eval',
	run: cmd_eval
};