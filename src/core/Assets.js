/*
 * Model files are fetched once, in the background, and parsed only when a chapter needs them: the
 * download never holds up the first scene, and the parse happens behind the chapter veil.
 */

const _bytes = new Map(); // url -> Promise<ArrayBuffer | null>

/**
 * The file's bytes, or null when it is missing. The dev server answers unknown paths with index.html,
 * so an HTML response counts as missing too. One GET, no separate existence check.
 */
export function fetchBinary(url) {
  if (!_bytes.has(url)) {
    _bytes.set(url, fetch(url)
      .then((r) => (r.ok && !(r.headers.get('content-type') || '').includes('text/html') ? r.arrayBuffer() : null))
      .catch(() => null));
  }
  return _bytes.get(url);
}

/** Parses a GLB already in memory with the given GLTFLoader. */
export function parseGLB(loader, buffer, path = './models/') {
  return new Promise((resolve, reject) => loader.parse(buffer, path, resolve, reject));
}

/** Runs fn when the browser is idle (or after `ms` at the latest). */
export function whenIdle(fn, ms = 2000) {
  if (window.requestIdleCallback) requestIdleCallback(fn, { timeout: ms });
  else setTimeout(fn, Math.min(ms, 300));
}
