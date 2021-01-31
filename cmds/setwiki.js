const cheerio = require('cheerio');
const Wiki = require('../functions/wiki.js');
const checkGames = require('../functions/checkGames.js');

function cmd_setwiki(channel, userstate, msg, args, wiki) {
	if ( args[0] && ( userstate.mod || userstate['user-id'] === userstate['room-id'] || userstate['user-id'] === process.env.owner ) ) {
		if ( args.length === 1 && args[0] === '--auto' ) db.get( 'SELECT game FROM twitch WHERE id = ?', [userstate['room-id']], (dberror, row) => {
			if ( dberror || !row ) {
				console.log( '- Error while getting the game: ' + dberror );
				bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', I couldn\'t change the automatic wiki detection :(' );
				return dberror;
			}
			if ( row.game === null ) checkGames([{id:parseInt(userstate['room-id'], 10),game:null}], [channel,userstate['display-name']]);
			else db.run( 'UPDATE twitch SET game = NULL WHERE id = ?', [userstate['room-id']], function (dberror) {
				if ( dberror ) {
					console.log( '- Error while editing the settings: ' + dberror );
					bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', I couldn\'t stop changing the default wiki automatically :(' );
					return dberror;
				}
				console.log( '- Games successfully updated.' );
				bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', I will no longer automatically change the default wiki.' );
			} );
		} );
		else {
			args[0] = args.join(' ').toLowerCase().trim().replace( /^<\s*(.*)\s*>$/, '$1' );
			var wikinew = Wiki.fromInput(args[0]);
			if ( !wikinew ) {
				bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', please provide a valid wiki URL!' );
				return;
			}
			return got.get( wikinew + 'api.php?&action=query&meta=siteinfo&siprop=general&format=json' ).then( response => {
				if ( response.statusCode === 404 && typeof response.body === 'string' ) {
					let api = cheerio.load(response.body)('head link[rel="EditURI"]').prop('href');
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
						bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', this wiki does not exist!' );
					}
					else {
						console.log( '- ' + response.statusCode + ': Error while testing the wiki: ' + body?.error?.info );
						bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', please provide a valid wiki URL!' );
					}
					return;
				}
				wikinew.updateWiki(body.query.general);
				if ( wiki.href === wikinew.href ) {
					bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', the default wiki is already set to: ' + wikinew.toLink() );
					return;
				}
				if ( body.query.general.generator.replace( /^MediaWiki 1\.(\d\d).*$/, '$1' ) < 30 ) {
					console.log( '- This wiki is using ' + body.query.general.generator + '.' );
					bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', the wiki has to use at least MediaWiki 1.30!' );
					return;
				}
				return db.run( 'UPDATE twitch SET wiki = ? WHERE id = ?', [wikinew.href, userstate['room-id']], function (dberror) {
					if ( dberror ) {
						console.log( '- Error while editing the settings: ' + dberror );
						bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', I couldn\'t change the default wiki :(' );
						return dberror;
					}
					console.log( '- Settings successfully updated.' );
					bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', I changed the default wiki to: ' + wikinew.toLink() );
				} );
			}, ferror => {
				if ( wiki.noWiki(ferror.message) ) {
					console.log( '- This wiki doesn\'t exist!' );
					bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', this wiki does not exist!' );
				}
				else {
					console.log( '- Error while testing the wiki: ' + ferror );
					bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', please provide a valid wiki URL!' );
				}
			} );
		}
	}
	else {
		this.LINK(channel, msg.split(' ').slice(1).join(' '), wiki);
	}
}

module.exports = {
	name: 'setwiki',
	run: cmd_setwiki
};