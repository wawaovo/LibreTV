import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { getCache, setCache } from '@/lib/fetch-utils';

export const runtime = 'nodejs';

type PosterResult = { posterUrl: string | null };
type TmdbMovie = {
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  poster_path?: string | null;
};

const SUCCESS_TTL = 7 * 24 * 60 * 60 * 1000;
const MISS_TTL = 15 * 60 * 1000;
const POSTER_PATH = /^\/[a-zA-Z0-9_\/-]+\.(?:jpg|jpeg|png|webp)$/;
const TMDB_IMAGE = 'https://image.tmdb.org/t/p/w500';

/**
 * 旧版 douban.js 的 TMDB 海报兜底移植。
 * Key 只从服务端 TMDB_API_KEY 读取，绝不送到浏览器或提交到仓库。
 * 不接受用户提供上游 URL，因此不会变成任意地址代理。
 */
export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  const url = new URL(req.url);
  const title = (url.searchParams.get('title') || '').trim();
  const type = url.searchParams.get('type') === 'tv' ? 'tv' : 'movie';

  if (!title || title.length > 100) {
    return NextResponse.json({ error: '片名不能为空，最多 100 字符' }, { status: 400 });
  }
  const apiKey = process.env.TMDB_API_KEY?.trim();
  if (!apiKey) return NextResponse.json({ posterUrl: null } satisfies PosterResult);

  const cacheKey = `custom-tmdb:${type}:${title.toLocaleLowerCase()}`;
  const cached = getCache<PosterResult>(cacheKey);
  if (cached !== undefined) return NextResponse.json(cached);

  // 与旧版一致：先按电影/剧集类型和中文地区查找，再回退英文和另一类型。
  const other = type === 'tv' ? 'movie' : 'tv';
  const attempts: Array<[string, string]> = [
    [type, 'zh-TW'],
    [type, 'zh-CN'],
    [type, 'en-US'],
    [other, 'zh-TW'],
    [other, 'zh-CN'],
  ];
  const normalized = (value: string) => value.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  const targetName = normalized(title);
  let hadSuccess = false;

  for (const [mediaType, language] of attempts) {
    const endpoint = new URL(`https://api.themoviedb.org/3/search/${mediaType}`);
    endpoint.searchParams.set('api_key', apiKey);
    endpoint.searchParams.set('query', title);
    endpoint.searchParams.set('language', language);
    endpoint.searchParams.set('include_adult', 'false');

    try {
      const response = await fetch(endpoint.toString(), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) continue;
      hadSuccess = true;
      const payload = (await response.json()) as { results?: TmdbMovie[] };
      const results = (Array.isArray(payload.results) ? payload.results : []).filter(
        (entry) => typeof entry.poster_path === 'string' && POSTER_PATH.test(entry.poster_path)
      );
      if (!results.length) continue;
      const exact = results.find((entry) =>
        [entry.title, entry.name, entry.original_title, entry.original_name]
          .some((label) => label && normalized(label) === targetName)
      );
      if (exact?.poster_path) {
        const result: PosterResult = { posterUrl: TMDB_IMAGE + exact.poster_path };
        setCache(cacheKey, result, SUCCESS_TTL);
        return NextResponse.json(result);
      }
    } catch {
      // TMDB 暂时不可达：继续后备语言，不能影响首页的其他海报。
    }
  }

  const result: PosterResult = { posterUrl: null };
  if (hadSuccess) setCache(cacheKey, result, MISS_TTL);
  return NextResponse.json(result);
}
