import test from 'node:test';
import assert from 'node:assert/strict';
import { codexExecArgs, listMarketDataProviders, listProviders, providerStatus, providersJson, runProviderPrompt } from '../providers.ts';

test('providers report local deterministic mode and env-backed API scaffolding', () => {
  const providers = listProviders({ OPENAI_API_KEY: 'sk-test' } as NodeJS.ProcessEnv);

  assert.equal(providers.find((item) => item.name === 'none')?.available, true);
  assert.equal(providers.find((item) => item.name === 'openai')?.auth, 'env');
  assert.equal(providerStatus('missing-provider').available, false);
});

test('market data providers expose API key readiness without leaking keys', () => {
  const env = {
    ALPHAVANTAGE_API_KEY: 'alpha-secret',
    TWELVEDATA_API_KEY: 'twelve-secret',
    POLYGON_API_KEY: 'polygon-secret',
    FMP_API_KEY: 'fmp-secret',
  } as NodeJS.ProcessEnv;
  const providers = listMarketDataProviders(env);
  const payload = providersJson(env);

  assert.equal(providers.find((item) => item.name === 'alphavantage')?.available, true);
  assert.equal(providers.find((item) => item.name === 'sec')?.auth, 'not-required');
  assert.equal(providers.find((item) => item.name === 'yahoo')?.available, true);
  assert.doesNotMatch(JSON.stringify(payload), /alpha-secret|twelve-secret|polygon-secret|fmp-secret/);
});

test('none provider is a no-op deterministic adapter', () => {
  const result = runProviderPrompt('none', 'hello');

  assert.equal(result.ok, true);
  assert.equal(result.provider, 'none');
});

test('codex provider args include selected model and reasoning effort', () => {
  assert.deepEqual(codexExecArgs('hello', { cwd: '/repo', model: 'gpt-5.5', effort: 'high' }), [
    'exec',
    '--sandbox',
    'read-only',
    '--cd',
    '/repo',
    '--model',
    'gpt-5.5',
    '--config',
    'model_reasoning_effort="high"',
    'hello',
  ]);
});
