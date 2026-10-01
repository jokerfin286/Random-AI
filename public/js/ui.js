/**
 * ui.js — all DOM rendering and interaction wiring.
 * Reads from state, dispatches intent, never owns business rules.
 */

import { api } from './api.js';
import { getState, setState, subscribe, selectors } from './state.js';

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ toast */

let toastTimer = 0;

function toast(message, type = 'info') {
  const container = $('toastContainer');
  if (!container) return;

  const icons = { success: '✓', error: '!', info: 'i' };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type] || 'i'}</span><span>${escapeHtml(message)}</span>`;
  container.appendChild(el);

  window.setTimeout(() => {
    el.classList.add('is-leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, 2800);

  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    while (container.children.length > 3) container.removeChild(container.firstElementChild);
  }, 300);
}

function escapeHtml(value) {
  return (value ?? '').toString().replace(/[&<>"']/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
  ));
}

const formatDate = (iso) => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/* ------------------------------------------------------------- modal util */

function openModal(backdrop) {
  backdrop.classList.remove('hidden', 'is-closing');
  document.body.style.overflow = 'hidden';
}

function closeModal(backdrop) {
  if (!backdrop || backdrop.classList.contains('hidden')) return;
  backdrop.classList.add('is-closing');
  window.setTimeout(() => {
    backdrop.classList.add('hidden');
    backdrop.classList.remove('is-closing');
    if (![...document.querySelectorAll('.modal-backdrop')].some((m) => !m.classList.contains('hidden'))) {
      document.body.style.overflow = '';
    }
  }, 200);
}

/* -------------------------------------------------------------------- list */

function ideaItemMarkup(idea, isCompleted) {
  const difficulty = (idea.difficulty || 'Medium').toLowerCase();
  const date = isCompleted ? formatDate(idea.completedAt) : '';

  return `
    <li class="idea-item idea-item-enter ${isCompleted ? 'is-completed' : ''}" data-id="${idea.id}">
      <span class="idea-status-icon" aria-hidden="true">${isCompleted ? '✓' : '○'}</span>
      <div class="idea-body">
        <p class="idea-title">${escapeHtml(idea.title)}</p>
        <div class="idea-meta">
          ${idea.category ? `<span class="chip">${escapeHtml(idea.category)}</span>` : ''}
          <span class="chip chip-${difficulty}">${escapeHtml(idea.difficulty || 'Medium')}</span>
          ${date ? `<span class="idea-date">completed ${date}</span>` : ''}
        </div>
      </div>
      <div class="idea-actions">
        <button type="button" class="icon-btn" data-action="edit" title="Edit idea" aria-label="Edit idea">✎</button>
        <button type="button" class="icon-btn" data-action="toggle" title="${isCompleted ? 'Restore to available' : 'Mark as completed'}" aria-label="Toggle status">${isCompleted ? '↺' : '✓'}</button>
        <button type="button" class="icon-btn icon-btn-danger" data-action="delete" title="Delete idea" aria-label="Delete idea">✕</button>
      </div>
    </li>`;
}

function renderList(container, ideas, { completed = false, emptyTitle, emptyText, emptyAction = null }) {
  if (!ideas.length) {
    container.innerHTML = `
      <li class="list-empty">
        <strong>${escapeHtml(emptyTitle)}</strong>
        <span>${escapeHtml(emptyText)}</span>
        ${emptyAction ? `<div class="list-empty-cta"><button type="button" class="btn btn-secondary btn-sm" data-empty-action="${emptyAction.action}">${escapeHtml(emptyAction.label)}</button></div>` : ''}
      </li>`;
    return;
  }
  container.innerHTML = ideas.map((idea) => ideaItemMarkup(idea, completed)).join('');
}

/* ------------------------------------------------------------------ render */

function renderStats(state) {
  $('statAvailableCount').textContent = selectors.available(state).length;
  $('statCompletedCount').textContent = selectors.completed(state).length;
}

function renderLists(state) {
  const available = selectors.available(state);
  const completed = selectors.completed(state);
  const filteredAvailable = selectors.filterList(available, state);
  const filteredCompleted = selectors.filterList(completed, state);
  const hasFilter = Boolean(state.filter);

  $('availableSectionBadge').textContent = available.length;
  $('completedSectionBadge').textContent = completed.length;

  renderList($('availableIdeasList'), filteredAvailable, {
    emptyTitle: hasFilter ? 'No matches' : 'No available ideas',
    emptyText: hasFilter
      ? 'Try a different filter term.'
      : 'Add an idea to fill the roulette — the wheel only selects from this pool.',
    emptyAction: hasFilter ? null : { action: 'focus-add', label: '+ Add your first idea' }
  });

  renderList($('completedIdeasList'), filteredCompleted, {
    completed: true,
    emptyTitle: hasFilter ? 'No matches' : 'Nothing completed yet',
    emptyText: hasFilter
      ? 'Try a different filter term.'
      : 'Accept an idea from the roulette and it will show up here in green.'
  });

  $('restoreAllCompletedBtn').classList.toggle('hidden', completed.length === 0);
}

function renderWheelState(state) {
  const available = selectors.available(state);
  const overlay = $('wheelEmptyOverlay');
  const total = selectors.completed(state).length;

  $('centerSpinBtn').disabled = available.length === 0 || state.spinning;
  $('mainSpinBtn').disabled = available.length === 0 || state.spinning;

  if (available.length === 0) {
    overlay.classList.remove('hidden');
    $('wheelEmptyBadge').textContent = total > 0 ? 'POOL DEPLETED' : 'EMPTY POOL';
    $('wheelEmptyTitle').textContent = total > 0 ? 'No available ideas left' : 'No ideas yet';
    $('wheelEmptyDesc').textContent = total > 0
      ? 'Every idea has been completed. Restore them to the pool or add something new.'
      : 'Add your first coding idea and the roulette will start picking for you.';
    $('emptyRestoreAllBtn').classList.toggle('hidden', total === 0);
  } else {
    overlay.classList.add('hidden');
  }
}

function renderStage(state, roulette) {
  const stage = document.querySelector('.roulette-stage');
  stage.classList.toggle('is-spinning', state.spinning);
  stage.classList.toggle('is-locked', !state.spinning && state.resultId !== null);

  $('spinBtnLabel').textContent = state.spinning ? '…' : 'SPIN';
  $('spinBtnSub').textContent = state.spinning ? 'LOCKING' : 'SPACE';
  $('rotorStatusText').textContent = state.spinning
    ? 'SPINNING — LOCKING TARGET'
    : (state.resultId !== null ? 'TARGET LOCKED' : 'READY_TO_SPIN');

  const index = roulette ? roulette.pointerIndex : -1;
  const ideas = selectors.available(state);
  $('livePointerReadout').textContent = state.spinning && ideas[index]
    ? ideas[index].title
    : (state.resultId !== null && selectors.findById(state.resultId, state)
      ? selectors.findById(state.resultId, state).title
      : '—');
}

function renderResultModal(state) {
  const backdrop = $('resultModalBackdrop');
  const idea = state.resultId !== null ? selectors.findById(state.resultId, state) : null;

  if (!idea) {
    closeModal(backdrop);
    return;
  }

  $('resultIdeaTitle').textContent = idea.title;

  const difficulty = (idea.difficulty || 'Medium').toLowerCase();
  $('resultMetaTags').innerHTML = `
    ${idea.category ? `<span class="chip">${escapeHtml(idea.category)}</span>` : ''}
    <span class="chip chip-${difficulty}">${escapeHtml(idea.difficulty || 'Medium')}</span>`;

  openModal(backdrop);
}

function renderError(state) {
  if (!state.error) return;
  renderList($('availableIdeasList'), [], {
    emptyTitle: 'Could not reach the API',
    emptyText: state.error
  });
  renderList($('completedIdeasList'), [], {
    completed: true,
    emptyTitle: 'Unavailable',
    emptyText: 'Start the local server to load your ideas.'
  });
  $('mainSpinBtn').disabled = true;
  $('centerSpinBtn').disabled = true;
}

/* ----------------------------------------------------------------- wiring */

/**
 * Boots all UI behaviour.
 * @param {import('./roulette.js').IdeaRoulette} roulette
 * @param {{sfx: import('./sfx.js').SoundEngine}} deps
 */
export function initUI(roulette, { sfx }) {
  const state = getState();
  let soundEnabled = true;

  /* ---------- spin flow ---------- */
  async function startSpin() {
    const current = getState();
    if (current.spinning) return;

    const available = selectors.available(current);
    if (!available.length) {
      toast('No available ideas — add one or restore completed ideas.', 'info');
      return;
    }

    setState({ spinning: true, resultId: null, error: null });
    roulette.setSegments(available);
    roulette.clearHighlight();
    sfx.whoosh();

    const resolved = await roulette.spin();
    if (!resolved) {
      setState({ spinning: false });
      return;
    }

    sfx.chime();
    setState({ spinning: false, resultId: resolved.idea.id });
    highlightInList(resolved.idea.id);
  }

  function highlightInList(id) {
    const node = document.querySelector(`.idea-item[data-id="${id}"]`);
    if (!node) return;
    document.querySelectorAll('.idea-item.is-just-spun').forEach((el) => el.classList.remove('is-just-spun'));
    node.classList.add('is-just-spun');
    node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  $('centerSpinBtn').addEventListener('click', startSpin);
  $('mainSpinBtn').addEventListener('click', startSpin);
  $('spinAgainModalBtn').addEventListener('click', () => {
    closeModal($('resultModalBackdrop'));
    setState({ resultId: null });
    roulette.clearHighlight();
    startSpin();
  });

  /* ---------- accept / dismiss ---------- */
  $('acceptIdeaBtn').addEventListener('click', async () => {
    const target = selectors.findById(getState().resultId, getState());
    if (!target) return;

    try {
      const { ideas } = await api.update(target.id, { status: 'completed' });
      closeModal($('resultModalBackdrop'));
      roulette.clearHighlight();

      // Mark the card for the move animation, then commit the new list.
      const node = document.querySelector(`.idea-item[data-id="${target.id}"]`);
      node?.classList.add('is-removing');

      window.setTimeout(() => {
        setState({ ideas, resultId: null });
        toast('Idea locked in — go build it.', 'success');
      }, 180);
    } catch (error) {
      sfx.errorTone();
      toast(error.message, 'error');
    }
  });

  $('closeResultModalBtn').addEventListener('click', dismissResult);
  $('dismissResultBtn').addEventListener('click', dismissResult);

  function dismissResult() {
    closeModal($('resultModalBackdrop'));
    setState({ resultId: null });
    roulette.clearHighlight();
  }

  /* ---------- create ---------- */
  const addForm = $('addIdeaForm');

  function openAddForm() {
    addForm.classList.add('is-open');
    $('newIdeaTitleInput').focus();
  }

  $('quickAddToggleBtn').addEventListener('click', () => {
    addForm.classList.contains('is-open') ? addForm.classList.remove('is-open') : openAddForm();
  });

  $('openAddModalBtn').addEventListener('click', openAddForm);
  $('emptyAddIdeaBtn').addEventListener('click', openAddForm);

  addForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const title = $('newIdeaTitleInput').value.trim();
    if (!title) return;

    try {
      const { ideas } = await api.create({
        title,
        category: $('newIdeaCategoryInput').value.trim() || 'General',
        difficulty: $('newIdeaDifficultySelect').value
      });
      setState({ ideas });
      addForm.reset();
      $('newIdeaDifficultySelect').value = 'Medium';
      $('newIdeaTitleInput').focus();
      toast('Idea added to the pool.', 'success');
    } catch (error) {
      sfx.errorTone();
      toast(error.message, 'error');
    }
  });

  /* ---------- list actions (delegated) ---------- */
  document.querySelector('.lists-scroll-container').addEventListener('click', async (event) => {
    const emptyAction = event.target.closest('[data-empty-action]');
    if (emptyAction) {
      if (emptyAction.dataset.emptyAction === 'focus-add') openAddForm();
      return;
    }

    const button = event.target.closest('[data-action]');
    if (!button) return;

    const item = button.closest('.idea-item');
   