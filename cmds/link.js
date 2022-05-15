import cmd_random from '../functions/random.js';
import parse_page from '../functions/parse_page.js';
import Wiki, { toSection } from '../functions/wiki.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {wikiProjects} = require('../functions/default.json');

function cmd_link(msg, title, wiki, querystring = new URLSearchParams(), fragment = '', interwiki = '') {
	if ( title.includes( '#' ) ) {
		fragment = title.split('#').slice(1).join('#').trim().replace( /(?:%[\dA-F]{2})+/g, partialURIdecode );
		title = title.split('#')[0];
	}
	if ( /\?\w+=/.test(title) ) {
		let querystart = title.search(/\?\w+=/);
		querystring = new URLSearchParams(querystring + '&' + title.substring(querystart + 1));
		title = title.substring(0, querystart);
	}
	title = title.replace( /(?:%[\dA-F]{2})+/g, partialURIdecode );
	if ( title.length > 250 ) title = title.substring(0, 250);
	
	if ( title.toLowerCase() === 'random' && !querystring.toString() && !fragment ) {
		return cmd_random(msg.channel, wiki);
	}
	got.get( wiki + 'api.php?action=query&meta=siteinfo&siprop=general|namespaces|specialpagealiases&iwurl=true&redirects=true&prop=pageprops|extracts&ppprop=description&explaintext=true&exintro=true&exlimit=1&converttitles=true&titles=%1F' + encodeURIComponent( title.replace( /\x1F/g, '\ufffd' ) ) + '&format=json' ).then( response => {
		var body = response.body;
		if ( response.statusCode !== 200 || !body || body.batchcomplete === undefined || !body.query ) {
			if ( interwiki ) client.chat.say( msg.channel, interwiki );
			else if ( wiki.noWiki(response.url, response.statusCode) ) {
				console.log( '- This wiki doesn\'t exist!' );
				client.chat.say( msg.channel, 'This wiki does not exist!' );
			}
			else {
				console.log( '- ' + response.statusCode + ': Error while getting the search results: ' + ( body && body.error && body.error.info ) );
				client.chat.say( msg.channel, 'I got an error while searching: ' + wiki.toLink( ( querystring.toString() || fragment || !title ? title : 'Special:Search' ), ( querystring.toString() || fragment || !title ? querystring : {search:title} ), fragment) );
			}
			return;
		}
		wiki.updateWiki(body.query.general);
		if ( body.query.pages ) {
			var querypages = Object.values(body.query.pages);
			var querypage = querypages[0];
			if ( body.query.redirects && body.query.redirects[0].from.split(':')[0] === body.query.namespaces['-1']['*'] && body.query.specialpagealiases.filter( sp => ['Mypage','Mytalk','MyLanguage'].includes( sp.realname ) ).map( sp => sp.aliases[0] ).includes( body.query.redirects[0].from.split(':').slice(1).join(':').split('/')[0].replace( / /g, '_' ) ) ) {
				querypage.title = body.query.redirects[0].from;
				delete body.query.redirects[0].tofragment;
				delete querypage.missing;
				querypage.ns = -1;
				querypage.special = '';
			}
			if ( ( querypage.missing !== undefined && querypage.known === undefined ) || querypage.invalid !== undefined ) return got.get( wiki + 'api.php?action=query&prop=pageprops|extracts&ppprop=description&explaintext=true&exintro=true&exlimit=1&generator=search&gsrnamespace=4|12|14|' + ( querypage.ns >= 0 ? querypage.ns + '|' : '' ) + Object.values(body.query.namespaces).filter( ns => ns.content !== undefined ).map( ns => ns.id ).join('|') + '&gsrlimit=1&gsrsearch=' + encodeURIComponent( title ) + '&format=json' ).then( srresponse => {
				var srbody = srresponse.body;
				if ( srresponse.statusCode !== 200 || !srbody || srbody.batchcomplete === undefined ) {
					console.log( '- ' + srresponse.statusCode + ': Error while getting the search results: ' + ( srbody && srbody.error && srbody.error.info ) );
					client.chat.say( msg.channel, 'I got an error while searching: ' + wiki.toLink('Special:Search', {search:title}) );
					return;
				}
				if ( !srbody.query ) {
					client.chat.say( msg.channel, 'I couldn\'t find a result for "' + title.text + '" on this wiki :( ' + wiki.toLink() );
					return;
				}
				querypage = Object.values(srbody.query.pages)[0];
				var text = wiki.toLink(querypage.title, querystring, fragment);
				if ( title.replace( /[_-]/g, ' ' ).toLowerCase() !== querypage.title.replace( /-/g, ' ' ).toLowerCase() ) {
					if ( !srbody.continue ) {
						text = 'I found only this: ' + text;
					}
					else {
						text = 'I found this for you: ' + text;
					}
				}
				if ( querypage.pageprops && querypage.pageprops.description ) {
					text += ' – ' + querypage.pageprops.description;
					client.chat.say( msg.channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
					return;
				}
				if ( querypage.extract ) {
					text += ' – ' + querypage.extract;
					client.chat.say( msg.channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
					return;
				}
				return parse_page(msg.channel, text, wiki, querypage);
			}, error => {
				console.log( '- Error while getting the search results: ' + error );
				client.chat.say( msg.channel, 'I got an error while searching: ' + wiki.toLink('Special:Search', {search:title}) );
			} );
			var text = wiki.toLink(querypage.title, querystring, ( fragment || ( body.query.redirects && body.query.redirects[0].tofragment ) || '' ));
			if ( querypage.pageprops && querypage.pageprops.description ) {
				text += ' – ' + querypage.pageprops.description;
				client.chat.say( msg.channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
				return;
			}
			if ( querypage.extract ) {
				text += ' – ' + querypage.extract;
				client.chat.say( msg.channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
				return;
			}
			return parse_page(msg.channel, text, wiki, querypage);
		}
		if ( body.query.interwiki ) {
			var iw = new URL(body.query.interwiki[0].url.replace( /\\/g, '%5C' ).replace( /@(here|everyone)/g, '%40$1' ), wiki);
			querystring.forEach( (value, name) => {
				iw.searchParams.append(name, value);
			} );
			if ( fragment ) iw.hash = toSection(fragment);
			else fragment = iw.hash.substring(1);
			if ( ['http:','https:'].includes( iw.protocol ) ) {
				if ( iw.hostname.endsWith( '.gamepedia.com' ) ) {
					let iwtitle = decodeURIComponent( iw.pathname.substring(1) ).replace( /_/g, ' ' );
					cmd = '!' + iw.hostname.replace( '.gamepedia.com', ' ' );
					if ( cmd !== '!www ' ) return cmd_link(msg.channel, iwtitle, new Wiki(iw.origin), iw.searchParams, fragment, iw.href);
				}
				if ( iw.hostname.endsWith( '.fandom.com' ) || iw.hostname.endsWith( '.wikia.org' ) ) {
					let regex = iw.pathname.match( /^(\/(?!wiki\/)[a-z-]{2,12})?(?:\/wiki\/|\/?$)/ );
					if ( regex ) {
						let path = ( regex[1] || '' );
						let iwtitle = decodeURIComponent( iw.pathname.replace( regex[0], '' ) ).replace( /_/g, ' ' );
						cmd = ( iw.hostname.endsWith( '.wikia.org' ) ? '??' : '?' ) + ( path ? path.substring(1) + '.' : '' ) + iw.hostname.replace( /\.(?:fandom\.com|wikia\.org)/, ' ' );
						return cmd_link(msg.channel, iwtitle, new Wiki(iw.origin + path + '/'), iw.searchParams, fragment, iw.href);
					}
				}
				let project = wikiProjects.find( project => iw.hostname.endsWith( project.name ) );
				if ( project ) {
					let regex = ( iw.host + iw.pathname ).match( new RegExp( '^' + project.regex + '(?:' + project.articlePath + '|/?$)' ) );
					if ( regex ) {
						let iwtitle = decodeURIComponent( ( iw.host + iw.pathname ).replace( regex[0], '' ) ).replace( /_/g, ' ' );
						cmd = '!!' + regex[1] + ' ';
						return cmd_link(msg.channel, iwtitle, new Wiki('https://' + regex[1] + project.scriptPath), iw.searchParams, fragment, iw.href);
					}
				}
			}
			client.chat.say( msg.channel, iw );
			return;
		}
		got.get( wiki + 'api.php?action=query&redirects=true&prop=pageprops|extracts&ppprop=description&explaintext=true&exintro=true&exlimit=1&titles=' + encodeURIComponent( body.query.general.mainpage ) + '&format=json' ).then( mpresponse => {
			var mpbody = mpresponse.body;
			if ( mpresponse.statusCode !== 200 || !mpbody || mpbody.batchcomplete === undefined || !mpbody.query || !mpbody.query.pages ) {
				console.log( '- ' + mpresponse.statusCode + ': Error while getting the main page: ' + ( mpbody && mpbody.error && mpbody.error.info ) );
				return;
			}
			var querypage = Object.values(mpbody.query.pages)[0];
			var text = wiki.toLink(querypage.title, querystring, fragment);
			if ( querypage.pageprops && querypage.pageprops.description ) {
				text += ' – ' + querypage.pageprops.description;
				client.chat.say( msg.channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
				return;
			}
			if ( querypage.extract ) {
				text += ' – ' + querypage.extract;
				client.chat.say( msg.channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
				return;
			}
			return parse_page(msg.channel, text, wiki, querypage);
		}, error => {
			console.log( '- Error while getting the main page: ' + error );
			var querypage = {title: body.query.general.mainpage};
			return parse_page(msg.channel, wiki.toLink(querypage.title, querystring, fragment), wiki, querypage);
		} );
	}, error => {
		if ( interwiki ) client.chat.say( msg.channel, interwiki );
		else if ( wiki.noWiki(error.message) ) {
			console.log( '- This wiki doesn\'t exist!' );
			client.chat.say( msg.channel, 'This wiki does not exist!' );
		}
		else {
			console.log( '- Error while getting the search results: ' + error );
			client.chat.say( msg.channel, 'I got an error while searching: ' + wiki.toLink( ( querystring.toString() || fragment || !title ? title : 'Special:Search' ), ( querystring.toString() || fragment || !title ? querystring : {search:title} ), fragment) );
		}
	} );
}

/**
 * Try to URI decode.
 * @param {String} m - The character to decode.
 * @returns {String}
 */
function partialURIdecode(m) {
	var text = '';
	try {
		text = decodeURIComponent( m );
	}
	catch ( replaceError ) {
		if ( isDebug ) console.log( '- Failed to decode ' + m + ':' + replaceError );
		text = m;
	}
	return text;
};


export default {
	name: 'LINK',
	run: cmd_link
};