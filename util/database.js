import pg from 'pg';

const db = new pg.Pool()
export default db.on( 'error', dberror => {
	console.log( '- Error while connecting to the database: ' + dberror );
} );

const schema = [`
BEGIN TRANSACTION;
CREATE TABLE twitch (
    id          INTEGER PRIMARY KEY
                        UNIQUE
                        NOT NULL,
    name        TEXT    NOT NULL,
    wiki        TEXT    NOT NULL
                        DEFAULT 'https://en.wikipedia.org/w/',
    game        TEXT,
    cooldown    INTEGER NOT NULL
                        DEFAULT 0,
    restriction TEXT    NOT NULL
                        DEFAULT 'everyone'
);
CREATE INDEX idx_twitch_channel ON twitch (
    id
);
COMMIT TRANSACTION;
ALTER DATABASE "${process.env.PGDATABASE}" SET my.twitchVersion TO 1;
`];

db.query( 'SELECT CURRENT_SETTING($1, $2) AS version', ['my.twitchVersion', true] ).then( ({rows:[row]}) => {
	if ( row.version === null ) {
		return db.query( schema[0] ).then( () => {
			console.log( '- The database has been updated to: v' + schema.length );
		}, dberror => {
			console.log( '- Error while updating the database: ' + dberror );
			return Promise.reject();
		} );
	}
	row.version = parseInt(row.version, 10);
	if ( isNaN(row.version) || row.version > schema.length ) {
		console.log( '- Invalid database version: v' + row.version );
		return Promise.reject();
	}
	if ( row.version === schema.length ) {
		console.log( '- The database is up to date: v' + row.version );
		return;
	}
	console.log( '- The database is outdated: v' + row.version );
	if ( process.env.READONLY ) return Promise.reject();
	return db.query( schema.filter( (sql, version) => {
		if ( row.version === 0 ) return ( version === 0 );
		return ( row.version <= version );
	} ).join('\n') ).then( () => {
		console.log( '- The database has been updated to: v' + schema.length );
	}, dberror => {
		console.log( '- Error while updating the database: ' + dberror );
		return Promise.reject();
	} );
}, dberror => {
	console.log( '- Error while getting the database version: ' + dberror );
	return Promise.reject();
} ).catch( () => process.exit(1) );