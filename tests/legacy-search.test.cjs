// Smoke/regression tests for legacy Cloudflare Pages search (no external CMS requests).
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

function loadSearch(mocks = {}) {
  const ctx = vm.createContext({
    URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
    console: { warn() {} },
    window: { ProxyAuth: { async addAuthToProxyUrl(path) { return path; } } },
    document: { getElementById() { return { value: '逃出布迪秀' }; } },
    API_SITES: { dbzy: { api: 'https://example.com/api.php/provide/vod', name: '豆瓣资源' } },
    API_CONFIG: { search: { headers: {}, maxPages: 50 } },
    PROXY_URL: '/proxy/',
    getCustomApiInfo() { return null; },
    ...mocks
  });
  vm.runInContext(fs.readFileSync('js/search.js','utf8'),ctx);
  return ctx;
}

test('ignore punctuation, whitespace and case', () => {
  const c = loadSearch();
  assert.equal(c.normalizeSearchTitle('  The LAST-of Us!  '),'thelastofus');
  assert.equal(c.isRelevantSearchResult({vod_name:'逃出布迪秀 (2025)'},'逃出布迪秀'),true);
  assert.equal(c.isRelevantSearchResult({vod_name:'007：生死交战'},'逃出布迪秀'),false);
  assert.equal(c.isRelevantSearchResult({vod_name:'101忠狗'},'逃出布迪秀'),false);
  assert.equal(c.isRelevantSearchResult({vod_name:'The Last of Us'},'Last of Us'),true);
});

test('filters irrelevant CMS results, caps pages to five, deduplicates IDs', async () => {
  const requests = [];
  const c = loadSearch({
    fetch: async (url) => {
      const original = decodeURIComponent(url.replace('/proxy/','').split('?auth=')[0]);
      const parsed = new URL(original);
      requests.push(parsed);
      const page = Number(parsed.searchParams.get('pg')||'1');
      return {ok: true, json: async () => ({
        pagecount: 50,
        list: [
          {vod_id: 'same', vod_name: '逃出布迪秀', type_name: '电影'},
          {vod_id: 'irrelevant'+page, vod_name: '007系列'},
          {vod_id: 'other'+page, vod_name: '逃出布迪秀 高清'+page},
        ]
      })};
    }
  });
  const results = await c.searchByAPIAndKeyWord('dbzy', '逃出布迪秀');
  assert.equal(requests.length,5);
  assert.equal(results.length,6); // same + 5 unique titles
  assert.ok(results.every(v=>v.vod_name.includes('逃出布迪秀')));
  assert.ok(requests.every(v=>v.searchParams.get('wd')==='逃出布迪秀'));
  assert.ok(requests.every(v=>v.searchParams.get('ac')==='videolist'));
});

test('source HTTP errors do not become unrelated search results', async () => {
  const c = loadSearch({fetch: async()=>({ok:false,status:401})});
  const result = await c.searchByAPIAndKeyWord('dbzy','逃出布迪秀');
  assert.equal(result.length,0);
  assert.equal(c.window.__legacySearchAuthIssue,true);
});

test('empty and missing titles are rejected', () => {
  const c=loadSearch();
  assert.equal(c.isRelevantSearchResult({vod_name:''},'你好'),false);
  assert.equal(c.isRelevantSearchResult({vod_name:'你好'},''),false);
  assert.equal(c.isRelevantSearchResult({},'你好'),false);
});
