import test from 'node:test';
import assert from 'node:assert/strict';
import { listProviders, providerStatus, runProviderPrompt } from '../providers.ts';

test('providers report local deterministic mode and env-backed API scaffolding', () => {
  const providers = listProviders({ OPENAI_API_KEY: 'sk-test' } as NodeJS.ProcessEnv);

  assert.equal(providers.find((item) => item.name === 'none')?.available, true);
  assert.equal(providers.find((item) => item.name === 'openai')?.auth, 'env');
  assert.equal(providerStatus('missing-provider').available, false);
});

test('none provider is a no-op deterministic adapter', () => {
  const result = runProviderPrompt('none', 'hello');

  assert.equal(result.ok, true);
  assert.equal(result.provider, 'none');
});
