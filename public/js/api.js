/**
 * api.js — REST communication layer.
 * The frontend never touches data/ideas.json directly; every mutation
 * travels through these four calls so persistence stays server-owned.
 */

const ENDPOINT = '/api/ideas';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

/**
 * Performs a JSON request and normalizes error reporting.
 * @param {string} path
 * @param {RequestInit} [options]
 * @returns {Promise<object>}
 */
async function request(path, options = {}) {
  let response;

  try {
    response = await fetch(path, { headers: JSON_HEADERS, ...options });
  } catch (_networkError) {
    throw new Error('Cannot reach the API server — make sure the app is running.');
  }

  const isJson = (response.headers.get('content-type') || '').includes('application/json');
  const payload = isJson ? await response.json().catch(() => ({})) : {};

  if (!response.ok) {
    throw new Error(payload.error || `Request failed with status ${response.status}`);
  }

  return payload;
}

export const api = {
  /** @returns {Promise<{ideas: import('./state.js').Idea[]}>} */
  list: () => request(ENDPOINT),

  /** @param {{title: string, category?: string, difficulty?: string}} idea */
  create: (idea) => request(ENDPOINT, { method: 'POST', body: JSON.stringify(idea) }),

  /** @param {number} id @param {object} patch */
  update: (id, patch) =>
    request(`${ENDPOINT}/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),

  /** @param {number} id */
  remove: (id) => request(`${ENDPOINT}/${id}`, { method: 'DELETE' }),

  /** Moves every completed idea back into the available pool. */
  restoreAll: () => request(`${ENDPOINT}/restore-all`, { method: 'POST' })
};