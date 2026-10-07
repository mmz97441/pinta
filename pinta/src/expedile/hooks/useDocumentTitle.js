import { useEffect } from 'react';

export const SITE_NAME = 'Expedîle';

/** One distinct browser title per screen (« Mes expéditions — Expedîle »); the previous title returns when the screen closes. */
export default function useDocumentTitle(title) {
  useEffect(() => {
    if (!title) return undefined;
    const previous = document.title;
    document.title = `${title} — ${SITE_NAME}`;
    return () => { document.title = previous; };
  }, [title]);
}
