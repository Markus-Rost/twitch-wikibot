import { inspect } from 'node:util';
import { inputToWikiProject } from 'mediawiki-projects-list';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {defaultSettings} = require('./default.json');

/**
 * A wiki.
 * @class Wiki
 */
export default class Wiki extends URL {
	/**
	 * Creates a new wiki.
	 * @param {String|URL|Wiki} [wiki] - The wiki script path.
	 * @param {String|URL|Wiki} [base] - The base for the wiki.
	 * @constructs Wiki
	 */
	constructor(wiki = defaultSettings.wiki, base = defaultSettings.wiki) {
		super(wiki, base);
		this.protocol = 'https';
		let articlepath = this.pathname + 'index.php?title=$1';
		this.gamepedia = this.hostname.endsWith( '.gamepedia.com' );
		if ( this.isGamepedia() ) articlepath = '/$1';
		this.wikifarm = null;
		this.centralauth = false;
		this.spaceReplacement = '_';
		let project = inputToWikiProject(this.href);
		if ( project ) {
			articlepath = project.fullArticlePath;
			this.spaceReplacement = project.wikiProject.urlSpaceReplacement;
			this.wikifarm = project.wikiProject.wikiFarm;
			this.centralauth = project.wikiProject.extensions.includes('CentralAuth');
		}
		this.articlepath = articlepath;
		this.mainpage = '';
		this.mainpageisdomainroot = false;
	}

	/**
	 * @type {String}
	 */
	get articlepath() {
		return this.articleURL.pathname + this.articleURL.search;
	}
	set articlepath(path) {
		this.articleURL = new articleURL(path, this);
	}

	/**
	 * @type {String}
	 */
	get mainpage() {
		return this.articleURL.mainpage;
	}
	set mainpage(title) {
		this.articleURL.mainpage = title;
	}

	/**
	 * Updates the wiki url.
	 * @param {Object} siteinfo - Siteinfo from the wiki API.
	 * @param {String} siteinfo.servername - Hostname of the wiki.
	 * @param {String} siteinfo.scriptpath - Scriptpath of the wiki.
	 * @param {String} siteinfo.articlepath - Articlepath of the wiki.
	 * @param {String} siteinfo.mainpage - Main page of the wiki.
	 * @param {String} siteinfo.centralidlookupprovider - Central auth of the wiki.
	 * @param {String} siteinfo.logo - Logo of the wiki.
	 * @param {String} [siteinfo.gamepedia] - If the wiki is a Gamepedia wiki.
	 * @returns {Wiki}
	 */
	updateWiki({servername, scriptpath, articlepath, mainpage, mainpageisdomainroot, centralidlookupprovider, logo, gamepedia = 'false'}) {
		this.hostname = servername;
		this.pathname = scriptpath + '/';
		this.articlepath = articlepath;
		this.mainpage = mainpage;
		this.mainpageisdomainroot = ( mainpageisdomainroot !== undefined );
		this.centralauth = ( centralidlookupprovider === 'CentralAuth' );
		this.gamepedia = ( gamepedia === 'true' );
		let project = inputToWikiProject(this.href);
		if ( project ) {
			this.spaceReplacement = project.wikiProject.urlSpaceReplacement;
			this.wikifarm = project.wikiProject.wikiFarm;
		}
		if ( /^(?:https?:)?\/\/static\.miraheze\.org\//.test(logo) ) this.wikifarm = 'miraheze';
		return this;
	}

	/**
	 * Check for a Gamepedia wiki.
	 * @returns {Boolean}
	 */
	isGamepedia() {
		return this.gamepedia;
	}

	/**
	 * Check for CentralAuth.
	 * @returns {Boolean}
	 */
	hasCentralAuth() {
		return this.centralauth;
	}

	/**
	 * Check if a wiki is missing.
	 * @param {String} [message] - Error message or response url.
	 * @param {Number} [statusCode] - Status code of the response.
	 * @returns {Boolean}
	 */
	noWiki(message = '', statusCode = 0) {
		if ( statusCode === 410 || statusCode === 404 ) return true;
		if ( this.wikifarm !== 'fandom' ) return false;
		if ( this.hostname.startsWith( 'www.' ) || message.startsWith( 'https://www.' ) ) return true;
		return [
			'https://community.fandom.com/wiki/Community_Central:Not_a_valid_community?from=' + this.hostname,
			this + 'language-wikis'
		].includes( message.replace( /Unexpected token < in JSON at position 0 in "([^ ]+)"/, '$1' ) );
	}

	/**
	 * Get a page link.
	 * @param {String} [title] - Name of the page.
	 * @param {URLSearchParams} [querystring] - Query arguments of the page.
	 * @param {String} [fragment] - Fragment of the page.
	 * @returns {String}
	 */
	toLink(title = '', querystring = '', fragment = '') {
		querystring = new URLSearchParams(querystring);
		if ( !querystring.toString().length ) {
			title = ( title || this.mainpage );
			if ( this.mainpageisdomainroot && title === this.mainpage ) return this.origin + '/' + Wiki.toSection(fragment, true, this.spaceReplacement);
		}
		title = title.replace( / /g, this.spaceReplacement ).replace( /%/g, '%2525' );
		let link = new URL(this.articleURL);
		link.pathname = link.pathname.replace( '$1', title.replace( /\\/g, '%5C' ) );
		link.searchParams.forEach( (value, name, searchParams) => {
			if ( value.includes( '$1' ) ) {
				if ( !title ) searchParams.delete(name);
				else searchParams.set(name, value.replace( '$1', title ));
			}
		} );
		querystring.forEach( (value, name) => {
			link.searchParams.append(name, value);
		} );
		link.hash = Wiki.toSection(fragment, false, this.spaceReplacement);
		return link.href.replace( /'/g, '%27' );
	}

	/**
	 * Encode a page title.
	 * @param {String} [title] - Title of the page.
	 * @param {String} [spaceReplacement] - The url replacement for spaces.
	 * @returns {String}
	 * @static
	 */
	static toTitle(title = '', spaceReplacement = '_') {
		return title.replace( / /g, spaceReplacement ).replace( /[?&%\\]/g, (match) => {
			return '%' + match.charCodeAt().toString(16).toUpperCase();
		} ).replace( /@(here|everyone)/g, '%40$1' ).replace( /[()]/g, '\\$&' );
	};

	/**
	 * Encode a link section.
	 * @param {String} [fragment] - Fragment of the page.
	 * @param {Boolean} [simpleEncoding] - Don't fully encode the anchor.
	 * @param {String} [spaceReplacement] - The url replacement for spaces.
	 * @returns {String}
	 * @static
	 */
	static toSection(fragment = '', simpleEncoding = true, spaceReplacement = '_') {
		if ( !fragment ) return '';
		fragment = fragment.replace( / /g, spaceReplacement );
		if ( simpleEncoding && !/['"`^{}<>|\\]|@(everyone|here)/.test(fragment) ) return '#' + fragment;
		return '#' + encodeURIComponent( fragment ).replace( /[!'()*~]/g, (match) => {
			return '%' + match.charCodeAt().toString(16).toUpperCase();
		} ).replace( /%3A/g, ':' ).replace( /%/g, '.' );
	}

	/**
	 * Turn user input into a wiki.
	 * @param {String} input - The user input referring to a wiki.
	 * @returns {Wiki?}
	 * @static
	 */
	static fromInput(input = '') {
		try {
			if ( input instanceof URL ) return new Wiki(input);
			input = input.replace( /^(?:https?:)?\/\//, 'https://' );
			var regex = input.match( /^(?:https:\/\/)?([a-z\d-]{1,50}\.(?:gamepedia\.com|(?:fandom\.com|wikia\.org)(?:(?!\/(?:wiki|api)\/)\/[a-z-]{2,12})?))(?:\/|$)/ );
			if ( regex ) return new Wiki('https://' + regex[1] + '/');
			let project = inputToWikiProject(input);
			if ( project ) return new Wiki(project.fullScriptPath);
			if ( input.startsWith( 'https://' ) ) {
				let wiki = input.replace( /\/(?:index|api|load|rest)\.php(?:|[\?\/#].*)$/, '/' );
				if ( !wiki.endsWith( '/' ) ) wiki += '/';
				return new Wiki(wiki);
			}
			if ( /^(?:[a-z-]{2,12}\.)?[a-z\d-]{1,50}$/.test(input) ) {
				if ( !input.includes( '.' ) ) return new Wiki('https://' + input + '.fandom.com/');
				else return new Wiki('https://' + input.split('.')[1] + '.fandom.com/' + input.split('.')[0] + '/');
			}
			return null;
		}
		catch {
			return null;
		}
	}

	[inspect.custom](depth, opts) {
		if ( typeof depth === 'number' && depth < 0 ) return this;
		const wiki = {
			href: this.href,
			origin: this.origin,
			protocol: this.protocol,
			username: this.username,
			password: this.password,
			host: this.host,
			hostname: this.hostname,
			port: this.port,
			pathname: this.pathname,
			search: this.search,
			searchParams: this.searchParams,
			hash: this.hash,
			articlepath: this.articlepath,
			articleURL: this.articleURL,
			spaceReplacement: this.spaceReplacement,
			mainpage: this.mainpage,
			mainpageisdomainroot: this.mainpageisdomainroot,
		}
		return 'Wiki ' + inspect(wiki, opts);
	}
}

/**
 * An article URL.
 * @class articleURL
 */
class articleURL extends URL {
	/**
	 * Creates a new article URL.
	 * @param {String|URL|Wiki} [articlepath] - The article path.
	 * @param {Wiki} [wiki] - The wiki.
	 * @constructs articleURL
	 */
	constructor(articlepath = '/index.php?title=$1', wiki) {
		super(articlepath, wiki);
		this.protocol = 'https';
		this.username = '';
		this.password = '';
		this.mainpage = '';
		this.spaceReplacement = ( wiki?.spaceReplacement || '_' );
	}

	[inspect.custom](depth, opts) {
		if ( typeof depth === 'number' && depth < 0 ) return this;
		if ( typeof depth === 'number' && depth < 2 ) {
			var link = this.href;
			var mainpage = link.replace( '$1', Wiki.toTitle(( this.mainpage || 'Main Page' ), this.spaceReplacement) );
			return 'articleURL { ' + inspect(link, opts) + ' => ' + inspect(mainpage, opts) + ' }';
		}
		return super[inspect.custom](depth, opts);
	}
}

export const toTitle = Wiki.toTitle;
export const toSection = Wiki.toSection;
export const fromInput = Wiki.fromInput;