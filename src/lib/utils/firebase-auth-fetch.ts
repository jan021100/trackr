import type { User } from 'firebase/auth';

/**
 * Calls a Trackr server endpoint with the current Firebase ID token. A cached
 * token can occasionally outlive Safari's restored tab session, so retry one
 * authentication failure with a freshly issued token.
 */
export async function firebaseAuthFetch(
  user: User,
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const request = async (forceRefresh: boolean) => {
    const token = await user.getIdToken(forceRefresh);
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };

  const response = await request(false);
  return response.status === 401 ? request(true) : response;
}
