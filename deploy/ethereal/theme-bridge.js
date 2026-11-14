/**
 * Optional Ethereal bridge — only needed for themes that do NOT write their
 * colour scheme to same-origin localStorage. Paste into Halo
 * 「代码注入 → 页脚」 as a <script> block, or into the theme template.
 *
 * The game page already reads localStorage.theme / hue directly, so in the
 * default setup this bridge is unnecessary. It exists for custom themes that
 * keep their state only in DOM attributes.
 */
(function () {
  'use strict';

  function scheme() {
    const root = document.documentElement;
    if (root.classList.contains('dark')) return 'dark';
    const attr = root.getAttribute('data-color-scheme');
    if (attr === 'light' || attr === 'dark') return attr;
    return 'auto';
  }

  function hue() {
    const value = getComputedStyle(document.documentElement).getPropertyValue('--hue').trim();
    return /^\d+$/.test(value) ? Number(value) : null;
  }

  function broadcast() {
    const message = { type: 'tetris:theme', scheme: scheme(), hue: hue() };
    document.querySelectorAll('iframe[data-tetris]').forEach((frame) => {
      try {
        // Same-origin only: the game rejects any message from another origin.
        frame.contentWindow.postMessage(message, location.origin);
      } catch (error) {
        // Cross-origin or not loaded yet — ignore.
      }
    });
  }

  window.addEventListener('storage', broadcast);
  window.addEventListener('load', broadcast);
  if (window.MutationObserver) {
    new MutationObserver(broadcast).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-color-scheme', 'style'],
    });
  }
})();
