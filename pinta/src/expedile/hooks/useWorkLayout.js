import { useEffect, useState } from 'react';
import { resolveWorkLayout } from '../domain/workTable';

const mediaList = query => typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;

function useMedia(query) {
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

/** Mon travail renders one layout, chosen here rather than hidden by CSS: a
 * second copy of a task would duplicate its form drafts and its
 * [data-work-action] target. `phone` folds the relay band away. */
export default function useWorkLayout(preference) {
  const wide = useMedia('(min-width: 1280px)');
  const phone = useMedia('(max-width: 767px)');
  return { layout: resolveWorkLayout(preference, wide), phone };
}
