import { useEffect, useRef, useState } from 'react';
import { readBoardAsset } from '../../lib/boardFiles';

export function useSlideMedia(deckId: string, keys: string[], reconnect?: boolean) {
  const requestKey = [...new Set(keys)].sort().join(' ');
  const cache = useRef(new Map<string, string | null>());
  const [images, setImages] = useState<ReadonlyMap<string, string | null>>(() => new Map());

  useEffect(() => {
    const loaded = cache.current;
    return () => {
      for (const url of loaded.values()) if (url) URL.revokeObjectURL(url);
      loaded.clear();
    };
  }, [deckId]);

  useEffect(() => {
    const wanted = requestKey ? requestKey.split(' ') : [];
    const active = new Set(wanted);
    const loaded = cache.current;
    let removed = false;
    for (const [key, url] of loaded) {
      if (active.has(key)) continue;
      if (url) URL.revokeObjectURL(url);
      loaded.delete(key);
      removed = true;
    }
    if (removed) setImages(new Map(loaded));
    const missing = wanted.filter(key => !loaded.get(key) && (!loaded.has(key) || reconnect));
    const controller = new AbortController();
    let next = 0;
    async function fetchImages() {
      while (!controller.signal.aborted && next < missing.length) {
        const key = missing[next++];
        try {
          const image = await readBoardAsset(deckId, key, controller.signal);
          if (controller.signal.aborted) return;
          loaded.set(key, URL.createObjectURL(image));
        } catch {
          if (controller.signal.aborted) return;
          loaded.set(key, null);
        }
        setImages(new Map(loaded));
      }
    }
    for (let index = 0; index < Math.min(4, missing.length); index++) void fetchImages();
    return () => controller.abort();
  }, [deckId, reconnect, requestKey]);
  return images;
}
