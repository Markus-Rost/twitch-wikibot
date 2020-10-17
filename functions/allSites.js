var allSites = [];
function getAllSites(callback, force = false) {
    if ( allSites.length && !force && callback ) return callback(allSites);
    got.get( 'https://commons.gamepedia.com/api.php?action=allsites&formatversion=2&do=getSiteStats&filter=wikis|wiki_domain,wiki_display_name,wiki_managers,official_wiki,wiki_crossover,ss_good_articles&format=json', {
		responseType: 'json'
	} ).then( response => {
		var body = response.body;
		if ( response.statusCode !== 200 || !body || body.status !== 'okay' || !body.data || !body.data.wikis ) {
			console.log( '- ' + response.statusCode + ': Error while gettings all sites: ' + ( body && body.error && body.error.info ) );
		}
		else {
			console.log( '- Sites successfully loaded.' );
			allSites = JSON.parse(JSON.stringify(body.data.wikis.filter( site => /^[a-z\d-]{1,50}\.gamepedia\.com$/.test(site.wiki_domain) )));
			allSites.filter( site => site.wiki_crossover ).forEach( site => site.wiki_crossover = site.wiki_crossover.replace( /^(?:https?:)?\/\/(([a-z\d-]{1,50})\.(?:fandom\.com|wikia\.org)(?:(?!\/wiki\/)\/([a-z-]{1,8}))?).*/, '$1' ) );
			if ( callback ) callback(allSites);
		}
	}, error => {
			console.log( '- Error while gettings all sites: ' + error );
	} );
}

module.exports = getAllSites;