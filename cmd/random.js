const htmlparser = require('htmlparser2');

function cmd_random(channel, wiki) {
	got.get( wiki + 'api.php?action=query&meta=allmessages|siteinfo&ammessages=description&amenableparser=true&siprop=general&prop=pageprops|extracts&ppprop=description&exsentences=10&exintro=true&explaintext=true&generator=random&grnnamespace=0&format=json', {
		responseType: 'json'
	} ).then( response => {
		var body = response.body;
		if ( response.statusCode !== 200 || !body || !body.query || !body.query.pages ) {
			if ( wiki.noWiki(response.url) || response.statusCode === 410 ) {
				console.log( '- This wiki doesn\'t exist!' );
				bot.say( channel, 'This wiki does not exist!' );
			}
			else {
				console.log( '- ' + response.statusCode + ': Error while getting the search results: ' + ( body && body.error && body.error.info ) );
				bot.say( channel, 'I got an error while searching: ' + wiki.toLink('Special:Random') );
			}
		}
		else {
			var querypage = Object.values(body.query.pages)[0];
			var text = '🎲 ' + wiki.toLink(querypage.title, body.query.general);
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
			else if ( querypage.title === body.query.general.mainpage && body.query.allmessages[0]['*'] ) text += ' – ' + body.query.allmessages[0]['*'];
			else if ( wiki.isFandom() ) {
				var nosend = true;
				got.get( wiki + 'wiki/' + encodeURIComponent( querypage.title.replace( / /g, '_' ) ) ).then( descresponse => {
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
			
			if ( !nosend ) bot.say( channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
		}
	}, error => {
		if ( wiki.noWiki(error.message) ) {
			console.log( '- This wiki doesn\'t exist!' );
			bot.say( channel, 'This wiki does not exist!' );
		}
		else {
			console.log( '- Error while getting the search results: ' + error );
			bot.say( channel, 'I got an error while searching: ' + wiki.toLink('Special:Random') );
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

String.prototype.toLink = function(title = '', path) {
	if ( path ) return ( path.server.startsWith( '//' ) ? 'https:' : '' ) + path.server + path.articlepath.replace( '$1', title.toTitle().replace( /\$/g, '$$$$' ) );
	else if ( this.endsWith( '.gamepedia.com/' ) ) return this + title.toTitle();
	else if ( this.isFandom() ) return this + 'wiki/' + title.toTitle();
	else return this + 'index.php?title=' + title.toTitle(true);
};

String.prototype.toTitle = function(inQuery) {
	var title = encodeURI( this.replace( / /g, '_' ) ).replace( /\,/g, '%2C').replace( /\'/g, '%27' ).replace( /\!/g, '%21' );
	if ( inQuery ) return title.replace( /\&/g, '%26' );
	else return title.replace( /\?/g, '%3F' );
};

module.exports = {
    name: 'RANDOM',
    run: cmd_random
};