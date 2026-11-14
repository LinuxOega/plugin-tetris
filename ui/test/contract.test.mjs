import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jsdom from 'jsdom';

/**
 * Contract: this is a plugin, not a site-specific deployment. The only public
 * entry is https://<the installing site's own domain>/tetris. Nothing shipped
 * may pin a concrete hostname, and the runtime must issue identical same-origin
 * relative requests on every origin.
 */
const { JSDOM } = jsdom;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const gameDir = path.join(root, 'src/main/resources/static/tetris');
const read = (...parts) => fs.readFileSync(path.join(...parts), 'utf8');

const html = read(gameDir, 'index.html');
const core = read(gameDir, 'tetris-core.js');
const app = read(gameDir, 'app.js');
const API_BASE = '/apis/api.tetris.halo.run/v1alpha1/scores';
const GAME_PATH = '/plugins/plugin-tetris/assets/tetris/index.html';
const ENTRY_PLACEHOLDER = 'https://你的域名/tetris';

const SHIPPED_FILES = [
  'README.md',
  'src/main/resources/plugin.yaml',
  'src/main/resources/page/tetris.html',
  'src/main/java/run/halo/tetris/TetrisPageInitializer.java',
  'src/main/java/run/halo/tetris/TetrisPlugin.java',
  'src/main/resources/static/tetris/index.html',
  'src/main/resources/static/tetris/app.js',
  'src/main/resources/static/tetris/style.css',
  'src/main/resources/static/tetris/tetris-core.js',
  'deploy/embed-snippet.html',
  'deploy/page-tetris.html',
  'deploy/ethereal/embed.html',
  'deploy/ethereal/page.html',
  'deploy/ethereal/theme-bridge.js',
  'standalone/tetris.html',
  'standalone/tetris/index.html',
  'standalone/tetris/app.js',
];

const ABSOLUTE_ENTRY = /https?:\/\/([^\s/`"'<>),]+)\/tetris/g;

test('no concrete site domain is pinned in any shipped file or document', () => {
  for (const file of SHIPPED_FILES) {
    const text = read(root, file);
    assert.doesNotMatch(text, /mlingxi|blog\.example\.com/i,
      `${file} must not name a specific blog domain`);
    for (const match of text.matchAll(ABSOLUTE_ENTRY)) {
      assert.equal(match[1], '你的域名',
        `${file} hard-codes an absolute entry host: ${match[0]}`);
    }
  }
});

test('the domain-agnostic access convention is documented everywhere it matters', () => {
  const readme = read(root, 'README.md');
  assert.match(readme, /https:\/\/你的域名\/tetris/);
  assert.match(readme, /域名无关|不绑定|零域名配置/);
  for (const file of ['deploy/page-tetris.html', 'deploy/ethereal/page.html']) {
    assert.match(read(root, file), /https:\/\/你的域名\/tetris/);
  }
  for (const file of [
    'deploy/embed-snippet.html', 'deploy/page-tetris.html',
    'deploy/ethereal/embed.html', 'deploy/ethereal/page.html',
  ]) {
    const source = read(root, file).replace(/<!--[\s\S]*?-->/g, '');
    assert.doesNotMatch(source, /https?:\/\//,
      `${file} must not contain an absolute URL in its body`);
    assert.match(source, new RegExp(`src="${GAME_PATH.replace(/\//g, '\\/')}"`),
      `${file} keeps the same-origin relative iframe src`);
  }
});

function boot(url, { config, storage } = {}) {
  const calls = [];
  const dom = new JSDOM(html, {
    url,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (requestUrl, options = {}) => {
        calls.push({ url: requestUrl, options });
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      };
      if (config) window.TETRIS_CONFIG = config;
      if (storage) {
        for (const [key, value] of Object.entries(storage)) {
          window.localStorage.setItem(key, value);
        }
      }
    },
  });
  dom.window.eval(core);
  dom.window.eval(app);
  return { window: dom.window, calls };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test('identical same-origin relative requests on any domain, protocol and port', async () => {
  const origins = [
    'https://blog.example.org',
    'https://my.site.cn',
    'http://localhost:8090',
    'https://192.168.1.20:8443',
  ];
  for (const origin of origins) {
    const { window, calls } = boot(`${origin}${GAME_PATH}`);
    await flush();
    assert.ok(calls.length >= 1, `${origin}: leaderboard request was issued`);
    assert.equal(calls[0].url, `${API_BASE}?size=10`, `${origin}: API base`);
    for (const call of calls) {
      assert.doesNotMatch(call.url, /^https?:\/\//,
        `${origin}: request URL must not embed an origin`);
      assert.equal(call.url.includes(new URL(origin).host), false,
        `${origin}: hostname must not leak into any request`);
    }
    assert.equal(window.document.getElementById('back-link').getAttribute('href'), '/');
    window.close();
  }
});

test('a Halo site behind a sub-path prefix derives its prefix from the pathname', async () => {
  const { window, calls } = boot(`https://site.example.org/blog${GAME_PATH}`);
  await flush();
  assert.equal(calls[0].url, `/blog${API_BASE}?size=10`);
  assert.equal(window.document.getElementById('back-link').getAttribute('href'), '/blog/');
  window.close();
});

test('explicit basePath / apiBase overrides remain domain-free', async () => {
  const prefixed = boot(`https://site-a.example.org${GAME_PATH}`,
    { config: { basePath: '/cms/' } });
  await flush();
  assert.equal(prefixed.calls[0].url, `/cms${API_BASE}?size=10`);
  assert.equal(prefixed.window.document.getElementById('back-link').getAttribute('href'), '/cms/');
  prefixed.window.close();

  const custom = boot(`https://site-b.example.org${GAME_PATH}`,
    { config: { apiBase: '/custom/scores' } });
  await flush();
  assert.equal(custom.calls[0].url, '/custom/scores?size=10');
  custom.window.close();

  const local = boot(`https://site-c.example.org${GAME_PATH}`, { config: { mode: 'local' } });
  await flush();
  assert.equal(local.calls.length, 0, 'local mode never touches the network');
  assert.equal(local.window.document.getElementById('rank-title').textContent, '本地排行榜');
  local.window.close();
});

test('the generated page fragment is same-origin relative and script-free', () => {
  const fragment = read(root, 'src/main/resources/page/tetris.html')
    .replace(/<!--[\s\S]*?-->/g, '');
  assert.doesNotMatch(fragment, /https?:\/\//);
  assert.doesNotMatch(fragment, /<script/i);
  assert.match(fragment, new RegExp(`src="${GAME_PATH.replace(/\//g, '\\/')}"`));
  assert.match(fragment, /data-tetris/);
  assert.doesNotMatch(fragment, /mlingxi/i);
});

test('plugin start creates a published /tetris page and ships no Console UI', () => {
  const initializer = read(root, 'src/main/java/run/halo/tetris/TetrisPageInitializer.java');
  assert.match(initializer, /SLUG = "tetris"/);
  assert.match(initializer, /PAGE_TITLE = "俄罗斯方块"/);
  assert.match(initializer, /FRAGMENT_RESOURCE = "page\/tetris\.html"/);
  assert.match(initializer, /MANAGED_LABEL = "tetris\.halo\.run\/managed"/);
  assert.match(initializer, /spec\.setPublish\(true\)/);
  assert.match(initializer, /Post\.VisibleEnum\.PUBLIC/);

  const plugin = read(root, 'src/main/java/run/halo/tetris/TetrisPlugin.java');
  assert.match(plugin, /TetrisScore\.class/);
  assert.match(plugin, /pageInitializer\.ensurePage\(\)/);

  const proxy = read(root, 'src/main/resources/extensions/reverse-proxy.yaml');
  assert.match(proxy, /path: \/tetris\/\*\*/);
  assert.match(proxy, /directory: static\/tetris/);

  const build = read(root, 'build.gradle');
  assert.match(build, /exclude 'ui\/\*\*'/);
  assert.match(build, /exclude 'ui-plugin\.json'/);
  assert.doesNotMatch(build, /processUiResources/);

  const manifest = read(root, 'src/main/resources/plugin.yaml');
  assert.match(manifest, /name: plugin-tetris/);
  assert.match(manifest, /displayName: "俄罗斯方块"/);
  assert.doesNotMatch(manifest, /mlingxi/i);

  const roles = read(root, 'src/main/resources/extensions/role-template.yaml');
  assert.match(roles, /api\.tetris\.halo\.run/);
  assert.match(roles, /tetrisscores/);
  assert.match(roles, /aggregate-to-anonymous/);
});

test('leaderboard payload and DTOs share the Tetris field set', () => {
  assert.match(app, /lines: state\.lines/);
  assert.match(app, /level: state\.level/);
  assert.match(app, /pieces: state\.pieces/);
  assert.doesNotMatch(app, /maxTile|won/);
  const submit = read(root, 'src/main/java/run/halo/tetris/ScoreSubmit.java');
  const view = read(root, 'src/main/java/run/halo/tetris/ScoreView.java');
  for (const file of [submit, view]) {
    assert.match(file, /Integer lines|int lines/);
    assert.match(file, /Integer level|int level/);
    assert.match(file, /Integer pieces|int pieces/);
    assert.doesNotMatch(file, /maxTile|won/);
  }
  assert.match(read(root, 'src/main/java/run/halo/tetris/ScoreEndpoint.java'),
    /api\.tetris\.halo\.run/);
});

test('the single-file standalone build is self-contained and offline', () => {
  const single = read(root, 'standalone/tetris.html');
  assert.match(single, /window\.TETRIS_CONFIG = \{ mode: 'local' \}/);
  assert.doesNotMatch(single, /<script src=/);
  assert.doesNotMatch(single, /href="\.\/style\.css"/);
  assert.match(single, /TetrisCore = \{/);
  assert.match(single, /id="board"/);
});

test('Ethereal light/dark and hue are mirrored from same-origin localStorage', () => {
  const { window } = boot(`https://theme.example.org${GAME_PATH}`, {
    storage: { theme: 'dark', __user_chose_theme: '1', hue: '300' },
  });
  const rootEl = window.document.documentElement;
  assert.ok(rootEl.classList.contains('theme-ethereal'));
  assert.ok(rootEl.classList.contains('dark'));
  assert.equal(rootEl.dataset.colorScheme, 'dark');
  assert.equal(rootEl.style.getPropertyValue('--hue'), '300');
  window.close();
});

test('the page renders a 10x20 board and is playable by keyboard in local mode', async () => {
  const { window, calls } = boot('https://local.example.org/tetris/index.html',
    { config: { mode: 'local' } });
  await flush();
  const board = window.document.getElementById('board');
  assert.equal(board.children.length, 200);
  assert.ok(board.querySelectorAll('.cell.fill').length > 0, 'active piece is drawn');
  assert.equal(window.document.getElementById('pieces').textContent, '0');
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  await flush();
  assert.equal(window.document.getElementById('pieces').textContent, '1',
    'space hard-drops and locks a piece');
  assert.equal(calls.length, 0, 'local mode issues no network requests');
  window.close();
});
