/*
 * SearchBlox search UI core. Framework-free ES module shared by the EDS widget,
 * the EDS block and the classic AEM embed. Talks to the SearchBlox Search API:
 *   GET {domain}/rest/v2/api/hybrid-search (default; /search when `vectorWeight` is 0)
 *   GET {domain}/rest/v2/api/autocomplete
 *   GET {domain}/rest/v2/api/smartsuggest (when `smartSuggest` names an index)
 *   POST {domain}/rest/v2/api/ai-overview (when `aiOverview` names collections)
 *   GET {domain}/rest/v2/api/smart-faq/* (unless `smartFaqs` is false)
 *   GET/POST {domain}/ui/v1/chatbot/* (when `chatbot` or `aiMode` names a console chatbot)
 *   GET {domain}/ui/v1/api/document-lookup (AI Mode references)
 *   POST {domain}/rest/v2/api/query/topquery (popular searches when nothing matches)
 *   POST {domain}/rest/v2/api/speech/text (voice search where the browser can't transcribe)
 *   POST {domain}/rest/v2/api/recommendations (when `recommendations` is on)
 *   GET/POST {domain}/ui/v1/searchai-assist (when `assist` is on)
 *   POST {domain}/ui/v1/analytics/*, /ui/v1/featured-result/display-count
 *     (unless `analytics` is false)
 */

const DEFAULTS = {
  domain: '',
  collections: [],
  pageSize: 10,
  facets: [],
  checkboxFacets: ['topics', 'keywords'],
  dateFacets: ['lastmodified'],
  autosuggest: true,
  suggestLimit: 6,
  smartSuggest: '',
  aiOverview: [],
  smartFaqs: true,
  chatbot: '',
  analytics: true,
  placeholder: 'Enter a search term...',
  resultsPage: '',
  queryParam: 'q',
  syncUrl: true,
  newTab: false,
  sort: 'relevance',
  vectorWeight: 0.2,
  vectorThreshold: 0.6,
  accent: '',
  scheme: 'auto',
  settings: false,
  recommendations: false,
  llmFields: 'off',
  assist: false,
  topQueries: true,
  trending: '',
  loadMore: false,
  voiceSearch: false,
  aiMode: '',
  chatSuggestions: false,
  chatReferences: false,
  featured: true,
  urlDisplay: true,
};

const FACET_LABELS = {
  lastmodified: 'Date',
  contenttype: 'Content Type',
  keywords: 'Keywords',
  colname: 'Collection',
};

// As in the SearchBlox search plugin: request up to 100 values per facet, show 5
// and add or remove 5 with "Show more"/"Show less"; facets with more than 5
// values get a search box that filters the list.
const FACET_SIZE = 100;
const FACET_SHOWN = 5;
const FACET_SEARCH_MIN = 5;
const HYBRID_MAX_PAGE_SIZE = 50;
const SUGGEST_DELAY = 200;
// As in the SearchBlox plugin, suggestions start at 3 characters.
const SUGGEST_MIN = 3;
// SmartFAQs, as in the SearchBlox search plugin: 3 shown above the results (up to
// 10 with "Show all"), 3 in the suggestions once 3 characters are typed, answers
// cut to 150 characters until "Show more".
const FAQ_SHOWN = 3;
const FAQ_LIMIT = 10;
const FAQ_SUGGEST = 3;
const FAQ_SUGGEST_MIN = 3;
const FAQ_ANSWER_CHARS = 150;
const PAGE_WINDOW = 2;
const WIDE_LAYOUT = 720;
// As in the SearchBlox search plugin: AI recommendations start once 3 results
// have been opened and show 3; Assist takes up to 4 results, but no audio or video.
const VIEWED_TITLES = 3;
const RECOMMENDATIONS_SHOWN = 3;
const ASSIST_LIMIT = 4;
const ASSIST_SKIP = /^(mp3|mp4|wav|ogg|m4a|m4b|m4p|aac|flac|wma|aiff?|aifc|mid|avi|mov|wmv|webm|mkv|flv|gif)$/i;
const ASSIST_PROMPTS = ['analyze', 'compare', 'explain', 'highlights', 'summarize'];
const TOPICS_SHOWN = 5;
// Date facets, as in the SearchBlox search plugin: these ranges up to now, or a
// custom range picked with two date fields.
const DATE_PRESETS = [
  ['day', 'Last 24 hours', (d) => d.setDate(d.getDate() - 1)],
  ['week', 'Past week', (d) => d.setDate(d.getDate() - 7)],
  ['month', 'Past month', (d) => d.setMonth(d.getMonth() - 1)],
  ['year', 'Past year', (d) => d.setFullYear(d.getFullYear() - 1)],
];
// As in the SearchBlox search plugin: 5 popular searches when nothing matches,
// 5 trending searches when the empty box is focused, AI Mode answers from 10
// passages, the chat asks if there's anything else after 30 idle minutes, and
// chat suggests 3 SmartFAQs once 3 characters are typed.
const TOP_QUERIES = 5;
const TRENDING_LIMIT = 5;
const AI_MODE_PASSAGES = 10;
const CHAT_IDLE_MINUTES = 30;
const CHAT_SUGGEST = 3;
// Chat answers can list the top 2 search results for the question, as the
// plugin's "Reference links".
const CHAT_REFERENCES = 2;
const CHAT_SUGGEST_MIN = 3;
// Keyword search can sort by relevance or date; only date has a direction.
const SORTS = [['relevance', 'Relevance'], ['date', 'Date']];

let instanceCount = 0;
// The page's own title, before searches put the query in front of it.
const baseTitle = typeof document === 'undefined' ? '' : document.title;

// ------------------------------------------------------------------
// Config
// ------------------------------------------------------------------

const toList = (value) => {
  if (Array.isArray(value)) return value.map((v) => `${v}`.trim()).filter(Boolean);
  if (!value) return [];
  return `${value}`.split(',').map((v) => v.trim()).filter(Boolean);
};

const toBool = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return !['false', 'no', 'off', '0'].includes(`${value}`.trim().toLowerCase());
};

// A facet's selected values: one for radio facets, any number for checkbox ones.
const values = (value) => [].concat(value || []).filter(Boolean);

const toFraction = (value, fallback) => {
  const n = Number.parseFloat(value);
  return n >= 0 && n <= 1 ? n : fallback;
};

// "replace" or "both"; any other true value means "both", as the plugin's default.
const toLlmMode = (value) => {
  const mode = `${value ?? ''}`.trim().toLowerCase();
  if (['replace', 'both'].includes(mode)) return mode;
  return toBool(mode, false) ? 'both' : DEFAULTS.llmFields;
};

// Accepts "contenttype" or "contenttype:Content Type".
const parseFacets = (value) => toList(value).map((entry) => {
  const [field, ...label] = entry.split(':');
  const key = field.trim().toLowerCase();
  return { field: key, label: label.join(':').trim() || FACET_LABELS[key] || key };
});

/**
 * Normalises config from any source (data-* attributes, block table, plain object).
 * Keys are case/format tolerant: "page-size", "pagesize" and "pageSize" all work.
 */
export function normaliseConfig(raw = {}) {
  const flat = {};
  Object.entries(raw).forEach(([k, v]) => {
    flat[k.toLowerCase().replace(/[^a-z]/g, '')] = v;
  });

  const pageSize = Number.parseInt(flat.pagesize, 10);
  const suggestLimit = Number.parseInt(flat.suggestlimit, 10);
  const vectorWeight = toFraction(flat.vectorweight, DEFAULTS.vectorWeight);

  return {
    ...DEFAULTS,
    domain: `${flat.domain || ''}`.trim().replace(/\/+$/, ''),
    collections: toList(flat.collections),
    pageSize: Math.min(
      pageSize > 0 ? pageSize : DEFAULTS.pageSize,
      vectorWeight > 0 ? HYBRID_MAX_PAGE_SIZE : 100,
    ),
    facets: parseFacets(flat.facets),
    checkboxFacets: flat.checkboxfacets === undefined
      ? DEFAULTS.checkboxFacets
      : toList(flat.checkboxfacets).map((f) => f.toLowerCase()),
    dateFacets: flat.datefacets === undefined
      ? DEFAULTS.dateFacets
      : toList(flat.datefacets).map((f) => f.toLowerCase()),
    autosuggest: toBool(flat.autosuggest, DEFAULTS.autosuggest),
    suggestLimit: suggestLimit > 0 ? suggestLimit : DEFAULTS.suggestLimit,
    smartSuggest: `${flat.smartsuggest || ''}`.trim(),
    aiOverview: toList(flat.aioverview),
    smartFaqs: toBool(flat.smartfaqs, DEFAULTS.smartFaqs),
    chatbot: `${flat.chatbot || ''}`.trim(),
    analytics: toBool(flat.analytics, DEFAULTS.analytics),
    placeholder: flat.placeholder || DEFAULTS.placeholder,
    resultsPage: `${flat.resultspage || ''}`.trim(),
    queryParam: flat.queryparam || DEFAULTS.queryParam,
    syncUrl: toBool(flat.syncurl, DEFAULTS.syncUrl),
    newTab: toBool(flat.newtab, DEFAULTS.newTab),
    sort: flat.sort || DEFAULTS.sort,
    vectorWeight,
    vectorThreshold: toFraction(flat.vectorthreshold, DEFAULTS.vectorThreshold),
    accent: `${flat.accent || ''}`.trim(),
    scheme: ['light', 'dark'].includes(flat.scheme) ? flat.scheme : DEFAULTS.scheme,
    settings: toBool(flat.settings, DEFAULTS.settings),
    recommendations: toBool(flat.recommendations, DEFAULTS.recommendations),
    llmFields: toLlmMode(flat.llmfields),
    assist: toBool(flat.assist, DEFAULTS.assist),
    topQueries: toBool(flat.topqueries, DEFAULTS.topQueries),
    trending: `${flat.trending || ''}`.trim(),
    loadMore: toBool(flat.loadmore, DEFAULTS.loadMore),
    voiceSearch: toBool(flat.voicesearch, DEFAULTS.voiceSearch),
    aiMode: `${flat.aimode || ''}`.trim(),
    chatSuggestions: toBool(flat.chatsuggestions, DEFAULTS.chatSuggestions),
    chatReferences: toBool(flat.chatreferences, DEFAULTS.chatReferences),
    featured: toBool(flat.featured, DEFAULTS.featured),
    urlDisplay: toBool(flat.urldisplay, DEFAULTS.urlDisplay),
  };
}

// ------------------------------------------------------------------
// DOM helpers
// ------------------------------------------------------------------

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (v === undefined || v === null || v === false) return;
    if (k === 'className') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v === true ? '' : v);
  });
  children.flat().forEach((c) => {
    if (c !== undefined && c !== null && c !== false) node.append(c);
  });
  return node;
}

// Icons from the SearchBlox search plugin: Tabler icons (MIT) plus its "AI chip"
// (SVGRepo). All are 24px stroke icons drawn with currentColor.
const ICONS = {
  ai: 'M21 8H17.8174M21 12H18M21 16H17.8174M6.18257 8H3M8 6.18257V3M8 21L8 17.8174M12 6V3M12 21V18M16 6.18257V3M16 21V17.8174M6 12H3M6.18257 16H3M10.8 18H13.2C14.8802 18 15.7202 18 16.362 17.673C16.9265 17.3854 17.3854 16.9265 17.673 16.362C18 15.7202 18 14.8802 18 13.2V10.8C18 9.11984 18 8.27976 17.673 7.63803C17.3854 7.07354 16.9265 6.6146 16.362 6.32698C15.7202 6 14.8802 6 13.2 6H10.8C9.11984 6 8.27976 6 7.63803 6.32698C7.07354 6.6146 6.6146 7.07354 6.32698 7.63803C6 8.27976 6 9.11984 6 10.8V13.2C6 14.8802 6 15.7202 6.32698 16.362C6.6146 16.9265 7.07354 17.3854 7.63803 17.673C8.27976 18 9.11984 18 10.8 18ZM10 10H14V14H10V10Z',
  chat: 'M8 9h8M8 13h6M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-5l-5 3v-3h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12z',
  close: 'M18 6l-12 12M6 6l12 12',
  followup: 'M6 6v6a3 3 0 0 0 3 3h10l-4 -4m0 8l4 -4',
  filterPlus: 'M12 20l-3 1v-8.5l-4.48 -4.928a2 2 0 0 1 -.52 -1.345v-2.227h16v2.172a2 2 0 0 1 -.586 1.414l-4.414 4.414v3M16 19h6M19 16v6',
  filterMinus: 'M12 20l-3 1v-8.5l-4.48 -4.928a2 2 0 0 1 -.52 -1.345v-2.227h16v2.172a2 2 0 0 1 -.586 1.414l-4.414 4.414v3M16 19h6',
  regenerate: 'M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0',
  help: 'M12 16v.01M12 13a2 2 0 0 0 .914 -3.782a1.98 1.98 0 0 0 -2.414 .483M10 20.777a8.942 8.942 0 0 1 -2.48 -.969M14 3.223a9.003 9.003 0 0 1 0 17.554M4.579 17.093a8.961 8.961 0 0 1 -1.227 -2.592M3.124 10.5c.16 -.95 .468 -1.85 .9 -2.675l.169 -.305M6.907 4.579a8.954 8.954 0 0 1 3.093 -1.356',
  reload: 'M19.933 13.041a8 8 0 1 1 -9.925 -8.788c3.899 -1 7.935 1.007 9.425 4.747M20 4v5h-5',
  search: 'M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0M21 21l-6 -6',
  chevronLeft: 'M15 6l-6 6l6 6',
  chevronRight: 'M9 6l6 6l-6 6',
  calendar: 'M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2zM16 3l0 4M8 3l0 4M4 11l16 0M8 15h2v2h-2z',
  file: 'M14 3v4a1 1 0 0 0 1 1h4M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z',
  layers: 'M12 4l-8 4l8 4l8 -4l-8 -4M4 12l8 4l8 -4M4 16l8 4l8 -4',
  stopwatch: 'M5 13a7 7 0 1 0 14 0a7 7 0 0 0 -14 0zM14.5 10.5l-2.5 2.5M17 8l1 -1M14 3h-4',
  send: 'M10 14l11 -11M21 3l-6.5 18a.55 .55 0 0 1 -1 0l-3.5 -7l-7 -3.5a.55 .55 0 0 1 0 -1l18 -6.5',
  up: 'M7 11v8a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1v-7a1 1 0 0 1 1 -1h3a4 4 0 0 0 4 -4v-1a2 2 0 0 1 4 0v5h3a2 2 0 0 1 2 2l-1 5a2 3 0 0 1 -2 2h-7a3 3 0 0 1 -3 -3',
  adjustments: 'M14 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M4 6l8 0M16 6l4 0M8 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M4 12l2 0M10 12l10 0M17 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M4 18l11 0M19 18l1 0',
  settings: 'M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065zM9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0',
  copy: 'M7 7m0 2.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667zM4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1',
  markdown: 'M3 7a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2zM7 15v-6l2 2l2 -2v6M14 13l2 2l2 -2M16 15v-6',
  check: 'M5 12l5 5l10 -10',
  sparkles: 'M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6z',
  summarize: 'M11 6h9M11 12h9M12 18h8M4 16a2 2 0 1 1 4 0c0 .591 -.5 1 -1 1.5l-3 2.5h4M6 10v-6l-2 2',
  bulb: 'M3 12h1m8 -9v1m8 8h1m-15.4 -6.4l.7 .7m12.1 -.7l-.7 .7M9 16a5 5 0 1 1 6 0a3.5 3.5 0 0 0 -1 3a2 2 0 0 1 -4 0a3.5 3.5 0 0 0 -1 -3M9.7 17l4.6 0',
  explain: 'M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0M12 16v.01M12 13a2 2 0 0 0 .914 -3.782a1.98 1.98 0 0 0 -2.414 .483',
  edit: 'M7 7h-1a2 2 0 0 0 -2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2 -2v-1M20.385 6.585a2.1 2.1 0 0 0 -2.97 -2.97l-8.415 8.385v3h3l8.385 -8.415zM16 5l3 3',
  quote: 'M10 11h-4a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1h3a1 1 0 0 1 1 1v6c0 2.667 -1.333 4.333 -4 5M19 11h-4a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1h3a1 1 0 0 1 1 1v6c0 2.667 -1.333 4.333 -4 5',
  down: 'M7 13v-8a1 1 0 0 0 -1 -1h-2a1 1 0 0 0 -1 1v7a1 1 0 0 0 1 1h3a4 4 0 0 1 4 4v1a2 2 0 0 0 4 0v-5h3a2 2 0 0 0 2 -2l-1 -5a2 3 0 0 0 -2 -2h-7a3 3 0 0 0 -3 3',
  noResults: 'M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0M21 21l-6 -6M10 13v.01M10 7v3',
  trending: 'M3 17l6 -6l4 4l8 -8M14 7h7v7',
  microphone: 'M9 5a3 3 0 0 1 6 0v5a3 3 0 0 1 -6 0zM5 10a7 7 0 0 0 14 0M8 21h8M12 17v4',
  stop: 'M5 7a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2z',
  sortDesc: 'M4 6h9M4 12h7M4 18h7M15 15l3 3l3 -3M18 6v12',
  sortAsc: 'M4 6h7M4 12h7M4 18h9M15 9l3 -3l3 3M18 6v12',
  chevronDown: 'M6 9l6 6l6 -6',
  related: 'M9.183 6.117a6 6 0 1 0 4.511 3.986M14.813 17.883a6 6 0 1 0 -4.496 -3.954',
  link: 'M9 15l6 -6M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463',
};

function icon(name, size = 18) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  Object.entries({
    viewBox: '0 0 24 24',
    width: size,
    height: size,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 2,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false',
  }).forEach(([k, v]) => svg.setAttribute(k, v));
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', ICONS[name]);
  svg.append(path);
  return svg;
}

// Minimal markdown for LLM answers: paragraphs, "-"/"1." lists, # headings,
// "|" tables, "---" rules and **bold**, built as DOM nodes so answer text can
// never become HTML.
const inline = (text) => text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? el('strong', {}, part) : part));

function markdown(text) {
  const nodes = [];
  `${text}`.split(/\n\s*\n/).forEach((block) => {
    let list;
    let item0; // the last top-level list item, for indented sub-items
    let para;
    let table;
    block.split('\n').forEach((raw) => {
      const line = raw.trim();
      if (!line) return;
      const row = /^\|(.*)\|$/.exec(line);
      if (row) {
        const cells = row[1].split('|').map((c) => c.trim());
        list = null;
        item0 = null;
        para = null;
        if (cells.every((c) => /^:?-+:?$/.test(c))) return; // header separator
        if (!table) {
          table = el('tbody');
          nodes.push(el('div', { className: 'sb-table' }, el(
            'table',
            {},
            el('thead', {}, el('tr', {}, cells.map((c) => el('th', {}, inline(c))))),
            table,
          )));
        } else {
          table.append(el('tr', {}, cells.map((c) => el('td', {}, inline(c)))));
        }
        return;
      }
      table = null;
      if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(line)) {
        nodes.push(el('hr'));
        list = null;
        item0 = null;
        para = null;
        return;
      }
      const item = /^(?:[-*•]|(\d+)[.)])\s+(.*)$/.exec(line);
      const heading = /^#{1,6}\s+(.*)$/.exec(line);
      if (item) {
        const tag = item[1] ? 'OL' : 'UL';
        if (item0 && /^\s{2,}/.test(raw)) {
          let sub = item0.lastElementChild;
          if (sub?.tagName !== tag) {
            sub = el(tag.toLowerCase());
            item0.append(sub);
          }
          sub.append(el('li', {}, inline(item[2])));
        } else {
          // A numbered list broken up by other lines keeps its numbering.
          if (list?.tagName !== tag) {
            list = el(tag.toLowerCase(), { start: item[1] > 1 ? item[1] : undefined });
            nodes.push(list);
          }
          item0 = el('li', {}, inline(item[2]));
          list.append(item0);
        }
        para = null;
      } else if (heading) {
        nodes.push(el('p', {}, el('strong', {}, heading[1].replace(/\*\*/g, ''))));
        list = null;
        item0 = null;
        para = null;
      } else if (para) {
        para.append(' ', ...inline(line));
      } else {
        para = el('p', {}, inline(line));
        nodes.push(para);
        list = null;
        item0 = null;
      }
    });
  });
  return nodes;
}

// <template> parses inertly (no scripts, no image loads) and, unlike
// DOMParser's <body>, keeps leading/trailing whitespace around highlights.
function stripTags(text) {
  const tpl = document.createElement('template');
  tpl.innerHTML = `${text}`;
  return tpl.content.textContent || '';
}

// SearchBlox marks matched terms with <highlight>. Build text nodes + <mark>
// instead of using innerHTML so indexed content can never inject markup.
function highlighted(text) {
  const frag = document.createDocumentFragment();
  `${text}`.split(/(<highlight>.*?<\/highlight>)/gi).forEach((part) => {
    const match = part.match(/^<highlight>(.*?)<\/highlight>$/i);
    if (match) frag.append(el('mark', {}, stripTags(match[1])));
    else if (part) frag.append(stripTags(part));
  });
  return frag;
}

// highlighted(), cut to `max` characters of text (with "…") if longer.
function highlightedClip(text, max) {
  const frag = document.createDocumentFragment();
  let left = max;
  `${text}`.split(/(<highlight>.*?<\/highlight>)/gi).forEach((part) => {
    if (left <= 0 || !part) return;
    const match = part.match(/^<highlight>(.*?)<\/highlight>$/i);
    const plain = stripTags(match ? match[1] : part);
    const kept = plain.length > left ? `${plain.slice(0, left).trimEnd()}…` : plain;
    left -= plain.length;
    frag.append(match ? el('mark', {}, kept) : kept);
  });
  return frag;
}

// `text` with what was typed in bold wherever it appears, as the SearchBlox
// plugin shows suggestions.
function matchHighlight(text, typed) {
  if (!typed) return text;
  const escaped = typed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.split(new RegExp(`(${escaped})`, 'gi'))
    .map((part, i) => (i % 2 ? el('strong', {}, part) : part))
    .filter(Boolean);
}

function safeUrl(url) {
  try {
    const parsed = new URL(url, typeof window === 'undefined' ? undefined : window.location.href);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

// As the SearchBlox plugin shows them: "Oct 05, 2026", in UTC.
const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', month: 'short', day: '2-digit', year: 'numeric',
});

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return DATE_FORMAT.format(date);
}

function displayUrl(url) {
  try {
    const { host, pathname } = new URL(url);
    return `${host}${pathname === '/' ? '' : pathname}`;
  } catch {
    return url;
  }
}

// ------------------------------------------------------------------
// Analytics
// ------------------------------------------------------------------

// The events the SearchBlox search plugin logs, so the console's analytics cover
// this widget. keepalive lets a click's log finish after the browser leaves the page.
// `always` sends it even with `analytics` off, as the plugin does for chat actions.
export function track(config, path, body, always = false) {
  if (!config.analytics && !always) return;
  fetch(`${config.domain}${path}`, {
    method: 'POST',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {});
}

// pcode: SearchBlox's id for a search session. Each search returns one; sending it
// back links a visitor's searches and clicks. Kept for this tab only.
const PCODE_KEY = 'sb-pcode';

function getPcode() {
  try {
    return sessionStorage.getItem(PCODE_KEY) || '';
  } catch {
    return '';
  }
}

function setPcode(pcode) {
  try {
    if (pcode) sessionStorage.setItem(PCODE_KEY, pcode);
  } catch {
    // Storage blocked or unavailable: searches still work, just unlinked.
  }
}

// AI recommendations keep the titles of the last results opened, and the last
// recommendations, for this tab only. `undefined` removes the entry.
const VIEWED_KEY = 'sb-viewed';
const RECOMMENDATIONS_KEY = 'sb-recommendations';

function readSession(key, fallback) {
  try {
    return JSON.parse(sessionStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeSession(key, value) {
  try {
    if (value === undefined) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked: recommendations then only follow opens on this page.
  }
}

const trackRecommendation = (config, body) => track(config, '/ui/v1/recommendations/track/click', body);

// SmartFAQ events: which FAQs were shown, and opens and link clicks.
const faqShown = (config, query, faqs) => faqs.length && track(config, '/rest/v2/api/smart-faq/impression', {
  smartfaq: faqs.map((f) => ({ uid: f.uid, collection: f.collection })), query, action: 'show', pcode: getPcode() || undefined,
});
const faqAction = (config, query, uid, action) => track(config, '/rest/v2/api/smart-faq/action', {
  uid, action, query, pcode: getPcode() || undefined,
});

// ------------------------------------------------------------------
// API
// ------------------------------------------------------------------

// Local date and time as SearchBlox takes it: 2026-10-23T14:05:00.
const pad = (n) => `${n}`.padStart(2, '0');
const sbTime = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  + `T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;

// When a date preset starts, counted back from `now`.
function presetStart(key, now) {
  const start = new Date(now);
  DATE_PRESETS.find(([k]) => k === key)?.[2](start);
  return start;
}

// A date facet's value: a preset key ("week") or a custom range of local dates
// ("2024-01-01..2025-12-31", either end may be empty). Returns the API range.
function dateRange(value, now) {
  if (DATE_PRESETS.some(([k]) => k === value)) return `[${sbTime(presetStart(value, now))}TO*]`;
  const [from, to] = `${value}`.split('..');
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!day.test(from) && !day.test(to)) return '';
  return `[${day.test(from) ? `${from}T00:00:00` : '*'}TO${day.test(to) ? `${to}T23:59:59` : '*'}]`;
}

const formatDay = (value) => formatDate(`${value}T00:00:00Z`);

// How a date facet's value reads on its chip.
function dateLabel(value) {
  const preset = DATE_PRESETS.find(([k]) => k === value);
  if (preset) return preset[1];
  const [from, to] = `${value}`.split('..');
  if (from && to) return `${formatDay(from)} – ${formatDay(to)}`;
  return from ? `From ${formatDay(from)}` : `Until ${formatDay(to)}`;
}

const isDateFacet = (config, field) => config.dateFacets.includes(field);

/**
 * Builds the Search API URL. `state` = { query, page, filters: { field: [values] },
 * sort, sortdir, allTerms, mlt }. `mlt` ({ id, col }) asks for pages like that
 * result ("More like this"), paged with XPC. Several values of one field narrow the results:
 * SearchBlox requires all of them. Hybrid search blends keyword and vector
 * (meaning) matching: `v.weight` is the vector share and `v.threshold` the
 * minimum similarity. As in the SearchBlox search plugin, hybrid search ORs the
 * terms so long natural-language queries still match, and keyword search (or
 * `allTerms`) requires all of them. `public=true` is what allows anonymous
 * (token-less) search; only collections marked Public in SearchBlox are returned.
 */
export function buildSearchUrl(config, state) {
  const params = new URLSearchParams();
  params.set('query', state.query || '*');
  params.set('page', `${state.page || 1}`);
  params.set('pagesize', `${config.pageSize}`);
  // As in the SearchBlox plugin, relevance is the console's manual ranking
  // (mrank) first, then relevance. Date sorting is newest first unless `sortdir`
  // is "asc".
  const sort = state.sort || config.sort;
  if (sort === 'relevance') {
    params.set('sort', 'mrank');
    params.set('sortdir', 'asc');
    params.set('sort1', 'relevance');
    params.set('sortdir1', 'desc');
  } else {
    params.set('sort', sort);
    if (sort === 'date') params.set('sortdir', state.sortdir || 'desc');
  }
  params.set('public', 'true');
  // The plugin's other request settings: the WEB tuning template, SmartFAQs
  // left out of search results (they have their own call), the suppression
  // list applied, and whether to return featured results.
  params.set('tunetemplate', 'WEB');
  params.set('smartfaqdisable', 'true');
  params.set('ignoreSuppressionList', 'false');
  params.set('adsDisplay', `${config.featured}`);
  config.collections.forEach((col) => params.append('col', col));

  // Date facets count each preset range, and a selected range filters only when
  // it's among the counted ranges too.
  const now = new Date();
  config.facets.forEach(({ field }) => {
    params.append('facet.field', field);
    if (!isDateFacet(config, field)) {
      params.set(`f.${field}.size`, `${FACET_SIZE}`);
      return;
    }
    DATE_PRESETS.forEach(([key]) => params.append(`f.${field}.range`, dateRange(key, now)));
    const selected = dateRange(values(state.filters?.[field])[0], now);
    if (selected) {
      if (!params.getAll(`f.${field}.range`).includes(selected)) params.append(`f.${field}.range`, selected);
      params.append(`f.${field}.filter`, selected);
    }
  });

  Object.entries(state.filters || {}).forEach(([field, value]) => {
    if (isDateFacet(config, field)) return;
    values(value).forEach((v) => params.append(`f.${field}.filter`, v));
  });

  if (state.mlt) {
    params.set('mlt_id', state.mlt.id);
    params.set('mlt_col', state.mlt.col);
    params.set('XPC', `${state.page || 1}`);
  }

  const hybrid = config.vectorWeight > 0;
  params.set('default', hybrid && !state.allTerms ? 'OR' : 'AND');
  if (hybrid) {
    params.set('v.weight', `${config.vectorWeight}`);
    params.set('v.threshold', `${config.vectorThreshold}`);
    return `${config.domain}/rest/v2/api/hybrid-search?${params}`;
  }
  return `${config.domain}/rest/v2/api/search?${params}`;
}

export function buildSuggestUrl(config, query) {
  const params = new URLSearchParams({ query, limit: `${config.suggestLimit}`, public: 'true' });
  config.collections.forEach((col) => params.append('col', col));
  return `${config.domain}/rest/v2/api/autocomplete?${params}`;
}

// SmartSuggest suggests phrases from an index built on one collection
// (Collections > SmartSuggest in the console); `cname` is that collection's name.
export function buildSmartSuggestUrl(config, query) {
  const params = new URLSearchParams({ query, cname: config.smartSuggest, limit: `${config.suggestLimit}` });
  return `${config.domain}/rest/v2/api/smartsuggest?${params}`;
}

// Structured records (e.g. product feeds) come back with title "null" and url
// "db?url="; their name and link are in product_* fields. Only absolute http(s)
// URLs are kept, so a record with no web page renders without a link.
const textOf = (value) => (value && value !== 'null' ? `${value}` : '');
const webUrl = (...urls) => urls.find((u) => /^https?:\/\//i.test(u || '')) || '';

// As in the SearchBlox search plugin: titles can come URL-encoded ("%20") and
// with stray "&#0;"; a "%" not followed by a hex pair is kept as is.
function cleanTitle(value) {
  const title = value.replace(/&#0;/g, '').replace(/&amp;/g, '&');
  try {
    return decodeURIComponent(title.replace(/%(?![\da-f]{2})/gi, '%25'));
  } catch {
    return title;
  }
}

// Descriptions can be escaped twice ("&amp;amp;") and start with a page's
// "Skip to main content" link.
const cleanDescription = (value) => value
  .replace(/&amp;(?:amp;)*/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&nbsp;/g, ' ')
  .replace(/\bskip to (?:main content|content|navigation|main navigation)\b/gi, '')
  .trim();

// One search result or recommendation. In a collection enriched by an LLM in
// SearchBlox, title and description hold the generated text and original_* the
// page's own; topics is a generated, comma-separated list.
const parseResult = (r) => {
  const url = webUrl(r.url, r.product_url, r.productUrl);
  return {
    uid: r.uid,
    col: r.col,
    position: Number(r.no) || undefined,
    url,
    title: cleanTitle(textOf(r.title) || textOf(r.product_name)) || url || 'Untitled',
    description: cleanDescription(textOf(r.description) || textOf(r.context)),
    contenttype: r.contenttype || '',
    colname: textOf(r.colname),
    lastmodified: r.lastmodified || '',
    // A page's share image, as the SearchBlox plugin uses for thumbnails.
    thumbnail: webUrl(r['og:image'], r['twitter:image'], r.thumbnail, r.image),
    originalTitle: cleanTitle(textOf(r.original_title)),
    originalDescription: cleanDescription(textOf(r.original_description)),
    topics: toList(textOf(r.topics)),
    pendingReview: `${r.needsReview}` === 'true' && `${r.approved}` !== 'true',
  };
};

/** Maps the raw Search API response into a small, stable shape for rendering. */
export function parseResponse(data = {}) {
  const facets = {};
  (data.facets || []).forEach((group) => {
    (group.facet || []).forEach((facet) => {
      // Date ranges come back with `from` and no name, counted or not.
      facets[facet.name] = (facet.facetinner || [])
        .filter((item) => item.from || item.count > 0)
        .map((item) => (item.from
          ? { from: item.from, count: item.count }
          : { value: item.name, count: item.count }));
    });
  });

  return {
    hits: Number(data.hits) || 0,
    currentPage: Number(data.currentPage) || 1,
    // 0 when the server leaves it out; the pagination works it out from hits.
    lastPage: Number(data.lastPage) || 0,
    // false when SearchBlox says not to highlight matches.
    highlight: data.highlight !== false,
    suggest: data.suggest || '',
    time: data.time,
    pcode: data.pcode || '',
    results: (data.result || []).map(parseResult),
    featured: (data.ads || []).map((ad) => ({
      uid: ad.uid,
      url: ad.url,
      title: ad.title,
      description: ad.description,
      image: ad.imageURL,
    })),
    facets,
  };
}

// A failed request throws with the server's own message when it sends one
// (e.g. "No Public Collection Found to Search").
async function checked(res) {
  if (res.ok) return res.json();
  const body = await res.json().catch(() => ({}));
  throw new Error(body.message || `SearchBlox responded with ${res.status}`);
}

async function getJson(url, signal) {
  return checked(await fetch(url, { signal, headers: { Accept: 'application/json' } }));
}

async function postJson(url, body, signal) {
  return checked(await fetch(url, {
    method: 'POST',
    signal,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

export async function search(config, state, signal) {
  const pcode = config.analytics ? getPcode() : '';
  const url = `${buildSearchUrl(config, state)}${pcode ? `&pcode=${encodeURIComponent(pcode)}` : ''}`;
  const data = parseResponse(await getJson(url, signal));
  if (config.analytics) setPcode(data.pcode);
  return data;
}

// Autocomplete returns ["a", "b"]; SmartSuggest returns [{"0": "a", "1": "b"}].
const toSuggestions = (data) => [...new Set((Array.isArray(data) ? data : [data])
  .flatMap((item) => (item && typeof item === 'object' ? Object.values(item) : item))
  .filter((item) => typeof item === 'string' && item.trim()))];

/**
 * Suggestions for `query`. Uses SmartSuggest when configured, falling back to
 * autocomplete if the index is missing or has nothing for this prefix.
 */
export async function suggest(config, query, signal) {
  if (config.smartSuggest) {
    try {
      const items = toSuggestions(await getJson(buildSmartSuggestUrl(config, query), signal));
      if (items.length) return items;
    } catch (err) {
      if (err.name === 'AbortError') throw err;
    }
  }
  return toSuggestions(await getJson(buildSuggestUrl(config, query), signal));
}

// The most searched queries, as the SearchBlox search plugin offers when nothing
// matches. The server answers { query: count }, most searched first.
export async function topQueries(config, signal) {
  const data = await postJson(`${config.domain}/rest/v2/api/query/topquery`, {
    col: config.collections.join(','), limit: `${TOP_QUERIES}`,
  }, signal);
  return Object.keys(data || {}).filter((q) => q.trim()).slice(0, TOP_QUERIES);
}

// Trending searches are the titles of a collection kept for the purpose (one
// document per search), as in the SearchBlox search plugin.
export async function trendingSearches(config, signal) {
  const params = new URLSearchParams({
    query: '*', cname: config.trending, sort: 'alpha', sortdir: 'asc', pagesize: `${TRENDING_LIMIT}`, public: 'true',
  });
  const data = await getJson(`${config.domain}/rest/v2/api/search?${params}`, signal);
  const titles = (data.result || []).map((r) => stripTags(cleanTitle(textOf(r.title))));
  return [...new Set(titles.filter(Boolean))];
}

// SmartFAQs are question/answer pairs generated for a collection in the console.
const parseFaq = (f) => ({
  uid: f.uid,
  question: textOf(f.question),
  answer: textOf(f.answer),
  url: webUrl(f.url),
  collection: f.collections,
});

export async function smartFaqs(config, query, size, signal) {
  const params = new URLSearchParams({ status: 'active', query, size: `${size}` });
  if (config.collections.length) params.set('col', config.collections.join(','));
  const data = await getJson(`${config.domain}/rest/v2/api/smart-faq/list?${params}`, signal);
  return (data.smartFaq || []).filter((f) => f.uid && f.question).map(parseFaq);
}

export async function smartFaq(config, uid, signal) {
  const data = await getJson(`${config.domain}/rest/v2/api/smart-faq/get/${encodeURIComponent(uid)}`, signal);
  return data?.uid && data.question ? parseFaq(data) : null;
}

const samePage = (a, b) => (a.url && b.url
  ? a.url.replace(/\/+$/, '') === b.url.replace(/\/+$/, '')
  : a.uid === b.uid);

// AI recommendations: an LLM picks results related to the titles of the last
// few results the visitor opened. As in the SearchBlox plugin, they come from the
// collections picked in a Collection filter (`cnames`, by name), or else the
// configured ones.
export async function recommendations(config, { titles, query, cnames = [] }, signal) {
  const scope = config.collections.length ? { col: config.collections } : {};
  const data = await postJson(`${config.domain}/rest/v2/api/recommendations`, {
    viewedPageTitles: titles,
    numberOfRecommendations: RECOMMENDATIONS_SHOWN,
    originalQuery: query && query !== '*' ? query : '',
    ...(cnames.length ? { cname: cnames } : scope),
  }, signal);
  return {
    sessionId: data.sessionId || '',
    // The same page can be indexed twice (e.g. with and without a trailing
    // slash) and come back twice; keep the first.
    items: (data.recommendations || []).map((r) => ({ ...parseResult(r), id: r.recommendationId }))
      .filter((r, i, all) => all.findIndex((o) => samePage(o, r)) === i),
  };
}

// SearchAI Assist: the actions (summarize, compare, ...) the server offers.
export async function assistPrompts(config, signal) {
  const data = await getJson(`${config.domain}/ui/v1/searchai-assist/prompts`, signal);
  const names = Object.keys(data?.prompts || {}).map((k) => k.replace(/^searchai-assist-/, '')).sort();
  return names.length ? names : ASSIST_PROMPTS;
}

/**
 * Runs an Assist action on the chosen results. Returns the answer as parts:
 * one text for the whole selection, or one per document ({ doc, text }).
 */
export async function assist(config, { operation, docs, prompt }, signal) {
  const data = await postJson(`${config.domain}/ui/v1/searchai-assist`, {
    operation,
    documents: docs.map((d) => ({ id: d.uid, collectionId: d.col })),
    customPrompt: prompt || '',
  }, signal);
  if (typeof data?.result === 'string') return [{ text: data.result }];
  if (typeof data?.documents === 'string') return [{ text: data.documents }];
  // Per document: { documentId, <operation>: text }.
  return (Array.isArray(data?.documents) ? data.documents : []).map((d) => {
    const key = Object.keys(d).find((k) => k !== 'documentId');
    return { doc: docs.find((r) => r.uid === d.documentId), text: textOf(d.result ?? d[key]) };
  }).filter((part) => part.text);
}

// ------------------------------------------------------------------
// AI overview and chat
// ------------------------------------------------------------------

const tryJson = (raw) => {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

// One array field of a JSON string that may not parse as a whole; entries that
// don't parse on their own are dropped.
function jsonArrayField(raw, key) {
  const match = new RegExp(`"${key}"\\s*:\\s*(\\[[\\s\\S]*?\\])\\s*[,}]`).exec(raw);
  if (!match) return [];
  return tryJson(match[1])
    ?? (match[1].match(/\{[^{}]*\}|"(?:[^"\\]|\\.)*"/g) || []).map(tryJson).filter((v) => v !== undefined);
}

// When the server can't parse the LLM's JSON it passes the raw string through
// as `overview`, sometimes inside a ```json fence. As in the SearchBlox search
// plugin, a raw answer that doesn't parse (often one bad citation) keeps the
// fields that do.
function parseRawOverview(text) {
  const raw = `${text || ''}`.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1');
  if (!raw.startsWith('{')) return null;
  const parsed = tryJson(raw);
  const answer = /"overview"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(raw);
  if (!parsed && !answer) return { overview: '' };
  const field = (key) => (parsed ? parsed[key] : jsonArrayField(raw, key));
  return {
    overview: parsed ? parsed.overview : tryJson(`"${answer[1]}"`) ?? answer[1],
    keyPoints: field('key_points'),
    citations: field('citations'),
    followupQuestions: field('followup_questions'),
  };
}

/** Maps the AI overview response into { overview, keyPoints, sources, followups }. */
export function parseOverview(data = {}) {
  const fields = { ...data, ...parseRawOverview(data.overview) };
  const sources = [];
  (fields.citations || []).forEach((c) => {
    const url = safeUrl(c?.url);
    if (url && !sources.some((s) => s.url === url)) {
      sources.push({ url, title: c.title || displayUrl(url) });
    }
  });
  const strings = (list) => (Array.isArray(list) ? list.filter((v) => typeof v === 'string' && v.trim()) : []);
  return {
    // insufficientSupport: the retrieved content doesn't answer the query.
    overview: data.insufficientSupport ? '' : `${fields.overview || ''}`.trim(),
    keyPoints: strings(fields.keyPoints),
    sources,
    followups: strings(fields.followupQuestions),
  };
}

// Answers are grounded on chunks from the named collections (`cname`); the API
// rejects requests without one.
export async function overview(config, query, signal) {
  return parseOverview(await postJson(`${config.domain}/rest/v2/api/ai-overview`, {
    query,
    cname: config.aiOverview,
    includeCitations: true,
    includeNextSteps: true,
    includeKgContext: true,
  }, signal));
}

// Chatbot answers cite sources inline as <source>url</source>. Database records
// cite "db?url=..." sources, which have no page to link to, so they're dropped.
// As in the SearchBlox plugin, an answer without <source> tags takes any bare
// URLs in it as its sources (the text keeps them).
export function parseChatAnswer(content) {
  const sources = [];
  const add = (url) => {
    const href = /^https?:\/\//i.test(url) ? safeUrl(url) : null;
    if (href && !sources.includes(href)) sources.push(href);
  };
  const text = `${content || ''}`.replace(/<source>\s*([\s\S]*?)\s*<\/source>/gi, (_, url) => {
    add(url);
    return '';
  }).trim();
  if (!sources.length) {
    (text.match(/https?:\/\/[^\s)<>"]+/g) || []).forEach((url) => add(url.replace(/[.,;:]+$/, '')));
  }
  return { text, sources };
}

// The default word list of the SearchBlox plugin's chat profanity filter:
// badwords-list 2.0.1 (MIT, (c) 2013 Maurice Butler), comma-separated and
// base64-encoded to keep it out of plain sight in the source.
const PROFANITY = 'NHI1ZSw1aDF0LDVoaXQsYTU1LGFuYWwsYW51cyxhcjVlLGFycnNlLGFyc2UsYXNzLGFzcy1mdWNrZXIsYXNzZXMsYXNzZnVja2VyLGFzc2Z1a2thLGFzc2hvbGUsYXNzaG9sZXMsYXNzd2hvbGUsYV9zX3MsYiF0Y2gsYjAwYnMsYjE3Y2gsYjF0Y2gsYmFsbGJhZyxiYWxscyxiYWxsc2FjayxiYXN0YXJkLGJlYXN0aWFsLGJlYXN0aWFsaXR5LGJlbGxlbmQsYmVzdGlhbCxiZXN0aWFsaXR5LGJpK2NoLGJpYXRjaCxiaXRjaCxiaXRjaGVyLGJpdGNoZXJzLGJpdGNoZXMsYml0Y2hpbixiaXRjaGluZyxibG9vZHksYmxvdyBqb2IsYmxvd2pvYixibG93am9icyxib2lvbGFzLGJvbGxvY2ssYm9sbG9rLGJvbmVyLGJvb2IsYm9vYnMsYm9vb2JzLGJvb29vYnMsYm9vb29vYnMsYm9vb29vb29icyxicmVhc3RzLGJ1Y2V0YSxidWdnZXIsYnVtLGJ1bm55IGZ1Y2tlcixidXR0LGJ1dHRob2xlLGJ1dHRtdWNoLGJ1dHRwbHVnLGMwY2ssYzBja3N1Y2tlcixjYXJwZXQgbXVuY2hlcixjYXdrLGNoaW5rLGNpcGEsY2wxdCxjbGl0LGNsaXRvcmlzLGNsaXRzLGNudXQsY29jayxjb2NrLXN1Y2tlcixjb2NrZmFjZSxjb2NraGVhZCxjb2NrbXVuY2gsY29ja211bmNoZXIsY29ja3MsY29ja3N1Y2ssY29ja3N1Y2tlZCxjb2Nrc3Vja2VyLGNvY2tzdWNraW5nLGNvY2tzdWNrcyxjb2Nrc3VrYSxjb2Nrc3Vra2EsY29rLGNva211bmNoZXIsY29rc3Vja2EsY29vbixjb3gsY3JhcCxjdW0sY3VtbWVyLGN1bW1pbmcsY3VtcyxjdW1zaG90LGN1bmlsaW5ndXMsY3VuaWxsaW5ndXMsY3VubmlsaW5ndXMsY3VudCxjdW50bGljayxjdW50bGlja2VyLGN1bnRsaWNraW5nLGN1bnRzLGN5YWxpcyxjeWJlcmZ1YyxjeWJlcmZ1Y2ssY3liZXJmdWNrZWQsY3liZXJmdWNrZXIsY3liZXJmdWNrZXJzLGN5YmVyZnVja2luZyxkMWNrLGRhbW4sZGljayxkaWNraGVhZCxkaWxkbyxkaWxkb3MsZGluayxkaW5rcyxkaXJzYSxkbGNrLGRvZy1mdWNrZXIsZG9nZ2luLGRvZ2dpbmcsZG9ua2V5cmliYmVyLGRvb3NoLGR1Y2hlLGR5a2UsZWphY3VsYXRlLGVqYWN1bGF0ZWQsZWphY3VsYXRlcyxlamFjdWxhdGluZyxlamFjdWxhdGluZ3MsZWphY3VsYXRpb24sZWpha3VsYXRlLGYgdSBjIGssZiB1IGMgayBlIHIsZjRubnksZmFnLGZhZ2dpbmcsZmFnZ2l0dCxmYWdnb3QsZmFnZ3MsZmFnb3QsZmFnb3RzLGZhZ3MsZmFubnksZmFubnlmbGFwcyxmYW5ueWZ1Y2tlcixmYW55eSxmYXRhc3MsZmN1ayxmY3VrZXIsZmN1a2luZyxmZWNrLGZlY2tlcixmZWxjaGluZyxmZWxsYXRlLGZlbGxhdGlvLGZpbmdlcmZ1Y2ssZmluZ2VyZnVja2VkLGZpbmdlcmZ1Y2tlcixmaW5nZXJmdWNrZXJzLGZpbmdlcmZ1Y2tpbmcsZmluZ2VyZnVja3MsZmlzdGZ1Y2ssZmlzdGZ1Y2tlZCxmaXN0ZnVja2VyLGZpc3RmdWNrZXJzLGZpc3RmdWNraW5nLGZpc3RmdWNraW5ncyxmaXN0ZnVja3MsZmxhbmdlLGZvb2ssZm9va2VyLGZ1Y2ssZnVja2EsZnVja2VkLGZ1Y2tlcixmdWNrZXJzLGZ1Y2toZWFkLGZ1Y2toZWFkcyxmdWNraW4sZnVja2luZyxmdWNraW5ncyxmdWNraW5nc2hpdG1vdGhlcmZ1Y2tlcixmdWNrbWUsZnVja3MsZnVja3doaXQsZnVja3dpdCxmdWRnZSBwYWNrZXIsZnVkZ2VwYWNrZXIsZnVrLGZ1a2VyLGZ1a2tlcixmdWtraW4sZnVrcyxmdWt3aGl0LGZ1a3dpdCxmdXgsZnV4MHIsZl91X2NfayxnYW5nYmFuZyxnYW5nYmFuZ2VkLGdhbmdiYW5ncyxnYXlsb3JkLGdheXNleCxnb2F0c2UsR29kLGdvZC1kYW0sZ29kLWRhbW5lZCxnb2RkYW1uLGdvZGRhbW5lZCxoYXJkY29yZXNleCxoZWxsLGhlc2hlLGhvYXIsaG9hcmUsaG9lcixob21vLGhvcmUsaG9ybmllc3QsaG9ybnksaG90c2V4LGphY2stb2ZmLGphY2tvZmYsamFwLGplcmstb2ZmLGppc20saml6LGppem0saml6eixrYXdrLGtub2Isa25vYmVhZCxrbm9iZWQsa25vYmVuZCxrbm9iaGVhZCxrbm9iam9ja3ksa25vYmpva2V5LGtvY2ssa29uZHVtLGtvbmR1bXMsa3VtLGt1bW1lcixrdW1taW5nLGt1bXMsa3VuaWxpbmd1cyxsM2krY2gsbDNpdGNoLGxhYmlhLGx1c3QsbHVzdGluZyxtMGYwLG0wZm8sbTQ1dGVyYmF0ZSxtYTV0ZXJiOCxtYTV0ZXJiYXRlLG1hc29jaGlzdCxtYXN0ZXItYmF0ZSxtYXN0ZXJiOCxtYXN0ZXJiYXQqLG1hc3RlcmJhdDMsbWFzdGVyYmF0ZSxtYXN0ZXJiYXRpb24sbWFzdGVyYmF0aW9ucyxtYXN0dXJiYXRlLG1vLWZvLG1vZjAsbW9mbyxtb3RoYWZ1Y2ssbW90aGFmdWNrYSxtb3RoYWZ1Y2thcyxtb3RoYWZ1Y2theixtb3RoYWZ1Y2tlZCxtb3RoYWZ1Y2tlcixtb3RoYWZ1Y2tlcnMsbW90aGFmdWNraW4sbW90aGFmdWNraW5nLG1vdGhhZnVja2luZ3MsbW90aGFmdWNrcyxtb3RoZXIgZnVja2VyLG1vdGhlcmZ1Y2ssbW90aGVyZnVja2VkLG1vdGhlcmZ1Y2tlcixtb3RoZXJmdWNrZXJzLG1vdGhlcmZ1Y2tpbixtb3RoZXJmdWNraW5nLG1vdGhlcmZ1Y2tpbmdzLG1vdGhlcmZ1Y2trYSxtb3RoZXJmdWNrcyxtdWZmLG11dGhhLG11dGhhZmVja2VyLG11dGhhZnVja2tlcixtdXRoZXIsbXV0aGVyZnVja2VyLG4xZ2dhLG4xZ2dlcixuYXppLG5pZ2czcixuaWdnNGgsbmlnZ2EsbmlnZ2FoLG5pZ2dhcyxuaWdnYXosbmlnZ2VyLG5pZ2dlcnMsbm9iLG5vYiBqb2tleSxub2JoZWFkLG5vYmpvY2t5LG5vYmpva2V5LG51bWJudXRzLG51dHNhY2ssb3JnYXNpbSxvcmdhc2ltcyxvcmdhc20sb3JnYXNtcyxwMHJuLHBhd24scGVja2VyLHBlbmlzLHBlbmlzZnVja2VyLHBob25lc2V4LHBodWNrLHBodWsscGh1a2VkLHBodWtpbmcscGh1a2tlZCxwaHVra2luZyxwaHVrcyxwaHVxLHBpZ2Z1Y2tlcixwaW1waXMscGlzcyxwaXNzZWQscGlzc2VyLHBpc3NlcnMscGlzc2VzLHBpc3NmbGFwcyxwaXNzaW4scGlzc2luZyxwaXNzb2ZmLHBvb3AscG9ybixwb3Jubyxwb3Jub2dyYXBoeSxwb3Jub3MscHJpY2sscHJpY2tzLHByb24scHViZSxwdXNzZSxwdXNzaSxwdXNzaWVzLHB1c3N5LHB1c3N5cyxyZWN0dW0scmV0YXJkLHJpbWphdyxyaW1taW5nLHMgaGl0LHMuby5iLixzYWRpc3Qsc2NobG9uZyxzY3Jld2luZyxzY3JvYXQsc2Nyb3RlLHNjcm90dW0sc2VtZW4sc2V4LHNoISssc2ghdCxzaDF0LHNoYWcsc2hhZ2dlcixzaGFnZ2luLHNoYWdnaW5nLHNoZW1hbGUsc2hpKyxzaGl0LHNoaXRkaWNrLHNoaXRlLHNoaXRlZCxzaGl0ZXksc2hpdGZ1Y2ssc2hpdGZ1bGwsc2hpdGhlYWQsc2hpdGluZyxzaGl0aW5ncyxzaGl0cyxzaGl0dGVkLHNoaXR0ZXIsc2hpdHRlcnMsc2hpdHRpbmcsc2hpdHRpbmdzLHNoaXR0eSxza2FuayxzbHV0LHNsdXRzLHNtZWdtYSxzbXV0LHNuYXRjaCxzb24tb2YtYS1iaXRjaCxzcGFjLHNwdW5rLHNfaF9pX3QsdDF0dDFlNSx0MXR0aWVzLHRlZXRzLHRlZXosdGVzdGljYWwsdGVzdGljbGUsdGl0LHRpdGZ1Y2ssdGl0cyx0aXR0LHRpdHRpZTUsdGl0dGllZnVja2VyLHRpdHRpZXMsdGl0dHlmdWNrLHRpdHR5d2Fuayx0aXR3YW5rLHRvc3Nlcix0dXJkLHR3NHQsdHdhdCx0d2F0aGVhZCx0d2F0dHksdHd1bnQsdHd1bnRlcix2MTRncmEsdjFncmEsdmFnaW5hLHZpYWdyYSx2dWx2YSx3MDBzZSx3YW5nLHdhbmssd2Fua2VyLHdhbmt5LHdob2FyLHdob3JlLHdpbGxpZXMsd2lsbHkseHJhdGVkLHh4eA==';
let profanityWords;

// The console's "mask profanity" setting, as the plugin's filter applies it:
// each listed word becomes "#%*!". `useDefaultDataset` adds the list above;
// whitelisted words are let through and blacklisted ones added.
export function maskProfanity(text, rules = {}) {
  if (!rules.maskProfanity) return text;
  profanityWords = profanityWords || atob(PROFANITY).split(',');
  const allowed = new Set((rules.whitelistedWords || []).map((w) => `${w}`.toLowerCase()));
  const listed = rules.useDefaultDataset === false ? [] : profanityWords;
  const words = [...listed, ...(rules.blacklistedWords || [])]
    .map((w) => `${w}`.trim().toLowerCase())
    .filter((w) => w && !allowed.has(w));
  if (!words.length) return text;
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return text.replace(new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'gi'), '#%*!');
}

// The console's "mask sensitive data" setting, with the SearchBlox plugin's
// patterns: hide these before the question leaves the browser.
const SENSITIVE = {
  bankingCards: [
    /\d{4}-\d{4}-\d{4}-\d{4}/g, /\d{4}\s\d{4}\s\d{4}\s\d{4}/g, /\d{4}\.\d{4}\.\d{4}\.\d{4}/g,
    /\d{4}-\d{6}-\d{5}/g, /\d{4}\s\d{6}\s\d{5}/g, /\d{4}\.\d{6}\.\d{5}/g,
    /\d{4}-\d{6}-\d{4}/g, /\d{4}\s\d{6}\s\d{4}/g, /\d{4}\.\d{6}\.\d{4}/g,
    /\d{19}/g, /\d{16}/g, /\d{15}/g,
  ],
  phoneNumbers: [
    /\b\d{3}-\d{4}\b/g, /\b\d{3}-\d{3}-\d{4}\b/g, /\b\d{3}[-\u2011)]?\d{7}\b/g, /\b\d{10}\b/g,
    /\(\d{3}\)\d{3}[-\u2011)]?\d{4}/g, /\(\d{3}\)[-\u2011)]?\d{3}-\d{4}/g,
    /\(\d{3}\)(?:[-\u2011)]?)?\d{3}-\d{4}/g, /\(\d{3}\)[-\u2011)]?\d{7}/g,
    /\b1[-\u2011)]?\d{3}[-\u2011)]?\d{3}[-\u2011)]?\d{4}\b/g, /\b1-\d{3}-\d{7}\b/g,
    /\b1-\d{10}\b/g, /\b\d{11}\b/g, /\b1\(\d{3}\)\d{3}-\d{4}\b/g, /\b1\(\d{3}\)-\d{3}-\d{4}\b/g,
    /\b1\(\d{3}\)-\d{7}\b/g, /\b1-\(\d{3}\)\d{3}-\d{4}\b/g, /\b1-\(\d{3}\)-\d{3}-\d{4}\b/g,
    /\b1-\(\d{3}\)-\d{7}\b/g,
  ],
  ssn: [/\d{3}-\d{2}-\d{4}/g, /\d{3}\.\d{2}\.\d{4}/g, /\d{3}\s\d{2}\s\d{4}/g, /\d{9}/g],
};
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

// A console pattern: "/x/i", "x/i" or plain "x". Always global, so every match
// is masked. Returns null for one this browser can't compile.
function patternOf(value) {
  const str = `${value}`;
  const literal = /^\/(.*)\/([a-z]*)$/.exec(str);
  const slash = str.lastIndexOf('/');
  let [source, flags] = [str, ''];
  if (literal && /^[dgimsuvy]*$/.test(literal[2])) [, source, flags] = literal;
  else if (slash > 0 && /^[dgimsuvy]+$/.test(str.slice(slash + 1))) [source, flags] = [str.slice(0, slash), str.slice(slash + 1)];
  try {
    return new RegExp(source, flags.includes('g') ? flags : `${flags}g`);
  } catch {
    return null;
  }
}

export function maskSensitive(text, rules = {}) {
  if (!rules.maskSensitiveData) return text;
  const patterns = [
    ...Object.entries(SENSITIVE).flatMap(([key, list]) => (rules[key] === false ? [] : list)),
    ...(rules.additionalPatterns || []).map(patternOf).filter(Boolean),
  ];
  // Longer patterns first, so a card number isn't half-matched as a phone number.
  patterns.sort((a, b) => b.source.length - a.source.length);
  const start = rules.emailIds === false ? text : text.replace(EMAIL, '####');
  return patterns.reduce((out, re) => out.replace(re, '####'), start);
}

const chatUrl = (config, path) => `${config.domain}/ui/v1/chatbot/${path}`;

export async function chatSettings(config, signal) {
  const data = await getJson(chatUrl(config, `settings/${encodeURIComponent(config.chatbot)}`), signal);
  if (!data.success) throw new Error(data.message || `Chatbot "${config.chatbot}" not found`);
  return {
    userLabel: 'You', botLabel: 'AI', initialMessage: 'Hello! What can I help you with?', ...data.chatBotSettings,
  };
}

/** One chat turn. The server keeps the history; we only send back its conversation id. */
// `useKg` is the chatbot's own setting, sent as is (left out when unset).
export async function chat(config, { question, conversationId, useKg }, signal) {
  const data = await postJson(chatUrl(config, 'chat'), {
    chatbotname: config.chatbot,
    question,
    useKg,
    ...(conversationId ? { conversation_id: conversationId } : {}),
  }, signal);
  const message = data.choices?.[0]?.message;
  if (!message) throw new Error(data.message || 'Empty chatbot response');
  return {
    id: data.id,
    conversationId: data.conversation_id,
    created: Number(data.created) || Date.now(),
    action: data.actions?.[0],
    ...parseChatAnswer(message.content),
  };
}

export const chatVote = (config, id, action) => postJson(chatUrl(config, 'action'), { message_id: id, action });

/**
 * One AI Mode turn: the `aiMode` chatbot answers from `AI_MODE_PASSAGES` passages
 * and suggests follow-up questions. Cited pages come back as plain URLs, so the
 * caller looks up their titles with documentLookup().
 */
export async function aiModeAsk(config, { question, conversationId }, signal) {
  const data = await postJson(chatUrl(config, 'chat-with-suggestions'), {
    chatbotname: config.aiMode,
    question,
    passages: AI_MODE_PASSAGES,
    ...(conversationId ? { conversation_id: conversationId } : {}),
  }, signal);
  const message = data.choices?.[0]?.message;
  if (!message) throw new Error(data.message || 'Empty AI Mode response');
  const answer = parseChatAnswer(message.content);
  return {
    id: data.id,
    conversationId: data.conversation_id,
    followups: (data.follow_up_questions || []).filter((q) => typeof q === 'string' && q.trim()),
    ...answer,
  };
}

// Titles and descriptions of indexed pages, by URL; pages not found are left out.
export async function documentLookup(config, urls, signal) {
  const params = new URLSearchParams();
  urls.forEach((url) => params.append('url', url));
  const data = await getJson(`${config.domain}/ui/v1/api/document-lookup?${params}`, signal);
  return (data.documents || []).filter((d) => d.url).map((d) => ({
    url: d.url,
    title: cleanTitle(textOf(d.original_title) || textOf(d.title)) || displayUrl(d.url),
    description: cleanDescription(textOf(d.original_description) || textOf(d.description)),
  }));
}

// ------------------------------------------------------------------
// URL state
// ------------------------------------------------------------------

function readUrlState(config) {
  const params = new URLSearchParams(window.location.search);
  const filters = {};
  // Filters are written as the SearchBlox plugin writes them (f.field.filter);
  // the older f.field form still reads. A plugin date range ([...TO...]) becomes
  // a custom range.
  config.facets.forEach(({ field }) => {
    const selected = [...params.getAll(`f.${field}.filter`), ...params.getAll(`f.${field}`)]
      .filter(Boolean)
      .map((v) => {
        const range = /^\[(\d{4}-\d{2}-\d{2}|\*)\S*?TO(\d{4}-\d{2}-\d{2}|\*)/.exec(v);
        return range ? `${range[1].replace('*', '')}..${range[2].replace('*', '')}` : v;
      });
    if (selected.length) filters[field] = [...new Set(selected)];
  });
  const sort = SORTS.some(([value]) => value === params.get('sort')) ? params.get('sort') : '';
  return {
    query: params.get(config.queryParam) || '',
    // Load more starts from the first page again.
    page: config.loadMore ? 1 : Number.parseInt(params.get('page'), 10) || 1,
    filters,
    faq: params.get('faq') || '',
    sort,
    sortdir: sort === 'date' && params.get('sortdir') === 'asc' ? 'asc' : '',
    // "mode=ai" hands a question from a box-only instance to AI Mode.
    aiMode: params.get('mode') === 'ai',
    mlt: params.get('mlt_id') && params.get('mlt_col')
      ? { id: params.get('mlt_id'), col: params.get('mlt_col'), title: '' }
      : null,
  };
}

function writeUrlState(config, state) {
  if (!config.syncUrl) return;
  const url = new URL(window.location.href);
  url.searchParams.set(config.queryParam, state.query);
  if (state.page > 1 && !config.loadMore) url.searchParams.set('page', state.page);
  else url.searchParams.delete('page');
  if (state.faq) url.searchParams.set('faq', state.faq);
  else url.searchParams.delete('faq');
  if (state.sort) url.searchParams.set('sort', state.sort);
  else url.searchParams.delete('sort');
  if (state.sortdir) url.searchParams.set('sortdir', state.sortdir);
  else url.searchParams.delete('sortdir');
  url.searchParams.delete('mode');
  if (state.mlt) {
    url.searchParams.set('mlt_id', state.mlt.id);
    url.searchParams.set('mlt_col', state.mlt.col);
  } else {
    url.searchParams.delete('mlt_id');
    url.searchParams.delete('mlt_col');
  }
  config.facets.forEach(({ field }) => {
    url.searchParams.delete(`f.${field}`);
    url.searchParams.delete(`f.${field}.filter`);
    values(state.filters[field]).forEach((v) => url.searchParams.append(`f.${field}.filter`, v));
  });
  window.history.replaceState(null, '', url);
}

// ------------------------------------------------------------------
// Theme
// ------------------------------------------------------------------

// Relative luminance of a computed "rgb(...)"/"rgba(...)" color, or null when the
// color is transparent or in another format.
const luminance = (color) => {
  const m = /^rgba?\(([\d.]+),? ([\d.]+),? ([\d.]+)(?:,? \/? ?([\d.]+))?\)$/.exec(color || '');
  if (!m || Number(m[4] ?? 1) < 0.5) return null;
  const [r, g, b] = m.slice(1, 4).map((v) => {
    const c = Number(v) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

// The page is dark if the first opaque background behind the widget is dark or,
// when none is found, if the inherited text color is light.
const detectScheme = (root) => {
  for (let node = root; node; node = node.parentElement) {
    const bg = luminance(getComputedStyle(node).backgroundColor);
    if (bg !== null) return bg < 0.18 ? 'dark' : 'light';
  }
  const text = luminance(getComputedStyle(root).color);
  return text !== null && text > 0.18 ? 'dark' : 'light';
};

const applyTheme = (root, config) => {
  if (config.accent && (!window.CSS?.supports || CSS.supports('color', config.accent))) {
    root.style.setProperty('--sb-accent', config.accent);
  }
  root.dataset.sbScheme = config.scheme === 'auto' ? detectScheme(root) : config.scheme;
};

// ------------------------------------------------------------------
// Chat
// ------------------------------------------------------------------

let chatHost;

// Message times, as in the SearchBlox plugin's chat: the first message shows the
// date and time, later ones "just now" for 20 seconds, then "2 minutes ago".
const SHORT_TIME = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' });
const RELATIVE_TIME = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const JUST_NOW = 20; // seconds; also how often relative times refresh

function relativeTime(ms) {
  const seconds = Math.round((ms - Date.now()) / 1000);
  if (seconds > -JUST_NOW) return 'just now';
  const [unit, size] = [['day', 86400], ['hour', 3600], ['minute', 60]].find(([, s]) => -seconds >= s) || ['second', 1];
  return RELATIVE_TIME.format(Math.round(seconds / size), unit);
}

// "3 secs", "1 min, 5 secs"; nothing under a second.
function formatDuration(ms) {
  const total = Math.floor(ms / 1000);
  const plural = (n, unit) => `${n} ${unit}${n > 1 ? 's' : ''}`;
  return [
    total >= 60 ? plural(Math.floor(total / 60), 'min') : '',
    total % 60 ? plural(total % 60, 'sec') : '',
  ].filter(Boolean).join(', ');
}

function chatActionLink(config, action) {
  const resource = `${action.actionResource || ''}`.trim();
  let href = safeUrl(resource);
  if (action.actionType === 'phone') href = `tel:${resource.replace(/[^\d+]/g, '')}`;
  if (action.actionType === 'email') href = `mailto:${resource}`;
  if (!href || !resource) return null;
  return el(
    'div',
    { className: 'sb-chat-action' },
    action.description ? el('p', {}, action.description) : null,
    el('a', {
      href,
      download: action.actionType === 'download' ? '' : undefined,
      target: href.startsWith('http') ? '_blank' : undefined,
      rel: 'noopener',
      onClick: () => track(config, '/ui/v1/analytics/ca', { uid: action.uid }, true),
    }, action.buttonDisplay || resource),
  );
}

// Thumbs up/down; `vote(action)` sends 'upvote' or 'downvote' and returns a promise.
// As in the plugin, a vote only sticks when the server confirms it.
function votes(vote) {
  const buttons = [['upvote', 'up', 'Helpful'], ['downvote', 'down', 'Not helpful']].map(([action, name, label]) => el('button', {
    type: 'button',
    'aria-label': label,
    title: label,
    'aria-pressed': 'false',
    // aria-disabled, not disabled: a disabled button drops focus out of the panel.
    onClick: (e) => {
      const button = e.currentTarget;
      if (button.getAttribute('aria-disabled')) return;
      buttons.forEach((b) => b.setAttribute('aria-disabled', 'true'));
      vote(action)
        .then((res) => {
          if (res?.success === false) throw new Error('Vote not recorded');
          button.setAttribute('aria-pressed', 'true');
        })
        .catch(() => buttons.forEach((b) => b.removeAttribute('aria-disabled')));
    },
  }, icon(name)));
  return el('div', { className: 'sb-votes' }, buttons);
}

/**
 * Floating chat button and chat panel, one per page. It lives in its own
 * .searchblox-search host on <body>: the widget root's container-type would make
 * it the containing block for position: fixed.
 */
function mountChat(config) {
  if (chatHost?.isConnected) return;
  instanceCount += 1;
  const id = `sb-${instanceCount}-chat`;
  const log = el('div', { className: 'sb-chat-log', role: 'log', 'aria-live': 'polite' });
  const input = el('input', {
    className: 'sb-input', type: 'text', autocomplete: 'off', placeholder: 'Ask a question ...', 'aria-label': 'Ask a question',
  });
  const send = el('button', {
    className: 'sb-submit', type: 'submit', 'aria-label': 'Send', title: 'Send',
  }, icon('send', 20));
  const launcher = el('button', {
    type: 'button', className: 'sb-chat-launcher', 'aria-expanded': 'false', 'aria-controls': id,
  });
  // Like the SearchBlox plugin: a chat bubble that turns into a close button.
  const setLauncher = (isOpen) => {
    const label = isOpen ? 'Close' : 'SearchAI ChatBot';
    launcher.replaceChildren(icon(isOpen ? 'close' : 'chat', 24));
    launcher.setAttribute('aria-label', label);
    launcher.title = label;
    launcher.setAttribute('aria-expanded', `${isOpen}`);
  };
  setLauncher(false);
  const panel = el(
    'section',
    {
      id, className: 'sb-chat', role: 'dialog', 'aria-labelledby': `${id}-title`, hidden: true,
    },
    el(
      'header',
      { className: 'sb-chat-header' },
      el('h2', { id: `${id}-title` }, icon('ai'), 'ChatBot ', el('em', { className: 'sb-chat-name' }, config.chatbot)),
      el('button', {
        type: 'button', className: 'sb-chat-reset', 'aria-label': 'New chat', title: 'New chat',
      }, icon('reload')),
      el('button', {
        type: 'button', className: 'sb-chat-close', 'aria-label': 'Close chat', title: 'Close chat',
      }, icon('close')),
    ),
    log,
    el('form', { className: 'sb-chat-form' }, input, send),
  );

  let settings;
  let conversationId = '';
  let controller;

  const add = (node) => {
    log.append(node);
    log.scrollTop = log.scrollHeight;
    return node;
  };
  // One chat line: speaker, message, then its time, response time and (for
  // answers) feedback buttons. Any action button sits below the bubble.
  const message = (who, {
    label, body, created = Date.now(), first, duration, id: messageId, action,
  }) => {
    const time = el('time', {
      className: 'sb-chat-time',
      datetime: new Date(created).toISOString(),
      title: first ? undefined : `${who === 'user' ? 'Sent' : 'Received'} at ${SHORT_TIME.format(created)}`,
      'data-created': first ? undefined : `${created}`,
    }, first ? SHORT_TIME.format(created) : relativeTime(created));
    return add(el(
      'div',
      { className: `sb-chat-msg is-${who}` },
      el(
        'div',
        { className: 'sb-chat-bubble' },
        el('p', { className: 'sb-chat-speaker' }, label),
        body,
        el(
          'div',
          { className: 'sb-chat-details' },
          el('span', {}, time, duration ? el('span', { className: 'sb-chat-duration', title: 'Response time' }, icon('stopwatch', 12), duration) : null),
          messageId ? votes((vote) => chatVote(config, messageId, vote)) : null,
        ),
      ),
      action ? chatActionLink(config, action) : null,
    ));
  };
  const pending = () => add(el(
    'div',
    { className: 'sb-chat-msg is-bot sb-chat-pending' },
    el('div', { className: 'sb-chat-bubble' }, 'Thinking…'),
  ));
  // After CHAT_IDLE_MINUTES without activity in the chat, ask once whether
  // there's anything else, as the SearchBlox plugin does.
  let idleTimer;
  let idlePrompted = false;
  let asked = false;
  const resetIdle = () => {
    clearTimeout(idleTimer);
    if (!settings || idlePrompted) return;
    idleTimer = setTimeout(() => {
      idlePrompted = true;
      message('bot', {
        label: settings.botLabel,
        body: el('p', { className: 'sb-chat-text' }, `Is there anything ${asked ? 'else ' : ''}I can help you find?`),
      });
    }, CHAT_IDLE_MINUTES * 60 * 1000);
  };
  ['input', 'pointerdown'].forEach((type) => panel.addEventListener(type, resetIdle));

  // SmartFAQ questions as prompts while typing (`chatSuggestions`).
  const prompts = el('ul', { className: 'sb-chat-prompts', 'aria-label': 'Suggested questions', hidden: true });
  let promptTimer;
  let promptController;
  const hidePrompts = () => {
    clearTimeout(promptTimer);
    promptController?.abort();
    prompts.hidden = true;
    prompts.replaceChildren();
  };
  if (config.chatSuggestions) {
    panel.querySelector('.sb-chat-form').before(prompts);
    input.addEventListener('input', () => {
      const typed = input.value.trim();
      hidePrompts();
      if (typed.length < CHAT_SUGGEST_MIN) return;
      promptTimer = setTimeout(() => {
        promptController = new AbortController();
        smartFaqs(config, typed, CHAT_SUGGEST, promptController.signal)
          .then((faqs) => {
            prompts.replaceChildren(...faqs.map((faq) => el('li', {}, el('button', {
              type: 'button', 'data-question': stripTags(faq.question),
            }, matchHighlight(stripTags(faq.question), typed)))));
            prompts.hidden = !faqs.length;
          })
          .catch(() => {});
      }, SUGGEST_DELAY);
    });
  }

  let ticker;

  const start = async () => {
    controller?.abort();
    controller = new AbortController();
    conversationId = '';
    idlePrompted = false;
    asked = false;
    hidePrompts();
    log.replaceChildren();
    send.disabled = true;
    const wait = pending();
    try {
      settings = await chatSettings(config, controller.signal);
      wait.remove();
      message('bot', {
        label: settings.botLabel, body: el('div', { className: 'sb-chat-text' }, markdown(settings.initialMessage)), first: true,
      });
      send.disabled = false;
      resetIdle();
    } catch (err) {
      if (err.name === 'AbortError') return;
      wait.remove();
      message('bot', { label: 'AI', body: el('p', { className: 'sb-error' }, 'Chat is unavailable right now.'), first: true });
      // eslint-disable-next-line no-console
      console.error('[searchblox-search] chat', err);
    }
  };

  // Profanity, then sensitive data, is masked before the question leaves the browser.
  const ask = async (raw) => {
    const clean = maskProfanity(raw.trim(), settings?.profanitySettings);
    const question = maskSensitive(clean, settings?.sensitiveDataInformation);
    if (!question || !settings || send.disabled) return;
    input.value = '';
    hidePrompts();
    asked = true;
    resetIdle();
    message('user', { label: settings.userLabel, body: el('p', { className: 'sb-chat-text' }, question) });
    send.disabled = true;
    const wait = pending();
    const started = performance.now();
    try {
      const { useKg } = settings;
      // `chatReferences`: the top search results for the question, fetched alongside.
      const references = config.chatReferences
        ? search(config, { query: question, page: 1, filters: {} }, controller.signal)
          .then((data) => data.results.filter((r) => safeUrl(r.url)).slice(0, CHAT_REFERENCES))
          .catch(() => [])
        : [];
      const [answer, refs] = await Promise.all([
        chat(config, { question, conversationId, useKg }, controller.signal),
        references,
      ]);
      conversationId = answer.conversationId || conversationId;
      wait.remove();
      message('bot', {
        label: settings.botLabel,
        body: [
          el('div', { className: 'sb-chat-text' }, markdown(answer.text)),
          answer.sources.length ? el(
            'ol',
            { className: 'sb-chat-sources', 'aria-label': 'Sources' },
            answer.sources.map((url) => el('li', {}, el('a', {
              href: url, target: '_blank', rel: 'noopener',
            }, displayUrl(url)))),
          ) : null,
          refs.length ? el(
            'div',
            { className: 'sb-chat-refs' },
            el('p', { className: 'sb-chat-refs-title' }, 'Reference links'),
            el('ul', {}, refs.map((r, i) => el('li', {}, el('a', {
              href: safeUrl(r.url),
              target: '_blank',
              rel: 'noopener',
              onClick: () => track(config, '/ui/v1/analytics/click', {
                collection: r.col,
                query: question,
                title: stripTags(r.title),
                uid: r.uid,
                url: r.url,
                pcode: getPcode() || undefined,
                pos: i + 1,
                page: 1,
              }),
            }, icon('link', 16), el(
              'span',
              {},
              el('span', { className: 'sb-chat-ref-title' }, stripTags(r.title)),
              el('span', { className: 'sb-chat-ref-url' }, displayUrl(r.url)),
            ))))),
          ) : null,
        ],
        created: answer.created,
        duration: formatDuration(performance.now() - started),
        id: answer.id,
        action: answer.action,
      });
    } catch (err) {
      if (err.name === 'AbortError') return;
      wait.remove();
      message('bot', { label: settings.botLabel, body: el('p', { className: 'sb-error' }, 'Sorry, that went wrong. Please try again.') });
      // eslint-disable-next-line no-console
      console.error('[searchblox-search] chat', err);
    } finally {
      if (!controller.signal.aborted) send.disabled = false;
    }
  };

  const refreshTimes = () => log.querySelectorAll('time[data-created]').forEach((t) => {
    t.textContent = relativeTime(Number(t.dataset.created));
  });
  const open = () => {
    panel.hidden = false;
    setLauncher(true);
    refreshTimes();
    ticker = setInterval(refreshTimes, JUST_NOW * 1000);
    if (!settings && !log.children.length) start();
    input.focus();
  };
  const close = () => {
    panel.hidden = true;
    clearInterval(ticker);
    setLauncher(false);
    launcher.focus();
  };
  launcher.addEventListener('click', () => (panel.hidden ? open() : close()));
  panel.querySelector('.sb-chat-reset').addEventListener('click', () => start());
  panel.querySelector('.sb-chat-close').addEventListener('click', () => close());
  panel.querySelector('.sb-chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    ask(input.value);
  });
  prompts.addEventListener('click', (e) => {
    const question = e.target.closest('button')?.dataset.question;
    if (question) ask(question);
  });
  panel.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!prompts.hidden) hidePrompts();
    else close();
  });

  chatHost = el('div', { className: 'searchblox-search sb-chat-host' }, panel, launcher);
  document.body.append(chatHost);
  applyTheme(chatHost, config);
}

// ------------------------------------------------------------------
// Voice search
// ------------------------------------------------------------------

// As in the SearchBlox search plugin: the browser's speech recognition where it
// works, otherwise a recording sent to SearchBlox's speech-to-text endpoint.
// Recording stops after a second of silence once the visitor has spoken, or
// after 5 seconds of nothing; nothing longer than 15 seconds is sent.
const VOICE_SILENCE = 1000;
const VOICE_WAIT = 5000;
const VOICE_MAX = 15000;
const VOICE_RATE = 16000;
// Brave and Edge expose SpeechRecognition but it doesn't transcribe there.
const SpeechRecognitionApi = typeof window === 'undefined'
  ? undefined
  : window.SpeechRecognition || window.webkitSpeechRecognition;
const nativeSpeech = () => SpeechRecognitionApi && !navigator.brave && !/\bEdg\//.test(navigator.userAgent);
const recordedSpeech = () => Boolean(
  navigator.mediaDevices?.getUserMedia && window.MediaRecorder && window.AudioContext,
);
const speechLang = () => document.documentElement.lang || navigator.language || 'en-US';

// 16-bit mono WAV, which the speech-to-text endpoint takes as LINEAR16.
function wav(samples, rate) {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const ascii = (offset, str) => [...str].forEach((c, i) => {
    view.setUint8(offset + i, c.charCodeAt(0));
  });
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((v, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true));
  return new Uint8Array(view.buffer);
}

async function transcribe(config, blob) {
  // Decoding at 16 kHz resamples whatever the browser recorded.
  const ctx = new AudioContext({ sampleRate: VOICE_RATE });
  try {
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    const bytes = wav(audio.getChannelData(0), audio.sampleRate);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    const data = await postJson(`${config.domain}/rest/v2/api/speech/text`, {
      config: { encoding: 'LINEAR16', languageCode: speechLang(), sampleRateHertz: audio.sampleRate },
      audio: { content: btoa(binary) },
    });
    if (data.error) throw new Error(data.error.message || 'Speech-to-text failed');
    return `${data.results?.[0]?.alternatives?.[0]?.transcript || ''}`.trim();
  } finally {
    ctx.close();
  }
}

/**
 * A microphone button. `onText(text)` gets the transcript; `onState(state)` gets
 * 'listening', 'working' (transcribing a recording), 'idle' or 'error'.
 * Returns null when the browser can do neither kind of voice input.
 */
function voiceButton(config, { onText, onState }) {
  if (!nativeSpeech() && !recordedSpeech()) return null;
  let useNative = nativeSpeech();
  let stop = null;
  const button = el('button', { type: 'button', className: 'sb-voice' });
  const setState = (state) => {
    const listening = state === 'listening';
    const label = listening ? 'Stop listening' : 'Search by voice';
    button.replaceChildren(icon(listening ? 'stop' : 'microphone', 20));
    button.classList.toggle('is-listening', listening);
    button.setAttribute('aria-label', label);
    button.title = label;
    button.disabled = state === 'working';
    onState(state);
  };
  setState('idle');

  const record = async () => {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setState('error');
      return;
    }
    const recorder = new MediaRecorder(stream);
    const chunks = [];
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    ctx.createMediaStreamSource(stream).connect(analyser);
    const levels = new Float32Array(analyser.fftSize);
    const started = performance.now();
    let spoke = false;
    let quietSince = started;
    let frame;
    let send = false;
    const finish = (keep) => {
      if (recorder.state === 'inactive') return;
      send = keep;
      cancelAnimationFrame(frame);
      recorder.stop();
    };
    const watch = () => {
      analyser.getFloatTimeDomainData(levels);
      const loud = Math.sqrt(levels.reduce((sum, v) => sum + v * v, 0) / levels.length) > 0.02;
      const now = performance.now();
      if (loud) {
        spoke = true;
        quietSince = now;
      }
      if ((spoke && now - quietSince > VOICE_SILENCE) || now - started > VOICE_MAX) finish(spoke);
      else if (!spoke && now - started > VOICE_WAIT) finish(false);
      else frame = requestAnimationFrame(watch);
    };
    recorder.addEventListener('dataavailable', (e) => chunks.push(e.data));
    recorder.addEventListener('stop', async () => {
      stream.getTracks().forEach((t) => t.stop());
      ctx.close();
      stop = null;
      if (!send) {
        setState('idle');
        return;
      }
      setState('working');
      try {
        const text = await transcribe(config, new Blob(chunks, { type: recorder.mimeType }));
        setState(text ? 'idle' : 'error');
        if (text) onText(text);
      } catch (err) {
        setState('error');
        // eslint-disable-next-line no-console
        console.error('[searchblox-search] voice search', err);
      }
    });
    recorder.start();
    stop = () => finish(spoke);
    setState('listening');
    watch();
  };

  const listen = () => {
    const recognition = new SpeechRecognitionApi();
    recognition.lang = speechLang();
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    let heard = '';
    let failed = false;
    recognition.addEventListener('result', (e) => {
      heard = e.results[e.results.length - 1][0].transcript.trim();
    });
    recognition.addEventListener('error', (e) => {
      failed = true;
      // The service isn't reachable from this browser: record instead from now on.
      if (['network', 'service-not-allowed', 'language-not-supported'].includes(e.error) && recordedSpeech()) {
        useNative = false;
      }
    });
    recognition.addEventListener('end', () => {
      stop = null;
      if (heard) {
        setState('idle');
        onText(heard);
      } else if (failed && !useNative) {
        record();
      } else {
        setState(failed ? 'error' : 'idle');
      }
    });
    recognition.start();
    stop = () => recognition.stop();
    setState('listening');
  };

  button.addEventListener('click', () => {
    if (stop) stop();
    else if (useNative) listen();
    else record();
  });
  return button;
}

// ------------------------------------------------------------------
// UI
// ------------------------------------------------------------------

function setFacetsShown(root, shown) {
  const toggle = root.querySelector('.sb-facets-toggle');
  const label = `${shown ? 'Hide' : 'Show'} facet filters`;
  root.classList.toggle('sb-facets-open', shown);
  toggle.replaceChildren(icon(shown ? 'filterMinus' : 'filterPlus', 24));
  toggle.setAttribute('aria-expanded', `${shown}`);
  toggle.setAttribute('aria-label', label);
  toggle.title = label;
}

function ensureSkeleton(root, config) {
  if (!root.querySelector('.sb-form')) {
    root.append(
      el(
        'form',
        { className: 'sb-form', role: 'search' },
        el(
          'div',
          { className: 'sb-input-wrap' },
          el('input', { className: 'sb-input', type: 'search', autocomplete: 'off' }),
          el('ul', { className: 'sb-suggestions', role: 'listbox', hidden: true }),
        ),
        el('button', { className: 'sb-submit', type: 'submit' }, 'Search'),
      ),
      el('div', { className: 'sb-status', 'aria-live': 'polite' }),
      el(
        'div',
        { className: 'sb-body' },
        el('aside', { className: 'sb-facets', hidden: true }),
        el(
          'div',
          { className: 'sb-main' },
          el('ol', { className: 'sb-featured', hidden: true }),
          el('ol', { className: 'sb-results' }),
          el('nav', { className: 'sb-pagination', 'aria-label': 'Search results pages' }),
        ),
      ),
    );
  }

  instanceCount += 1;
  const id = `sb-${instanceCount}`;
  const input = root.querySelector('.sb-input');
  const list = root.querySelector('.sb-suggestions');
  input.placeholder = config.placeholder;
  input.setAttribute('aria-label', config.placeholder);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', `${id}-suggestions`);
  input.id = input.id || id;
  const submit = root.querySelector('.sb-submit');
  submit.replaceChildren(icon('search', 20));
  submit.setAttribute('aria-label', 'Search');
  submit.title = 'Search';
  list.id = `${id}-suggestions`;

  // Facets toggle next to the results count, as in the SearchBlox plugin: the
  // sidebar starts hidden on wide layouts. Narrow layouts use the "Filters" section.
  if (!config.resultsPage && !root.querySelector('.sb-facets-toggle')) {
    const status = root.querySelector('.sb-status');
    const toggle = el('button', {
      type: 'button',
      className: 'sb-facets-toggle',
      hidden: true,
      'aria-controls': `${id}-facets`,
      onClick: () => setFacetsShown(root, !root.classList.contains('sb-facets-open')),
    });
    const summary = el('div', { className: 'sb-summary' });
    status.before(summary);
    summary.append(toggle, status, el('div', { className: 'sb-sort', hidden: true }));
    root.querySelector('.sb-facets').id = `${id}-facets`;
    setFacetsShown(root, false);
  }

  // Added here too so the EDS widget's own markup gets them.
  const main = root.querySelector('.sb-main');
  if (main && !main.querySelector('.sb-selected')) {
    main.prepend(el('div', { className: 'sb-selected', hidden: true }));
    root.querySelector('.sb-results').after(el('div', { className: 'sb-empty', hidden: true }));
  }

  // A box-only instance (header search) never shows results.
  if (config.resultsPage) {
    root.classList.add('sb-box-only');
    root.querySelector('.sb-status')?.remove();
    root.querySelector('.sb-body')?.remove();
  }
}

// Sort menu for keyword search, as in the SearchBlox search plugin (hybrid
// search ranks by meaning, so it has none): relevance or date, and for date
// newest or oldest first.
function renderSort(root, config, data, state) {
  const box = root.querySelector('.sb-sort');
  if (!box) return;
  box.hidden = config.vectorWeight > 0 || !data.hits;
  if (box.hidden) {
    box.replaceChildren();
    return;
  }
  const id = `${root.querySelector('.sb-input').id}-sort`;
  const sort = state.sort || (config.sort === 'date' ? 'date' : 'relevance');
  const apply = (next) => root.sbRun({ ...state, page: 1, ...next });
  const select = el('select', {
    id, className: 'sb-sort-select', onChange: (e) => apply({ sort: e.target.value, sortdir: '' }),
  }, SORTS.map(([value, label]) => el('option', { value, selected: value === sort }, label)));
  const direction = (dir, name, label) => el('button', {
    type: 'button',
    className: 'sb-sort-dir',
    title: label,
    'aria-label': label,
    'aria-pressed': `${(state.sortdir || 'desc') === dir}`,
    onClick: () => apply({ sort, sortdir: dir === 'desc' ? '' : dir }),
  }, icon(name, 18));
  // replaceChildren() would render null as text, so filter the empty slot out.
  box.replaceChildren(...[
    el('label', { for: id }, 'Sort by'),
    el('span', { className: 'sb-sort-wrap' }, select, icon('chevronDown', 16)),
    sort === 'date' ? el(
      'span',
      { className: 'sb-sort-dirs', role: 'group', 'aria-label': 'Sort direction' },
      direction('desc', 'sortDesc', 'Newest first'),
      direction('asc', 'sortAsc', 'Oldest first'),
    ) : null,
  ].filter(Boolean));
}

// The selected filters as chips above the results, each removing itself, and
// "Clear all", as in the SearchBlox search plugin.
function renderSelectedFilters(root, config, state) {
  const box = root.querySelector('.sb-selected');
  if (!box) return;
  const chips = config.facets.flatMap(({ field, label }) => values(state.filters[field]).map((value) => el('button', {
    type: 'button',
    className: 'sb-chip',
    title: `Remove filter: ${label}: ${isDateFacet(config, field) ? dateLabel(value) : value}`,
    'aria-label': `Remove filter: ${label}: ${isDateFacet(config, field) ? dateLabel(value) : value}`,
    onClick: () => root.sbRun({
      ...state,
      page: 1,
      filters: {
        ...state.filters,
        [field]: values(state.filters[field]).filter((v) => v !== value),
      },
    }),
  }, el('span', {}, isDateFacet(config, field) ? dateLabel(value) : value), icon('close', 14))));
  box.hidden = !chips.length;
  box.replaceChildren(...(chips.length ? [
    el('button', {
      type: 'button', className: 'sb-chip sb-chip-clear', onClick: () => root.sbRun({ ...state, page: 1, filters: {} }),
    }, 'Clear all'),
    ...chips,
  ] : []));
}

// Shown instead of results when nothing matches: tips, and the most searched
// queries (first page only) as in the SearchBlox search plugin.
function renderEmpty(root, config, data, state) {
  const box = root.querySelector('.sb-empty');
  if (!box) return;
  box.hidden = data.hits > 0;
  if (box.hidden) {
    box.replaceChildren();
    return;
  }
  const filtered = Object.values(state.filters || {}).some((v) => values(v).length);
  const popular = el('div', { className: 'sb-empty-popular', hidden: true });
  box.replaceChildren(
    icon('noResults', 48),
    el(
      'div',
      {},
      el('p', { className: 'sb-empty-title' }, 'No matches found.'),
      el('p', {}, filtered
        ? 'Try removing some filters, checking the spelling or using more general words.'
        : 'Check the spelling or try more general words.'),
      popular,
    ),
  );
  if (!config.topQueries || state.page > 1) return;
  root.sbTopQueries = root.sbTopQueries || topQueries(config).catch(() => []);
  root.sbTopQueries.then((queries) => {
    if (!queries.length || !popular.isConnected) return;
    popular.hidden = false;
    popular.replaceChildren(
      el('p', {}, 'Or search for:'),
      el('ul', {}, queries.map((q) => el('li', {}, el('button', {
        type: 'button', onClick: () => root.sbRun({ query: q, page: 1, filters: {} }),
      }, icon('search', 16), q)))),
    );
  });
}

// LLM-generated fields, as in the SearchBlox plugin. "off": the page's own title
// and description. "replace": the generated ones, with topics. "both": the
// page's own, plus a box with the generated ones. Results still awaiting review
// in the console always show the page's own.
function llmView(config, r) {
  const own = {
    title: r.originalTitle || r.title,
    description: r.originalDescription || r.description,
  };
  if (config.llmFields === 'off' || r.pendingReview) return own;
  if (config.llmFields === 'replace') return { title: r.title, description: r.description, topics: r.topics };
  if (!r.originalTitle && !r.originalDescription) return own;
  return {
    ...own,
    generated: {
      title: r.originalTitle ? r.title : '',
      description: r.originalDescription ? r.description : '',
      topics: r.topics,
    },
  };
}

// Topic chips; with a "topics" facet, picking one filters by it.
function topicList(config, topics, ui) {
  const list = el('ul', { className: 'sb-topics', 'aria-label': 'Topics' });
  const filterable = ui.filter && config.facets.some((f) => f.field === 'topics');
  const show = (all) => list.replaceChildren(
    ...topics.slice(0, all ? undefined : TOPICS_SHOWN).map((topic) => el('li', {}, filterable
      ? el('button', {
        type: 'button', className: 'sb-topic', title: `Filter by topic: ${topic}`, onClick: () => ui.filter('topics', topic.toLowerCase()),
      }, topic)
      : el('span', { className: 'sb-topic' }, topic))),
    topics.length > TOPICS_SHOWN ? el('li', {}, el('button', {
      type: 'button', className: 'sb-link-button sb-topics-more', onClick: () => show(!all),
    }, all ? 'Show less' : `+${topics.length - TOPICS_SHOWN} more`)) : null,
  );
  show(false);
  return list;
}

function syncAssistButton(button, picker) {
  const picked = picker.has(button.sbResult);
  const full = !picked && picker.full();
  button.replaceChildren(icon(picked ? 'check' : 'ai', 16), 'SearchAI Assist');
  button.setAttribute('aria-pressed', `${picked}`);
  button.disabled = full;
  button.title = full ? `Up to ${ASSIST_LIMIT} results can be used at once` : `${picked ? 'Remove from' : 'Add to'} SearchAI Assist`;
}

// The Assist toggle beside a card's title; syncAssist() updates them all in place.
function assistButton(r, picker) {
  const button = el('button', { type: 'button', className: 'sb-assist-pick', onClick: () => picker.toggle(r) });
  button.sbResult = r;
  syncAssistButton(button, picker);
  return button;
}

function syncAssist(root, picker) {
  root.querySelectorAll('.sb-assist-pick').forEach((b) => syncAssistButton(b, picker));
}

// `append` adds the results below the ones shown (load more).
function renderResultList(root, config, data, state, ui, append = false) {
  const resultsEl = root.querySelector('.sb-results');
  const target = config.newTab ? '_blank' : undefined;
  const rel = config.newTab ? 'noopener' : undefined;

  if (!append) resultsEl.setAttribute('start', `${(state.page - 1) * config.pageSize + 1}`);
  resultsEl[append ? 'append' : 'replaceChildren'](...data.results.map((r, i) => {
    const href = safeUrl(r.url);
    const date = formatDate(r.lastmodified);
    const logClick = () => track(config, '/ui/v1/analytics/click', {
      collection: r.col,
      query: state.query,
      title: stripTags(r.title),
      uid: r.uid,
      url: r.url,
      pcode: getPcode() || undefined,
      pos: r.position || (state.page - 1) * config.pageSize + i + 1,
      page: state.page,
      pageSize: config.pageSize,
    });
    const opened = () => {
      logClick();
      ui.onOpen?.(r);
    };
    const shown = llmView(config, r);
    const picker = ui.assist && r.uid && !ASSIST_SKIP.test(r.contenttype) ? ui.assist : null;
    const detail = (name, label, ...content) => el('span', { className: 'sb-result-detail', title: label }, icon(name, 16), ...content);
    // A card like the SearchBlox plugin's: title (with the Assist toggle), description,
    // URL and thumbnail, then a strip with the date, file type and collection.
    return el(
      'li',
      { className: 'sb-result' },
      el(
        'div',
        { className: 'sb-result-content' },
        el(
          'div',
          { className: 'sb-result-fields' },
          el(
            'div',
            { className: 'sb-result-heading' },
            el(
              'h3',
              { className: 'sb-result-title' },
              href ? el('a', {
                href,
                target,
                rel,
                onClick: opened,
                // Middle-click opens a new tab without a click event.
                onAuxclick: (e) => e.button === 1 && opened(),
              }, highlighted(shown.title)) : highlighted(shown.title),
            ),
            picker ? assistButton(r, picker) : null,
            // As in the plugin: web pages, for a real query.
            ui.moreLikeThis && r.uid && r.contenttype.toLowerCase() === 'html' && state.query !== '*'
              ? el('button', {
                type: 'button',
                className: 'sb-mlt',
                title: 'More like this',
                'aria-label': `More like ${stripTags(shown.title)}`,
                onClick: () => ui.moreLikeThis(r),
              }, icon('related', 16))
              : null,
          ),
          // Both are cut short by CSS; the tooltip shows the full text.
          shown.description ? el('p', { className: 'sb-result-desc', title: stripTags(shown.description) }, highlighted(shown.description)) : null,
          href && config.urlDisplay ? el('div', { className: 'sb-result-url', title: href }, href) : null,
          shown.topics?.length ? topicList(config, shown.topics, ui) : null,
        ),
        r.thumbnail ? el('img', {
          className: 'sb-result-thumb', src: r.thumbnail, alt: '', loading: 'lazy', onError: (e) => e.target.remove(),
        }) : null,
      ),
      shown.generated ? el(
        'div',
        { className: 'sb-llm' },
        el('p', { className: 'sb-llm-label' }, icon('ai', 16), 'LLM-generated'),
        shown.generated.title ? el('p', { className: 'sb-llm-title' }, highlighted(shown.generated.title)) : null,
        shown.generated.description ? el('p', { className: 'sb-llm-desc' }, highlighted(shown.generated.description)) : null,
        shown.generated.topics.length ? topicList(config, shown.generated.topics, ui) : null,
      ) : null,
      date || r.contenttype || r.colname ? el(
        'div',
        { className: 'sb-result-details' },
        date ? detail('calendar', 'Last modified', el('time', { datetime: r.lastmodified }, date)) : null,
        r.contenttype ? detail('file', 'Content type', r.contenttype.toLowerCase()) : null,
        r.colname ? detail('layers', 'Collection', r.colname) : null,
      ) : null,
    );
  }));
}

// A date facet: "Any time", the presets (with counts for keyword search) and
// "Custom range", which shows From and To date fields and an Apply button.
function dateFacet(facet, {
  selected, showCounts, id, apply,
}) {
  const custom = Boolean(selected) && !DATE_PRESETS.some(([k]) => k === selected);
  const [from, to] = custom ? selected.split('..') : ['', ''];
  // The counted ranges come back oldest first; match each preset by its start.
  const now = Date.now();
  const countOf = (key) => {
    const start = presetStart(key, now).getTime();
    return facet.items.find((item) => Math.abs(new Date(item.from.replace(/Z$/, '')).getTime() - start) < 5 * 60000)?.count;
  };
  // With a range applied, the server counts within it, so counts would mislead.
  const counted = showCounts && !selected;
  const range = el('div', { className: 'sb-date-range', hidden: !custom });
  const option = (value, label, count) => el('li', {}, el(
    'label',
    { className: `sb-facet-option${value && value === (custom ? 'custom' : selected) ? ' is-active' : ''}` },
    el('input', {
      type: 'radio',
      name: id,
      value,
      checked: value === (custom ? 'custom' : selected),
      'data-key': `${facet.field}:${value}`,
      onChange: () => {
        if (value === 'custom') {
          range.hidden = false;
          range.querySelector('input').focus();
        } else {
          apply(value);
        }
      },
    }),
    el('span', { className: 'sb-facet-name' }, label),
    counted && count !== undefined ? el('span', { className: 'sb-count' }, count.toLocaleString()) : null,
  ));
  const today = sbTime(new Date()).slice(0, 10);
  const field = (label, value) => el('label', {}, label, el('input', {
    type: 'date', className: 'sb-date-input', value, max: today,
  }));
  const fromField = field('From', from);
  const toField = field('To', to);
  const [fromInput, toInput] = [fromField, toField].map((f) => f.querySelector('input'));
  const applyButton = el('button', { type: 'button', className: 'sb-date-apply' }, 'Apply');
  const check = () => {
    applyButton.disabled = (!fromInput.value && !toInput.value)
      || Boolean(fromInput.value && toInput.value && fromInput.value > toInput.value);
    toInput.min = fromInput.value;
  };
  [fromInput, toInput].forEach((input) => input.addEventListener('input', check));
  applyButton.addEventListener('click', () => apply(`${fromInput.value}..${toInput.value}`));
  check();
  range.append(fromField, toField, applyButton);

  return el(
    'div',
    { className: 'sb-facet' },
    el('h4', { id }, facet.label),
    el(
      'ul',
      { role: 'radiogroup', 'aria-labelledby': id },
      option('', 'Any time'),
      DATE_PRESETS.map(([key, label]) => option(key, label, countOf(key))),
      option('custom', 'Custom range'),
    ),
    range,
  );
}

// On narrow layouts, as in the SearchBlox plugin, picks are held in `draft`
// until Apply (or dropped with Cancel) instead of searching on each one.
function renderFacets(root, config, data, state, draft = null) {
  const facetsEl = root.querySelector('.sb-facets');
  const narrow = root.clientWidth < WIDE_LAYOUT;
  const filters = draft || state.filters;
  const selectedIn = (field) => values(filters[field]);
  // Hybrid search counts facet values over a wider match set than the results it
  // returns (e.g. 232 next to 50 results), so counts are only shown for keyword search.
  const showCounts = config.vectorWeight === 0;
  const groups = config.facets
    .map((facet) => ({ ...facet, items: data.facets[facet.field] || [] }))
    .filter((facet) => facet.items.length || selectedIn(facet.field).length);

  // Filtering re-renders the sidebar; keep keyboard focus on the same option.
  const focused = document.activeElement;
  const focusedKey = facetsEl.contains(focused) ? focused.dataset.key : undefined;
  facetsEl.hidden = groups.length === 0;
  const toggle = root.querySelector('.sb-facets-toggle');
  if (toggle) toggle.hidden = facetsEl.hidden;
  const activeCount = config.facets.reduce((n, { field }) => n + selectedIn(field).length, 0);
  const details = el(
    'details',
    { className: 'sb-filters' },
    el('summary', {}, activeCount ? `Filters (${activeCount})` : 'Filters'),
  );
  // Collapsed on narrow layouts so results stay above the fold; CSS hides the
  // summary on wide layouts where the facets sit in a sidebar.
  details.open = root.clientWidth >= WIDE_LAYOUT || facetsEl.querySelector('details')?.open === true;
  facetsEl.replaceChildren(details);

  const instance = root.querySelector('.sb-input').id;
  // How many values each facet shows and its search text, kept across re-renders
  // for the same query.
  if (root.sbFacetView?.query !== state.query) {
    root.sbFacetView = { query: state.query, fields: {} };
  }
  // Builds on the latest search, which may not have rendered yet, so a quick
  // second pick keeps the first.
  const apply = (field, next) => {
    if (narrow) {
      renderFacets(root, config, data, state, { ...filters, [field]: next });
      return;
    }
    const base = root.sbCurrent || state;
    root.sbRun({ ...base, page: 1, filters: { ...base.filters, [field]: next } });
  };

  // Checkbox facets take any number of values; the rest are radios with "All".
  details.append(...groups.map((facet) => {
    const { field } = facet;
    if (isDateFacet(config, field)) {
      return dateFacet(facet, {
        selected: selectedIn(field)[0] || '', showCounts, id: `${instance}-facet-${field}`, apply: (v) => apply(field, values(v)),
      });
    }
    const selected = selectedIn(field);
    const multi = config.checkboxFacets.includes(field);
    const headingId = `${instance}-facet-${field}`;
    const option = (value, label, count) => {
      const active = value ? selected.includes(value) : selected.length === 0;
      return el(
        'li',
        {},
        el(
          'label',
          { className: `sb-facet-option${active && value ? ' is-active' : ''}` },
          el('input', {
            type: multi ? 'checkbox' : 'radio',
            name: `${instance}-${field}`,
            value,
            checked: active,
            'data-key': `${field}:${value}`,
            onChange: () => {
              if (!multi) apply(field, values(value));
              else if (active) apply(field, selected.filter((v) => v !== value));
              else apply(field, [...selected, value]);
            },
          }),
          el('span', { className: 'sb-facet-name' }, label),
          showCounts && count !== undefined ? el('span', { className: 'sb-count' }, count.toLocaleString()) : null,
        ),
      );
    };
    const view = root.sbFacetView.fields[field] || { shown: FACET_SHOWN, search: '' };
    root.sbFacetView.fields[field] = view;
    const list = el('ul', { role: multi ? 'group' : 'radiogroup', 'aria-labelledby': headingId });
    const more = el('div', { className: 'sb-facet-more' });

    // Redraws only this facet's list (no new search). Selected values stay
    // visible even beyond the shown count.
    const draw = (focusAction) => {
      const term = view.search.trim().toLowerCase();
      const matches = facet.items.filter((item) => item.value.toLowerCase().includes(term));
      const visible = matches.slice(0, view.shown);
      const hiddenSelected = matches
        .filter((item) => selected.includes(item.value) && !visible.includes(item));
      // replaceChildren() would render null as text, so filter the empty slots out.
      list.replaceChildren(...[
        multi ? null : option('', 'All'),
        ...[...visible, ...hiddenSelected]
          .map((item) => option(item.value, item.value, item.count)),
        matches.length ? null : el('li', { className: 'sb-facet-empty' }, 'No filters found.'),
      ].filter(Boolean));
      const step = (action, label, shown) => el('button', {
        type: 'button',
        className: 'sb-link-button',
        'data-action': action,
        onClick: () => {
          view.shown = shown;
          draw(action);
        },
      }, label);
      more.replaceChildren(...[
        matches.length > view.shown ? step('more', 'Show more', view.shown + FACET_SHOWN) : null,
        view.shown > FACET_SHOWN && matches.length > FACET_SHOWN
          ? step('less', 'Show less', Math.max(FACET_SHOWN, view.shown - FACET_SHOWN)) : null,
        multi && selected.length ? el('button', {
          type: 'button',
          className: 'sb-link-button',
          onClick: () => apply(field, []),
        }, 'Clear') : null,
      ].filter(Boolean));
      // Keep focus on the button pressed, or the other one if it's gone.
      if (focusAction) (more.querySelector(`[data-action="${focusAction}"]`) || more.querySelector('button'))?.focus();
    };
    draw();

    return el(
      'div',
      { className: 'sb-facet' },
      el('h4', { id: headingId }, facet.label),
      facet.items.length > FACET_SEARCH_MIN ? el('input', {
        type: 'search',
        className: 'sb-facet-search',
        placeholder: 'Search',
        'aria-label': `Search ${facet.label}`,
        autocomplete: 'off',
        value: view.search,
        onInput: (e) => {
          view.search = e.target.value;
          draw();
        },
      }) : null,
      list,
      more,
    );
  }));

  const pending = draft && config.facets
    .some(({ field }) => `${values(draft[field])}` !== `${values(state.filters[field])}`);
  if (pending) {
    details.append(el(
      'div',
      { className: 'sb-filters-actions' },
      el('button', {
        type: 'button', className: 'sb-link-button', onClick: () => renderFacets(root, config, data, state),
      }, 'Cancel'),
      el('button', {
        type: 'button',
        className: 'sb-date-apply',
        onClick: () => root.sbRun({ ...(root.sbCurrent || state), page: 1, filters: draft }),
      }, 'Apply'),
    ));
  }

  if (focusedKey) {
    [...facetsEl.querySelectorAll('input')].find((input) => input.dataset.key === focusedKey)?.focus();
  }
}

function renderPagination(root, config, data, state) {
  const nav = root.querySelector('.sb-pagination');
  const last = Math.max(1, data.lastPage || Math.ceil(data.hits / config.pageSize));
  if (last <= 1 || (config.loadMore && state.page >= last)) {
    nav.replaceChildren();
    return;
  }

  // Load more, as in the SearchBlox search plugin: the next page is added below.
  if (config.loadMore) {
    nav.replaceChildren(el('button', {
      type: 'button',
      className: 'sb-load-more',
      onClick: (e) => {
        e.currentTarget.disabled = true;
        e.currentTarget.setAttribute('aria-busy', 'true');
        e.currentTarget.replaceChildren(el('span', { className: 'sb-spinner', 'aria-hidden': 'true' }), 'Loading…');
        root.sbRun({ ...state, page: state.page + 1 }, { append: true });
      },
    }, 'Load more'));
    return;
  }

  const go = (page) => () => {
    root.sbRun({ ...state, page });
    root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const pageButton = (page) => el('button', {
    type: 'button',
    className: `sb-page${page === state.page ? ' is-active' : ''}`,
    'aria-current': page === state.page ? 'page' : undefined,
    onClick: go(page),
  }, `${page}`);

  // As in the SearchBlox plugin: up to 5 pages around the current one, and no
  // previous/next button on the first/last page.
  const start = Math.max(1, Math.min(state.page - PAGE_WINDOW, last - PAGE_WINDOW * 2));
  const end = Math.min(last, start + PAGE_WINDOW * 2);
  const pages = [];
  for (let p = start; p <= end; p += 1) pages.push(pageButton(p));

  nav.replaceChildren(...[
    state.page > 1 ? el('button', {
      type: 'button', className: 'sb-page sb-page-step', 'aria-label': 'Previous page', title: 'Previous page', onClick: go(state.page - 1),
    }, icon('chevronLeft', 20)) : null,
    ...pages,
    state.page < last ? el('button', {
      type: 'button', className: 'sb-page sb-page-step', 'aria-label': 'Next page', title: 'Next page', onClick: go(state.page + 1),
    }, icon('chevronRight', 20)) : null,
  ].filter(Boolean));
}

// `ui` connects the cards to the mount: onOpen(result) when one is opened,
// filter(field, value) for topic chips, and the Assist selection when it's on.
function renderResults(root, config, data, state, ui = {}) {
  const status = root.querySelector('.sb-status');
  const featuredEl = root.querySelector('.sb-featured');
  const target = config.newTab ? '_blank' : undefined;
  const rel = config.newTab ? 'noopener' : undefined;

  const query = el('strong', {}, el('em', {}, state.query));
  const count = `${data.hits.toLocaleString()} result${data.hits === 1 ? '' : 's'}`;
  // "*" (an empty search) lists everything, so there's no query to name.
  if (state.query === '*') status.replaceChildren(data.hits ? count : 'No results.');
  else status.replaceChildren(...(data.hits ? [`${count} for `, query] : ['No results for ', query, '.']));
  root.classList.toggle('sb-no-highlight', !data.highlight);
  // The page title leads with the query, as the plugin's does, keeping the site's own.
  if (config.syncUrl) {
    document.title = state.query === '*' ? baseTitle : `${state.query} – ${baseTitle}`;
  }
  // More like this: say which page, and offer the way back.
  if (state.mlt) {
    const like = el('strong', {}, el('em', {}, state.mlt.title || 'the selected page'));
    status.replaceChildren(
      `${data.hits.toLocaleString()} result${data.hits === 1 ? '' : 's'} like `,
      like,
      '. ',
      el('button', {
        type: 'button',
        className: 'sb-link-button',
        onClick: () => root.sbRun({ ...state, page: 1, mlt: null }),
      }, `Back to results for ${state.query}`),
    );
  } else if (state.original) {
    // After a search with no results was retried (see mount): say what was searched.
    status.append(`${data.hits ? '.' : ''} No results for `, el('strong', {}, el('em', {}, state.original)), '.');
    if (state.retry === 'suggest') {
      status.append(' ', el('button', {
        type: 'button',
        className: 'sb-link-button',
        onClick: () => root.sbRun({
          ...state, query: state.original, page: 1, original: '', retry: 'none',
        }),
      }, `Search for ${state.original} instead`));
    }
  } else if (data.hits && data.suggest
    && data.suggest.toLowerCase() !== state.query.toLowerCase()) {
    status.append(' Did you mean ', el('button', {
      type: 'button',
      className: 'sb-link-button',
      onClick: () => root.sbRun({ query: data.suggest, page: 1, filters: {} }),
    }, data.suggest), '?');
  }
  renderSort(root, config, data, state);
  renderSelectedFilters(root, config, state);
  renderEmpty(root, config, data, state);

  // Featured results (`featured`), on page 1 of a real query, as in the plugin.
  const featured = config.featured && state.page === 1 && state.query !== '*'
    ? data.featured.filter((f) => f.title || safeUrl(f.url)) : [];
  featuredEl.hidden = featured.length === 0;
  featuredEl.replaceChildren(...featured.map((f) => el(
    'li',
    { className: 'sb-featured-item' },
    f.image && safeUrl(f.image) ? el('img', {
      src: safeUrl(f.image), alt: '', loading: 'lazy', onError: (e) => e.target.remove(),
    }) : null,
    el(
      'div',
      {},
      el('span', { className: 'sb-badge' }, 'Featured'),
      safeUrl(f.url) ? el('a', {
        href: safeUrl(f.url),
        target,
        rel,
        onClick: () => track(config, '/ui/v1/analytics/fr', { uid: f.uid, query: state.query }),
      }, f.title || displayUrl(f.url)) : el('strong', {}, f.title),
      f.description ? el('p', {}, f.description) : null,
    ),
  )));

  if (featured.length) {
    track(config, '/ui/v1/featured-result/display-count', { uids: featured.map((f) => f.uid) });
  }

  renderResultList(root, config, data, state, ui);
  renderFacets(root, config, data, state);
  renderPagination(root, config, data, state);
}

// The AI overview and SmartFAQs go between the search box and the results count,
// above the facets and results: filtering doesn't change them.
const resultsTop = (root) => root.querySelector('.sb-summary') || root.querySelector('.sb-status');

// `ai` is null while loading, or the parsed overview plus how long it took.
// Laid out like the SearchBlox plugin's: header with regenerate, answer, Key
// Points, sources, related questions and the generation time.
function renderOverview(root, config, ai, regenerate) {
  let panel = root.querySelector('.sb-ai');
  if (!panel) {
    panel = el('section', { className: 'sb-ai', 'aria-labelledby': `${root.querySelector('.sb-input').id}-ai` });
    (root.querySelector('.sb-faqs') || root.querySelector('.sb-recs') || resultsTop(root)).before(panel);
  }
  const heading = el(
    'div',
    { className: 'sb-ai-header' },
    el('h2', { className: 'sb-ai-title', id: `${root.querySelector('.sb-input').id}-ai` }, icon('ai'), 'AI Overview'),
    ai && regenerate ? el('button', {
      type: 'button',
      className: 'sb-ai-regenerate',
      'aria-label': 'Regenerate answer',
      title: 'Regenerate answer',
      onClick: regenerate,
    }, icon('regenerate')) : null,
  );

  if (!ai) {
    panel.hidden = false;
    panel.setAttribute('aria-busy', 'true');
    panel.replaceChildren(
      heading,
      el('p', { className: 'sb-ai-status' }, 'Generating an answer…'),
      el('div', { className: 'sb-ai-loading', 'aria-hidden': 'true' }, el('span'), el('span'), el('span')),
    );
    return;
  }

  panel.removeAttribute('aria-busy');
  panel.hidden = !ai.overview;
  if (!ai.overview) {
    panel.replaceChildren();
    return;
  }
  const target = config.newTab ? '_blank' : undefined;
  const rel = config.newTab ? 'noopener' : undefined;
  panel.replaceChildren(...[heading,
    el('div', { className: 'sb-ai-text' }, markdown(ai.overview)),
    ai.keyPoints.length ? el(
      'div',
      { className: 'sb-ai-keypoints' },
      el('h3', {}, 'Key Points'),
      el('ul', { className: 'sb-ai-points' }, ai.keyPoints.map((point) => el('li', {}, point))),
    ) : null,
    ai.sources.length ? el(
      'div',
      { className: 'sb-ai-sources' },
      el('h3', {}, 'Sources'),
      el('ol', {}, ai.sources.map((s) => el('li', {}, el('a', { href: s.url, target, rel }, s.title)))),
    ) : null,
    ai.followups.length ? el(
      'div',
      { className: 'sb-ai-followups' },
      el('h3', {}, 'Related questions'),
      el('ul', {}, ai.followups.map((q) => el('li', {}, el('button', {
        type: 'button',
        onClick: () => root.sbRun({ query: q, page: 1, filters: {} }),
      }, icon('followup', 16), q)))),
    ) : null,
    ai.duration ? el('p', { className: 'sb-ai-time' }, icon('stopwatch', 14), `Generated in ${ai.duration}`) : null,
  ].filter(Boolean));
}

// One FAQ as a <details>; FAQs sharing `group` open one at a time.
// Answers keep the search's highlighting, as in the SearchBlox plugin.
function faqItem(config, query, faq, group, open = false) {
  const long = stripTags(faq.answer).length > FAQ_ANSWER_CHARS;
  const answerText = el('span', {}, highlightedClip(faq.answer, FAQ_ANSWER_CHARS));
  const details = el(
    'details',
    { className: 'sb-faq', name: group, open },
    el('summary', {}, el('span', {}, highlighted(faq.question))),
    el(
      'div',
      { className: 'sb-faq-body' },
      el('p', {}, answerText, long ? ' ' : null, long ? el('button', {
        type: 'button',
        className: 'sb-link-button',
        'aria-expanded': 'false',
        onClick: (e) => {
          const more = e.currentTarget.getAttribute('aria-expanded') !== 'true';
          answerText.replaceChildren(more
            ? highlighted(faq.answer)
            : highlightedClip(faq.answer, FAQ_ANSWER_CHARS));
          e.currentTarget.setAttribute('aria-expanded', `${more}`);
          e.currentTarget.textContent = more ? 'Show less' : 'Show more';
        },
      }, 'Show more') : null),
      faq.url ? el('a', {
        className: 'sb-faq-url',
        href: faq.url,
        target: '_blank',
        rel: 'noopener',
        onClick: () => faqAction(config, query, faq.uid, 'click'),
      }, displayUrl(faq.url)) : null,
      // Votes are feedback the visitor chooses to give, so they're sent even with analytics off.
      votes((action) => postJson(`${config.domain}/rest/v2/api/smart-faq/action`, {
        uid: faq.uid, action, query, pcode: getPcode() || undefined,
      })),
    ),
  );
  // Also fires for a FAQ rendered open, which counts as opening it.
  details.addEventListener('toggle', () => {
    if (details.open) faqAction(config, query, faq.uid, 'open');
  });
  return details;
}

// The SmartFAQs section above the results. `selected` is the FAQ picked from the
// suggestions, shown open at the top.
function renderFaqs(root, config, query, { faqs, selected }) {
  const id = `${root.querySelector('.sb-input').id}-faqs`;
  let section = root.querySelector('.sb-faqs');
  if (!section) {
    section = el('section', { className: 'sb-faqs', 'aria-labelledby': id });
    (root.querySelector('.sb-recs') || resultsTop(root)).before(section);
  }
  const others = faqs.filter((f) => f.uid !== selected?.uid);
  section.hidden = !selected && !others.length;
  if (section.hidden) {
    section.replaceChildren();
    return;
  }

  const list = el('ul', { className: 'sb-faq-list' });
  const showAll = el('button', { type: 'button', className: 'sb-link-button sb-faq-all' }, 'Show all');
  let shown = 0;
  const reveal = (count) => {
    const next = others.slice(shown, count);
    list.append(...next.map((faq) => el('li', {}, faqItem(config, query, faq, id))));
    faqShown(config, query, next);
    shown = Math.max(shown, Math.min(count, others.length));
    showAll.hidden = shown >= others.length;
  };
  showAll.addEventListener('click', () => reveal(others.length));
  section.replaceChildren(...[
    el('h2', { className: 'sb-faqs-title', id }, icon('help'), 'SmartFAQs'),
    selected ? faqItem(config, query, selected, id, true) : null,
    list,
    showAll,
  ].filter(Boolean));
  if (selected) faqShown(config, query, [selected]);
  reveal(FAQ_SHOWN);
}

// AI recommendations, between the SmartFAQs and the results. `recs` is
// { items, sessionId, previous: [uids] } or null; `loading` shows placeholders
// (or a note beside the heading while earlier recommendations are shown);
// `fresh` announces a new set for 5 seconds, as the plugin does.
function renderRecommendations(root, config, recs, { loading, fresh, query }) {
  const id = `${root.querySelector('.sb-input').id}-recs`;
  let section = root.querySelector('.sb-recs');
  if (!section) {
    section = el('section', { className: 'sb-recs', 'aria-labelledby': id });
    resultsTop(root).before(section);
  }
  const items = recs?.items || [];
  section.hidden = !loading && !items.length;
  if (section.hidden) {
    section.replaceChildren();
    return;
  }
  const previous = recs?.previous || [];
  const target = config.newTab ? '_blank' : undefined;
  const rel = config.newTab ? 'noopener' : undefined;
  section.setAttribute('aria-busy', `${Boolean(loading)}`);
  clearTimeout(root.sbRecsNotice);
  if (fresh) {
    root.sbRecsNotice = setTimeout(() => section.querySelector('.sb-recs-notice')?.remove(), 5000);
  }
  section.replaceChildren(
    el(
      'h2',
      { className: 'sb-ai-title', id },
      icon('ai'),
      'Personalized AI-Recommended Results',
      loading && items.length ? el('span', { className: 'sb-recs-updating' }, 'Updating…') : null,
      fresh ? el('span', { className: 'sb-recs-notice', role: 'status' }, 'New recommendations') : null,
    ),
    items.length ? el('ul', { className: 'sb-recs-list' }, items.map((r, i) => {
      const href = safeUrl(r.url);
      const date = formatDate(r.lastmodified);
      const isNew = previous.length > 0 && !previous.includes(r.uid);
      // Logged as a recommendation click and, as in the plugin, a result click.
      const open = () => {
        trackRecommendation(config, {
          sessionId: recs.sessionId,
          recommendationId: r.id,
          position: i + 1,
          collections: [r.colname],
          query,
          url: r.url,
        });
        track(config, '/ui/v1/analytics/click', {
          collection: r.col,
          query,
          title: stripTags(r.title),
          uid: r.uid,
          url: r.url,
          pcode: getPcode() || undefined,
          pos: i + 1,
          page: 1,
        });
      };
      return el(
        'li',
        { className: 'sb-rec' },
        el(
          'h3',
          { className: 'sb-result-title' },
          href ? el('a', {
            href, target, rel, onClick: open, onAuxclick: (e) => e.button === 1 && open(),
          }, highlighted(r.title)) : highlighted(r.title),
          isNew ? el('span', { className: 'sb-rec-new' }, icon('sparkles', 14), 'New') : null,
        ),
        r.description ? el('p', { className: 'sb-result-desc', title: stripTags(r.description) }, stripTags(r.description)) : null,
        href && config.urlDisplay ? el('div', { className: 'sb-result-url', title: href }, href) : null,
        date || r.contenttype || r.colname ? el(
          'div',
          { className: 'sb-rec-details' },
          date ? el('span', { className: 'sb-result-detail', title: 'Last modified' }, icon('calendar', 14), date) : null,
          r.contenttype ? el('span', { className: 'sb-result-detail', title: 'Content type' }, icon('file', 14), r.contenttype.toLowerCase()) : null,
          r.colname ? el('span', { className: 'sb-result-detail', title: 'Collection' }, icon('layers', 14), r.colname) : null,
        ) : null,
      );
    })) : el('div', { className: 'sb-ai-loading', 'aria-label': 'Finding recommendations' }, el('span'), el('span'), el('span')),
  );
}

function wireSuggestions(root, config, submit) {
  const input = root.querySelector('.sb-input');
  const list = root.querySelector('.sb-suggestions');
  let timer;
  let controller;
  let active = -1;
  let typed = '';

  let picks = [];

  const close = () => {
    list.hidden = true;
    list.replaceChildren();
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };

  // Logs which suggestion was picked for what the visitor had typed.
  const pick = (text) => {
    track(config, '/ui/v1/analytics/suggest', { query: typed.replace(/['"]+/g, ''), suggestion: text });
    input.value = text;
    close();
    submit(text);
  };
  // A SmartFAQ searches for its question and opens it above the results.
  const pickFaq = (faq) => {
    const question = stripTags(faq.question);
    input.value = question;
    close();
    submit(question, faq.uid);
  };

  const setActive = (index) => {
    const items = [...list.querySelectorAll('[role="option"]')];
    if (!items.length) return;
    active = (index + items.length) % items.length;
    items.forEach((item, i) => item.setAttribute('aria-selected', i === active ? 'true' : 'false'));
    input.setAttribute('aria-activedescendant', items[active].id);
  };

  // Suggestions, then SmartFAQs, each under a heading when both are shown;
  // `trending` lists trending searches instead.
  const show = (items, faqs = [], trending = []) => {
    if (!items.length && !faqs.length && !trending.length) {
      close();
      return;
    }
    picks = [];
    const option = (label, onPick) => {
      picks.push(onPick);
      return el('li', {
        id: `${list.id}-${picks.length - 1}`,
        role: 'option',
        'aria-selected': 'false',
        // mousedown fires before the input's blur, so the click isn't lost.
        onMousedown: (e) => {
          e.preventDefault();
          onPick();
        },
      }, label);
    };
    const heading = (name, label) => el('li', { role: 'presentation', className: 'sb-suggest-heading' }, icon(name, 16), label);
    list.replaceChildren(...[
      trending.length ? heading('trending', 'Trending searches') : null,
      ...trending.map((text) => option(text, () => pick(text))),
      faqs.length && items.length ? heading('search', 'Suggestions') : null,
      ...items.map((text) => option(matchHighlight(text, typed), () => pick(text))),
      faqs.length ? heading('help', 'SmartFAQs') : null,
      ...faqs.map((faq) => option(
        matchHighlight(stripTags(faq.question), typed),
        () => pickFaq(faq),
      )),
    ].filter(Boolean));
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    active = -1;
  };

  // Trending searches while the box is empty, fetched once.
  let trending;
  const showTrending = () => {
    if (!config.trending || input.value.trim()) return;
    trending = trending || trendingSearches(config).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[searchblox-search] trending searches', err);
      return [];
    });
    trending.then((items) => {
      if (document.activeElement === input && !input.value.trim()) show([], [], items);
    });
  };
  input.addEventListener('focus', showTrending);

  input.addEventListener('input', () => {
    clearTimeout(timer);
    controller?.abort();
    const query = input.value.trim();
    typed = query;
    if (!query) {
      close();
      showTrending();
      return;
    }
    if (query.length < SUGGEST_MIN || !config.autosuggest) {
      close();
      return;
    }
    timer = setTimeout(() => {
      controller = new AbortController();
      // Either list failing just leaves it out.
      const orNone = (err) => {
        if (err.name === 'AbortError') throw err;
        return [];
      };
      Promise.all([
        suggest(config, query, controller.signal).catch(orNone),
        config.smartFaqs && query.length >= FAQ_SUGGEST_MIN
          ? smartFaqs(config, query, FAQ_SUGGEST, controller.signal).catch(orNone) : [],
      ])
        .then(([items, faqs]) => show(items.slice(0, config.suggestLimit), faqs))
        .catch(() => {});
    }, SUGGEST_DELAY);
  });

  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(active + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(active - 1);
    } else if (e.key === 'Escape') {
      // Native type="search" clears the field on Escape; only dismiss the list.
      e.preventDefault();
      close();
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      picks[active]();
    }
  });

  input.addEventListener('blur', close);
  return close;
}

// ------------------------------------------------------------------
// SearchAI Assist
// ------------------------------------------------------------------

const ASSIST_ICONS = {
  summarize: 'summarize', compare: 'bulb', analyze: 'bulb', explain: 'explain', highlights: 'sparkles',
};
const plural = (n) => `${n} ${n === 1 ? 'file/URL' : 'files/URLs'} selected`;

// Visible text of an answer for "Copy text"; tables become tab-separated rows.
function plainText(node) {
  const copy = node.cloneNode(true);
  copy.querySelectorAll('tr').forEach((tr) => tr.replaceWith(`${[...tr.children].map((c) => c.textContent.trim()).join('\t')}\n`));
  copy.querySelectorAll('p, li, h3, hr').forEach((n) => n.append('\n'));
  return copy.textContent.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * SearchAI Assist, as in the SearchBlox search plugin: results are picked with
 * the button on each card (up to 4) and gather in a tray at the bottom left;
 * Proceed opens a dialog offering the server's actions (summarize, compare,
 * explain, ...) or a prompt of the visitor's own, with follow-up prompts after.
 * `onChange` runs whenever the selection changes. Returns the picker that the
 * cards use: { has, full, toggle, clear }.
 */
function mountAssist(config, onChange) {
  instanceCount += 1;
  const id = `sb-${instanceCount}-assist`;
  let selected = [];
  let prompts;
  let operation = '';
  let controller;
  let waitTimer;

  const same = (a, b) => a.uid === b.uid && a.col === b.col;
  // The page's own title: generated titles of similar pages can be identical.
  const docTitle = (r) => stripTags(r.originalTitle || r.title);
  const docLink = (r, className) => {
    const href = safeUrl(r.url);
    const label = docTitle(r);
    return href ? el('a', {
      href, target: '_blank', rel: 'noopener', className, title: label,
    }, label) : el('span', { className, title: label }, label);
  };
  // Its clicks are handled on the lists (below), which know `toggle`.
  const removeButton = (r) => {
    const button = el('button', {
      type: 'button', className: 'sb-assist-remove', 'aria-label': `Remove ${docTitle(r)}`, title: 'Remove',
    }, icon('close', 16));
    button.sbResult = r;
    return button;
  };

  // Tray
  const trayList = el('ul', { className: 'sb-assist-docs' });
  const trayCount = el('p', { className: 'sb-assist-count' });
  const tray = el(
    'section',
    {
      className: 'sb-assist-tray', 'aria-labelledby': `${id}-tray`, hidden: true,
    },
    el(
      'header',
      { className: 'sb-assist-header' },
      el('h2', { id: `${id}-tray` }, icon('ai'), 'SearchAI Assist'),
      el('button', {
        type: 'button', className: 'sb-assist-icon sb-assist-clear', 'aria-label': 'Clear selection', title: 'Clear selection',
      }, icon('close')),
    ),
    trayList,
    trayCount,
    el(
      'div',
      { className: 'sb-assist-actions' },
      el('button', { type: 'button', className: 'sb-link-button sb-assist-cancel' }, 'Cancel'),
      el('button', { type: 'button', className: 'sb-settings-apply sb-assist-proceed' }, 'Proceed'),
    ),
  );

  // Dialog
  const log = el('div', { className: 'sb-assist-log', role: 'log', 'aria-live': 'polite' });
  const input = el('textarea', {
    className: 'sb-assist-input', rows: 2, placeholder: 'Enter your prompt here...', 'aria-label': 'Your prompt',
  });
  const send = el('button', {
    type: 'submit', className: 'sb-submit', 'aria-label': 'Send', title: 'Send',
  }, icon('send', 20));
  const compose = el('div', { className: 'sb-assist-compose', hidden: true }, input, send);
  const docs = el('ul', { className: 'sb-assist-docs sb-assist-chosen' });
  const count = el('span', { className: 'sb-assist-selected' });
  const dialog = el(
    'dialog',
    { className: 'sb-assist', 'aria-labelledby': `${id}-title` },
    el(
      'header',
      { className: 'sb-assist-header' },
      el('h2', { id: `${id}-title` }, icon('ai'), 'SearchAI Assist', count),
      el('button', {
        type: 'button', className: 'sb-assist-icon sb-assist-restart', 'aria-label': 'Start over', title: 'Start over',
      }, icon('reload')),
      el('button', {
        type: 'button', className: 'sb-assist-icon', 'aria-label': 'Close SearchAI Assist', title: 'Close', onClick: () => dialog.close(),
      }, icon('close')),
    ),
    log,
    el('form', { className: 'sb-assist-form' }, compose, docs),
  );
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      dialog.querySelector('.sb-assist-form').requestSubmit();
    }
  });

  const host = el('div', { className: 'searchblox-search sb-assist-host' }, tray, dialog);
  document.body.append(host);
  applyTheme(host, config);

  // Answers scroll to their start, so a long one reads from the top.
  const add = (node, block = 'nearest') => {
    log.append(node);
    node.scrollIntoView?.({ block });
    return node;
  };
  const setBusy = (busy) => {
    send.disabled = busy;
    log.querySelectorAll('.sb-assist-prompt').forEach((b) => { b.disabled = busy; });
  };

  // One answer: a single text, or a section per result headed with its link.
  const answer = (parts) => {
    const body = el('div', { className: 'sb-chat-text' });
    const markdownParts = [];
    parts.forEach(({ doc, text: part }, i) => {
      if (i) body.append(el('hr'));
      if (doc && parts.length > 1) {
        body.append(el('h3', { className: 'sb-assist-doc-title' }, `URL ${i + 1}: `, docLink(doc)));
        markdownParts.push(`**URL ${i + 1}: [${docTitle(doc)}](${doc.url})**\n\n${part}`);
      } else {
        markdownParts.push(part);
      }
      body.append(...markdown(part));
    });
    const copyButton = (iconName, label, value) => {
      const button = el('button', {
        type: 'button', className: 'sb-assist-icon', 'aria-label': label, title: label,
      }, icon(iconName, 16));
      button.addEventListener('click', () => {
        navigator.clipboard?.writeText(value()).then(() => {
          button.replaceChildren(icon('check', 16));
          setTimeout(() => button.replaceChildren(icon(iconName, 16)), 2000);
        }).catch(() => {});
      });
      return button;
    };
    return el(
      'div',
      { className: 'sb-chat-msg is-bot' },
      el('div', { className: 'sb-chat-bubble' }, body),
      el(
        'div',
        { className: 'sb-assist-copy' },
        copyButton('copy', 'Copy text', () => plainText(body)),
        copyButton('markdown', 'Copy markdown', () => markdownParts.join('\n\n---\n\n')),
      ),
    );
  };

  const ask = (name, prompt = '') => {
    if (!selected.length) return;
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    operation = name;
    add(el(
      'div',
      { className: 'sb-chat-msg is-user' },
      el('div', { className: 'sb-chat-bubble' }, prompt || name.replace(/-/g, ' ')),
    ));
    const wait = add(el('p', { className: 'sb-assist-wait' }, 'Processing content…'));
    clearTimeout(waitTimer);
    waitTimer = setTimeout(() => { wait.textContent = 'Generating response…'; }, 4000);
    setBusy(true);
    input.value = '';
    assist(config, { operation: name, docs: selected, prompt }, signal)
      .then((parts) => add(parts.length ? answer(parts) : el('p', { className: 'sb-assist-wait' }, 'No answer was found in these results.'), 'start'))
      .catch((err) => {
        if (err.name === 'AbortError') return;
        add(el('p', { className: 'sb-error' }, 'SearchAI Assist is unavailable right now. Please try again later.'));
        // eslint-disable-next-line no-console
        console.error('[searchblox-search] SearchAI Assist', err);
      })
      .finally(() => {
        if (signal.aborted) return;
        clearTimeout(waitTimer);
        wait.remove();
        setBusy(false);
        compose.hidden = false;
        input.focus({ preventScroll: true });
      });
  };

  // The action buttons that fit the selection: compare needs two or more
  // results; analyze and the server's own extra actions take a single one.
  const promptButtons = () => {
    const usable = prompts.filter((name) => (selected.length > 1
      ? ASSIST_PROMPTS.includes(name) && name !== 'analyze'
      : name !== 'compare'));
    return el(
      'div',
      { className: 'sb-assist-prompts' },
      usable.map((name) => el('button', {
        type: 'button', className: 'sb-assist-prompt', onClick: () => ask(name),
      }, icon(ASSIST_ICONS[name] || 'quote', 16), name.replace(/-/g, ' '))),
      el('button', {
        type: 'button',
        className: 'sb-assist-prompt sb-assist-own',
        onClick: () => {
          operation = 'custom';
          compose.hidden = false;
          input.focus();
        },
      }, icon('edit', 16), 'Enter your own prompt'),
    );
  };

  const start = () => {
    controller?.abort();
    clearTimeout(waitTimer);
    operation = '';
    input.value = '';
    compose.hidden = true;
    setBusy(false);
    log.replaceChildren(el('p', { className: 'sb-assist-intro' }, 'Please choose an action from the options below or write your own prompt.'));
    if (prompts) {
      add(promptButtons());
      return;
    }
    const loading = add(el('p', { className: 'sb-assist-wait' }, 'Loading actions…'));
    assistPrompts(config)
      .catch(() => ASSIST_PROMPTS)
      .then((names) => {
        prompts = names;
        if (loading.isConnected) loading.replaceWith(promptButtons());
      });
  };

  const update = () => {
    const { open } = dialog;
    tray.hidden = !selected.length || open;
    trayList.replaceChildren(...selected.map((r) => el('li', {}, docLink(r, 'sb-assist-doc'), removeButton(r))));
    trayCount.textContent = plural(selected.length);
    count.textContent = `(${plural(selected.length)})`;
    docs.replaceChildren(...selected.map((r) => el('li', {}, docLink(r, 'sb-assist-doc'), removeButton(r))));
    onChange();
  };

  const open = () => {
    if (!selected.length) return;
    tray.hidden = true;
    document.documentElement.classList.add('sb-assist-open');
    dialog.showModal();
    start();
    update();
  };

  // Closing (button or Escape) ends the conversation and clears the selection.
  dialog.addEventListener('close', () => {
    controller?.abort();
    clearTimeout(waitTimer);
    document.documentElement.classList.remove('sb-assist-open');
    selected = [];
    update();
  });

  function toggle(r) {
    if (selected.some((s) => same(s, r))) selected = selected.filter((s) => !same(s, r));
    else if (selected.length < ASSIST_LIMIT) selected = [...selected, r];
    if (dialog.open && !selected.length) {
      dialog.close();
      return;
    }
    update();
  }

  function clear() {
    if (dialog.open) dialog.close();
    selected = [];
    update();
  }

  tray.querySelector('.sb-assist-clear').addEventListener('click', clear);
  tray.querySelector('.sb-assist-cancel').addEventListener('click', clear);
  tray.querySelector('.sb-assist-proceed').addEventListener('click', open);
  dialog.querySelector('.sb-assist-restart').addEventListener('click', start);
  dialog.querySelector('.sb-assist-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const prompt = input.value.trim();
    if (prompt && !send.disabled) ask(operation === 'custom' ? 'summarize' : operation, prompt);
  });
  [trayList, docs].forEach((list) => list.addEventListener('click', (e) => {
    const button = e.target.closest('.sb-assist-remove');
    if (button) toggle(button.sbResult);
  }));

  return {
    has: (r) => selected.some((s) => same(s, r)),
    full: () => selected.length >= ASSIST_LIMIT,
    toggle,
    clear,
  };
}

// ------------------------------------------------------------------
// Settings menus
// ------------------------------------------------------------------

// Search Settings and Plugin Settings from the SearchBlox search plugin, as two
// buttons beside the search button when `settings` is on. Changes last until the
// page reloads; nothing is saved. `applySearch(weight, threshold)` applies the search
// settings (omitted on a box-only instance); `toggles()` lists the plugin
// settings as { label, on, set, modes, mode, setMode }, read each time the
// menu opens. One without `set` is shown switched off and greyed out.
// `modes` ([[value, label]]) adds radio buttons, shown while on.
const percent = (n) => `${Math.round(n * 100)}%`;

function mountSettings(root, config, { applySearch, toggles }) {
  const base = root.querySelector('.sb-input').id;
  const menus = [];

  const menu = (name, label, iconName, fill) => {
    const id = `${base}-${name}`;
    const toggle = el('button', {
      type: 'button', className: 'sb-settings-toggle', 'aria-expanded': 'false', 'aria-controls': id, 'aria-label': label, title: label,
    }, icon(iconName, 22));
    const panel = el('div', {
      id, className: 'sb-settings-panel', role: 'dialog', 'aria-labelledby': `${id}-title`, hidden: true,
    });
    const wrap = el('div', { className: 'sb-settings' }, toggle, panel);
    const close = (refocus) => {
      if (panel.hidden) return;
      panel.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      if (refocus) toggle.focus();
    };
    const open = () => {
      menus.forEach((m) => m.close());
      panel.replaceChildren(el('h2', { className: 'sb-settings-title', id: `${id}-title` }, label), ...fill(close));
      panel.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      panel.querySelector('input:not(:disabled), button')?.focus();
    };
    toggle.addEventListener('click', () => (panel.hidden ? open() : close()));
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close(true);
    });
    document.addEventListener('pointerdown', (e) => {
      if (!wrap.contains(e.target)) close();
    });
    menus.push({ close });
    return wrap;
  };

  const slider = (id, label, value) => el('input', {
    id, type: 'range', className: 'sb-range', min: 0, max: 1, step: 0.1, value, 'aria-label': label,
  });

  const searchMenu = applySearch && menu('search-settings', 'Search Settings', 'adjustments', (close) => {
    const ratio = slider(`${base}-ratio`, 'Search ratio (vector share)', config.vectorWeight);
    const threshold = slider(`${base}-threshold`, 'Vector threshold', config.vectorThreshold);
    const keywordShare = el('strong');
    const vectorShare = el('strong');
    const thresholdValue = el('strong');
    const thresholdRow = el(
      'div',
      { className: 'sb-setting' },
      el('label', { className: 'sb-setting-label', for: threshold.id }, 'Vector Threshold'),
      threshold,
      el('div', { className: 'sb-setting-values' }, el('span', {}, 'Minimum similarity', thresholdValue)),
    );
    const update = () => {
      const weight = Number(ratio.value);
      keywordShare.textContent = percent(1 - weight);
      vectorShare.textContent = percent(weight);
      thresholdValue.textContent = Number(threshold.value).toFixed(1);
      threshold.disabled = weight === 0;
      thresholdRow.classList.toggle('sb-disabled', weight === 0);
    };
    ratio.addEventListener('input', update);
    threshold.addEventListener('input', update);
    update();
    return [
      el(
        'div',
        { className: 'sb-setting' },
        el('label', { className: 'sb-setting-label', for: ratio.id }, 'Search Ratio'),
        ratio,
        el(
          'div',
          { className: 'sb-setting-values' },
          el('span', {}, 'Keyword', keywordShare),
          el('span', {}, 'Vector', vectorShare),
        ),
      ),
      thresholdRow,
      el(
        'div',
        { className: 'sb-settings-actions' },
        el('button', { type: 'button', className: 'sb-link-button', onClick: () => close(true) }, 'Cancel'),
        el('button', {
          type: 'button',
          className: 'sb-settings-apply',
          onClick: () => {
            close(true);
            applySearch(Number(ratio.value), Number(threshold.value));
          },
        }, 'Apply'),
      ),
    ];
  });

  const pluginMenu = menu('plugin-settings', 'Plugin Settings', 'settings', () => {
    const items = toggles();
    return [el('ul', { className: 'sb-settings-list' }, items.map(({
      label, on, set, modes, mode, setMode,
    }, i) => {
      const choices = modes && el('div', {
        className: 'sb-setting-modes', role: 'radiogroup', 'aria-label': `${label} display`, hidden: !on,
      }, modes.map(([value, text]) => el(
        'label',
        {},
        el('input', {
          type: 'radio', name: `${base}-plugin-mode-${i}`, value, checked: value === mode, onChange: () => setMode(value),
        }),
        text,
      )));
      return el(
        'li',
        { className: set ? '' : 'sb-disabled' },
        el(
          'label',
          { className: 'sb-setting-switch' },
          el('span', {}, label),
          el('input', {
            type: 'checkbox',
            role: 'switch',
            className: 'sb-switch',
            checked: Boolean(set && on),
            disabled: !set,
            onChange: (e) => {
              set(e.target.checked);
              if (choices) choices.hidden = !e.target.checked;
            },
          }),
        ),
        choices,
      );
    }))];
  });

  root.querySelector('.sb-form').append(...[searchMenu, pluginMenu].filter(Boolean));
}

// ------------------------------------------------------------------
// AI Mode
// ------------------------------------------------------------------

/**
 * AI Mode, as in the SearchBlox search plugin: a conversation with the `aiMode`
 * chatbot in place of the results. Each answer shows how long it took, thumbs
 * up/down and its references; the latest also suggests follow-up questions.
 * "All results" goes back to the results for the last question. Returns
 * { open(question), close(), isOpen() }; `onExit(query)` runs the search and
 * `onToggle(open)` follows it opening and closing.
 */
function mountAiMode(root, config, { onExit, onToggle }) {
  const id = `${root.querySelector('.sb-input').id}-aimode`;
  const thread = el('ol', { className: 'sb-aimode-thread', 'aria-live': 'polite' });
  const empty = el(
    'div',
    { className: 'sb-aimode-empty' },
    icon('ai', 48),
    el('p', { className: 'sb-aimode-empty-title' }, 'SearchBlox AI Mode'),
    el('p', {}, 'Start a new thread by typing a detailed question below, then follow up with further questions.'),
  );
  const input = el('input', {
    className: 'sb-input', type: 'text', autocomplete: 'off', 'aria-label': 'Ask AI Mode',
  });
  const send = el('button', {
    type: 'submit', className: 'sb-submit', 'aria-label': 'Send', title: 'Send',
  }, icon('send', 20));
  const section = el(
    'section',
    {
      id, className: 'sb-aimode', 'aria-labelledby': `${id}-title`, hidden: true,
    },
    el(
      'div',
      { className: 'sb-aimode-header' },
      el('h2', { className: 'sb-ai-title', id: `${id}-title` }, icon('ai'), 'AI Mode'),
      el('button', {
        type: 'button', className: 'sb-ai-regenerate', 'aria-label': 'New thread', title: 'New thread',
      }, icon('reload')),
    ),
    empty,
    thread,
    el(
      'form',
      { className: 'sb-aimode-form' },
      input,
      send,
      el('button', { type: 'button', className: 'sb-aimode-exit' }, 'All results'),
    ),
  );
  root.querySelector('.sb-form').after(section);

  let conversationId = '';
  let lastQuestion = '';
  section.querySelector('.sb-aimode-exit').addEventListener('click', () => onExit(input.value.trim() || lastQuestion));
  let controller;
  const target = config.newTab ? '_blank' : undefined;
  const rel = config.newTab ? 'noopener' : undefined;

  const setPlaceholder = () => {
    input.placeholder = thread.children.length ? 'Ask a follow-up question…' : 'Ask me anything…';
  };
  setPlaceholder();

  // References start as the cited URLs and gain titles and descriptions once looked up.
  const references = (sources) => {
    const list = el('ul');
    const draw = (docs) => list.replaceChildren(...sources.map((url) => {
      const doc = docs.find((d) => safeUrl(d.url) === url);
      return el(
        'li',
        {},
        el('a', { href: url, target, rel }, doc?.title || displayUrl(url)),
        doc?.description ? el('p', {}, doc.description) : null,
      );
    }));
    draw([]);
    documentLookup(config, sources, controller.signal).then(draw).catch(() => {});
    return el('details', { className: 'sb-aimode-refs' }, el('summary', {}, `References (${sources.length})`), list);
  };

  const ask = async (raw) => {
    const question = raw.trim();
    if (!question || send.disabled) return;
    lastQuestion = question;
    input.value = '';
    send.disabled = true;
    empty.hidden = true;
    thread.querySelectorAll('.sb-aimode-followups').forEach((n) => n.remove());
    const answer = el(
      'div',
      { className: 'sb-aimode-answer' },
      el('div', { className: 'sb-ai-loading', 'aria-label': 'Generating an answer' }, el('span'), el('span'), el('span')),
    );
    const turn = el(
      'li',
      { className: 'sb-aimode-turn', 'aria-busy': 'true' },
      el('p', { className: 'sb-aimode-question' }, question),
      answer,
    );
    thread.append(turn);
    setPlaceholder();
    turn.scrollIntoView({ behavior: 'smooth', block: 'start' });
    controller = controller || new AbortController();
    const started = performance.now();
    try {
      const reply = await aiModeAsk(config, { question, conversationId }, controller.signal);
      conversationId = reply.conversationId || conversationId;
      const duration = formatDuration(performance.now() - started);
      answer.replaceChildren(el('div', { className: 'sb-chat-text' }, markdown(reply.text)));
      turn.append(...[
        el(
          'div',
          { className: 'sb-aimode-meta' },
          duration ? el('span', { className: 'sb-ai-time' }, icon('stopwatch', 14), `Generated in ${duration}`) : el('span'),
          reply.id ? votes((action) => chatVote(config, reply.id, action)) : null,
        ),
        reply.sources.length ? references(reply.sources) : null,
        reply.followups.length ? el(
          'div',
          { className: 'sb-aimode-followups sb-ai-followups' },
          el('h3', {}, 'Suggested follow-up questions'),
          el('ul', {}, reply.followups.map((q) => el('li', {}, el('button', {
            type: 'button', onClick: () => ask(q),
          }, icon('followup', 16), q)))),
        ) : null,
      ].filter(Boolean));
    } catch (err) {
      if (err.name === 'AbortError') return;
      answer.replaceChildren(el('p', { className: 'sb-error' }, 'Sorry, that went wrong. Please try again or ask something else.'));
      // eslint-disable-next-line no-console
      console.error('[searchblox-search] AI Mode', err);
    } finally {
      turn.removeAttribute('aria-busy');
      send.disabled = false;
    }
  };

  const reset = () => {
    controller?.abort();
    controller = null;
    conversationId = '';
    lastQuestion = '';
    thread.replaceChildren();
    empty.hidden = false;
    send.disabled = false;
    setPlaceholder();
    input.focus();
  };
  section.querySelector('.sb-ai-regenerate').addEventListener('click', reset);
  section.querySelector('.sb-aimode-form').addEventListener('submit', (e) => {
    e.preventDefault();
    ask(input.value);
  });

  return {
    isOpen: () => !section.hidden,
    // A question already asked last isn't asked again.
    open: (question = '') => {
      section.hidden = false;
      root.classList.add('sb-aimode-on');
      onToggle(true);
      if (question && question !== lastQuestion) ask(question);
      else input.focus();
    },
    close: () => {
      section.hidden = true;
      root.classList.remove('sb-aimode-on');
      onToggle(false);
    },
  };
}

/**
 * Mounts the search UI into `root`. Reuses existing .sb-* markup (EDS widget
 * HTML) or builds it. Returns { run } for programmatic queries.
 */
export function mount(root, rawConfig) {
  // A copy, since the settings menus change it.
  const config = rawConfig?.domain !== undefined && Array.isArray(rawConfig.facets)
    ? { ...rawConfig }
    : normaliseConfig(rawConfig);
  root.classList.add('searchblox-search');
  applyTheme(root, config);

  if (!config.domain) {
    root.replaceChildren(el('p', { className: 'sb-error' }, 'SearchBlox search: set the "domain" option (site-wide in searchblox-config, or on this widget).'));
    return { run: () => {} };
  }

  if (config.chatbot) mountChat(config);
  ensureSkeleton(root, config);
  const form = root.querySelector('.sb-form');
  const input = root.querySelector('.sb-input');
  const aiEnabled = config.aiOverview.length > 0 && !config.resultsPage;
  const faqsEnabled = config.smartFaqs;
  let aiOn = aiEnabled;
  let current;
  let lastResults;
  let llmMode = config.llmFields === 'off' ? 'both' : config.llmFields;
  let picker;
  let recController;
  let recs = readSession(RECOMMENDATIONS_KEY, null);
  let faqController;
  let faqKey = '';
  let controller;
  let aiController;
  let aiQuery = '';
  let aiResult;

  // One overview per query: paging and filtering keep it, page 2+ hides it.
  // `force` regenerates the answer for the same query.
  const runOverview = (state, force = false) => {
    const panel = root.querySelector('.sb-ai');
    if (state.query === aiQuery && !force) {
      if (panel) panel.hidden = state.page > 1 || !aiResult?.overview;
      return;
    }
    aiController?.abort();
    aiQuery = state.query;
    aiResult = undefined;
    if (state.page > 1) {
      if (panel) panel.hidden = true;
      aiQuery = '';
      return;
    }
    aiController = new AbortController();
    const started = performance.now();
    const regenerate = () => runOverview({ ...state, page: 1 }, true);
    renderOverview(root, config, null);
    overview(config, state.query, aiController.signal)
      .then((ai) => {
        aiResult = { ...ai, duration: formatDuration(performance.now() - started) };
        renderOverview(root, config, aiResult, regenerate);
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        aiResult = { overview: '' };
        renderOverview(root, config, aiResult);
        // eslint-disable-next-line no-console
        console.error('[searchblox-search] AI overview', err);
      });
  };

  // SmartFAQs per query (and picked FAQ), shown on page 1 only.
  const runFaqs = (state) => {
    const section = root.querySelector('.sb-faqs');
    const key = `${state.query}\n${state.faq || ''}`;
    if (state.page > 1 || key === faqKey) {
      if (section) section.hidden = state.page > 1 || !section.childElementCount;
      if (state.page > 1 && key !== faqKey) faqKey = '';
      return;
    }
    faqController?.abort();
    faqController = new AbortController();
    faqKey = key;
    const { signal } = faqController;
    const none = (err) => {
      if (err.name === 'AbortError') throw err;
      // eslint-disable-next-line no-console
      console.error('[searchblox-search] SmartFAQs', err);
      return null;
    };
    Promise.all([
      smartFaqs(config, state.query, FAQ_LIMIT, signal).catch(none),
      state.faq ? smartFaq(config, state.faq, signal).catch(none) : null,
    ])
      .then(([faqs, selected]) => renderFaqs(root, config, state.query, {
        faqs: faqs || [], selected,
      }))
      .catch(() => {});
  };

  const hide = (selector) => {
    const node = root.querySelector(selector);
    if (node) node.hidden = true;
  };

  // AI recommendations once enough results have been opened. They're kept for
  // the tab and only fetched again when the opened titles change.
  const runRecommendations = (state) => {
    const titles = readSession(VIEWED_KEY, []);
    if (titles.length < VIEWED_TITLES) {
      hide('.sb-recs');
      return;
    }
    const cnames = values(state.filters?.colname);
    const key = JSON.stringify([titles, config.collections, cnames]);
    const show = (loading, fresh = false) => renderRecommendations(root, config, recs, {
      loading, fresh, query: state.query,
    });
    if (recs?.key === key) {
      show(false);
      return;
    }
    recController?.abort();
    recController = new AbortController();
    show(true);
    recommendations(config, { titles, query: state.query, cnames }, recController.signal)
      .then(({ sessionId, items }) => {
        // As in the plugin, an empty answer keeps the previous recommendations.
        recs = items.length
          ? {
            key, sessionId, items, previous: (recs?.items || []).map((r) => r.uid),
          }
          : { ...(recs || { items: [] }), key };
        writeSession(RECOMMENDATIONS_KEY, recs);
        show(false, items.length > 0);
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        show(false);
        // eslint-disable-next-line no-console
        console.error('[searchblox-search] AI recommendations', err);
      });
  };

  const ui = {
    moreLikeThis: (r) => {
      if (!current) return;
      root.sbRun({
        ...current,
        page: 1,
        mlt: { id: r.uid, col: r.col, title: stripTags(r.originalTitle || r.title) },
      });
      root.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    onOpen: (r) => {
      if (!config.recommendations) return;
      const title = stripTags(r.title);
      const titles = readSession(VIEWED_KEY, []).filter((t) => t !== title);
      writeSession(VIEWED_KEY, [...titles, title].slice(-VIEWED_TITLES));
      // Only finishes if the page stays (new tab); otherwise the next search does it.
      if (current) runRecommendations(current);
    },
    filter: (field, value) => {
      if (!current) return;
      const selected = config.checkboxFacets.includes(field)
        ? [...new Set([...values(current.filters[field]), value])]
        : value;
      root.sbRun({
        ...current, page: 1, faq: '', filters: { ...current.filters, [field]: selected },
      });
    },
    get assist() {
      return config.assist ? picker : null;
    },
  };
  const rerender = () => lastResults
    && renderResultList(root, config, lastResults.data, lastResults.state, ui);
  const ensureAssist = () => {
    picker = picker || mountAssist(config, () => syncAssist(root, picker));
  };
  if (config.assist && !config.resultsPage) ensureAssist();

  // `append` adds the next page below the results shown (load more). A search
  // with no results is retried once, as in the SearchBlox search plugin: without
  // its quotes (all words required), or else with the spelling suggestion.
  // `original` and `retry` record that for the status line.
  const run = async (state, { append = false } = {}) => {
    if (!state.query) return;
    current = state;
    root.sbCurrent = state;
    controller?.abort();
    controller = new AbortController();
    const mine = controller;
    input.value = state.query === '*' ? '' : state.query;
    writeUrlState(config, state);
    // "*" lists everything: there's no question to answer.
    const asked = state.query !== '*';
    if (!append) {
      if (aiOn && asked) runOverview(state);
      else hide('.sb-ai');
      if (config.smartFaqs && !config.resultsPage && asked) runFaqs(state);
      else hide('.sb-faqs');
      if (config.recommendations) runRecommendations(state);
    }
    root.setAttribute('aria-busy', 'true');
    try {
      const data = await search(config, state, controller.signal);
      if (!data.hits && !append && !state.retry && !state.mlt) {
        const unquoted = state.query.replace(/"+/g, ' ').replace(/\s+/g, ' ').trim();
        const retry = state.query.includes('"') && unquoted
          ? { query: unquoted, allTerms: true, retry: 'quotes' }
          : data.suggest && data.suggest.toLowerCase() !== state.query.toLowerCase() && { query: data.suggest, retry: 'suggest' };
        if (retry) {
          await run({ ...state, ...retry, original: state.query });
          return;
        }
      }
      if (append && lastResults) {
        lastResults = {
          data: { ...data, results: [...lastResults.data.results, ...data.results] },
          state: { ...state, page: lastResults.state.page },
        };
        renderResultList(root, config, data, state, ui, true);
        renderPagination(root, config, data, state);
      } else {
        lastResults = { data, state };
        renderResults(root, config, data, state, ui);
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      // eslint-disable-next-line no-console
      console.error('[searchblox-search]', err);
      if (append && lastResults) {
        current = { ...state, page: state.page - 1 };
        renderPagination(root, config, lastResults.data, current);
        return;
      }
      // The same cases the SearchBlox plugin explains; anything else is generic.
      const reason = err.message.toLowerCase();
      let message = 'Search is unavailable right now. Please try again.';
      if (reason.includes('no public collection')) message = 'There is no public collection available to search.';
      else if (reason.includes('index_not_found')) message = 'The search index isn’t available. Please try again later.';
      root.querySelector('.sb-status').replaceChildren(el('span', { className: 'sb-error' }, message));
      root.querySelector('.sb-results').replaceChildren();
      root.querySelector('.sb-pagination').replaceChildren();
      ['.sb-sort', '.sb-selected', '.sb-empty'].forEach(hide);
    } finally {
      // A search replaced by a newer one leaves the busy state to that one.
      if (controller === mine) root.removeAttribute('aria-busy');
    }
  };
  root.sbRun = run;

  let aiMode;

  // `faq` is the uid of a SmartFAQ picked from the suggestions. A new query
  // keeps the sort order. `ai` opens AI Mode on the results page instead. As
  // in the SearchBlox plugin, an empty search lists everything ("*").
  const submit = (query, faq, ai = false) => {
    const q = query.trim() || (ai ? '' : '*');
    if (config.resultsPage) {
      const url = new URL(config.resultsPage, window.location.href);
      url.searchParams.set(config.queryParam, q);
      if (faq) url.searchParams.set('faq', faq);
      if (ai) url.searchParams.set('mode', 'ai');
      window.location.assign(url);
      return;
    }
    aiMode?.close();
    run({
      query: q, page: 1, filters: {}, faq, sort: current?.sort || '', sortdir: current?.sortdir || '',
    });
  };

  const closeSuggestions = config.autosuggest || config.trending
    ? wireSuggestions(root, config, submit)
    : () => {};

  if (config.aiMode) {
    let toggle;
    if (!config.resultsPage) {
      aiMode = mountAiMode(root, config, {
        onExit: (q) => {
          aiMode.close();
          if (q) submit(q);
        },
        onToggle: (open) => toggle.setAttribute('aria-pressed', `${open}`),
      });
    }
    toggle = el('button', {
      type: 'button',
      className: 'sb-aimode-toggle',
      'aria-pressed': 'false',
      title: 'Switch to AI Mode',
      onClick: () => {
        closeSuggestions();
        if (!aiMode) {
          submit(input.value, undefined, true);
        } else if (aiMode.isOpen()) {
          aiMode.close();
        } else {
          aiMode.open(input.value.trim());
        }
      },
    }, icon('ai', 20), el('span', {}, 'AI Mode'));
    form.querySelector('.sb-submit').after(toggle);
  }

  if (config.voiceSearch) {
    const { placeholder } = input;
    let reset;
    const voice = voiceButton(config, {
      onText: (text) => {
        input.value = text;
        closeSuggestions();
        submit(text);
      },
      onState: (state) => {
        clearTimeout(reset);
        input.placeholder = {
          listening: 'Listening…', working: 'Transcribing…', error: 'Didn’t catch that. Please try again.',
        }[state] || placeholder;
        if (state === 'error') reset = setTimeout(() => { input.placeholder = placeholder; }, 3000);
      },
    });
    if (voice) {
      root.querySelector('.sb-input-wrap').append(voice);
      root.classList.add('sb-has-voice');
    }
  }

  if (config.settings) {
    mountSettings(root, config, {
      applySearch: !config.resultsPage && ((weight, threshold) => {
        config.vectorWeight = weight;
        config.vectorThreshold = threshold;
        if (weight > 0) config.pageSize = Math.min(config.pageSize, HYBRID_MAX_PAGE_SIZE);
        // Hybrid search has no sort menu, so it goes back to relevance.
        if (current) run({ ...current, page: 1, ...(weight > 0 ? { sort: '', sortdir: '' } : {}) });
      }),
      // The plugin's list, in its order, plus SmartFAQs. Results-page features
      // are left out of a box-only instance.
      toggles: () => [
        !config.resultsPage && (aiEnabled ? {
          label: 'AI Overview',
          on: aiOn,
          set: (on) => {
            aiOn = on;
            if (on) {
              if (current) runOverview(current);
              return;
            }
            // Keep a finished answer for when it's switched back on; drop one in progress.
            if (!aiResult) {
              aiController?.abort();
              aiQuery = '';
            }
            hide('.sb-ai');
          },
        } : { label: 'AI Overview' }),
        faqsEnabled ? {
          label: 'SmartFAQs',
          on: config.smartFaqs,
          set: (on) => {
            config.smartFaqs = on;
            if (on) {
              if (current && !config.resultsPage) runFaqs(current);
              return;
            }
            faqController?.abort();
            faqKey = '';
            hide('.sb-faqs');
          },
        } : { label: 'SmartFAQs' },
        !config.resultsPage && {
          label: 'AI Recommendations',
          on: config.recommendations,
          set: (on) => {
            config.recommendations = on;
            if (on) {
              if (current) runRecommendations(current);
              return;
            }
            // As in the plugin, switching off forgets what was opened.
            recController?.abort();
            recs = null;
            writeSession(VIEWED_KEY, undefined);
            writeSession(RECOMMENDATIONS_KEY, undefined);
            hide('.sb-recs');
          },
        },
        !config.resultsPage && {
          label: 'LLM-generated Fields',
          on: config.llmFields !== 'off',
          set: (on) => {
            config.llmFields = on ? llmMode : 'off';
            rerender();
          },
          modes: [['replace', 'Replace'], ['both', 'Show Both']],
          mode: llmMode,
          setMode: (mode) => {
            llmMode = mode;
            config.llmFields = mode;
            rerender();
          },
        },
        !config.resultsPage && {
          label: 'AI Assist',
          on: config.assist,
          set: (on) => {
            config.assist = on;
            if (on) ensureAssist();
            else picker?.clear();
            rerender();
          },
        },
        chatHost?.isConnected ? {
          label: 'ChatBot',
          on: !chatHost.hidden,
          set: (on) => {
            chatHost.hidden = !on;
          },
        } : { label: 'ChatBot' },
      ].filter(Boolean),
    });
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    closeSuggestions();
    submit(input.value);
  });

  if (!config.resultsPage) {
    const initial = readUrlState(config);
    if (initial.aiMode && aiMode) {
      const url = new URL(window.location.href);
      url.searchParams.delete('mode');
      window.history.replaceState(null, '', url);
      input.value = initial.query;
      aiMode.open(initial.query);
    } else if (initial.query) {
      run(initial);
    }
  }

  return { run: (query) => submit(query) };
}
