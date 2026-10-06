import { useEffect, useState } from 'react';

const mediaList = query => typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;

/** Whether a media query matches, kept in step with the window. */
export default function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => Boolean(mediaList(query)?.matches));
  useEffect(() => {
    const media = mediaList(query);
    if (!media) return undefined;
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}
