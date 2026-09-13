/** Supabase keeps a non-2xx Edge response in error.context, not result.data. */
export async function functionErrorMessage(result, fallback = 'L’action n’a pas pu être enregistrée. Réessayez.') {
  if (typeof result?.data?.error === 'string' && result.data.error.trim()) return result.data.error;
  const response = result?.error?.context;
  if (response?.json) {
    try {
      const body = await (response.clone ? response.clone() : response).json();
      if (typeof body?.error === 'string' && body.error.trim()) return body.error;
    } catch { /* A missing or already-consumed error body must not hide the failure. */ }
  }
  return fallback;
}
