// Действия с песнями для всех экранов: включить место, перемешать, меню песни, добавить в плейлист.
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import {choose} from './ui/dialogs';
import type { Candidate } from './api';
import type { StackParams } from './nav';
import { trackKey, useApp } from './state';
import { askText, openTrackMenu } from './ui/kit';

export function useActions() {
  const { player, profile, favKeys, toggleFav, say, touch } = useApp();
  const nav = useNavigation<NavigationProp<StackParams>>();

  const openArtist = (name: string, ytId?: string) => nav.navigate('Artist', { name, ytId });

  function addToPlaylist(c: Candidate) {
    const pls = profile.playlists();
    const add = (id: number, name: string) => {
      profile.addToPlaylist(id, c);
      say(`Добавлено в «${name}»`);
      touch();
    };
    choose([...pls.map(p=>p.name),'Новый плейлист…','Отмена'],(i) => {
        if (i < pls.length) add(pls[i].id, pls[i].name);
        else if (i === pls.length) askText('Новый плейлист', (name) => add(profile.createPlaylist(name), name));
      },'Добавить в плейлист');
  }

  return {
    openArtist,
    /** Песня из места (альбом, плейлист, поиск...): очередь = всё место с этой песни. */
    play: (tracks: Candidate[], i: number, from: string) => player.playContext(tracks, i, from),
    playShuffled: (tracks: Candidate[], from: string) => player.playContext(tracks, Math.floor(Math.random() * tracks.length), from, { shuffle: true }),
    radio: (c: Candidate) => void player.startRadio(c).then(say),
    menu: (c: Candidate, remove?: () => void) =>
      openTrackMenu(c, favKeys.has(trackKey(c)), {
        playNext: (x) => {
          player.playNext(x);
          say(`«${x.title}» сыграет следующей`);
        },
        enqueue: (x) => {
          player.enqueue(x);
          say(`«${x.title}» в очереди`);
        },
        radio: (x) => {
          say('Подбираю похожие песни…');
          void player.startRadio(x).then(say);
        },
        toggleFav,
        addToPlaylist,
        openArtist,
        remove,
        dislike:x=>{profile.hide(x);touch();if(player.current?.candidate.id===x.id)player.next();say('Больше не предлагать');},
      }),
  };
}
