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
  assetClass: 'stock' | 'etf' | 'index';
  category: string;
  source: string;
  exchange?: string;
  tags: string[];
  next: string;
  note: string;
};

export const SOURCES: SourceInfo[] = [
  {
    id: 'stooq',
    name: 'Stooq',
    kind: 'historical OHLCV',
    auth: 'no API key',
    coverage: 'US stocks/ETFs and global indexes with provider symbols such as aapl.us or ^spx',
    command: '/data download AAPL --period 1y',
    note: '현재 TossQuant의 기본 다운로드 소스입니다.',
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
    kind: 'screeners / trending / quotes',
    auth: 'unofficial; may change',
    coverage: 'most active, gainers, losers, trending, ETF/fund metadata',
    command: '/discover most-active',
    note: '실시간 앱형 탐색 후보 소스로 적합하지만 안정 API로 간주하지 않습니다.',
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

export function discover(category = 'trending'): { category: string; items: SymbolInfo[]; note: string } {
  const normalized = category.trim().toLowerCase() || 'trending';
  const key = DISCOVER_BUCKETS[normalized] ? normalized : 'trending';
  const symbols = DISCOVER_BUCKETS[key] ?? [];
  const items = symbols.map((symbol) => symbolInfo(symbol)).filter((item): item is SymbolInfo => Boolean(item));
  return {
    category: key,
    items,
    note: key === normalized ? 'curated local universe; live Yahoo/Nasdaq connectors are planned' : `unknown category "${category}", showing trending instead`,
  };
}
