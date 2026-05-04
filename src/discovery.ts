import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type SourceInfo = {
  id: string;
  name: string;
  kind: string;
  auth: string;
  coverage: string;
  command: string;
  note: string;
};

export type SymbolInfo = {
  symbol: string;
  name: string;
  assetClass: 'stock' | 'etf' | 'index' | 'crypto';
  category: string;
  source: string;
  exchange?: string;
  tags: string[];
  next: string;
  note: string;
};

export type DiscoverSource = 'local' | 'yahoo';

export type DiscoverResult = {
  category: string;
  source: DiscoverSource;
  live: boolean;
  items: SymbolInfo[];
  note: string;
  cachePath?: string;
  fetchedAt?: string;
  fallback?: string;
};

export type SymbolSearchResult = {
  query: string;
  source: DiscoverSource;
  live: boolean;
  items: SymbolInfo[];
  note: string;
  cachePath?: string;
  fetchedAt?: string;
  fallback?: string;
};

export type DiscoverOptions = {
  category?: string;
  source?: DiscoverSource | 'live';
  limit?: number;
  dataDir?: string;
  fetcher?: typeof fetch;
};

export type SymbolSearchOptions = {
  query: string;
  source?: DiscoverSource | 'live';
  limit?: number;
  dataDir?: string;
  fetcher?: typeof fetch;
};

export const SOURCES: SourceInfo[] = [
  {
    id: 'stooq',
    name: 'Stooq',
    kind: 'historical OHLCV',
    auth: 'STOOQ_API_KEY may be required for CSV downloads',
    coverage: 'US stocks/ETFs and global indexes with provider symbols such as aapl.us or ^spx',
    command: '/data download AAPL --source stooq --period 1y',
    note: 'CSV 다운로드가 API key를 요구할 수 있어 기본 CLI 다운로드는 Yahoo를 우선 사용합니다.',
  },
  {
    id: 'tossctl',
    name: 'tossctl',
    kind: 'account/quote bridge',
    auth: 'local tossctl auth',
    coverage: '사용자 로컬 tossctl이 제공하는 quote/account/portfolio',
    command: '/quote fetch AAPL',
    note: '민감정보는 저장 전 redaction을 거칩니다.',
  },
  {
    id: 'yahoo',
    name: 'Yahoo Finance',
    kind: 'live screeners / trending / quotes',
    auth: 'unofficial; no API key',
    coverage: 'daily OHLCV, trending, most active, day gainers, day losers; ETF/theme buckets fall back to local universe',
    command: '/data download AAPL --source yahoo --period 1y',
    note: '기본 TS 다운로드/분석 소스입니다. 비공식 endpoint라 실패 시 메시지를 확인하세요.',
  },
  {
    id: 'nasdaq',
    name: 'Nasdaq / exchange symbol directory',
    kind: 'symbol universe',
    auth: 'web endpoint / no stable contract',
    coverage: 'listed stocks, ETFs, exchange metadata',
    command: '/symbol search SOX',
    note: '전체 상장 심볼 목록과 ETF universe 보강 후보입니다.',
  },
  {
    id: 'vendor',
    name: 'Paid market data vendors',
    kind: 'realtime / aggregates / fundamentals',
    auth: 'API key required',
    coverage: 'Polygon, Tiingo, Twelve Data, Alpha Vantage 등',
    command: '/sources vendor',
    note: '나중에 실시간/분봉/재무제표가 필요할 때 연결하는 영역입니다.',
  },
];

export const SYMBOLS: SymbolInfo[] = [
  {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    assetClass: 'stock',
    category: 'mega-cap technology',
    source: 'stooq',
    exchange: 'NASDAQ',
    tags: ['technology', 'mega-cap', 'hardware'],
    next: '/data download AAPL --period 1y',
    note: '기본 smoke/example 심볼로 적합합니다.',
  },
  {
    symbol: 'MSFT',
    name: 'Microsoft Corporation',
    assetClass: 'stock',
    category: 'mega-cap technology',
    source: 'stooq',
    exchange: 'NASDAQ',
    tags: ['technology', 'mega-cap', 'software', 'ai'],
    next: '/data download MSFT --period 1y',
    note: 'AAPL과 비교 예제로 좋습니다.',
  },
  {
    symbol: 'SPY',
    name: 'SPDR S&P 500 ETF Trust',
    assetClass: 'etf',
    category: 'broad market ETF',
    source: 'stooq',
    exchange: 'NYSE Arca',
    tags: ['etf', 'broad-market', 's&p-500'],
    next: '/data download SPY --period 1y',
    note: '미국 대형주 벤치마크로 사용하기 좋습니다.',
  },
  {
    symbol: 'QQQ',
    name: 'Invesco QQQ Trust',
    assetClass: 'etf',
    category: 'growth / Nasdaq-100 ETF',
    source: 'stooq',
    exchange: 'NASDAQ',
    tags: ['etf', 'nasdaq-100', 'growth', 'technology'],
    next: '/data download QQQ --period 1y',
    note: '기술주 성장 벤치마크로 사용하기 좋습니다.',
  },
  {
    symbol: 'SOXL',
    name: 'Direxion Daily Semiconductor Bull 3X Shares',
    assetClass: 'etf',
    category: 'leveraged semiconductor ETF',
    source: 'stooq',
    exchange: 'NYSE Arca',
    tags: ['etf', 'leveraged', 'semiconductor', '3x', 'high-risk'],
    next: '/data download SOXL --period 6mo',
    note: '반도체 3x 레버리지 ETF라 변동성과 손실위험이 큽니다.',
  },
  {
    symbol: 'SOXS',
    name: 'Direxion Daily Semiconductor Bear 3X Shares',
    assetClass: 'etf',
    category: 'inverse leveraged semiconductor ETF',
    source: 'stooq',
    exchange: 'NYSE Arca',
    tags: ['etf', 'leveraged', 'inverse', 'semiconductor', '3x', 'high-risk'],
    next: '/data download SOXS --period 6mo',
    note: 'SOXL의 반대 방향 3x 일일 목표 ETF입니다.',
  },
  {
    symbol: 'TQQQ',
    name: 'ProShares UltraPro QQQ',
    assetClass: 'etf',
    category: 'leveraged Nasdaq-100 ETF',
    source: 'stooq',
    exchange: 'NASDAQ',
    tags: ['etf', 'leveraged', 'nasdaq-100', '3x', 'high-risk'],
    next: '/data download TQQQ --period 6mo',
    note: 'QQQ의 3x 일일 목표 ETF입니다.',
  },
  {
    symbol: 'SQQQ',
    name: 'ProShares UltraPro Short QQQ',
    assetClass: 'etf',
    category: 'inverse leveraged Nasdaq-100 ETF',
    source: 'stooq',
    exchange: 'NASDAQ',
    tags: ['etf', 'leveraged', 'inverse', 'nasdaq-100', '3x', 'high-risk'],
    next: '/data download SQQQ --period 6mo',
    note: 'QQQ의 역방향 3x 일일 목표 ETF입니다.',
  },
  {
    symbol: 'TSLA',
    name: 'Tesla, Inc.',
    assetClass: 'stock',
    category: 'high beta technology / EV',
    source: 'stooq',
    exchange: 'NASDAQ',
    tags: ['technology', 'ev', 'high-beta', 'popular'],
    next: '/data download TSLA --period 1y',
    note: '변동성이 커서 risk/stat 예제로 좋습니다.',
  },
  {
    symbol: 'NVDA',
    name: 'NVIDIA Corporation',
    assetClass: 'stock',
    category: 'semiconductor / AI',
    source: 'stooq',
    exchange: 'NASDAQ',
    tags: ['semiconductor', 'ai', 'mega-cap', 'popular'],
    next: '/data download NVDA --period 1y',
    note: '반도체/AI 테마 대표 심볼입니다.',
  },
];

export const DISCOVER_BUCKETS: Record<string, string[]> = {
  trending: ['NVDA', 'TSLA', 'SOXL', 'QQQ', 'AAPL', 'TQQQ'],
  'most-active': ['TSLA', 'NVDA', 'SOXL', 'SQQQ', 'TQQQ', 'AAPL'],
  gainers: ['SOXL', 'TQQQ', 'NVDA', 'TSLA'],
  losers: ['SOXS', 'SQQQ', 'TSLA'],
  etf: ['SPY', 'QQQ', 'SOXL', 'SOXS', 'TQQQ', 'SQQQ'],
  'etf leveraged': ['SOXL', 'SOXS', 'TQQQ', 'SQQQ'],
  'etf semiconductor': ['SOXL', 'SOXS', 'NVDA'],
  semiconductor: ['NVDA', 'SOXL', 'SOXS'],
};

const YAHOO_CATEGORY_ENDPOINT: Record<string, string> = {
  trending: 'https://query1.finance.yahoo.com/v1/finance/trending/US',
  'most-active': 'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=most_actives',
  gainers: 'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=day_gainers',
  losers: 'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=day_losers',
};

export function sourceById(id: string): SourceInfo | undefined {
  return SOURCES.find((source) => source.id === id.toLowerCase());
}

export function searchSymbols(query: string): SymbolInfo[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return SYMBOLS;
  return SYMBOLS.filter((item) => {
    const haystack = [item.symbol, item.name, item.category, item.exchange ?? '', ...item.tags]
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  });
}

export function symbolInfo(symbol: string): SymbolInfo | undefined {
  return SYMBOLS.find((item) => item.symbol === symbol.trim().toUpperCase());
}

function normalizeCategory(category = 'trending'): string {
  const normalized = category.trim().toLowerCase() || 'trending';
  return DISCOVER_BUCKETS[normalized] || YAHOO_CATEGORY_ENDPOINT[normalized] ? normalized : 'trending';
}

function inferAssetClass(symbol: string, quoteType?: string, typeDisp?: string): SymbolInfo['assetClass'] {
  const type = `${quoteType ?? ''} ${typeDisp ?? ''}`.toLowerCase();
  if (type.includes('crypto') || /-(usd|usdt|btc|eth)$/i.test(symbol)) return 'crypto';
  if (type.includes('etf') || ['SPY', 'QQQ', 'SOXL', 'SOXS', 'TQQQ', 'SQQQ'].includes(symbol)) return 'etf';
  if (type.includes('index') || symbol.startsWith('^')) return 'index';
  return 'stock';
}

function dynamicSymbolInfo(raw: any, category: string, source: DiscoverSource): SymbolInfo | undefined {
  const symbol = String(raw?.symbol ?? '').trim().toUpperCase();
  if (!symbol || symbol.includes('=')) return undefined;
  const known = symbolInfo(symbol);
  if (known) return { ...known, source };
  const assetClass = inferAssetClass(symbol, raw?.quoteType, raw?.typeDisp);
  const name = String(raw?.shortName ?? raw?.longName ?? raw?.displayName ?? symbol);
  const exchange = String(raw?.fullExchangeName ?? raw?.exchange ?? '').trim() || undefined;
  const tags = [category, assetClass, source].filter(Boolean);
  const next = assetClass === 'crypto' ? `/symbol search ${symbol}` : `/data download ${symbol} --period 1y`;
  return {
    symbol,
    name,
    assetClass,
    category,
    source,
    exchange,
    tags,
    next,
    note: assetClass === 'crypto'
      ? `${source} live discovery result; crypto download provider is not wired to the default Stooq downloader yet.`
      : `${source} live discovery result; verify provider coverage before analysis.`,
  };
}

function yahooUrl(category: string, limit: number): string | undefined {
  const base = YAHOO_CATEGORY_ENDPOINT[category];
  if (!base) return undefined;
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}count=${limit}`;
}

function yahooQuotes(payload: any): any[] {
  const trending = payload?.finance?.result?.[0]?.quotes;
  if (Array.isArray(trending)) return trending;
  const screener = payload?.finance?.result?.[0]?.quotes;
  if (Array.isArray(screener)) return screener;
  return [];
}

function yahooSearchUrl(query: string, limit: number): string {
  const params = new URLSearchParams({
    q: query,
    quotesCount: String(limit),
    newsCount: '0',
    enableFuzzyQuery: 'true',
    quotesQueryId: 'tss_match_phrase_query',
  });
  return `https://query1.finance.yahoo.com/v1/finance/search?${params.toString()}`;
}

export function discover(category = 'trending'): { category: string; items: SymbolInfo[]; note: string } {
  const requested = category.trim().toLowerCase() || 'trending';
  const key = DISCOVER_BUCKETS[requested] ? requested : 'trending';
  const symbols = DISCOVER_BUCKETS[key] ?? [];
  const items = symbols.map((symbol) => symbolInfo(symbol)).filter((item): item is SymbolInfo => Boolean(item));
  return {
    category: key,
    items,
    note: key === requested ? 'curated local universe; use --source yahoo for live screeners where available' : `unknown category "${category}", showing trending instead`,
  };
}

async function writeDiscoveryCache(dataDir: string, result: DiscoverResult): Promise<string> {
  const dir = join(dataDir, 'discovery', result.source);
  await mkdir(dir, { recursive: true });
  const safeCategory = result.category.replace(/[^a-z0-9_-]+/gi, '-');
  const path = join(dir, `${safeCategory}.json`);
  await writeFile(path, JSON.stringify(result, null, 2) + '\n', 'utf8');
  return path;
}

async function writeSymbolSearchCache(dataDir: string, result: SymbolSearchResult): Promise<string> {
  const dir = join(dataDir, 'symbols', result.source);
  await mkdir(dir, { recursive: true });
  const safeQuery = result.query.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'all';
  const path = join(dir, `${safeQuery}.json`);
  await writeFile(path, JSON.stringify(result, null, 2) + '\n', 'utf8');
  return path;
}

async function fetchYahooDiscover(category: string, limit: number, fetcher: typeof fetch): Promise<SymbolInfo[]> {
  const url = yahooUrl(category, limit);
  if (!url) throw new Error(`Yahoo live discovery does not support category: ${category}`);
  const response = await fetcher(url, {
    headers: { 'User-Agent': 'TossQuant-cli/0.1' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Yahoo discovery HTTP ${response.status}`);
  const payload = await response.json();
  return yahooQuotes(payload)
    .map((item) => dynamicSymbolInfo(item, category, 'yahoo'))
    .filter((item): item is SymbolInfo => Boolean(item))
    .slice(0, limit);
}

export async function discoverMarket(options: DiscoverOptions = {}): Promise<DiscoverResult> {
  const category = normalizeCategory(options.category ?? 'trending');
  const limit = Math.max(1, Math.min(Number(options.limit ?? 25), 100));
  const source = options.source === 'live' ? 'yahoo' : (options.source ?? 'local');
  const local = discover(category);
  let result: DiscoverResult;

  if (source === 'local') {
    result = {
      category: local.category,
      source: 'local',
      live: false,
      items: local.items.slice(0, limit),
      note: local.note,
      fetchedAt: new Date().toISOString(),
    };
  } else {
    try {
      const items = await fetchYahooDiscover(category, limit, options.fetcher ?? fetch);
      result = {
        category,
        source: 'yahoo',
        live: true,
        items,
        note: `live Yahoo ${category} discovery; cached for reproducibility`,
        fetchedAt: new Date().toISOString(),
      };
    } catch (error) {
      result = {
        category: local.category,
        source: 'local',
        live: false,
        items: local.items.slice(0, limit),
        note: `${local.note}; live Yahoo fallback used local universe`,
        fetchedAt: new Date().toISOString(),
        fallback: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (options.dataDir) {
    result.cachePath = await writeDiscoveryCache(options.dataDir, result);
  }
  return result;
}

async function fetchYahooSymbolSearch(query: string, limit: number, fetcher: typeof fetch): Promise<SymbolInfo[]> {
  const response = await fetcher(yahooSearchUrl(query, limit), {
    headers: { 'User-Agent': 'TossQuant-cli/0.1' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Yahoo symbol search HTTP ${response.status}`);
  const payload = await response.json();
  const quotes = Array.isArray(payload?.quotes) ? payload.quotes : [];
  return quotes
    .map((item) => dynamicSymbolInfo(item, 'symbol-search', 'yahoo'))
    .filter((item): item is SymbolInfo => Boolean(item))
    .slice(0, limit);
}

export async function searchSymbolsLive(options: SymbolSearchOptions): Promise<SymbolSearchResult> {
  const query = options.query.trim();
  const limit = Math.max(1, Math.min(Number(options.limit ?? 10), 50));
  const source = options.source === 'live' ? 'yahoo' : (options.source ?? 'yahoo');
  const localItems = searchSymbols(query).slice(0, limit);
  let result: SymbolSearchResult;

  if (!query || source === 'local') {
    result = {
      query,
      source: 'local',
      live: false,
      items: localItems,
      note: query ? 'local curated symbol search' : 'empty query; showing local curated symbols',
      fetchedAt: new Date().toISOString(),
    };
  } else {
    try {
      const items = await fetchYahooSymbolSearch(query, limit, options.fetcher ?? fetch);
      result = {
        query,
        source: 'yahoo',
        live: true,
        items,
        note: `live Yahoo symbol search for "${query}"; cached for reproducibility`,
        fetchedAt: new Date().toISOString(),
      };
    } catch (error) {
      result = {
        query,
        source: 'local',
        live: false,
        items: localItems,
        note: `local fallback symbol search for "${query}"`,
        fetchedAt: new Date().toISOString(),
        fallback: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (options.dataDir) {
    result.cachePath = await writeSymbolSearchCache(options.dataDir, result);
  }
  return result;
}
