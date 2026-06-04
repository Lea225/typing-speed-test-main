/* =========================================================
   Typing Speed Test — Behavior
   ========================================================= */

(() => {
  'use strict';

  /* ---------- Constants ---------- */
  const TIMED_DURATION = 60;          // seconds for "Timed (60s)" mode
  const STORAGE_KEY    = 'tst:personalBest';
  const TICK_MS        = 100;         // stat refresh while typing

  const MESSAGES = {
    complete: {
      title: 'Test Complete!',
      message: 'Solid run. Keep pushing to beat your high score.',
      button: 'Go Again',
    },
    baseline: {
      title: 'Baseline Established!',
      message: 'You’ve set the bar. Now the real challenge begins—time to beat it.',
      button: 'Beat This Score',
    },
    'new-pb': {
      title: 'High Score Smashed!',
      message: 'You’re getting faster. That was incredible typing.',
      button: 'Beat This Score',
    },
  };

  /* ---------- DOM ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);

  const els = {
    // Live stats
    wpm:        $('[data-wpm]'),
    accuracy:   $('[data-accuracy]'),
    time:       $('[data-time]'),
    pb:         $('[data-personal-best]'),

    // Settings
    difficultyInputs: document.querySelectorAll('input[name="difficulty"]'),
    modeInputs:       document.querySelectorAll('input[name="mode"]'),
    optionGroups:     document.querySelectorAll('[data-option-group]'),

    // Test area
    testArea:       $('.test-area'),
    passage:        $('[data-passage]'),
    input:          $('[data-typing-input]'),
    startBtn:       $('[data-start-btn]'),
    restartWrapper: $('[data-restart-wrapper]'),
    restartBtn:     $('[data-restart-btn]'),

    // Results
    results:        $('[data-results]'),
    resultsTitle:   $('[data-results-title]'),
    resultsMessage: $('[data-results-message]'),
    finalWpm:       $('[data-final-wpm]'),
    finalAccuracy:  $('[data-final-accuracy]'),
    finalCorrect:   $('[data-final-correct]'),
    finalIncorrect: $('[data-final-incorrect]'),
    againBtn:       $('[data-again-btn]'),
    againLabel:     $('[data-again-label]'),

    // Confetti
    confetti: $('[data-confetti]'),
  };

  /* ---------- State ---------- */
  const state = {
    passages: null,          // { easy: [...], medium: [...], hard: [...] }
    difficulty: 'hard',
    mode: 'timed',
    passage: '',             // current passage text
    chars: [],               // char span elements
    cursor: 0,               // index of next char to type
    correctTotal: 0,         // correct keystrokes (cumulative, errors don't decrement)
    errorTotal: 0,           // wrong keystrokes (cumulative)
    keystrokes: 0,           // total keystrokes (correct + wrong)
    startedAt: null,         // ms timestamp when first key pressed
    tickId: null,
    testState: 'idle',       // 'idle' | 'typing' | 'done'
    personalBest: null,      // int (WPM) or null
  };

  /* =========================================================
     Init
     ========================================================= */
  async function init() {
    bindUI();
    syncSelectedFromInputs();
    loadPersonalBest();
    await loadPassages();
    pickPassage();
  }

  async function loadPassages() {
    try {
      const res = await fetch('./data.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      state.passages = await res.json();
    } catch (err) {
      console.error('Could not load passages:', err);
      // Fallback so the app still works offline / file://
      state.passages = {
        easy:   [{ id: 'easy-fb',   text: 'The quick brown fox jumps over the lazy dog. Practice makes progress.' }],
        medium: [{ id: 'medium-fb', text: 'Curiosity is the engine of achievement; without it, even the most disciplined effort eventually stalls.' }],
        hard:   [{ id: 'hard-fb',   text: 'Notwithstanding intermittent setbacks, the expedition pressed onward through labyrinthine canyons.' }],
      };
    }
  }

  /* =========================================================
     Passage rendering
     ========================================================= */
  function pickPassage() {
    const pool = state.passages?.[state.difficulty] || [];
    if (!pool.length) return;
    const next = pool[Math.floor(Math.random() * pool.length)].text;
    state.passage = next;
    renderPassage();
    resetRuntime();
    updateLiveStats(true);
  }

  function renderPassage() {
    els.passage.innerHTML = '';
    state.chars = [];
    const frag = document.createDocumentFragment();
    for (const ch of state.passage) {
      const span = document.createElement('span');
      span.className = 'char';
      span.textContent = ch;
      frag.appendChild(span);
      state.chars.push(span);
    }
    els.passage.appendChild(frag);
    paintCursor();
  }

  function paintCursor() {
    state.chars.forEach((span, i) => {
      span.classList.toggle('char--cursor', i === state.cursor && state.testState !== 'done');
    });
  }

  /* =========================================================
     Test lifecycle
     ========================================================= */
  function resetRuntime() {
    stopTick();
    state.cursor = 0;
    state.correctTotal = 0;
    state.errorTotal = 0;
    state.keystrokes = 0;
    state.startedAt = null;
    state.testState = 'idle';
    els.testArea.dataset.state = 'idle';
    els.results.hidden = true;
    els.restartWrapper.hidden = true;
    els.confetti.hidden = true;
    els.input.value = '';
    // Clear classes on chars
    state.chars.forEach(s => { s.className = 'char'; });
    paintCursor();
  }

  function startTest() {
    if (state.testState !== 'idle') return;
    state.testState = 'typing';
    state.startedAt = Date.now();
    els.testArea.dataset.state = 'typing';
    els.restartWrapper.hidden = false;
    els.input.focus();
    tick();
    state.tickId = setInterval(tick, TICK_MS);
  }

  function endTest() {
    if (state.testState === 'done') return;
    state.testState = 'done';
    stopTick();
    els.testArea.dataset.state = 'done';
    paintCursor();
    showResults();
  }

  function restartTest() {
    pickPassage();
    els.input.focus();
  }

  function stopTick() {
    if (state.tickId !== null) {
      clearInterval(state.tickId);
      state.tickId = null;
    }
  }

  /* =========================================================
     Typing handler
     ========================================================= */
  function onInput() {
    if (state.testState === 'done') {
      // Don't accept more input after end
      els.input.value = els.input.value.slice(0, state.cursor);
      return;
    }
    if (state.testState === 'idle') startTest();

    const value = els.input.value;

    // Cap input length to passage length
    if (value.length > state.passage.length) {
      els.input.value = value.slice(0, state.passage.length);
    }

    // Determine if this was a backspace (length decreased) or a new char
    const newLen = els.input.value.length;
    const prevCursor = state.cursor;

    if (newLen < prevCursor) {
      // Backspace: move cursor back, un-mark the char
      const removedIndex = newLen;
      const span = state.chars[removedIndex];
      if (span) span.classList.remove('char--correct', 'char--incorrect');
      state.cursor = newLen;
    } else if (newLen > prevCursor) {
      // One (or more, if paste) new chars typed
      for (let i = prevCursor; i < newLen; i++) {
        const expected = state.passage[i];
        const typed = els.input.value[i];
        const span = state.chars[i];
        if (!span) break;
        state.keystrokes++;
        if (typed === expected) {
          span.classList.add('char--correct');
          span.classList.remove('char--incorrect');
          state.correctTotal++;
        } else {
          span.classList.add('char--incorrect');
          span.classList.remove('char--correct');
          state.errorTotal++;
        }
      }
      state.cursor = newLen;
    }

    paintCursor();
    updateLiveStats();

    // End condition: full passage typed
    if (state.cursor >= state.passage.length) endTest();
  }

  // Block keyboard from leaving the input element when typing-area focused
  function onPassageClick() {
    if (state.testState === 'idle') startTest();
    els.input.focus();
  }

  /* =========================================================
     Timer + live stats
     ========================================================= */
  function tick() {
    if (state.testState !== 'typing') return;
    const remaining = remainingSeconds();
    if (state.mode === 'timed' && remaining <= 0) {
      endTest();
      return;
    }
    updateLiveStats();
  }

  function elapsedSeconds() {
    if (!state.startedAt) return 0;
    return (Date.now() - state.startedAt) / 1000;
  }

  function remainingSeconds() {
    return Math.max(0, TIMED_DURATION - elapsedSeconds());
  }

function formatTime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  // Timed mode : valeur bornée à [0, 60] → toujours "0:XX"
  if (state.mode === 'timed') {
    return `0:${String(s).padStart(2, '0')}`;
  }
  // Passage mode : peut dépasser 60s → format standard m:ss
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, '0')}`;
}

  function computeWPM() {
    const minutes = elapsedSeconds() / 60;
    if (minutes <= 0) return 0;
    // Standard WPM = correct chars / 5 / minutes
    return Math.round((state.correctTotal / 5) / minutes);
  }

  function computeAccuracy() {
    if (state.keystrokes === 0) return 100;
    return Math.round((state.correctTotal / state.keystrokes) * 100);
  }

  function updateLiveStats(forceReset = false) {
    if (forceReset || state.testState === 'idle') {
      els.wpm.textContent = '0';
      els.accuracy.textContent = '100%';
      els.time.textContent =
        state.mode === 'timed'
          ? formatTime(TIMED_DURATION)
          : '0:00';
      els.time.classList.remove('live-stats__value--time-running');
      els.accuracy.classList.remove('live-stats__value--accuracy-low');
      return;
    }

    const acc = computeAccuracy();
    els.wpm.textContent = String(computeWPM());
    els.accuracy.textContent = `${acc}%`;

    if (state.mode === 'timed') {
      els.time.textContent = formatTime(remainingSeconds());
    } else {
      els.time.textContent = formatTime(elapsedSeconds());
    }

    // Visual cues (subtle, matches design)
    els.time.classList.toggle('live-stats__value--time-running', state.testState === 'typing');
    els.accuracy.classList.toggle('live-stats__value--accuracy-low', acc < 100);
  }

  /* =========================================================
     Results + personal best
     ========================================================= */
  function loadPersonalBest() {
    const raw = localStorage.getItem(STORAGE_KEY);
    state.personalBest = raw === null ? null : Number(raw);
    renderPersonalBest();
  }

  function savePersonalBest(wpm) {
    state.personalBest = wpm;
    localStorage.setItem(STORAGE_KEY, String(wpm));
    renderPersonalBest();
  }

  function renderPersonalBest() {
    els.pb.textContent = state.personalBest === null ? '--' : String(state.personalBest);
  }

  function showResults() {
    const wpm = computeWPM();
    const acc = computeAccuracy();
    const correct = state.correctTotal;
    const incorrect = state.errorTotal;

    // Determine variant
    let variant;
    if (state.personalBest === null) {
      variant = 'baseline';
      savePersonalBest(wpm);
    } else if (wpm > state.personalBest) {
      variant = 'new-pb';
      savePersonalBest(wpm);
    } else {
      variant = 'complete';
    }

    // Apply variant
    els.results.dataset.variant = variant;
    els.resultsTitle.textContent = MESSAGES[variant].title;
    els.resultsMessage.textContent = MESSAGES[variant].message;
    els.againLabel.textContent = MESSAGES[variant].button;

    // Stats
    els.finalWpm.textContent = String(wpm);
    els.finalAccuracy.textContent = `${acc}%`;
    els.finalCorrect.textContent = String(correct);
    els.finalIncorrect.textContent = String(incorrect);

    // Reveal
    els.results.hidden = false;
    if (variant === 'new-pb') {
      els.confetti.hidden = false;
    }

    // Move focus to the action button for keyboard users
    els.againBtn.focus({ preventScroll: false });
  }

  /* =========================================================
     Settings (difficulty + mode) + dropdowns
     ========================================================= */
  function syncSelectedFromInputs() {
    document.querySelectorAll('input[name="difficulty"]').forEach(r => {
      if (r.checked) state.difficulty = r.value;
    });
    document.querySelectorAll('input[name="mode"]').forEach(r => {
      if (r.checked) state.mode = r.value;
    });
    syncTriggerLabels();
    updateLiveStats(true);
  }

  function syncTriggerLabels() {
    els.optionGroups.forEach(group => {
      const checked = group.querySelector('input[type="radio"]:checked');
      const labelEl = group.querySelector('[data-selected-label]');
      if (checked && labelEl) {
        const text = checked.parentElement.querySelector('.option__label').textContent;
        labelEl.textContent = text;
      }
    });
  }

  function onOptionChange(e) {
    const input = e.target;
    if (input.name === 'difficulty') {
      state.difficulty = input.value;
      pickPassage();
    } else if (input.name === 'mode') {
      state.mode = input.value;
      pickPassage();
    }
    syncTriggerLabels();
    closeAllDropdowns();
  }

  function openDropdown(group) {
    closeAllDropdowns(group);
    group.dataset.open = 'true';
    group.querySelector('.option-group__trigger')?.setAttribute('aria-expanded', 'true');
  }

  function closeDropdown(group) {
    delete group.dataset.open;
    group.querySelector('.option-group__trigger')?.setAttribute('aria-expanded', 'false');
  }

  function closeAllDropdowns(except = null) {
    els.optionGroups.forEach(g => { if (g !== except) closeDropdown(g); });
  }

  function onTriggerClick(e) {
    const group = e.currentTarget.closest('[data-option-group]');
    if (!group) return;
    if (group.dataset.open === 'true') closeDropdown(group);
    else openDropdown(group);
  }

  function onDocumentClick(e) {
    if (!e.target.closest('[data-option-group]')) closeAllDropdowns();
  }

  /* =========================================================
     UI bindings
     ========================================================= */
  function bindUI() {
    // Start / restart / again
    els.startBtn.addEventListener('click', () => {
      startTest();
      els.input.focus();
    });
    els.restartBtn.addEventListener('click', restartTest);
    els.againBtn.addEventListener('click', restartTest);

    // Click on passage focuses input (and starts the test)
    els.passage.addEventListener('click', onPassageClick);

    // Typing
    els.input.addEventListener('input', onInput);
    // Catch keys that don't always fire 'input' (some browsers/IMEs)
    els.input.addEventListener('keydown', (e) => {
      if (state.testState === 'idle' && e.key.length === 1) startTest();
    });

    // Settings
    document.querySelectorAll('input[name="difficulty"], input[name="mode"]')
      .forEach(r => r.addEventListener('change', onOptionChange));

    // Dropdown triggers
    document.querySelectorAll('.option-group__trigger')
      .forEach(t => t.addEventListener('click', onTriggerClick));

    // Close dropdown on outside click / Escape
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeAllDropdowns();
    });
  }

  /* =========================================================
     Go
     ========================================================= */
  init();

})();
