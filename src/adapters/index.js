import { GitLabAdapter } from './gitlab';
import { LocalFileAdapter } from './local-file';

/**
 * Registry of all available adapters.
 * Content script iterates through these to find one that matches the current URL.
 * LocalFileAdapter first — most common use case for local .md reading.
 */
const adapters = [
  new LocalFileAdapter(),
  new GitLabAdapter(),
];

/**
 * Find the adapter that matches the current page URL
 * @param {string} url
 * @returns {BaseAdapter|null}
 */
export function findAdapter(url) {
  for (const adapter of adapters) {
    if (adapter.matchUrl(url)) {
      return adapter;
    }
  }
  return null;
}

/**
 * Register a custom adapter (for user-configured platforms)
 */
export function registerAdapter(adapter) {
  adapters.push(adapter);
}

export { GitLabAdapter };
