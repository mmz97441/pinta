import React, { useEffect, useState } from 'react';
import * as sb from '../../lib/supabaseData';

/** URLs are signed on read; only the storage path is kept in business records. */
export function useSignedFile(bucket, pathOrUrl) {
  const [state, setState] = useState({ url: '', error: '', loading: Boolean(pathOrUrl) });
  useEffect(() => {
    let alive = true;
    setState({ url: '', error: '', loading: Boolean(pathOrUrl) });
    if (pathOrUrl) sb.signedFileUrl(bucket, pathOrUrl).then((url) => {
      if (alive) setState({ url, error: '', loading: false });
    }).catch(() => {
      if (alive) setState({ url: '', error: 'Document indisponible. Rechargez le dossier pour réessayer.', loading: false });
    });
    return () => { alive = false; };
  }, [bucket, pathOrUrl]);
  return state;
}

export function SecureImage({ bucket = 'photos-colis', src, alt = '', ...props }) {
  const { url, error, loading } = useSignedFile(bucket, src);
  if (!src) return null;
  if (loading) return <div role="status" className="h-32 rounded-xl bg-gray-100 animate-pulse" aria-label="Chargement de la photo" />;
  if (error) return <p role="status" className="text-xs text-red-600 p-3">{error}</p>;
  return <img {...props} src={url} alt={alt} />;
}

export function SecureFileLink({ bucket = 'factures', href, children, ...props }) {
  const { url, error, loading } = useSignedFile(bucket, href);
  if (!url) return <span className="text-xs text-gray-500" title={error || ''}>{loading ? 'Chargement du document…' : error || 'Document indisponible'}</span>;
  return <a {...props} href={url} target="_blank" rel="noopener noreferrer">{children}</a>;
}
