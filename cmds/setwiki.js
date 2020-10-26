const {Wiki} = require('../functions/wiki.js');
var allSites = [];
require('../functions/allSites.js')( sites => allSites = sites );
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
			args[0] = args[0].toLowerCase();
			var wikinew = '';
			var comment = '';
			if ( args.length === 2 && args[1] === '--force' ) {
				var forced = 'forced';
				wikinew = args[0];
			}
			else if ( allSites.some( site => site.wiki_domain === args[0] + '.gamepedia.com' ) ) wikinew = 'https://' + args[0] + '.gamepedia.com/';
			else {
				var regex = args[0].match( /^(?:https:\/\/)?([a-z\d-]{1,50}\.(?:gamepedia\.com|(?:fandom\.com|wikia\.org)(?:(?!\/wiki\/)\/[a-z-]{1,8})?))(?:\/|$)/ );
				if ( regex !== null ) wikinew = 'https://' + regex[1] + '/';
				else if ( /^(?:[a-z-]{1,8}\.)?[a-z\d-]{1,50}$/.test(args[0]) ) {
					if ( args[0].includes( '.' ) ) wikinew = 'https://' + args[0].split('.')[1] + '.fandom.com/' + args[0].split('.')[0] + '/';
					else wikinew = 'https://' + args[0] + '.fandom.com/';
				}
			}
			if ( wikinew ) {
				if ( wiki.url === wikinew && !forced ) {
					bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', the default wiki is already set to: ' + wiki );
				}
				else {
					if ( wikinew.endsWith( '.gamepedia.com/' ) && !forced ) {
						let site = allSites.find( site => site.wiki_domain === wikinew.replace( /^https:\/\/([a-z\d-]{1,50}\.gamepedia\.com)\/$/, '$1' ) );
						if ( site ) wikinew = 'https://' + ( site.wiki_crossover || site.wiki_domain ) + '/';
					}
					wikinew = new Wiki(wikinew);
					got.get( wikinew.url + 'api.php?action=query&meta=allmessages|siteinfo&ammessages=custom-GamepediaNotice|custom-FandomMergeNotice&amenableparser=true&siprop=general&format=json', {
						responseType: 'json'
					} ).then( response => {
						var body = response.body;
						if ( response.statusCode !== 200 || !body || !body.query || !body.query.allmessages ) {
							if ( forced || wikinew.noWiki(response.url) || response.statusCode === 410 ) {
								console.log( '- This wiki doesn\'t exist!' );
								bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', this wiki does not exist!' );
								return false;
							}
							console.log( '- ' + response.statusCode + ': Error while reaching the wiki: ' + ( body && body.error && body.error.info ) );
							comment = ' I got an error while checking if the wiki exists!';
						}
						else if ( wikinew.url.endsWith( '.gamepedia.com/' ) && !forced ) {
							let site = allSites.find( site => site.wiki_domain === body.query.general.servername );
							if ( site ) wikinew = new Wiki('https://' + ( site.wiki_crossover || site.wiki_domain ) + '/');
						}
						else if ( wikinew.isFandom() && !forced ) {
							let crossover = '';
							if ( body.query.allmessages[0]['*'] ) {
								crossover = 'https://' + body.query.allmessages[0]['*'] + '.gamepedia.com/';
							}
							else if ( body.query.allmessages[1]['*'] ) {
								let merge = body.query.allmessages[1]['*'].split('/');
								crossover = 'https://' + merge[0] + '.fandom.com/' + ( merge[1] ? merge[1] + '/' : '' );
							}
							if ( crossover ) wikinew = new Wiki(crossover);
						}
						return true;
					}, error => {
						if ( forced || wikinew.noWiki(error.message) ) {
							console.log( '- This wiki doesn\'t exist!' );
							bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', this wiki does not exist!' );
							return false;
						}
						console.log( '- Error while reaching the wiki: ' + error );
						comment = ' I got an error while checking if the wiki exists!';
						return true;
					} ).then( checkwiki => {
						if ( checkwiki ) {
							db.run( 'UPDATE twitch SET wiki = ? WHERE id = ?', [wikinew.url, userstate['room-id']], function (dberror) {
								if ( dberror ) {
									console.log( '- Error while editing the settings: ' + dberror );
									bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', I couldn\'t change the default wiki :(' );
									return dberror;
								}
								console.log( '- Settings successfully updated.' );
								bot.say( channel, 'gamepediaWIKIBOT @' + userstate['display-name'] + ', I ' + ( forced || 'changed' ) + ' the default wiki to: ' + wikinew.url + comment );
							} );
						}
					} );
				}
			}
			else {
				this.LINK(channel, msg.split(' ').slice(1).join(' '), wiki);
			}
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