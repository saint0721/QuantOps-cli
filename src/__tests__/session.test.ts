import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureQuantSession, listQuantSessions, recordSessionEvent, sessionHandoff } from '../session.ts';

test('.quant session stores redacted events and handoff summaries', () => {
  const root = mkdtempSync(join(tmpdir(), 'tq-quant-session-'));
  const session = ensureQuantSession({ root, id: 'NVDA idea', title: 'NVDA idea', now: '2026-05-05T00:00:00Z' });
  recordSessionEvent(session, { at: '2026-05-05T00:01:00Z', type: 'runtime.run', summary: 'checked NVDA', payload: { access_token: 'secret' } });

  const sessions = listQuantSessions(root);
  const handoff = sessionHandoff(session, root);

  assert.equal(sessions[0]?.id, 'nvda-idea');
  assert.match(handoff, /checked NVDA/);
  assert.doesNotMatch(handoff, /secret/);
});
