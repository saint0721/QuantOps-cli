export type NaturalPlanStep = {
  command: string;
  reason: string;
};

export type NaturalPlan = {
  ok: boolean;
  input: string;
  intent: string;
  steps: NaturalPlanStep[];
  note: string;
};

const CATEGORY_ALIASES: Array<[RegExp, string]> = [
  [/많이\s*(거래|활동)|거래량|most[-\s]?active|active/i, 'discover most-active'],
  [/오르|상승|gainer|gain/i, 'discover gainers'],
  [/내리|하락|loser|loss/i, 'discover losers'],
  [/트렌딩|유행|인기|trend/i, 'discover trending'],
];

const PERIOD_ALIASES: Array<[RegExp, string]> = [
  [/([0-9]+)\s*년|([0-9]+)y\b/i, 'y'],
  [/([0-9]+)\s*개월|([0-9]+)mo\b|([0-9]+)m\b/i, 'mo'],
  [/([0-9]+)\s*주|([0-9]+)w\b/i, 'w'],
  [/([0-9]+)\s*일|([0-9]+)d\b/i, 'd'],
];

const RESERVED = new Set(['USD', 'KRW', 'ETF', 'BTC', 'AI']);

export function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const asciiWords = trimmed.match(/[A-Za-z0-9_.-]+/g)?.length ?? 0;
  const nonAscii = [...trimmed.replace(/[\x00-\x7F]/g, '한')].filter((ch) => ch === '한').length;
  return Math.max(1, Math.ceil(asciiWords * 1.3 + nonAscii / 1.7));
}

export function extractSymbol(input: string): string | undefined {
  const matches = input.match(/\b[A-Z][A-Z0-9.-]{1,9}\b/g) ?? [];
  return matches.find((item) => !RESERVED.has(item.toUpperCase()))?.toUpperCase();
}

export function extractLimit(input: string, fallback = 10): number {
  const explicit = input.match(/(?:limit|상위|종목|개)\s*[:=]?\s*(\d{1,3})|(?:상위\s*)?(\d{1,3})\s*개/i);
  const value = Number(explicit?.[1] ?? explicit?.[2] ?? fallback);
  return Number.isFinite(value) ? Math.max(1, Math.min(value, 100)) : fallback;
}

export function extractPeriod(input: string, fallback = '1y'): string {
  const lowered = input.toLowerCase();
  if (/ytd|연초/.test(lowered)) return 'ytd';
  if (/max|전체|가능한\s*전부|all|full/.test(lowered)) return 'max';
  for (const [pattern, unit] of PERIOD_ALIASES) {
    const match = input.match(pattern);
    if (!match) continue;
    const amount = match.slice(1).find(Boolean);
    if (amount) return `${amount}${unit}`;
  }
  return fallback;
}

export function planNatural(input: string): NaturalPlan {
  const text = input.trim();
  if (!text) return { ok: false, input, intent: 'empty', steps: [], note: '자연어 요청을 입력하세요. 예: TSM 1년치 받아서 분석해줘' };
  const symbol = extractSymbol(text);
  const limit = extractLimit(text);
  const period = extractPeriod(text);
  const wantsDownload = /다운|받|수집|download|fetch/i.test(text);
  const wantsAnalyze = /분석|analy[sz]e|stats?|비교|요약/i.test(text);
  const wantsSearch = /찾|검색|search|뭐야|정보|info/i.test(text);

  for (const [pattern, command] of CATEGORY_ALIASES) {
    if (pattern.test(text) && !symbol) {
      return {
        ok: true,
        input,
        intent: 'discover',
        steps: [{ command: `${command} --limit ${limit}`, reason: '시장 후보 목록을 실시간으로 찾습니다.' }],
        note: '후보를 고른 뒤 /download <SYMBOL> → /stats <SYMBOL> 순서로 진행하세요.',
      };
    }
  }

  if (symbol && wantsDownload && wantsAnalyze) {
    return {
      ok: true,
      input,
      intent: 'download-and-analyze',
      steps: [
        { command: `symbol search ${symbol} --limit 5`, reason: '심볼이 맞는지 live 검색으로 확인합니다.' },
        { command: `data download ${symbol} --period ${period}`, reason: `${period} 기간의 일봉 데이터를 저장합니다.` },
        { command: `stats ${symbol}`, reason: '저장된 OHLCV 데이터로 기초 분석을 실행합니다.' },
      ],
      note: '투자 판단이 아니라 데이터 준비와 기초 통계 확인입니다.',
    };
  }

  if (symbol && wantsDownload) {
    return {
      ok: true,
      input,
      intent: 'download',
      steps: [{ command: `data download ${symbol} --period ${period}`, reason: `${symbol} ${period} 데이터를 저장합니다.` }],
      note: `다음으로 /stats ${symbol} 을 실행하세요.`,
    };
  }

  if (symbol && wantsAnalyze) {
    return {
      ok: true,
      input,
      intent: 'analyze',
      steps: [{ command: `stats ${symbol}`, reason: `${symbol} 저장 데이터의 수익률/변동성/추세를 확인합니다.` }],
      note: '데이터가 없으면 먼저 /download <SYMBOL> 이 필요합니다.',
    };
  }

  if (symbol) {
    return {
      ok: true,
      input,
      intent: wantsSearch ? 'symbol-search' : 'symbol-search',
      steps: [{ command: `symbol search ${symbol} --limit 10`, reason: '심볼 후보를 live 검색합니다.' }],
      note: `원하는 후보가 맞으면 /download ${symbol} 로 데이터를 받으세요.`,
    };
  }

  for (const [pattern, command] of CATEGORY_ALIASES) {
    if (pattern.test(text)) {
      return {
        ok: true,
        input,
        intent: 'discover',
        steps: [{ command: `${command} --limit ${limit}`, reason: '시장 후보 목록을 실시간으로 찾습니다.' }],
        note: '후보를 고른 뒤 /download <SYMBOL> → /stats <SYMBOL> 순서로 진행하세요.',
      };
    }
  }

  return {
    ok: true,
    input,
    intent: 'help-next',
    steps: [{ command: 'next', reason: '현재 로컬 데이터 상태에서 다음 행동을 추천합니다.' }],
    note: '예: “TSM 1년치 받아서 분석해줘”, “많이 거래되는 종목 5개 찾아줘”.',
  };
}

export function formatNaturalPlan(plan: NaturalPlan): string {
  if (!plan.ok) return plan.note;
  const rows = plan.steps.map((step, index) => `${index + 1}. /${step.command}\n   - ${step.reason}`);
  return [
    `자연어 이해: ${plan.intent}`,
    '',
    ...rows,
    '',
    `note  ${plan.note}`,
  ].join('\n');
}
