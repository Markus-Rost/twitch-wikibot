var allSites = [];
require('./allSites.js')( sites => allSites = sites );

const kraken = {
	Accept: 'application/vnd.twitchtv.v5+json',
	'Client-ID': process.env.client,
	Authorization: 'OAuth ' + process.env.oauth
}

function checkGames(channels, mention) {
	if ( channels.length > 100 ) {
		checkGames(channels.slice(100), mention);
		channels = channels.slice(0, 100);
	}
	if ( channels.length ) got.get( 'https://api.twitch.tv/kraken/channels?id=' + channels.map( channel => channel.id ).join(','), {
		headers: kraken,
		responseType: 'json'
	} ).then( response => {
		var body = response.body;
		if ( response.statusCode !== 200 || !body || body.error || !body.channels ) {
			console.log( '- ' + response.statusCode + ': Error while checking games: ' + ( body && ( body.message || body.error ) ) );
			if ( mention ) bot.say( mention[0], 'gamepediaWIKIBOT @' + mention[1] + ', I couldn\'t start changing the default wiki automatically :(' );
		}
		else {
			var updated = body.channels.filter( user => user.game !== channels.find( channel => channel.id === user._id ).game );
			if ( updated.length ) updated.forEach( channel => {
				var game = channel.game;
				if ( game ) {
					channel.text = 'I automatically changed the default wiki to: ';
					var wiki = allSites.find( site => site.wiki_domain === game.toLowerCase().replace( / /g, '' ) + '.gamepedia.com' && ( site.ss_good_articles >= 100 || site.official_wiki || site.wiki_crossover ) );
					if ( wiki ) {
						channel.wiki = 'https://' + ( wiki.wiki_crossover || wiki.wiki_domain ) + '/';
						saveCheckedGames(channel, mention);
					}
					else {
						wiki = allSites.find( site => site.wiki_display_name === game + ' Wiki (EN)' && ( site.ss_good_articles >= 100 || site.official_wiki || site.wiki_crossover ) );
						if ( wiki ) {
							channel.wiki = 'https://' + ( wiki.wiki_crossover || wiki.wiki_domain ) + '/';
							saveCheckedGames(channel, mention);
						}
						else got.get( 'https://community.fandom.com/api/v1/Wikis/ByString?expand=true&includeDomain=true&lang=en&limit=10&string=' + encodeURIComponent( game ) + '&format=json', {
							responseType: 'json'
						} ).then( wsresponse => {
							var wsbody = wsresponse.body;
							if ( wsresponse.statusCode !== 200 || !wsbody || wsbody.exception || !wsbody.items ) {
								console.log( '- ' + wsresponse.statusCode + ': Error while getting the wiki results: ' + ( wsbody && wsbody.exception && wsbody.exception.details ) );
								channel.text = 'I got an error while searching for a wiki, I kept the current default wiki.';
								saveCheckedGames(channel, mention);
							}
							else {
								wiki = wsbody.items.find( site => site.stats.articles >= 100 );
								if ( wiki ) {
									channel.wiki = wiki.url + '/';
									saveCheckedGames(channel, mention);
								}
								else if ( /(?: \d{1,4}| [IVX]{1,3}|: .+)$/.test(game) ) {
									game = game.replace( /(?: \d{1,4}| [IVX]{1,3}|: .+)$/, '' );
									wiki = allSites.find( site => site.wiki_domain === game.toLowerCase().replace( / /g, '' ) + '.gamepedia.com' && ( site.ss_good_articles >= 100 || site.official_wiki || site.wiki_crossover ) );
									if ( wiki ) {
										channel.wiki = 'https://' + ( wiki.wiki_crossover || wiki.wiki_domain ) + '/';
										saveCheckedGames(channel, mention);
									}
									else {
										wiki = allSites.find( site => site.wiki_display_name === game + ' Wiki (EN)' && ( site.ss_good_articles >= 100 || site.official_wiki || site.wiki_crossover ) );
										if ( wiki ) {
											channel.wiki = 'https://' + ( wiki.wiki_crossover || wiki.wiki_domain ) + '/';
											saveCheckedGames(channel, mention);
										}
										else got.get( 'https://community.fandom.com/api/v1/Wikis/ByString?expand=true&includeDomain=true&lang=en&limit=10&string=' + encodeURIComponent( game ) + '&format=json', {
											responseType: 'json'
										} ).then( ws2response => {
											var ws2body = ws2response.body;
											if ( ws2response.statusCode !== 200 || !ws2body || ws2body.exception || !ws2body.items ) {
												console.log( '- ' + ws2response.statusCode + ': Error while getting the wiki results: ' + ( ws2body && ws2body.exception && ws2body.exception.details ) );
												channel.text = 'I got an error while searching for a wiki, I kept the current default wiki.';
												saveCheckedGames(channel, mention);
											}
											else {
												wiki = wsbody.items.find( site => site.stats.articles >= 100 );
												if ( wiki ) {
													channel.wiki = wiki.url + '/';
													saveCheckedGames(channel, mention);
												}
												else if ( /(?: \d{1,4}| [IVX]{1,3}|: .+)$/.test(game) ) {
													game = game.replace( /(?: \d{1,4}| [IVX]{1,3}|: .+)$/, '' );
													wiki = allSites.find( site => site.wiki_domain === game.toLowerCase().replace( / /g, '' ) + '.gamepedia.com' && ( site.ss_good_articles >= 100 || site.official_wiki || site.wiki_crossover ) );
													if ( wiki ) {
														channel.wiki = 'https://' + ( wiki.wiki_crossover || wiki.wiki_domain ) + '/';
														saveCheckedGames(channel, mention);
													}
													else {
														wiki = allSites.find( site => site.wiki_display_name === game + ' Wiki (EN)' && ( site.ss_good_articles >= 100 || site.official_wiki || site.wiki_crossover ) );
														if ( wiki ) {
															channel.wiki = 'https://' + ( wiki.wiki_crossover || wiki.wiki_domain ) + '/';
															saveCheckedGames(channel, mention);
														}
														else got.get( 'https://community.fandom.com/api/v1/Wikis/ByString?expand=true&includeDomain=true&lang=en&limit=10&string=' + encodeURIComponent( game ) + '&format=json', {
															responseType: 'json'
														} ).then( ws3response => {
															var ws3body = ws3response.body;
															if ( ws3response.statusCode !== 200 || !ws3body || ws3body.exception || !ws3body.items ) {
																console.log( '- ' + ws3response.statusCode + ': Error while getting the wiki results: ' + ( ws3body && ws3body.exception && ws3body.exception.details ) );
																channel.text = 'I got an error while searching for a wiki, I kept the current default wiki.';
															}
															else {
																wiki = ws3body.items.find( site => site.stats.articles >= 100 );
																if ( wiki ) channel.wiki = wiki.url + '/';
																else channel.text = 'I couldn\'t find a wiki for "' + channel.game + '", I kept the current default wiki.';
															}
															saveCheckedGames(channel, mention);
														}, ws3error => {
															console.log( '- Error while getting the wiki results: ' + ws3error );
															channel.text = 'I got an error while searching for a wiki, I kept the current default wiki.';
															saveCheckedGames(channel, mention);
														} );
													}
												}
												else {
													channel.text = 'I couldn\'t find a wiki for "' + channel.game + '", I kept the current default wiki.';
													saveCheckedGames(channel, mention);
												}
											}
										}, ws2error => {
											console.log( '- Error while getting the wiki results: ' + ws2error );
											channel.text = 'I got an error while searching for a wiki, I kept the current default wiki.';
											saveCheckedGames(channel, mention);
										} );
									}
								}
								else {
									channel.text = 'I couldn\'t find a wiki for "' + channel.game + '", I kept the current default wiki.';
									saveCheckedGames(channel, mention);
								}
							}
						}, wserror => {
							console.log( '- Error while getting the wiki results: ' + wserror );
							channel.text = 'I got an error while searching for a wiki, I kept the current default wiki.';
							saveCheckedGames(channel, mention);
						} );
					}
				}
				else {
					channel.text = 'No game is set, I kept the current default wiki.';
					saveCheckedGames(channel, mention);
				}
			} );
		}
	}, error => {
		console.log( '- Error while checking games: ' + error );
		if ( mention ) bot.say( mention[0], 'gamepediaWIKIBOT @' + mention[1] + ', I couldn\'t start changing the default wiki automatically :(' );
	} );
}

function saveCheckedGames(channel, mention) {
	var sql = 'UPDATE twitch SET game = ? WHERE id = ?';
	var args = [channel.game, channel._id];
	if ( channel.wiki ) {
		sql = 'UPDATE twitch SET wiki = ?, game = ? WHERE id = ?';
		args.unshift(channel.wiki);
	}
	db.run( sql, args, function (dberror) {
		if ( dberror ) {
			console.log( '- Error while updating the game for #' + channel.name + ': ' + dberror );
			if ( mention ) bot.say( mention[0], 'gamepediaWIKIBOT @' + mention[1] + ', I couldn\'t start changing the default wiki automatically :(' );
			return dberror;
		}
		console.log( '- Game successfully updated for #' + channel.name );
		bot.say( channel.name, 'gamepediaWIKIBOT ' + ( mention ? '@' + mention[1] + ', ' : '' ) + channel.text + ( channel.wiki || '' ) );
	} );
}

module.exports = checkGames;