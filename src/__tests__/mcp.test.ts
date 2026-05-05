import test from 'node:test';
import assert from 'node:assert/strict';
import { runMcpMessages } from '../mcp.ts';

test('mcp server exposes registry tools and calls them through the safe wrapper', async () => {
  const replies = await runMcpMessages([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'data.info', arguments: { symbol: 'AAPL' } } },
  ]);

  assert.equal(replies[0]?.result?.serverInfo?.name, 'quantops-cli');
  assert.ok((replies[1]?.result?.tools as any[]).some((tool) => tool.name === 'stats.run'));
  assert.equal((replies[2]?.result?.content as any[])[0].type, 'text');
});


test('mcp unknown tool response redacts secret-like names', async () => {
  const [reply] = await runMcpMessages([
    { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'unknown?apikey=super-secret&session_id=sess-123', arguments: {} } },
  ]);
  const serialized = JSON.stringify(reply);

  assert.doesNotMatch(serialized, /super-secret/);
  assert.doesNotMatch(serialized, /sess-123/);
  assert.match(serialized, /<redacted>/);
});
