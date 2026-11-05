/**
 * Click-to-zoom viewer for rendered <img> elements.
 * Reuses the mermaid fullscreen overlay CSS (.md-reader-mermaid-fs-*).
 *
 * Interaction mirrors the mermaid fullscreen viewer:
 *   - click image → overlay (fit-to-stage), drag pan, wheel pan,
 *     Ctrl/⌘+wheel or pinch zoom, double-click/0 fit, Esc/✕ close.
 *
 * Zoom resizes the <img> width (browser re-rasterizes) instead of CSS
 * transform scale, so pixels stay as crisp as the source allows.
 */

const ICONS = {
  close: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/></svg>`,
  zoomIn: `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 3.5a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0V8h-3a.5.5 0 0 1 0-1h3V4a.5.5 0 0 1 .5-.5Z"/></svg>`,
  zoomOut: `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M4 7.5h8a.5.5 0 0 1 0 1H4a.5.5 0 0 1 0-1Z"/></svg>`,
  reset: `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 2.5a5.5 5.5 0 1 0 5.47 5h-1.51A4 4 0 1 1 8 4V2.5Zm0 0V1l3 2.5L8 6V4.5"/></svg>`,
};

const MIN_SCALE = 0.1;
const MAX_SCALE = 10;

/**
 * Attach delegated click handling that opens the fullscreen viewer for
 * images inside the rendered markdown container.
 */
export function initImageZoom(container) {
  if (container.dataset.mdrImageZoom === 'true') return;
  container.dataset.mdrImageZoom = 'true';

  container.addEventListener('click', (e) => {
    const img = e.target.closest('img');
    if (!img || !container.contains(img)) return;
    // Don't hijack clicks on linked images — let the link open
    if (img.closest('a')) return;
    const src = img.currentSrc || img.src;
    if (!src) return;
    e.preventDefault();
    e.stopPropagation();
    openImageFullscreen(src, img.alt);
  });
}

function openImageFullscreen(src, alt) {
  const overlay = document.createElement('div');
  overlay.className = 'md-reader-mermaid-fs-overlay md-reader-img-fs';
  overlay.innerHTML = `
    <div class="md-reader-mermaid-fs-toolbar">
      <button type="button" class="md-reader-mermaid-fs-tool" data-act="zoom-out" title="缩小 (⌘/Ctrl+滚轮 / 捏合 / -)">${ICONS.zoomOut}</button>
      <span class="md-reader-mermaid-fs-scale">100%</span>
      <button type="button" class="md-reader-mermaid-fs-tool" data-act="zoom-in" title="放大 (⌘/Ctrl+滚轮 / 捏合 / +)">${ICONS.zoomIn}</button>
      <button type="button" class="md-reader-mermaid-fs-tool" data-act="reset" title="适应窗口 (双击 / 0)">${ICONS.reset}</button>
      <button type="button" class="md-reader-mermaid-fs-close" data-act="close" title="关闭 (Esc)">${ICONS.close}</button>
    </div>
    <div class="md-reader-mermaid-fs-stage">
      <div class="md-reader-mermaid-fs-content"><img alt=""></div>
    </div>
    <div class="md-reader-mermaid-fs-hint">${alt ? alt.replace(/</g, '&lt;') + ' · ' : ''}拖动 · Ctrl+滚轮缩放 · 双击适应 · Esc 关闭</div>
  `;

  const stage = overlay.querySelector('.md-reader-mermaid-fs-stage');
  const content = overlay.querySelector('.md-reader-mermaid-fs-content');
  const img = content.querySelector('img');
  const scaleLabel = overlay.querySelector('.md-reader-mermaid-fs-scale');
  img.src = src;

  document.body.appendChild(overlay);
  const prevBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  // Natural size discovered once the image decodes; close on load failure
  let naturalW = 0;
  let scale = 1;
  let tx = 0;
  let ty = 0;

  img.addEventListener('load', () => {
    naturalW = img.naturalWidth;
    img.style.width = naturalW + 'px';
    requestAnimationFrame(() => requestAnimationFrame(fitToStage));
  });
  img.addEventListener('error', () => close());

  function applyTransform() {
    content.style.transform = `translate(-50%, -50%) translate(${tx}px, ${ty}px)`;
    if (naturalW) img.style.width = `${naturalW * scale}px`;
    scaleLabel.textContent = `${Math.round(scale * 100)}%`;
  }

  function fitToStage() {
    const imgRect = img.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    if (!naturalW || imgRect.width === 0 || imgRect.height === 0) {
      scale = 1;
      tx = 0;
      ty = 0;
    } else {
      const padding = 40;
      const fitScale = Math.min(
        (stageRect.width - padding) / imgRect.width,
        (stageRect.height - padding) / imgRect.height,
        1
      );
      scale = fitScale > 0 ? fitScale : 1;
      tx = 0;
      ty = 0;
    }
    applyTransform();
  }

  /** Zoom around a screen point so the point under the cursor stays fixed. */
  function zoomAt(clientX, clientY, factor) {
    const rect = stage.getBoundingClientRect();
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));
    if (newScale === scale) return;
    const stageMidX = rect.width / 2;
    const stageMidY = rect.height / 2;
    const px = (cx - stageMidX - tx) / scale;
    const py = (cy - stageMidY - ty) / scale;
    tx = cx - stageMidX - px * newScale;
    ty = cy - stageMidY - py * newScale;
    scale = newScale;
    applyTransform();
  }

  function zoomBy(factor) {
    const rect = stage.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  }

  // --- Mouse / single-pointer drag -----------------------------------------
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startTx = 0;
  let startTy = 0;
  let touchActive = false;

  function onPointerDown(e) {
    if (e.target.closest('.md-reader-mermaid-fs-toolbar')) return;
    if (touchActive) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    startTx = tx;
    startTy = ty;
    stage.classList.add('is-dragging');
    if (stage.setPointerCapture && e.pointerId != null) {
      try { stage.setPointerCapture(e.pointerId); } catch { /* noop */ }
    }
    e.preventDefault();
  }
  function onPointerMove(e) {
    if (!dragging || touchActive) return;
    tx = startTx + (e.clientX - startX);
    ty = startTy + (e.clientY - startY);
    applyTransform();
  }
  function onPointerUp() {
    dragging = false;
    stage.classList.remove('is-dragging');
  }

  // --- Wheel: trackpad swipe = pan; pinch / Ctrl+wheel = zoom ---------------
  function onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
    } else {
      tx -= e.deltaX;
      ty -= e.deltaY;
      applyTransform();
    }
  }

  // --- Touch: single-finger pan + two-finger pinch --------------------------
  let touchStart = null;

  function touchDistance(t1, t2) {
    return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
  }

  function onTouchStart(e) {
    if (e.target.closest('.md-reader-mermaid-fs-toolbar')) return;
    if (e.touches.length === 1) {
      const t = e.touches[0];
      touchActive = true;
      dragging = true;
      startX = t.clientX;
      startY = t.clientY;
      startTx = tx;
      startTy = ty;
      e.preventDefault();
    } else if (e.touches.length === 2) {
      touchActive = true;
      dragging = false;
      stage.classList.remove('is-dragging');
      touchStart = { dist: touchDistance(e.touches[0], e.touches[1]), scale };
      e.preventDefault();
    }
  }

  function onTouchMove(e) {
    if (!touchActive) return;
    if (e.touches.length === 1 && !touchStart) {
      const t = e.touches[0];
      tx = startTx + (t.clientX - startX);
      ty = startTy + (t.clientY - startY);
      applyTransform();
      e.preventDefault();
    } else if (e.touches.length === 2 && touchStart) {
      const dist = touchDistance(e.touches[0], e.touches[1]);
      scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, touchStart.scale * (dist / touchStart.dist)));
      applyTransform();
      e.preventDefault();
    }
  }

  function onTouchEnd(e) {
    if (e.touches.length === 0) {
      touchActive = false;
      dragging = false;
      touchStart = null;
      stage.classList.remove('is-dragging');
    } else if (e.touches.length === 1) {
      touchStart = null;
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      startTx = tx;
      startTy = ty;
    }
  }

  function onDblClick() {
    fitToStage();
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
    else if (e.key === '+' || e.key === '=') zoomBy(1.2);
    else if (e.key === '-' || e.key === '_') zoomBy(1 / 1.2);
    else if (e.key === '0') fitToStage();
  }

  function onToolbarClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'close') close();
    else if (act === 'zoom-in') zoomBy(1.2);
    else if (act === 'zoom-out') zoomBy(1 / 1.2);
    else if (act === 'reset') fitToStage();
  }

  function close() {
    stage.removeEventListener('pointerdown', onPointerDown);
    overlay.removeEventListener('pointermove', onPointerMove);
    overlay.removeEventListener('pointerup', onPointerUp);
    overlay.removeEventListener('pointercancel', onPointerUp);
    overlay.removeEventListener('wheel', onWheel);
    stage.removeEventListener('touchstart', onTouchStart);
    stage.removeEventListener('touchmove', onTouchMove);
    stage.removeEventListener('touchend', onTouchEnd);
    stage.removeEventListener('touchcancel', onTouchEnd);
    stage.removeEventListener('dblclick', onDblClick);
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    document.body.style.overflow = prevBodyOverflow;
  }

  stage.addEventListener('pointerdown', onPointerDown);
  overlay.addEventListener('pointermove', onPointerMove);
  overlay.addEventListener('pointerup', onPointerUp);
  overlay.addEventListener('pointercancel', onPointerUp);
  overlay.addEventListener('wheel', onWheel, { passive: false });
  stage.addEventListener('touchstart', onTouchStart, { passive: false });
  stage.addEventListener('touchmove', onTouchMove, { passive: false });
  stage.addEventListener('touchend', onTouchEnd);
  stage.addEventListener('touchcancel', onTouchEnd);
  stage.addEventListener('dblclick', onDblClick);
  overlay.querySelector('.md-reader-mermaid-fs-toolbar').addEventListener('click', onToolbarClick);
  document.addEventListener('keydown', onKey);
}

