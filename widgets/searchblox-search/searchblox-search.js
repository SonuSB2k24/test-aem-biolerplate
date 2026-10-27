import { mount } from './searchblox-core.js';

/**
 * Site-wide options for every SearchBlox widget and block on an EDS site, from an
 * optional searchblox-config.json next to this file, e.g.
 *   { "domain": "https://search.example.com", "collections": "1", "chatbot": "my-chatbot" }
 * Options in a widget link or block table override it. Loaded once per page.
 */
let siteConfig;

export function loadSiteConfig() {
  siteConfig = siteConfig || fetch(new URL('searchblox-config.json', import.meta.url))
    .then((res) => (res.ok ? res.json().catch(() => {
      // eslint-disable-next-line no-console
      console.warn('[searchblox-search] searchblox-config.json is not valid JSON; it was ignored.');
      return {};
    }) : {}))
    .catch(() => ({}))
    .then((options) => (options && typeof options === 'object' && !Array.isArray(options) ? options : {}));
  return siteConfig;
}

/**
 * EDS widget entry point. Options come from the widget link's query string,
 * which EDS turns into data-* attributes, e.g.
 *   /widgets/searchblox-search/searchblox-search.html?collections=12&facets=contenttype,keywords
 * on top of the site-wide searchblox-config.json.
 */
export default async function decorate(widget) {
  // `source` is the link itself, added by the EDS widget loader.
  const { source, ...options } = widget.dataset;
  mount(widget, { ...(await loadSiteConfig()), ...options });
}
