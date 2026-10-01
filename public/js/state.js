/**
 * state.js — single source of truth.
 * A tiny observable store: mutate through setState(), render via subscribe().
 */

/** @typedef {{id:number,title:string,category?:string,difficulty?:string,status:'available'|'completed',completedAt?:string}} Idea */

/** @type {{ideas: Idea[], filter: string, loading: boolean, spinning: boolean, error: string|null, resultId: number|null}} */
const state = {
  ideas: [],
  filter: '',
  loading: true,
  spinning: false,
  error: null,
  resultId: null
};

const listeners = new Set();

/** @returns {typeof state} */
export function getState() {
  return state;
}

/**
 * Subscribes to every state change.
 * @param {(state: typeof state) => void} listener
 * @returns {() => void} unsubscribe
 */
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Shallow-merges a patch into state and notifies subscribers.
 * @param {Partial<typeof state>} patch
 */
export function setState(patch) {
  Object.assign(state, patch);
  listeners.forEach((listener) => listener(state));
}

const normalize = (value) => (value || '').toString().toLowerCase();

export const selectors = {
  /** Ideas still eligible for the roulette. */
  available: (s = state) => s.ideas.filter((idea) => idea.status !== 'completed'),

  /** Ideas the user already accepted. */
  completed: (s = state) => s.ideas.filter((idea) => idea.status === 'completed'),

  /** Case-insensitive match against title + category. */
  matches(idea, query) {
    if (!query) return true;
    const needle = normalize(query);
    return normalize(idea.title).includes(needle) || normalize(idea.category).includes(needle);
  },

  /** Applies the active search filter to any list. */
  filterList(list, s = state) {
    return list.filter((idea) => selectors.matches(idea, s.filter));
  },

  findById(id, s = state) {
    return s.ideas.find((idea) => Number(idea.id) === Number(id)) || null;
  }
};