module.exports.Wiki = class Wiki {
	constructor(url) {
		this.url = url.toString();
	}

	toString() {
		return this.url;
	}

	isFandom() {
		return /^https:\/\/[a-z\d-]{1,50}\.(?:fandom\.com|wikia\.org)\/(?:[a-z-]{1,8}\/)?$/.test(this.url);
	}
	
	noWiki(href) {
		if ( !href ) return false;
		else if ( this.url.startsWith( 'https://www.' ) && ( this.isFandom() || this.url.endsWith( '.gamepedia.com/' ) ) ) return true;
		else if ( this.url.endsWith( '.gamepedia.com/' ) ) return 'https://www.gamepedia.com/' === href;
		else if ( this.isFandom() ) return [
			this.url.replace( /^https:\/\/([a-z\d-]{1,50}\.(?:fandom\.com|wikia\.org))\/(?:[a-z-]{1,8}\/)?$/, 'https://community.fandom.com/wiki/Community_Central:Not_a_valid_community?from=$1' ),
			this.url + 'language-wikis'
		].includes( href.replace( /Unexpected token < in JSON at position 0 in "([^ ]+)"/, '$1' ) );
		else return false;
	}
}