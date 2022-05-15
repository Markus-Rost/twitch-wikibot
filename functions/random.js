import parse_page from './parse_page.js';

function cmd_random(channel, wiki) {
	got.get( wiki + 'api.php?action=query&meta=siteinfo&siprop=general&prop=pageprops|extracts&ppprop=description&explaintext=true&exintro=true&exlimit=1&generator=random&grnnamespace=0&format=json' ).then( response => {
		var body = response.body;
		if ( response.statusCode !== 200 || !body || body.batchcomplete === undefined || !body.query || !body.query.pages ) {
			if ( wiki.noWiki(response.url, response.statusCode) ) {
				console.log( '- This wiki doesn\'t exist!' );
				client.chat.say( channel, 'This wiki does not exist!' );
			}
			else {
				console.log( '- ' + response.statusCode + ': Error while getting the search results: ' + ( body && body.error && body.error.info ) );
				client.chat.say( channel, 'I got an error while searching: ' + wiki.toLink('Special:Random') );
			}
			return;
		}
		wiki.updateWiki(body.query.general);
		var querypage = Object.values(body.query.pages)[0];
		var text = '🎲 ' + wiki.toLink(querypage.title);
		if ( querypage.pageprops && querypage.pageprops.description ) {
			text += ' – ' + querypage.pageprops.description;
			client.chat.say( channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
			return;
		}
		if ( querypage.extract ) {
			text += ' – ' + querypage.extract;
			client.chat.say( channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
			return;
		}
		return parse_page(channel, text, wiki, querypage);
	}, error => {
		if ( wiki.noWiki(error.message) ) {
			console.log( '- This wiki doesn\'t exist!' );
			client.chat.say( channel, 'This wiki does not exist!' );
		}
		else {
			console.log( '- Error while getting the search results: ' + error );
			client.chat.say( channel, 'I got an error while searching: ' + wiki.toLink('Special:Random') );
		}
	} );
}

export default cmd_random;