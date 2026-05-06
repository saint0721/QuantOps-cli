import { alphaVantageApiKey, fmpApiKey, polygonApiKey, twelveDataApiKey } from './data.ts';
import type { JsonObject } from './storage.ts';

export type MarketDataProviderStatus = {
  name: 'yahoo' | 'stooq' | 'alphavantage' | 'twelve' | 'polygon' | 'fmp' | 'sec';
  available: boolean;
  auth: 'not-required' | 'env' | 'optional' | 'missing';
  env?: string[];
  detail: string;
};

export function listMarketDataProviders(env: NodeJS.ProcessEnv = process.env): MarketDataProviderStatus[] {
  return [
    { name: 'yahoo', available: true, auth: 'not-required', detail: 'unofficial chart/screener endpoints; no API key' },
    { name: 'stooq', available: true, auth: env.STOOQ_API_KEY ? 'env' : 'optional', env: ['STOOQ_API_KEY'], detail: env.STOOQ_API_KEY ? 'STOOQ_API_KEY is set' : 'CSV may work without a key, but Stooq can require STOOQ_API_KEY' },
    { name: 'alphavantage', available: Boolean(alphaVantageApiKey(env)), auth: alphaVantageApiKey(env) ? 'env' : 'missing', env: ['ALPHAVANTAGE_API_KEY', 'ALPHA_VANTAGE_API_KEY'], detail: alphaVantageApiKey(env) ? 'Alpha Vantage key is set' : 'set ALPHAVANTAGE_API_KEY or ALPHA_VANTAGE_API_KEY' },
    { name: 'twelve', available: Boolean(twelveDataApiKey(env)), auth: twelveDataApiKey(env) ? 'env' : 'missing', env: ['TWELVEDATA_API_KEY', 'TWELVE_DATA_API_KEY'], detail: twelveDataApiKey(env) ? 'Twelve Data key is set' : 'set TWELVEDATA_API_KEY or TWELVE_DATA_API_KEY' },
    { name: 'polygon', available: Boolean(polygonApiKey(env)), auth: polygonApiKey(env) ? 'env' : 'missing', env: ['POLYGON_API_KEY'], detail: polygonApiKey(env) ? 'Polygon key is set' : 'set POLYGON_API_KEY' },
    { name: 'fmp', available: Boolean(fmpApiKey(env)), auth: fmpApiKey(env) ? 'env' : 'missing', env: ['FMP_API_KEY', 'FINANCIAL_MODELING_PREP_API_KEY'], detail: fmpApiKey(env) ? 'FMP key is set' : 'set FMP_API_KEY or FINANCIAL_MODELING_PREP_API_KEY' },
    { name: 'sec', available: true, auth: 'not-required', detail: 'SEC EDGAR is filings/facts data, not an OHLCV download source' },
  ];
}

export function providersJson(env: NodeJS.ProcessEnv = process.env): JsonObject {
  return { ok: true, market_data_providers: listMarketDataProviders(env) as unknown as JsonObject[] };
}
