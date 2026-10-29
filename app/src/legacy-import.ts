import type{Profile,Sql}from'./profile';
/** Pure import after a verified native database backup; one transaction and no source writes. */
export function importLegacy(profile:Profile,old:Pick<Sql,'all'>,backup:string){
 const liked=old.all<{track:string}>('SELECT track FROM favorites'),lists=old.all<{id:number;name:string}>('SELECT id,name FROM playlists ORDER BY id'),history=old.all<{track:string;played_at:number}>('SELECT track,played_at FROM history ORDER BY played_at,id'),artists=old.all<any>('SELECT * FROM fav_artists'),prefs=old.all<{name:string;value:string}>('SELECT * FROM prefs');
 return profile.db.transaction(()=>{let items=0;for(const row of liked){const c=JSON.parse(row.track);if(!profile.favoriteKeys().has(c.source+':'+c.id))profile.toggleFavorite(c);}for(const p of lists){const id=profile.createPlaylist(p.name);for(const row of old.all<{track:string}>('SELECT track FROM playlist_items WHERE playlist_id=? ORDER BY id',p.id)){profile.addToPlaylist(id,JSON.parse(row.track));items++;}}for(const h of history)profile.addHistory(JSON.parse(h.track),h.played_at);
  for(const a of artists)if(!profile.isFavArtist({name:a.name,ytId:a.yt_id})){profile.toggleFavArtist({name:a.name,ytId:a.yt_id,thumbnail:a.thumbnail,releases:JSON.parse(a.releases||'[]')});profile.db.prepare('UPDATE fav_artists SET seen_releases=?,opened_at=?,checked_at=?,fresh=? WHERE user_id=1 AND artist_key=?').run(a.seen_releases||'[]',a.opened_at||0,a.checked_at||0,a.fresh, a.artist_key);}
  for(const p of prefs)if(['shuffle','repeat','endless'].includes(p.name))profile.setPref(p.name,p.value);
  profile.db.prepare("INSERT INTO settings VALUES('mobile.legacy.imported',?)").run(backup);return{backup,favorites:liked.length,playlists:lists.length,items,history:history.length,artists:artists.length};
 })();
}
