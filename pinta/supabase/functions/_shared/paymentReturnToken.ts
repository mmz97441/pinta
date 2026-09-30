/** Capability scoped to one checkout; raw values must never be persisted/logged. */
export async function hashPaymentReturnToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function createPaymentReturnToken() {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
  return { token, hash: await hashPaymentReturnToken(token), expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString() };
}
