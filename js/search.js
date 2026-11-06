// 旧版搜索相关性过滤：资源 API 有时忽略 wd，返回整站目录。
// 只保留影片名称与搜索关键词匹配的结果，避免「搜一部片得到上千个无关条目」。
function normalizeSearchTitle(title) {
    return String(title == null ? '' : title)
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\s\p{P}\p{S}]/gu, '');
}

function isRelevantSearchResult(item, query) {
    const title = normalizeSearchTitle(item && item.vod_name);
    const keyword = normalizeSearchTitle(query);
    if (!title || !keyword) return false;
    if (title.includes(keyword)) return true;

    // 允许「The Last of Us」等以空格分隔的多词查询，要求每个词均出现。
    const tokens = String(query).trim().split(/\s+/).map(normalizeSearchTitle).filter(Boolean);
    return tokens.length > 1 && tokens.every(token => title.includes(token));
}

function searchMatchPriority(item, query) {
    const title = normalizeSearchTitle(item && item.vod_name);
    const keyword = normalizeSearchTitle(query);
    if (title === keyword) return 0;
    if (title.startsWith(keyword)) return 1;
    return 2;
}

async function searchByAPIAndKeyWord(apiId, query) {
    try {
        let apiName, apiBaseUrl, customApiUrl;
        if (apiId.startsWith('custom_')) {
            const customApi = getCustomApiInfo(apiId.slice('custom_'.length));
            if (!customApi || !customApi.url) return [];
            apiBaseUrl = customApi.url;
            customApiUrl = customApi.url;
            apiName = customApi.name || apiId;
        } else {
            const site = API_SITES[apiId];
            if (!site || !site.api) return [];
            apiBaseUrl = site.api;
            apiName = site.name || apiId;
        }

        // URLSearchParams 可兼容原始采集站 URL 已含有查询参数的情况。
        const makeUrl = (page) => {
            const url = new URL(apiBaseUrl);
            if (!['http:', 'https:'].includes(url.protocol)) throw new Error('不支持的采集站协议');
            url.searchParams.set('ac', 'videolist');
            url.searchParams.set('wd', query);
            if (page > 1) url.searchParams.set('pg', String(page));
            return url.toString();
        };

        const fetchPage = async (page) => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 12000);
            try {
                const proxyPath = PROXY_URL + encodeURIComponent(makeUrl(page));
                const requestUrl = typeof window.ProxyAuth?.addAuthToProxyUrl === 'function'
                    ? await window.ProxyAuth.addAuthToProxyUrl(proxyPath)
                    : proxyPath;
                const response = await fetch(requestUrl, {
                    headers: API_CONFIG.search.headers,
                    signal: controller.signal
                });
                if (!response.ok) {
                    console.warn(`来源 ${apiName} 第 ${page} 页搜索失败: HTTP ${response.status}`);
                    if (response.status === 401 && document.getElementById('searchInput')?.value.trim() === query) {
                        window.__legacySearchAuthIssue = true;
                    }
                    return null;
                }
                const data = await response.json();
                return data && Array.isArray(data.list) ? data : null;
            } catch (error) {
                console.warn(`来源 ${apiName} 第 ${page} 页搜索异常:`, error);
                return null;
            } finally {
                clearTimeout(timeoutId);
            }
        };

        const first = await fetchPage(1);
        if (!first) return [];

        const addResults = (data) => data.list
            .filter(item => isRelevantSearchResult(item, query))
            .map(item => ({
                ...item,
                source_name: apiName,
                source_code: apiId,
                api_url: customApiUrl
            }));

        const results = addResults(first);
        const configuredPages = Math.max(1, Number(API_CONFIG.search.maxPages) || 5);
        // 限制最多 5 页，避免每个来源一次请求 50 页造成超时和大量无关结果。
        const maxPages = Math.min(5, configuredPages);
        const reportedPages = Math.max(1, Number(first.pagecount) || 1);
        const endPage = Math.min(maxPages, reportedPages);
        if (endPage > 1) {
            const nextPages = await Promise.all(
                Array.from({ length: endPage - 1 }, (_, index) => fetchPage(index + 2))
            );
            for (const data of nextPages) {
                if (data) results.push(...addResults(data));
            }
        }

        // 同一来源同一个 vod_id 可能跨分页重复出现，只展示一次。
        const seenIds = new Set();
        return results.filter(item => {
            const id = item.vod_id == null ? '' : String(item.vod_id);
            if (!id) return true;
            if (seenIds.has(id)) return false;
            seenIds.add(id);
            return true;
        });
    } catch (error) {
        console.warn(`来源 ${apiId} 搜索失败:`, error);
        return [];
    }
}
