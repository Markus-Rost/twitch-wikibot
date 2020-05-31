const htmlparser = require('htmlparser2');

function cmd_link(channel, title, wiki) {
	if ( title.length > 300 ) title = title.substring(0, 300);
	if ( title.toLowerCase() === 'random' ) this.RANDOM(channel, wiki);
	else got.get( wiki + 'api.php?action=query&meta=allmessages|siteinfo&ammessages=description&amenableparser=true&siprop=general|namespaces|specialpagealiases&iwurl=true&redirects=true&prop=pageprops|extracts&ppprop=description&exsentences=10&exintro=true&explaintext=true&titles=' + encodeURIComponent( title ) + '&format=json', {
		responseType: 'json'
	} ).then( response => {
		var body = response.body;
		if ( response.statusCode !== 200 || !body || !body.query ) {
			if ( wiki.noWiki(response.url) || response.statusCode === 410 ) {
				console.log( '- This wiki doesn\'t exist!' );
				bot.say( channel, 'This wiki does not exist!' );
			}
			else {
				console.log( '- ' + response.statusCode + ': Error while getting the search results: ' + ( body && body.error && body.error.info ) );
				bot.say( channel, 'I got an error while searching: ' + wiki.toLink(( title ? 'Special:Search' : '' ), ( title ? 'search=' + title.toSearch() : '' )) );
			}
		}
		else {
			if ( body.query.pages ) {
				var querypages = Object.values(body.query.pages);
				var querypage = querypages[0];
				if ( body.query.redirects && body.query.redirects[0].from.split(':')[0] === body.query.namespaces['-1']['*'] && body.query.specialpagealiases.filter( sp => ['Mypage','Mytalk','MyLanguage'].includes( sp.realname ) ).map( sp => sp.aliases[0] ).includes( body.query.redirects[0].from.split(':').slice(1).join(':').split('/')[0].replace( / /g, '_' ) ) ) {
					querypage.title = body.query.redirects[0].from;
					delete body.query.redirects[0].tofragment;
					delete querypage.missing;
					querypage.ns = -1;
				}
				if ( querypages.length !== 1 ) querypage = {
					title: title,
					invalidreason: 'The requested page title contains invalid characters: "|".',
					invalid: ''
				}
					
				if ( ( querypage.missing !== undefined && querypage.known === undefined ) || querypage.invalid !== undefined ) {
					if ( wiki.isFandom() && !body.query.general.generator.startsWith( 'MediaWiki 1.3' ) ) {
						if ( querypage.ns === 1201 ) {
							var thread = querypage.title.split(':');
							got.get( wiki + 'api.php?action=query&pageids=' + thread.slice(1).join(':') + '&format=json', {
								responseType: 'json'
							} ).then( thresponse => {
								var thbody = thresponse.body;
								if ( thresponse.statusCode !== 200 || !thbody || !thbody.query || !thbody.query.pages ) {
									console.log( '- ' + thresponse.statusCode + ': Error while getting the thread: ' + ( thbody && thbody.error && thbody.error.info ) );
									bot.say( channel, 'I got an error while searching: ' + wiki.toLink(querypage.title, '', '', body.query.general) );
								}
								else {
									querypage = thbody.query.pages[thread.slice(1).join(':')];
									if ( querypage.missing !== undefined ) {
										bot.say( channel, 'I couldn\'t find a result for "' + title + '" on this wiki :( ' + wiki.toLink('', '', '', body.query.general) );
									}
									else {
										var text = wiki.toLink(thread.join(':'), '', '', body.query.general);
										got.get( wiki.toDescLink(querypage.title) ).then( descresponse => {
											var descbody = descresponse.body;
											if ( descresponse.statusCode !== 200 || !descbody ) {
												console.log( '- ' + descresponse.statusCode + ': Error while getting the description.' );
											} else {
												var parser = new htmlparser.Parser( {
													onopentag: (tagname, attribs) => {
														if ( tagname === 'meta' && attribs.property === 'og:description' ) text += ' – ' + attribs.content;
													}
												}, {decodeEntities:true} );
												parser.write( descbody );
												parser.end();
											}
											bot.say( channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
										}, descerror => {
											console.log( '- Error while getting the description: ' + descerror );
											bot.say( channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
										} );
									}
								}
							}, therror => {
								console.log( '- Error while getting the thread: ' + therror );
								bot.say( channel, 'I got an error while searching: ' + wiki.toLink(querypage.title, '', '', body.query.general) );
							} );
						}
						else got.get( wiki + 'api/v1/Search/List?minArticleQuality=0&namespaces=' + Object.values(body.query.namespaces).filter( ns => ns.content !== undefined ).map( ns => ns.id ).join(',') + '&limit=1&query=' + encodeURIComponent( title ) + '&format=json', {
							responseType: 'json'
						} ).then( wsresponse => {
							var wsbody = wsresponse.body;
							if ( wsresponse.statusCode !== 200 || !wsbody || wsbody.exception || !wsbody.total || !wsbody.items || !wsbody.items.length ) {
								if ( wsbody && ( !wsbody.total || ( wsbody.items && !wsbody.items.length ) || ( wsbody.exception && wsbody.exception.code === 404 ) ) ) {
									bot.say( channel, 'I couldn\'t find a result for "' + title + '" on this wiki :( ' + wiki.toLink('', '', '', body.query.general) );
								}
								else {
									console.log( '- ' + wsresponse.statusCode + ': Error while getting the search results: ' + ( wsbody && wsbody.exception && wsbody.exception.details ) );
									bot.say( channel, 'I got an error while searching: ' + wiki.toLink('Special:Search', 'search=' + title.toSearch(), '', body.query.general) );
								}
							}
							else {
								querypage = wsbody.items[0];
								if ( querypage.ns && !querypage.title.startsWith( body.query.namespaces[querypage.ns]['*'] + ':' ) ) {
									querypage.title = body.query.namespaces[querypage.ns]['*'] + ':' + querypage.title;
								}
								var text = '';
								if ( title.replace( /\-/g, ' ' ).toTitle().toLowerCase() === querypage.title.replace( /\-/g, ' ' ).toTitle().toLowerCase() ) {
									text = '';
								}
								else if ( wsbody.total === 1 ) {
									text = 'I found only this: ';
								}
								else {
									text = 'I found this for you: ';
								}
								text += wiki.toLink(querypage.title, '', '', body.query.general);
								if ( querypage.title === body.query.general.mainpage && body.query.allmessages[0]['*'] ) {
										text += ' – ' + body.query.allmessages[0]['*'];
										bot.say( channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
								}
								else got.get( wiki.toDescLink(querypage.title) ).then( descresponse => {
									var descbody = descresponse.body;
									if ( descresponse.statusCode !== 200 || !descbody ) {
										console.log( '- ' + descresponse.statusCode + ': Error while getting the description.' );
									} else {
										var parser = new htmlparser.Parser( {
											onopentag: (tagname, attribs) => {
												if ( tagname === 'meta' && attribs.property === 'og:description' ) text += ' – ' + attribs.content;
											}
										}, {decodeEntities:true} );
										parser.write( descbody );
										parser.end();
									}
									bot.say( channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
								}, descerror => {
									console.log( '- Error while getting the description: ' + descerror );
									bot.say( channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
								} );
							}
						}, wserror => {
							console.log( '- Error while getting the search results: ' + wserror );
							bot.say( channel, 'I got an error while searching: ' + wiki.toLink('Special:Search', 'search=' + title.toSearch(), '', body.query.general) );
						} );
					}
					else {
						got.get( wiki + 'api.php?action=query&prop=pageprops|extracts&ppprop=description&exsentences=10&exintro=true&explaintext=true&generator=search&gsrnamespace=' + Object.values(body.query.namespaces).filter( ns => ns.content !== undefined ).map( ns => ns.id ).join('|') + '&gsrlimit=1&gsrsearch=' + encodeURIComponent( title ) + '&format=json', {
							responseType: 'json'
						} ).then( srresponse => {
							var srbody = srresponse.body;
							if ( srresponse.statusCode !== 200 || !srbody ) {
								console.log( '- ' + srresponse.statusCode + ': Error while getting the search results: ' + ( srbody && srbody.error && srbody.error.info ) );
								bot.say( channel, 'I got an error while searching: ' + wiki.toLink('Special:Search', 'search=' + title.toSearch(), '', body.query.general) );
							}
							else {
								if ( !srbody.query ) {
									bot.say( channel, 'I couldn\'t find a result for "' + title + '" on this wiki :( ' + wiki.toLink('', '', '', body.query.general) );
								}
								else {
									querypage = Object.values(srbody.query.pages)[0];
									var text = '';
									if ( title.replace( /\-/g, ' ' ).toTitle().toLowerCase() === querypage.title.replace( /\-/g, ' ' ).toTitle().toLowerCase() ) {
										text = '';
									}
									else if ( !srbody.continue ) {
										text = 'I found only this: ';
									}
									else {
										text = 'I found this for you: ';
									}
									text += wiki.toLink(querypage.title, '', '', body.query.general);
									if ( querypage.pageprops && querypage.pageprops.description ) {
										var parser = new htmlparser.Parser( {
											ontext: (htmltext) => {
												text += htmltext;
											}
										}, {decodeEntities:true} );
										parser.write( ' – ' + querypage.pageprops.description );
										parser.end();
									}
									else if ( querypage.extract ) text += ' – ' + querypage.extract;
									bot.say( channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
								}
							}
						}, srerror => {
							console.log( '- Error while getting the search results: ' + srerror );
							bot.say( channel, 'I got an error while searching: ' + wiki.toLink('Special:Search', 'search=' + title.toSearch(), '', body.query.general) );
						} );
					}
				}
				else {
					var text = wiki.toLink(querypage.title, '', ( body.query.redirects ? body.query.redirects[0].tofragment : '' ), body.query.general);
					if ( querypage.pageprops && querypage.pageprops.description ) {
						var parser = new htmlparser.Parser( {
							ontext: (htmltext) => {
								text += htmltext;
							}
						}, {decodeEntities:true} );
						parser.write( ' – ' + querypage.pageprops.description );
						parser.end();
					}
					else if ( querypage.extract ) text += ' – ' + querypage.extract;
					else if ( querypage.title === body.query.general.mainpage && body.query.allmessages[0]['*'] ) {
						text += ' – ' + body.query.allmessages[0]['*'];
					}
					if ( !text.includes( ' – ' ) && wiki.isFandom() ) got.get( wiki.toDescLink(querypage.title) ).then( descresponse => {
						var descbody = descresponse.body;
						if ( descresponse.statusCode !== 200 || !descbody ) {
							console.log( '- ' + descresponse.statusCode + ': Error while getting the description.' );
						} else {
							var parser = new htmlparser.Parser( {
								onopentag: (tagname, attribs) => {
									if ( tagname === 'meta' && attribs.property === 'og:description' ) text += ' – ' + attribs.content;
								}
							}, {decodeEntities:true} );
							parser.write( descbody );
							parser.end();
						}
						bot.say( channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
					}, descerror => {
						console.log( '- Error while getting the description: ' + descerror );
						bot.say( channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
					} );
					else bot.say( channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
				}
			}
			else if ( body.query.interwiki ) {
				var inter = body.query.interwiki[0];
				var intertitle = inter.title.substring(inter.iw.length+1);
				var regex = inter.url.match( /^(?:https?:)?\/\/([a-z\d-]{1,50}\.(?:gamepedia\.com|(?:fandom\.com|wikia\.org)(?:(?!\/wiki\/)\/[a-z-]{1,8})?(\/wiki))\/)/ );
				if ( regex !== null ) {
					var iwtitle = decodeURIComponent( inter.url.replace( regex[0], '' ) ).replace( /\_/g, ' ' ).replaceSave( intertitle.replace( /\_/g, ' ' ), intertitle );
					cmd_link(channel, iwtitle, 'https://' + regex[1].replace( regex[2], '' ));
				} else {
					regex = inter.url.match( /^(?:https?:)?\/\/([a-z\d-]{1,50}\.(?:wikipedia|mediawiki|wiktionary|wikimedia|wikibooks|wikisource|wikidata|wikiversity|wikiquote|wikinews|wikivoyage)\.org\/)wiki\// );
					if ( regex !== null ) {
						var iwtitle = decodeURIComponent( inter.url.replace( regex[0], '' ) ).replace( /\_/g, ' ' ).replaceSave( intertitle.replace( /\_/g, ' ' ), intertitle );
						cmd_link(channel, iwtitle, 'https://' + regex[1] + 'w/');
					} else bot.say( channel, inter.url );
				}
			}
			else {
				var text = wiki.toLink(body.query.general.mainpage, '', '', body.query.general);
				if ( body.query.allmessages[0]['*'] ) {
					text += ' – ' + body.query.allmessages[0]['*'];
					bot.say( channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
				}
				else if ( wiki.isFandom() && !body.query.general.generator.startsWith( 'MediaWiki 1.3' ) ) got.get( wiki.toDescLink(body.query.general.mainpage) ).then( descresponse => {
					var descbody = descresponse.body;
					if ( descresponse.statusCode !== 200 || !descbody ) {
						console.log( '- ' + descresponse.statusCode + ': Error while getting the description.' );
					} else {
						var parser = new htmlparser.Parser( {
							onopentag: (tagname, attribs) => {
								if ( tagname === 'meta' && attribs.property === 'og:description' ) text += ' – ' + attribs.content;
							}
						}, {decodeEntities:true} );
						parser.write( descbody );
						parser.end();
					}
					bot.say( channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
				}, descerror => {
					console.log( '- Error while getting the description: ' + descerror );
					bot.say( channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
				} );
				else got.get( wiki + 'api.php?action=query&redirects=true&prop=pageprops|extracts&ppprop=description&exsentences=10&exintro=true&explaintext=true&titles=' + encodeURIComponent( body.query.general.mainpage ) + '&format=json', {
					responseType: 'json'
				} ).then( mpresponse => {
					var mpbody = mpresponse.body;
					if ( mpresponse.statusCode !== 200 || !mpbody || !mpbody.query ) {
						console.log( '- ' + mpresponse.statusCode + ': Error while getting the main page: ' + ( mpbody && mpbody.error && mpbody.error.info ) );
					} else {
						querypage = Object.values(mpbody.query.pages)[0];
						if ( querypage.pageprops && querypage.pageprops.description ) {
							var parser = new htmlparser.Parser( {
								ontext: (htmltext) => {
									text += htmltext;
								}
							}, {decodeEntities:true} );
							parser.write( ' – ' + querypage.pageprops.description );
							parser.end();
						}
						else if ( querypage.extract ) text += ' – ' + querypage.extract;
					}
					bot.say( channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
				}, mperror => {
					console.log( '- Error while getting the main page: ' + mperror );
					bot.say( channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
				} );
			}
		}
	}, error => {
		if ( wiki.noWiki(error.message) ) {
			console.log( '- This wiki doesn\'t exist!' );
			bot.say( channel, 'This wiki does not exist!' );
		}
		else {
			console.log( '- Error while getting the search results: ' + error );
			bot.say( channel, 'I got an error while searching: ' + wiki.toLink(( title ? 'Special:Search' : '' ), ( title ? 'search=' + title.toSearch() : '' )) );
		}
	} );
}

String.prototype.noWiki = function(href) {
	if ( !href ) return false;
	else if ( this.startsWith( 'https://www.' ) ) return true;
	else if ( this.endsWith( '.gamepedia.com/' ) ) return 'https://www.gamepedia.com/' === href;
	else return [
		this.replace( /^https:\/\/([a-z\d-]{1,50}\.(?:fandom\.com|wikia\.org))\/(?:[a-z-]{1,8}\/)?$/, 'https://community.fandom.com/wiki/Community_Central:Not_a_valid_community?from=$1' ),
		this + 'language-wikis'
	].includes( href.replace( /Unexpected token < in JSON at position 0 in "([^ ]+)"/, '$1' ) );
};

String.prototype.isFandom = function() {
	return /^https:\/\/[a-z\d-]{1,50}\.(?:fandom\.com|wikia\.org)\/(?:[a-z-]{1,8}\/)?$/.test(this);
};

String.prototype.toLink = function(title = '', querystring = '', fragment = '', path) {
	var linksuffix = ( querystring ? '?' + querystring.toTitle(true) : '' ) + ( fragment ? '#' + fragment.toSection() : '' );
	if ( path ) return ( path.server.startsWith( '//' ) ? 'https:' : '' ) + path.server + path.articlepath.replaceSave( '$1', title.toTitle() ) + ( path.articlepath.includes( '?' ) && linksuffix.startsWith( '?' ) ? '&' + linksuffix.substring(1) : linksuffix );
	else if ( this.endsWith( '.gamepedia.com/' ) ) return this + title.toTitle() + linksuffix;
	else if ( this.isFandom() ) return this + 'wiki/' + title.toTitle() + linksuffix;
	else return this + 'index.php?title=' + title.toTitle(true) + ( linksuffix.startsWith( '?' ) ? '&' + linksuffix.substring(1) : linksuffix );
};

String.prototype.toTitle = function(inQuery) {
	var title = encodeURI( this.replace( / /g, '_' ) ).replace( /\,/g, '%2C').replace( /\'/g, '%27' ).replace( /\!/g, '%21' );
	if ( inQuery ) return title.replace( /\&/g, '%26' );
	else return title.replace( /\?/g, '%3F' );
};

String.prototype.toSearch = function() {
	return this.replace( / /g, '+' );
};

String.prototype.toSection = function() {
	return encodeURIComponent( this.replace( / /g, '_' ) ).replace( /\'/g, '%27' ).replace( /\(/g, '%28' ).replace( /\)/g, '%29' ).replace( /\%/g, '.' );
};

String.prototype.toDescLink = function(title = '') {
	return this + 'wiki/' + encodeURIComponent( title.replace( / /g, '_' ) );
};

String.prototype.replaceSave = function(pattern, replacement) {
	return this.replace( pattern, ( typeof replacement === 'string' ? replacement.replace( /\$/g, '$$$$' ) : replacement ) );
};

module.exports = {
    name: 'LINK',
    run: cmd_link
};