import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { marketDatasetPath } from '../data.ts';
import { listIdeas } from '../idea.ts';
import { runOnce, welcomeCard } from '../cli.ts';
import { appendJsonl } from '../storage.ts';

test('welcome keeps neofetch summary without runtime HUD line', () => {
  const welcome = welcomeCard();
  assert.match(welcome, /TossQuant-cli/);
  assert.match(welcome, /beginner/);
  assert.match(welcome, /\/find/);
  assert.match(welcome, /\/download <SYMBOL>/);
  assert.match(welcome, /\/research <SYMBOL>/);
  assert.match(welcome, /\/skills/);
  assert.match(welcome, /trading mutations disabled/);
  assert.doesNotMatch(welcome, /watchlist:\d/);
});

function captureConsole(fn: () => Promise<number>): Promise<{ code: number; output: string }> {
  const originalLog = console.log;
  let output = '';
  console.log = (...args: unknown[]) => { output += `${args.join(' ')}\n`; };
  return fn().then((code) => ({ code, output })).finally(() => { console.log = originalLog; });
}

test('research command routes to missing-data guidance without invoking generic codex chat', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-cli-research-missing-'));

  const { code, output } = await captureConsole(() => runOnce(['--no-tmux', '--data-dir', dir, 'research', 'AAPL']));

  assert.equal(code, 1);
  assert.match(output, /data download AAPL --period 1y/);
  assert.match(output, /before external research/);
});

test('data info and validate route through local market datasets', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-cli-data-ops-'));
  appendJsonl(marketDatasetPath(dir, 'yahoo', 'AAPL', 'd'), {
    ticker: 'AAPL',
    provider_symbol: 'AAPL',
    source: 'yahoo',
    interval: 'd',
    date: '2026-01-02',
    fetched_at: '2026-01-02T00:00:00Z',
    payload: { open: 100, high: 110, low: 99, close: 108, volume: 12345 },
  });

  const info = await captureConsole(() => runOnce(['--no-tmux', '--data-dir', dir, 'data', 'info', 'AAPL']));
  const validation = await captureConsole(() => runOnce(['--no-tmux', '--data-dir', dir, 'data', 'validate', 'AAPL', '--max-stale-days', '9999']));

  assert.equal(info.code, 0);
  assert.match(info.output, /Market data info: AAPL/);
  assert.equal(validation.code, 0);
  assert.match(validation.output, /validation passed/);
});

test('idea command records research hypotheses and links next data commands', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-cli-idea-'));

  const created = await captureConsole(() => runOnce(['--no-tmux', '--data-dir', dir, 'idea', 'new', 'NVDA', 'earnings', 'momentum']));
  const idea = listIdeas(dir)[0]!;
  const symbol = await captureConsole(() => runOnce(['--no-tmux', '--data-dir', dir, 'idea', 'add-symbol', idea.id, 'nvda']));
  const hypothesis = await captureConsole(() => runOnce(['--no-tmux', '--data-dir', dir, 'idea', 'add-hypothesis', idea.id, 'Earnings surprise momentum persists']));
  const status = await captureConsole(() => runOnce(['--no-tmux', '--data-dir', dir, 'idea', 'status', idea.id]));

  assert.equal(created.code, 0);
  assert.match(created.output, /created idea/);
  assert.equal(symbol.code, 0);
  assert.match(symbol.output, /NVDA/);
  assert.equal(hypothesis.code, 0);
  assert.match(hypothesis.output, /hypotheses: 1/);
  assert.equal(status.code, 0);
  assert.match(status.output, /Idea: NVDA earnings momentum/);
  assert.match(status.output, /data download NVDA --period 1y/);
  assert.match(status.output, /research NVDA --topic "NVDA earnings momentum"/);
});

test('idea command resolves latest references and prints copy-friendly plain status', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-cli-idea-latest-'));

  await captureConsole(() => runOnce(['--no-tmux', '--data-dir', dir, 'idea', 'new', 'NVDA', 'earnings', 'momentum']));
  const idea = listIdeas(dir)[0]!;
  await captureConsole(() => runOnce(['--no-tmux', '--data-dir', dir, 'idea', 'add-symbol', 'latest', 'nvda']));

  const show = await captureConsole(() => runOnce(['--no-tmux', '--data-dir', dir, 'idea', 'show', 'NVDA', '--plain']));
  const status = await captureConsole(() => runOnce(['--no-tmux', '--data-dir', dir, 'idea', 'status', 'latest', '--plain']));

  assert.equal(show.code, 0);
  assert.match(show.output, new RegExp(`id=${idea.id}`));
  assert.match(show.output, /symbols=NVDA/);
  assert.equal(status.code, 0);
  assert.match(status.output, /readiness:/);
  assert.match(status.output, /NVDA: market=missing validation=missing research=missing/);
  assert.match(status.output, /\/data download NVDA --period 1y/);
});

test('lab command builds idea workflow and prompt-only artifacts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-cli-lab-'));

  await captureConsole(() => runOnce(['--no-tmux', '--data-dir', dir, 'idea', 'new', 'NVDA', 'earnings', 'momentum']));
  await captureConsole(() => runOnce(['--no-tmux', '--data-dir', dir, 'idea', 'add-symbol', 'latest', 'NVDA']));

  const workflow = await captureConsole(() => runOnce(['--no-tmux', '--data-dir', dir, 'lab', 'workflow', 'latest']));
  const discuss = await captureConsole(() => runOnce(['--no-tmux', '--data-dir', dir, 'lab', 'discuss', 'latest', '실적', '모멘텀을', '뉴스와', '연결해서', '보고', '싶어', '--no-save']));
  const verify = await captureConsole(() => runOnce(['--no-tmux', '--data-dir', dir, 'lab', 'verify', 'latest', '--no-save']));
  const prompt = await captureConsole(() => runOnce(['--no-tmux', '--data-dir', dir, 'lab', 'backtest', 'latest', '--prompt']));

  assert.equal(workflow.code, 0);
  assert.match(workflow.output, /Lab workflow: NVDA earnings momentum/);
  assert.match(workflow.output, /quant lab discuss/);
  assert.equal(discuss.code, 0);
  assert.match(discuss.output, /논의 주제: 실적 모멘텀을 뉴스와 연결해서 보고 싶어/);
  assert.match(discuss.output, /\/agent 실적 모멘텀을 뉴스와 연결해서 보고 싶어/);
  assert.equal(verify.code, 0);
  assert.match(verify.output, /Lab verify: NVDA earnings momentum/);
  assert.match(verify.output, /Blocking gaps/);
  assert.doesNotMatch(verify.output, /saved_to:/);
  assert.equal(prompt.code, 0);
  assert.match(prompt.output, /backtest implementation swarm lead/);
  assert.match(prompt.output, /Do not write live trading code/);
});

test('backtest command runs a selected strategy for latest idea symbol', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-cli-backtest-'));
  await captureConsole(() => runOnce(['--no-tmux', '--data-dir', dir, 'idea', 'new', 'AAPL', 'trend']));
  await captureConsole(() => runOnce(['--no-tmux', '--data-dir', dir, 'idea', 'add-symbol', 'latest', 'AAPL']));
  for (let i = 1; i <= 80; i += 1) {
    appendJsonl(marketDatasetPath(dir, 'yahoo', 'AAPL', 'd'), {
      ticker: 'AAPL',
      provider_symbol: 'AAPL',
      source: 'yahoo',
      interval: 'd',
      date: `2026-02-${String(i).padStart(2, '0')}`,
      fetched_at: '2026-02-01T00:00:00Z',
      payload: { open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 1000 },
    });
  }

  const strategies = await captureConsole(() => runOnce(['--no-tmux', '--data-dir', dir, 'strategy', 'list']));
  const backtest = await captureConsole(() => runOnce(['--no-tmux', '--data-dir', dir, 'backtest', 'run', 'latest', '--strategy', 'ma-cross', '--fast', '5', '--slow', '20', '--no-save']));

  assert.equal(strategies.code, 0);
  assert.match(strategies.output, /ma-cross/);
  assert.equal(backtest.code, 0);
  assert.match(backtest.output, /Backtest: AAPL/);
  assert.match(backtest.output, /"fast":5/);
});

test('skills command lists local Codex skills with dollar invocation hints', async () => {
  const codexHome = mkdtempSync(join(tmpdir(), 'tq-cli-skills-'));
  const skillDir = join(codexHome, 'skills', 'tossquant-idea-coach');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: tossquant-idea-coach\ndescription: "Beginner idea coach"\n---\n', 'utf8');
  const previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;
  try {
    const result = await captureConsole(() => runOnce(['--no-tmux', 'skills']));

    assert.equal(result.code, 0);
    assert.match(result.output, /Codex skills/);
    assert.match(result.output, /tossquant-idea-coach/);
    assert.match(result.output, /\$tossquant-idea-coach --lang ko/);
  } finally {
    if (previous === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previous;
  }
});


test('tools and agent commands expose LLM execution surfaces', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-cli-agent-'));

  const tools = await captureConsole(() => runOnce(['--no-tmux', '--data-dir', dir, 'tools', '--json']));
  const lang = await captureConsole(() => runOnce(['--no-tmux', '--data-dir', dir, 'agent', 'ko']));
  const agent = await captureConsole(() => runOnce(['--no-tmux', '--data-dir', dir, 'agent', 'NVDA', 'earnings', 'momentum', '--session', 'cli-test']));
  const continued = await captureConsole(() => runOnce(['--no-tmux', '--data-dir', dir, 'agent', '다음엔', '뭐해?']));

  assert.equal(tools.code, 0);
  assert.match(tools.output, /stats.run/);
  assert.match(tools.output, /backtest.run/);
  assert.equal(lang.code, 0);
  assert.match(lang.output, /current: ko/);
  assert.equal(agent.code, 0);
  assert.match(agent.output, /세션: cli-test/);
  assert.match(agent.output, /data.download/);
  assert.equal(continued.code, 0);
  assert.match(continued.output, /세션: agent-chat/);
});

test('provider and session commands report local integration state', async () => {
  const providers = await captureConsole(() => runOnce(['--no-tmux', 'provider', '--json']));
  const session = await captureConsole(() => runOnce(['--no-tmux', 'session', 'current', 'readme-test', '--json']));

  assert.equal(providers.code, 0);
  assert.match(providers.output, /codex/);
  assert.equal(session.code, 0);
  assert.match(session.output, /readme-test/);
});


test('tools command redacts unknown tool names in CLI output', async () => {
  const result = await captureConsole(() => runOnce(['--no-tmux', 'tools', 'run', 'unknown?apikey=super-secret&session_id=sess-123', '--json']));

  assert.equal(result.code, 1);
  assert.doesNotMatch(result.output, /super-secret/);
  assert.doesNotMatch(result.output, /sess-123/);
  assert.match(result.output, /<redacted>/);
});
