import { load } from 'cheerio';

const removeClasses = [
	'div',
	'table',
	'script',
	'input',
	'style',
	'script',
	'noscript',
	'ul.gallery',
	'.mw-editsection',
	'sup.reference',
	'ol.references',
	'.error',
	'.nomobile',
	'.noprint',
	'.noexcerpt',
	'.sortkey'
];

const keepMainPageTag = [
	'div.main-page-tag-lcs',
	'div.lcs-container'
];

function parse_page(channel, text, wiki, {title}) {
	got.get( wiki + 'api.php?action=parse&prop=text&section=0&disablelimitreport=true&disableeditsection=true&disabletoc=true&sectionpreview=true&page=' + encodeURIComponent( title ) + '&format=json' ).then( response => {
		if ( response.statusCode !== 200 || !response?.body?.parse?.text ) {
			console.log( '- ' + response.statusCode + ': Error while parsing the page: ' + response?.body?.error?.info );
			client.chat.say( channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
			return;
		}
		var $ = load(response.body.parse.text['*'].replace( /<br\/?>/g, '\n' ));
		$('h1, h2, h3, h4, h5, h6').nextAll().remove();
		$('h1, h2, h3, h4, h5, h6').remove();
		$(removeClasses.join(', '), $('.mw-parser-output')).not(keepMainPageTag.join(', ')).remove();
		var description = $.root().text().trim();
		if ( description ) text += ' – ' + description;
		client.chat.say( channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
	}, error => {
		console.log( '- Error while parsing the page: ' + error );
		client.chat.say( channel, ( text.length < 450 ? text : text.substring(0, 450) + '\u2026' ) );
	} );
}

export default parse_page;