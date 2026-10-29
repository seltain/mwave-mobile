// Phone facade over the exact desktop 2.0 data model. No passwords or access tokens in SQLite.
import type {AlbumRef,Candidate} from './api';import {ProfileStore} from './pc/main/profile/profileStore';
import {desktopDb,type Sql} from './storage';import type {DB} from './pc/main/profile/db';
export type {Sql,SqlValue} from './storage';
export type FavArtist=ReturnType<ProfileStore['favArtists']>[number];
export interface PlaylistInfo{id:number;name:string;count:number;cover?:string;}
export interface HistoryEntry{id:number;track:Candidate;playedAt:number;}
export const trackKey=(c:Candidate)=>`${c.source}:${c.id}`;
export const artistKey=(a:{name:string;ytId?:string})=>a.ytId?'yt:'+a.ytId:'name:'+a.name.trim().toLowerCase();
export class Profile {
 readonly db:DB;readonly store:ProfileStore;
 constructor(sql:Sql){this.db=desktopDb(sql);this.db.prepare('INSERT OR IGNORE INTO users(id,name,name_key,pass_hash,created_at) VALUES(1,?,?,?,?)').run('iPhone','iphone','account-only',Date.now());this.store=new ProfileStore(this.db);this.store.openCloudProfile(1,false);this.db.exec('CREATE TABLE IF NOT EXISTS mobile_covers(hash TEXT PRIMARY KEY,jpeg TEXT NOT NULL);CREATE TABLE IF NOT EXISTS mobile_lyrics(key TEXT PRIMARY KEY,data TEXT NOT NULL);');this.store.coverUrl=file=>this.db.prepare('SELECT jpeg FROM mobile_covers WHERE hash=?').get(file.replace(/\.jpg$/,''))?`data:image/jpeg;base64,${(this.db.prepare('SELECT jpeg FROM mobile_covers WHERE hash=?').get(file.replace(/\.jpg$/,'')) as {jpeg:string}).jpeg}`:undefined;}
 favorites(){return this.store.listFavorites();}favoriteKeys(){return new Set(this.favorites().map(trackKey));}toggleFavorite(c:Candidate){return this.store.toggleFavorite(c);}
 playlists():PlaylistInfo[]{return this.store.listPlaylists().map(p=>({id:p.id,name:p.name,count:p.trackCount,cover:p.cover}));}
 createPlaylist(name:string){return this.store.createPlaylist(name).id;}renamePlaylist(id:number,name:string){this.store.renamePlaylist(id,name);}deletePlaylist(id:number){this.store.deletePlaylist(id);}
 playlistTracks(id:number){return this.store.playlistTracks(id);}addToPlaylist(id:number,c:Candidate){this.store.addToPlaylist(id,c);}
 removeFromPlaylist(itemId:number){const row=this.db.prepare('SELECT playlist_id FROM playlist_items WHERE id=?').get(itemId) as {playlist_id:number}|undefined;if(row)this.store.removeFromPlaylist(row.playlist_id,itemId);}
 moveItem(playlistId:number,itemId:number,afterItem:number|null){const list=this.playlistTracks(playlistId),at=list.findIndex(x=>x.itemId===itemId);if(at<0)return;const moved=list.splice(at,1)[0];list.splice(afterItem===null?0:Math.max(0,list.findIndex(x=>x.itemId===afterItem)+1),0,moved);this.db.transaction(()=>{list.forEach((x,i)=>this.db.prepare('UPDATE playlist_items SET position=? WHERE id=? AND playlist_id=?').run(i,x.itemId,playlistId));})();}
 addHistory(c:Candidate,at=Date.now()):number{const id=this.store.addHistory(c);const h=this.db.prepare('SELECT id FROM history WHERE user_id=1 ORDER BY id DESC LIMIT 1').get() as {id:number};this.db.transaction(()=>{this.db.prepare('UPDATE plays SET played_at=? WHERE id=? AND user_id=1').run(at,id);this.db.prepare('UPDATE history SET played_at=? WHERE id=? AND user_id=1').run(at,h.id);})();return id;}
 history(limit=200):HistoryEntry[]{return this.store.listHistory(limit);}
 clearHistory(){this.db.transaction(()=>this.db.prepare('DELETE FROM history WHERE user_id=1').run())();}
 recentTracks(hours:number){const seen=new Set<string>();return this.history().filter(h=>h.playedAt>=Date.now()-hours*3600000&&!seen.has(trackKey(h.track))&&!!seen.add(trackKey(h.track))).map(h=>h.track);}
 favArtists(){return this.store.favArtists();}isFavArtist(a:{name:string;ytId?:string}){return this.favArtists().some(x=>x.key===artistKey(a));}
 toggleFavArtist(a:{name:string;ytId?:string;thumbnail?:string;releases?:AlbumRef[]}){return this.store.toggleFavArtist(a);}
 markArtistOpened(a:{name:string;ytId?:string;thumbnail?:string},r:AlbumRef[]){const fresh=!!this.favArtists().find(x=>x.key===artistKey(a))?.fresh;this.store.markArtistOpened(a,r);return fresh;}
 favArtistsDue(ms:number,now=Date.now()){return this.favArtists().filter(x=>x.checkedAt<now-ms);}
 updateArtistReleases(key:string,r:AlbumRef[],thumbnail?:string,_now=Date.now()){this.store.updateArtistReleases(key,r,thumbnail);}
 pref(name:string){return this.store.getUserPref(name);}
 setPref(name:string,value:string){this.store.setUserPref(name,value);}
 saveAlbum(a:Parameters<ProfileStore['saveAlbum']>[0]){this.store.saveAlbum(a);}savedAlbums(){return this.store.savedAlbums();}savedAlbum(id:string){return this.store.savedAlbum(id);}unsaveAlbum(id:string){this.store.unsaveAlbum(id);}
 hide(c:Candidate){this.store.hide('track',c);}isHidden(c:Candidate){const h=this.store.hiddenKeys();return h.tracks.has(trackKey(c))||h.artists.has(c.artist.trim().toLowerCase());}
}
