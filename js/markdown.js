/* markdown.js — marked + DOMPurify のラッパ。render(md) は安全な HTML 文字列を返す。 */
window.MD = (function () {
  'use strict';

  const hasMarked = typeof marked !== 'undefined' && typeof marked.parse === 'function';
  const hasPurify = typeof DOMPurify !== 'undefined' && typeof DOMPurify.sanitize === 'function';

  if (hasMarked) {
    marked.use({ gfm: true, breaks: true });
  }
  if (hasPurify) {
    // 外部リンクは新しいタブで開く（貼り付けた AI の返答内のリンク用）
    DOMPurify.addHook('afterSanitizeAttributes', function (node) {
      if (node.tagName === 'A' && node.hasAttribute('href')) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function render(md) {
    const src = md == null ? '' : String(md);
    let html;
    if (hasMarked) {
      try { html = marked.parse(src); }
      catch (e) { console.warn('markdown parse failed', e); html = '<pre>' + escapeHtml(src) + '</pre>'; }
    } else {
      html = '<pre>' + escapeHtml(src) + '</pre>';
    }
    if (typeof html !== 'string') html = String(html);
    if (hasPurify) html = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
    return html;
  }

  return { render: render, escapeHtml: escapeHtml, available: hasMarked };
})();
