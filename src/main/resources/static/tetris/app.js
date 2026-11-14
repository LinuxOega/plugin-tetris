/**
 * Standalone Tetris page controller.
 *
 * Runs in two modes:
 *  - Under Halo (/plugins/plugin-tetris/assets/tetris/index.html): uses the
 *    plugin's public leaderboard API for the site-wide ranking.
 *  - Opened directly (static blog, object storage, file://): falls back to a
 *    browser-local leaderboard so the page is still fully playable.
 *
 * Domain-agnostic by design: every URL here is a same-origin, root-relative
 * path. No hostname, protocol or port is ever hard-coded, so the same JAR
 * works at https://<the installing site's own domain>/tetris everywhere.
 */
(function () {
  'use strict';

  const core = window.TetrisCore;
  if (!core) {
    document.body.textContent = '游戏核心加载失败，请检查 tetris-core.js 是否存在。';
    return;
  }

  const BEST_KEY = 'halo-tetris-best';
  const NAME_KEY = 'halo-tetris-player';
  const LOCAL_KEY = 'halo-tetris-local-board';
  const DEFAULT_API_BASE = '/apis/api.tetris.halo.run/v1alpha1/scores';
  // Captures an optional site prefix when Halo is proxied under a sub-path
  // (e.g. /blog/plugins/...). Only the pathname is inspected: the origin is
  // never read, so one build serves any domain, protocol and port.
  const HALO_GAME_PATH = /^(.*?)\/plugins\/plugin-tetris\/assets\/tetris\//;
  const HTTP = location.protocol === 'http:' || location.protocol === 'https:';
  const config = (window.TETRIS_CONFIG && typeof window.TETRIS_CONFIG === 'object')
    ? window.TETRIS_CONFIG
    : {};
  const haloPath = HTTP ? location.pathname.match(HALO_GAME_PATH) : null;
  const siteBase = typeof config.basePath === 'string'
    ? config.basePath.replace(/\/+$/, '')
    : (haloPath ? haloPath[1] : '');

  // Mode resolution (most explicit wins): local > apiBase > Halo path > local.
  let API_BASE = null;
  if (config.mode === 'local') {
    API_BASE = null;
  } else if (typeof config.apiBase === 'string' && config.apiBase.trim()) {
    API_BASE = config.apiBase.trim();
  } else if (haloPath) {
    API_BASE = `${siteBase}${DEFAULT_API_BASE}`;
  }

  const $ = (id) => document.getElementById(id);
  const boardEl = $('board');
  const scoreEl = $('score');
  const bestEl = $('best');
  const linesEl = $('lines');
  const levelEl = $('level');
  const piecesEl = $('pieces');
  const overlayEl = $('overlay');
  const overTitleEl = $('over-title');
  const overDetailEl = $('over-detail');
  const retryBtn = $('retry');
  const pauseBtn = $('pause');
  const statusEl = $('status');
  const playerInput = $('player');
  const submitBtn = $('submit');
  const nextListEl = $('next-list');
  const holdEl = $('hold');
  const rankList = $('rank-list');
  const rankEmpty = $('rank-empty');
  const rankTitle = $('rank-title');

  // A top-level Halo page should offer a way back; inside an iframe the host
  // page already has navigation, and static deployments do not show the link.
  const backLink = $('back-link');
  const embedded = config.embedded === true || window.self !== window.top;
  if (backLink && API_BASE && !embedded) {
    backLink.href = typeof config.homeUrl === 'string' && config.homeUrl.trim()
      ? config.homeUrl.trim()
      : (siteBase ? `${siteBase}/` : '/');
    backLink.hidden = false;
  }

  let best = readNumber(BEST_KEY);
  let state = core.createInitialState();
  let paused = false;
  let submitted = false;
  let timer = null;

  function readText(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function writeText(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* private mode */ }
  }
  function readNumber(key) {
    const n = Number(readText(key));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  // ---- Halo / Ethereal theme integration ---------------------------------
  // The game page is a standalone document served through ReverseProxy, so it
  // does not inherit the theme's CSS variables. Ethereal keeps its colour
  // scheme in same-origin localStorage; sharing the origin lets us follow
  // light/dark and hue switches without touching theme files or injecting JS.
  const THEME_KEYS = ['theme', '__user_chose_theme', 'hue', 'bannerDisplay'];
  const SCHEME_CLASSES = ['color-scheme-auto', 'color-scheme-light', 'color-scheme-dark'];

  function setupThemeSync() {
    const root = document.documentElement;
    const preference = config.theme; // undefined (auto) | 'ethereal' | 'off'
    if (preference === 'off') return;

    const forced = preference === 'ethereal';
    const detected = forced || (!!API_BASE && THEME_KEYS.some((key) => readText(key) !== null));
    if (!detected) return;

    root.classList.add('theme-ethereal');
    let override = null;
    let overrideHue = null;

    function systemDark() {
      return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
    function resolveMode() {
      if (override === 'light' || override === 'dark' || override === 'auto') return override;
      const userChose = readText('__user_chose_theme') !== null;
      const stored = userChose ? readText('theme') : null;
      return stored === 'light' || stored === 'dark' ? stored : 'auto';
    }
    function apply() {
      const mode = resolveMode();
      const dark = mode === 'dark' || (mode === 'auto' && systemDark());
      root.classList.toggle('dark', dark);
      root.classList.remove(...SCHEME_CLASSES);
      root.classList.add(`color-scheme-${mode}`);
      root.dataset.colorScheme = mode;
      const hue = readText('hue');
      root.style.setProperty('--hue', overrideHue
        || (hue && /^\d+$/.test(hue) ? hue : String(config.defaultHue || 250)));
    }

    window.addEventListener('storage', (event) => {
      if (!event.key || THEME_KEYS.indexOf(event.key) !== -1) apply();
    });
    if (window.matchMedia) {
      const query = window.matchMedia('(prefers-color-scheme: dark)');
      if (query.addEventListener) query.addEventListener('change', apply);
      else if (query.addListener) query.addListener(apply);
    }
    window.addEventListener('message', (event) => {
      if (event.origin !== location.origin) return;
      const data = event.data;
      if (!data || data.type !== 'tetris:theme') return;
      if (data.scheme === 'light' || data.scheme === 'dark' || data.scheme === 'auto') {
        override = data.scheme;
      }
      if (data.hue != null && /^\d+$/.test(String(data.hue))) {
        overrideHue = String(data.hue);
      }
      apply();
    });
    apply();
  }

  // ---- Fit-to-viewport ---------------------------------------------------
  // Keep the whole game visible at 100% browser zoom. Embedded in the
  // same-origin Halo page, the iframe is resized to the space left in the host
  // viewport and the 10x20 board is sized from the height left after the
  // header, toolbar and controls. Everything is measured at runtime, so it
  // also works after a window resize, a phone rotation or a taller theme.
  function setupFitToViewport() {
    const root = document.documentElement;
    if (embedded) root.classList.add('is-embedded');

    const appEl = document.querySelector('.app');
    const wrap = document.querySelector('.board-wrap');
    const gameEl = document.querySelector('.game');
    if (!appEl || !wrap || !gameEl) return;
    // No layout engine (jsdom / hidden iframe): rely on the CSS dvh fallback
    // and do not register observers or timers that could outlive the document.
    const probe = appEl.getBoundingClientRect();
    if (!probe || !probe.height) return;

    let frame = null;
    try {
      if (embedded && window.frameElement && window.parent !== window) {
        frame = window.frameElement;
      }
    } catch (e) {
      frame = null; // cross-origin frame: the host keeps its own height
    }

    const num = (value) => (Number.isFinite(value) ? value : 0);
    const heightOf = (selector) => {
      const el = document.querySelector(selector);
      if (!el || el.hidden) return 0;
      const style = window.getComputedStyle(el);
      if (style.display === 'none') return 0;
      return el.getBoundingClientRect().height
        + num(parseFloat(style.marginTop)) + num(parseFloat(style.marginBottom));
    };

    // A small game is fine; needing to zoom out or scroll the browser is not.
    // Tetris needs a taller board than 2048 (10 x 20), so it claims a full
    // viewport whenever the theme header leaves too little room.
    const FRAME_MIN = 240;
    const FRAME_MAX = 880;
    const FRAME_GAP = 16;
    const COMFORT_MIN = 420;
    const BOARD_MAX = 320;
    const BOARD_MIN = 100;
    const BOARD_RATIO = 2; // 10 columns x 20 rows
    let lastFrame = -1;
    let lastBoard = -1;
    let queued = false;
    let autoScrolled = false;

    function fitFrame() {
      if (!frame || !frame.style) return;
      try {
        const host = window.parent;
        const viewport = window.parent.innerHeight;
        if (!viewport) return;
        const top = num(frame.getBoundingClientRect().top);
        // Always resize the host frame to the space that actually remains in
        // the viewport, even for pages created by older plugin versions with a
        // fixed 720px iframe. Shrinking it is what makes 100% zoom playable.
        const offset = Math.max(0, Math.min(top, viewport));
        const remaining = viewport - offset - FRAME_GAP;
        const wanted = Math.round(Math.max(FRAME_MIN,
          Math.min(FRAME_MAX, remaining)));
        if (wanted !== lastFrame) {
          lastFrame = wanted;
          frame.style.height = `${wanted}px`;
        }
        if (!autoScrolled && remaining < COMFORT_MIN) {
          autoScrolled = true;
          const docTop = top + num(host.scrollY) - 8;
          if (docTop > 0 && typeof host.scrollTo === 'function') {
            host.scrollTo(0, docTop);
            const expanded = Math.round(Math.max(FRAME_MIN,
              Math.min(FRAME_MAX, viewport - 8 - FRAME_GAP)));
            if (expanded !== lastFrame) {
              lastFrame = expanded;
              frame.style.height = `${expanded}px`;
            }
          }
        }
      } catch (e) { /* restricted frame: keep host height */ }
    }

    function fitBoard() {
      const viewport = window.innerHeight || root.clientHeight;
      if (!viewport) return;
      const bodyStyle = window.getComputedStyle(document.body);
      const gameStyle = window.getComputedStyle(gameEl);
      const layoutEl = document.querySelector('.layout');
      const layoutStyle = layoutEl ? window.getComputedStyle(layoutEl) : null;
      const chrome = num(parseFloat(bodyStyle.paddingTop))
        + num(parseFloat(bodyStyle.paddingBottom))
        + num(parseFloat(gameStyle.paddingTop))
        + num(parseFloat(gameStyle.paddingBottom))
        + (layoutStyle ? num(parseFloat(layoutStyle.marginTop)) : 0)
        + heightOf('.back-link') + heightOf('.header') + heightOf('.toolbar')
        + heightOf('.status') + heightOf('.hint') + heightOf('.touch-controls')
        + heightOf('.footer') + 12;
      const availableHeight = viewport - chrome;
      const availableWidth = gameEl.clientWidth
        - num(parseFloat(gameStyle.paddingLeft))
        - num(parseFloat(gameStyle.paddingRight));
      const width = Math.max(BOARD_MIN, Math.floor(Math.min(
        BOARD_MAX, availableWidth, availableHeight / BOARD_RATIO
      )));
      if (width !== lastBoard) {
        lastBoard = width;
        wrap.style.width = `${width}px`;
      }
    }

    const schedule = () => {
      if (queued) return;
      queued = true;
      const raf = window.requestAnimationFrame || ((cb) => setTimeout(cb, 16));
      raf(() => {
        queued = false;
        fitFrame();
        fitBoard();
      });
    };

    fitFrame();
    schedule();
    window.addEventListener('resize', schedule);
    if (frame) {
      try {
        window.parent.addEventListener('resize', schedule);
        window.parent.addEventListener('scroll', schedule, { passive: true });
      } catch (e) { /* noop */ }
    }
    if (window.ResizeObserver) {
      new window.ResizeObserver(schedule).observe(appEl);
    }
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(schedule).catch(() => {});
    }
  }

  // ---- Board and previews -------------------------------------------------
  const cells = [];
  for (let i = 0; i < core.ROWS * core.COLS; i += 1) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cells.push(cell);
    boardEl.appendChild(cell);
  }

  function buildPreview(container) {
    const grid = document.createElement('div');
    grid.className = 'preview-grid';
    for (let i = 0; i < 16; i += 1) grid.appendChild(document.createElement('i'));
    container.replaceChildren(grid);
    return grid;
  }

  const nextGrids = [buildPreview(nextListEl), buildPreview(nextListEl), buildPreview(nextListEl)];
  // buildPreview replaces children, so append all three grids explicitly.
  nextListEl.replaceChildren(...nextGrids);
  const holdGrid = buildPreview(holdEl);

  function paintPreview(grid, type) {
    const matrix = type ? core.SHAPES[type] : null;
    const id = type ? core.TYPE_ID[type] : 0;
    for (let r = 0; r < 4; r += 1) {
      for (let c = 0; c < 4; c += 1) {
        grid.children[r * 4 + c].className = matrix && matrix[r][c] ? `fill t${id}` : '';
      }
    }
  }

  function render() {
    const view = core.boardWithActive(state);
    const activeId = state.active ? core.TYPE_ID[state.active.type] : 0;
    let i = 0;
    for (let r = 0; r < core.ROWS; r += 1) {
      for (let c = 0; c < core.COLS; c += 1) {
        const value = view[r][c];
        let className = 'cell';
        if (value === 20) className = `cell ghost t${activeId}`;
        else if (value > 10) className = `cell fill t${value - 10}`;
        else if (value > 0) className = `cell fill t${value}`;
        cells[i].className = className;
        i += 1;
      }
    }
    scoreEl.textContent = String(state.score);
    bestEl.textContent = String(best);
    linesEl.textContent = String(state.lines);
    levelEl.textContent = String(state.level);
    piecesEl.textContent = String(state.pieces);
    state.queue.slice(0, 3).forEach((type, index) => paintPreview(nextGrids[index], type));
    paintPreview(holdGrid, state.hold);
  }

  // ---- Game loop ----------------------------------------------------------
  function schedule() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (paused || state.over) return;
    timer = setTimeout(() => {
      timer = null;
      if (paused || state.over) return;
      setState(core.tick(state));
    }, core.dropInterval(state.level));
  }

  function setStatus(text) {
    statusEl.textContent = text || '';
  }

  function syncButtons() {
    submitBtn.disabled = submitted;
    pauseBtn.textContent = paused ? '继续' : '暂停';
  }

  function showOverlay(title, detail, buttonText, handler) {
    overTitleEl.textContent = title;
    overDetailEl.textContent = detail;
    retryBtn.textContent = buttonText;
    retryBtn.onclick = handler;
    overlayEl.hidden = false;
  }

  function setState(next) {
    const wasOver = state.over;
    state = next;
    if (state.score > best) {
      best = state.score;
      writeText(BEST_KEY, String(best));
    }
    render();
    syncButtons();
    if (state.over && !wasOver) {
      if (timer) { clearTimeout(timer); timer = null; }
      showOverlay('游戏结束', `得分 ${state.score} · 消行 ${state.lines} · 等级 ${state.level}`,
        '再来一局', newGame);
      reportScore();
      return;
    }
    schedule();
  }

  function newGame() {
    if (timer) { clearTimeout(timer); timer = null; }
    state = core.createInitialState();
    paused = false;
    submitted = false;
    overlayEl.hidden = true;
    setStatus('');
    render();
    syncButtons();
    schedule();
  }

  function togglePause() {
    if (state.over) return;
    paused = !paused;
    syncButtons();
    if (paused) {
      if (timer) { clearTimeout(timer); timer = null; }
      showOverlay('已暂停', '按 P 或点击下面的按钮继续', '继续', togglePause);
    } else {
      overlayEl.hidden = true;
      schedule();
    }
  }

  function act(action) {
    if (action === 'restart') { newGame(); return; }
    if (action === 'pause') { togglePause(); return; }
    if (state.over || paused) return;
    let next = state;
    switch (action) {
      case 'left': next = core.shift(state, -1, 0); break;
      case 'right': next = core.shift(state, 1, 0); break;
      case 'down': next = core.softDrop(state); break;
      case 'rotate': next = core.rotate(state, 1); break;
      case 'rotateLeft': next = core.rotate(state, -1); break;
      case 'drop': next = core.hardDrop(state); break;
      case 'hold': next = core.holdPiece(state); break;
      default: return;
    }
    if (next !== state) setState(next);
  }

  // ---- Leaderboard --------------------------------------------------------
  function readLocalBoard() {
    try {
      const rows = JSON.parse(readText(LOCAL_KEY) || '[]');
      return Array.isArray(rows) ? rows : [];
    } catch (e) {
      return [];
    }
  }

  function renderRank(rows) {
    rankList.replaceChildren();
    rows.slice(0, 10).forEach((row, index) => {
      const li = document.createElement('li');
      const rank = document.createElement('span');
      rank.className = 'rank';
      rank.textContent = String(index + 1);
      const name = document.createElement('span');
      name.className = 'name';
      // textContent keeps player-supplied names inert (no HTML injection).
      name.textContent = String(row.player || '匿名玩家');
      const score = document.createElement('span');
      score.className = 'score';
      score.textContent = String(Number(row.score) || 0);
      li.append(rank, name, score);
      rankList.appendChild(li);
    });
    const empty = rows.length === 0;
    rankEmpty.hidden = !empty;
    rankEmpty.textContent = empty
      ? (API_BASE ? '还没有人上榜，快来占个坑' : '本地模式：成绩仅保存在此浏览器')
      : '';
  }

  function loadRank() {
    rankTitle.textContent = API_BASE ? '全站排行榜' : '本地排行榜';
    if (!API_BASE) {
      renderRank(readLocalBoard());
      return;
    }
    fetch(`${API_BASE}?size=10`, { headers: { Accept: 'application/json' } })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => renderRank(Array.isArray(data) ? data : []))
      .catch(() => {
        setStatus('在线排行榜不可用，已切换为本地排行榜');
        renderRank(readLocalBoard());
      });
  }

  function saveLocal(row) {
    const rows = readLocalBoard();
    rows.push(Object.assign({ createdAt: new Date().toISOString() }, row));
    rows.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
    writeText(LOCAL_KEY, JSON.stringify(rows.slice(0, 10)));
    submitted = true;
    renderRank(readLocalBoard());
    syncButtons();
  }

  function reportScore() {
    if (submitted) {
      setStatus('本局成绩已提交过');
      return;
    }
    const name = (playerInput.value || '').trim().slice(0, 24) || '匿名玩家';
    writeText(NAME_KEY, name);
    const payload = {
      player: name,
      score: state.score,
      lines: state.lines,
      level: state.level,
      pieces: state.pieces,
    };
    if (!API_BASE) {
      saveLocal(payload);
      setStatus('本地模式：成绩已保存在此浏览器');
      return;
    }
    fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(() => {
        submitted = true;
        setStatus('成绩已提交到全站排行榜');
        loadRank();
        syncButtons();
      })
      .catch(() => {
        setStatus('在线提交失败，成绩已保存到本地排行榜');
        saveLocal(payload);
      });
  }

  // ---- Input --------------------------------------------------------------
  const KEY_ACTIONS = {
    ArrowLeft: 'left', ArrowRight: 'right', ArrowDown: 'down', ArrowUp: 'rotate',
    a: 'left', d: 'right', s: 'down', w: 'rotate',
    A: 'left', D: 'right', S: 'down', W: 'rotate',
    x: 'rotate', X: 'rotate', q: 'rotateLeft', Q: 'rotateLeft',
    c: 'hold', C: 'hold', p: 'pause', P: 'pause', r: 'restart', R: 'restart',
    ' ': 'drop', Spacebar: 'drop',
  };

  window.addEventListener('keydown', (event) => {
    const target = event.target;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (target && target.isContentEditable) return;
    const action = KEY_ACTIONS[event.key];
    if (!action) return;
    event.preventDefault();
    act(action);
  });

  document.querySelectorAll('.touch-controls [data-action]').forEach((button) => {
    button.addEventListener('click', () => act(button.getAttribute('data-action')));
  });

  let touchStart = null;
  boardEl.addEventListener('touchstart', (event) => {
    const touch = event.touches[0];
    if (touch) touchStart = { x: touch.clientX, y: touch.clientY };
  }, { passive: true });
  boardEl.addEventListener('touchend', (event) => {
    if (!touchStart) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - touchStart.x;
    const dy = touch.clientY - touchStart.y;
    touchStart = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) {
      act('rotate');
      return;
    }
    event.preventDefault();
    if (Math.abs(dx) > Math.abs(dy)) act(dx > 0 ? 'right' : 'left');
    else act(dy > 0 ? 'drop' : 'rotate');
  }, { passive: false });

  $('new-game').addEventListener('click', newGame);
  pauseBtn.addEventListener('click', togglePause);
  submitBtn.addEventListener('click', reportScore);
  $('refresh').addEventListener('click', loadRank);
  playerInput.value = readText(NAME_KEY) || '';

  const footerEl = document.querySelector('.footer');
  if (footerEl) {
    footerEl.textContent = API_BASE
      ? 'Powered by Halo 插件 · 俄罗斯方块'
      : '俄罗斯方块 · 成绩仅保存在此浏览器';
  }

  setupThemeSync();
  setupFitToViewport();
  render();
  syncButtons();
  loadRank();
  schedule();
})();
