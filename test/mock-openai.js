(() => {
  if (window.__mockInstalled) return 'already installed';
  window.__mockInstalled = true;
  window.__mockCalls = [];
  window.__mockUploads = [];
  window.__mockDeletes = [];
  window.__mockTokenCalls = [];
  window.__mockRevoked = [];
  window.__mockPlanEvents = [];
  window.__mockOnce = {};
  window.__mockResponseCount = 0;
  window.__mockSeq = 0;
  window.__mockProxyHits = 0;
  const DEFAULTS = {
    slowTranslate: false, auth401AfterCalls: 0, summaryIncompleteOnce: false, unsupportedParamOnce: false, translateIncompleteOnce: false, rateLimitOnce: true,
    authNoPlanScope: false, refreshFails: false, revokeFails: false, refreshDelayMs: 0,
    planUnsupportedParamOnce: '', planUnsupportedParamAlways: '', planLimitOnce: false, planFailMidStreamOnce: false, planAdmission401Once: false, planAdmission401Always: false, planNotEligible: false, planUnavailableOnce: false, planContextOnce: false,
    exchangeFailOnce: false,
    planModelsFail: '', planModelsFailOnce: false,
    proxyMissing: false, proxyUpstreamDown: false
  };
  // sessionStorage 덮어쓰기는 OAuth 내비게이션 뒤에도 남아 있어 시나리오 중간에 knob을 바꿀 수 있다
  const cfg = () => {
    let over = null;
    try { over = JSON.parse(sessionStorage.getItem('__mock.cfg')); } catch { over = null; }
    return Object.assign({}, DEFAULTS, window.__mockCfg || {}, over || {});
  };
  const once = (k) => { if (window.__mockOnce[k]) return false; window.__mockOnce[k] = true; return true; };
  const realFetch = window.fetch.bind(window);
  const enc = new TextEncoder();

  const outline = {
    meta: {
      title_en: 'SparseFlow: Efficient Long-Context Attention via Learned Token Routing',
      title_ko: 'SparseFlow: 학습된 토큰 라우팅을 통한 효율적인 장문맥 attention',
      authors: ['Mina Seo', 'Jonas Keller', 'Priya Natarajan', 'Wei Zhang'],
      venue: 'ICLR 2026', year: 2026, arxiv_id: '2601.01234',
      abstract_ko: '본 연구는 장문맥 입력에서 attention의 이차 복잡도를 줄이기 위해 학습된 토큰 라우팅(token routing) 기법인 SparseFlow를 제안한다. 라우터(router)는 각 토큰을 소수의 전문가 블록으로 보내며, 전체 계산량은 시퀀스 길이에 대해 준선형(sub-linear)으로 증가한다. 128K 토큰 길이에서 기존 dense attention 대비 3.1배 빠른 처리량을 달성하면서 long-context 벤치마크 정확도는 0.4 point 이내로 유지되었다.',
      keywords_ko: ['장문맥 모델링(long-context modeling)', '희소 attention(sparse attention)', '토큰 라우팅(token routing)', '효율적 Transformer', '혼합 전문가(mixture of experts)'],
    },
    outline: [
      { number: '', title_en: 'Abstract', title_ko: '초록', start_page: 1, end_page: 1, kind: 'abstract' },
      { number: '1', title_en: 'Introduction', title_ko: '서론', start_page: 1, end_page: 2, kind: 'body' },
      { number: '2', title_en: 'Background', title_ko: '배경', start_page: 2, end_page: 3, kind: 'body' },
      { number: '3', title_en: 'Model Architecture', title_ko: '모델 구조', start_page: 3, end_page: 10, kind: 'body' },
      { number: '4', title_en: 'Experiments', title_ko: '실험', start_page: 10, end_page: 12, kind: 'body' },
      { number: '5', title_en: 'Conclusion', title_ko: '결론', start_page: 12, end_page: 13, kind: 'body' },
      { number: '', title_en: 'References', title_ko: '참고문헌', start_page: 13, end_page: 14, kind: 'references' },
      { number: 'A', title_en: 'Additional Results', title_ko: '추가 결과', start_page: 14, end_page: 15, kind: 'appendix' },
    ],
    total_pages: 15,
    glossary: [
      { en: 'token routing', ko: '토큰 라우팅' }, { en: 'router', ko: '라우터' }, { en: 'sparse attention', ko: '희소 attention' },
      { en: 'dense attention', ko: 'dense attention' }, { en: 'throughput', ko: '처리량' }, { en: 'load balancing loss', ko: '부하 균형 손실' },
      { en: 'expert block', ko: '전문가 블록' }, { en: 'context length', ko: '문맥 길이' }, { en: 'perplexity', ko: 'perplexity' },
      { en: 'ablation study', ko: '제거 실험' }, { en: 'needle-in-a-haystack', ko: '건초더미 속 바늘(needle-in-a-haystack)' }, { en: 'pre-training', ko: '사전학습' },
    ],
  };

  const summary = {
    tldr_ko: '장문맥 attention의 이차 비용을 줄이기 위해 학습된 토큰 라우팅(SparseFlow)을 제안하여 128K 길이에서 3.1배 빠른 처리량과 0.4 point 이내의 정확도 손실을 달성하였다.',
    glance: {
      problem: '시퀀스 길이에 대해 이차로 증가하는 attention 비용 때문에 128K 이상 문맥에서는 학습·추론이 비현실적으로 느리다.',
      method: '경량 라우터가 토큰을 소수의 전문가 블록으로 보내는 학습된 희소화로 계산량을 준선형으로 낮춘다.',
      result: '128K 토큰에서 처리량 3.1배, LongBench 평균 점수는 dense 대비 -0.4 point로 거의 동일하다.',
    },
    sections: {
      problem_definition: '본 논문은 **장문맥 언어 모델링**에서 attention 연산의 비용 문제를 다룬다. 표준 attention은 시퀀스 길이 $n$에 대해 $O(n^2 d)$의 계산량을 가지며, 저자들은 128K 토큰 입력에서 전체 forward 시간의 71%가 attention에 소모됨을 보고한다(표 1).\n\n기존 희소 attention 기법은 고정 패턴(sliding window, dilated)에 의존하여 멀리 떨어진 토큰 간의 의존성을 놓치며, 저자들은 이를 건초더미 속 바늘(needle-in-a-haystack) 과제에서 정확도가 61.2%까지 떨어지는 사례로 뒷받침한다.\n\n연구 질문은 "어떤 토큰 쌍을 계산할지 데이터로부터 학습할 수 있는가"이며, 기여는 (1) 학습된 토큰 라우팅 구조, (2) 부하 균형 손실(load balancing loss), (3) 4개 벤치마크에서의 검증이다.',
      proposed_method: 'SparseFlow는 각 층에 경량 라우터 $r(x_i) = \\mathrm{softmax}(W_r x_i)$를 두어 토큰 $x_i$를 $k$개의 전문가 블록 중 상위 2개로 보낸다. 각 전문가 블록 내부에서만 attention을 계산하므로 비용은 $O(n \\cdot n/k \\cdot d)$가 된다.\n\n학습 목표는 언어 모델링 손실과 부하 균형 손실의 합이다:\n\n$$\\mathcal{L} = \\mathcal{L}_{LM} + \\lambda \\sum_{j=1}^{k} f_j \\cdot p_j$$\n\n여기서 $f_j$는 전문가 $j$로 보내진 토큰 비율, $p_j$는 평균 라우팅 확률이며 $\\lambda = 0.01$을 사용한다.\n\n기존 MoE가 FFN을 분할하는 것과 달리 SparseFlow는 attention 자체를 분할한다는 점이 본질적 차이다. 모델 크기는 1.3B, 사전학습 토큰은 300B이다.',
      results_and_strengths: '- **LongBench / 평균 점수 / dense baseline 대비**: 48.9 vs 48.5 (-0.4 point, 표 2)\n- **처리량 (128K, tokens/s)**: 1,420 → 4,400 (3.1배, 표 3)\n- **Needle-in-a-haystack 정확도**: 고정 패턴 희소화 61.2% → SparseFlow 97.8% (표 4)\n- **학습 perplexity (PG-19)**: 12.9 → 13.1 (+0.2, 표 2)\n\n제거 실험에서 부하 균형 손실을 제거하면 처리량이 2.2배로 떨어졌다(표 5). 장점은 장문맥에서의 큰 속도 향상, 고정 패턴 대비 장거리 의존성 보존, 기존 사전학습 체크포인트에서의 전환 가능성이다.',
      weaknesses_and_limitations: '### 단점\n- 비교 대상에 최신 선형 attention 계열(예: state-space 모델)이 빠져 있다(표 2의 비교 대상 구성).\n- 모든 실험이 단일 시드로 보고되어 통계적 유의성이 불분명하다.\n\n### 한계점\n- 저자들은 8K 이하 짧은 문맥에서는 라우터 오버헤드로 오히려 7% 느려진다고 밝힌다(5절).\n- 전문가 수 $k$가 32를 넘으면 품질이 급격히 저하된다.\n\n### 향후 과제\n- 라우터를 계층적으로 확장하여 1M 토큰까지 적용하는 것.',
      core_technology: '- **학습된 토큰 라우터** — 토큰을 전문가 블록에 배정 — softmax 게이트의 상위 2개 선택 (새로 고안)\n- **블록 내 attention** — 전문가 단위 attention 계산 — FlashAttention 커널 재사용 (차용)\n- **부하 균형 손실** — 전문가 쏠림 방지 — Switch Transformer의 보조 손실을 attention에 적용 (개선)\n- **연속 사전학습 전환** — dense 체크포인트에서 초기화 — 50B 토큰 추가 학습 (새로 고안)',
    },
    strengths: [
      '128K 토큰에서 처리량이 3.1배 향상된다(표 3).',
      '고정 패턴 희소화와 달리 장거리 의존성을 보존하여 needle 과제 정확도 97.8%를 달성한다.',
      '기존 dense 체크포인트에서 50B 토큰만으로 전환할 수 있다.',
      '추가 파라미터가 전체의 0.3%에 불과하다.',
    ],
    limitations: {
      weaknesses: ['최신 선형 attention·state-space 모델과의 비교가 없다.', '단일 시드 보고로 통계적 유의성이 불분명하다.', '코드와 가중치 공개 여부가 명시되지 않았다.'],
      stated_limitations: ['8K 이하 짧은 문맥에서는 라우터 오버헤드로 7% 느려진다.', '전문가 수 32 초과 시 품질이 급격히 저하된다.'],
      future_work: ['계층적 라우터로 1M 토큰까지 확장', '멀티모달 입력에 적용'],
    },
    pipeline: [
      { stage: '토큰 임베딩', description: '입력 토큰을 임베딩하고 위치 정보를 더한다.', input: '토큰 ID 시퀀스', output: '임베딩 벡터' },
      { stage: '라우터(Router)', description: '각 토큰의 라우팅 확률을 계산하고 상위 2개 전문가를 고른다.', input: '임베딩 벡터', output: '토큰→전문가 배정' },
      { stage: '블록 내 attention', description: '같은 전문가에 배정된 토큰끼리만 attention을 계산한다.', input: '전문가별 토큰 묶음', output: '문맥화된 표현' },
      { stage: '병합·FFN', description: '전문가 출력을 원래 순서로 되돌리고 FFN을 적용한다.', input: '문맥화된 표현', output: '층 출력' },
      { stage: '[학습] 손실 계산', description: '언어 모델링 손실과 부하 균형 손실을 합산한다.', input: '층 출력, 라우팅 통계', output: '총 손실' },
    ],
    metrics: [
      { metric: 'LongBench 평균', dataset: 'LongBench', unit: 'point', higher_is_better: true, baseline_name: 'Dense (1.3B)', baseline_value: 48.9, proposed_value: 48.5, source: 'Table 2', note: '동일 사전학습 데이터' },
      { metric: '처리량', dataset: '128K 토큰', unit: 'tokens/s', higher_is_better: true, baseline_name: 'Dense (1.3B)', baseline_value: 1420, proposed_value: 4400, source: 'Table 3', note: 'A100 80GB 1장' },
      { metric: 'Needle 정확도', dataset: 'NIAH 128K', unit: '%', higher_is_better: true, baseline_name: 'Sliding window', baseline_value: 61.2, proposed_value: 97.8, source: 'Table 4', note: '' },
      { metric: 'Perplexity', dataset: 'PG-19', unit: '-', higher_is_better: false, baseline_name: 'Dense (1.3B)', baseline_value: 12.9, proposed_value: 13.1, source: 'Table 2', note: '낮을수록 좋음' },
      { metric: '학습 비용', dataset: '300B 토큰', unit: 'GPU-h', higher_is_better: false, baseline_name: 'Dense (1.3B)', baseline_value: 9800, proposed_value: 6100, source: 'Section 4.3', note: '' },
      { metric: '추가 파라미터', dataset: '-', unit: '%', higher_is_better: false, baseline_name: '-', baseline_value: null, proposed_value: 0.3, source: 'Section 3.2', note: '라우터 가중치' },
    ],
    scores: {
      novelty: { score: 4, rationale: 'attention 자체를 라우팅으로 분할한 점은 기존 MoE 연구와 구별된다.' },
      rigor: { score: 3, rationale: '4개 벤치마크와 제거 실험이 있으나 단일 시드이다.' },
      reproducibility: { score: 2, rationale: '하이퍼파라미터는 공개되었으나 코드·가중치 공개가 명시되지 않았다.' },
      clarity: { score: 4, rationale: '수식과 그림이 명확하고 절 구성이 따라가기 쉽다.' },
      impact: { score: 4, rationale: '장문맥 추론 비용은 널리 공유되는 문제이다.' },
    },
    core_tech: [
      { name: '학습된 토큰 라우터(learned token router)', category: 'architecture', role: '토큰을 전문가 블록에 배정하는 핵심 구성요소(새로 제안)', description: '각 토큰에 대해 softmax 게이트를 계산하고 상위 2개 전문가를 선택한다. 라우팅 확률은 미분 가능하여 end-to-end로 학습된다.' },
      { name: '블록 내 attention', category: 'architecture', role: '전문가 단위로 attention을 제한(차용)', description: '같은 전문가에 속한 토큰끼리만 attention을 계산하여 비용을 줄인다.' },
      { name: '부하 균형 손실', category: 'objective_loss', role: '전문가 쏠림 방지(개선)', description: 'Switch Transformer의 보조 손실을 attention 라우팅에 맞게 변형하였다.' },
      { name: '연속 사전학습 전환', category: 'training', role: 'dense 모델에서 초기화(새로 제안)', description: 'dense 체크포인트에서 시작해 50B 토큰을 추가 학습한다.' },
      { name: 'FlashAttention 커널', category: 'system_infra', role: '블록 내 attention 가속(차용)', description: '전문가별 묶음을 하나의 배치로 묶어 커널을 재사용한다.' },
      { name: 'LongBench·NIAH 평가', category: 'evaluation', role: '장문맥 성능 검증(차용)', description: '표준 장문맥 벤치마크와 바늘 찾기 과제로 품질을 측정한다.' },
    ],
    meta: { title_ko: 'SparseFlow: 학습된 토큰 라우팅을 통한 효율적인 장문맥 attention', domain_ko: '자연어처리 / 효율적 Transformer', confidence: 'high', notes: '' },
  };

  function translationFor(perCall) {
    const m = perCall.match(/^- 섹션:\s*(.+)$/m);
    const title = m ? m[1].trim() : '섹션';
    if (/참고문헌|References/i.test(title)) return '> 참고문헌 목록은 원문 13–14 페이지를 참조한다. (총 42편)\n';
    return [
      `## ${title}`,
      '',
      '본 절에서는 제안 기법의 구조를 설명한다. 라우터(router)는 각 토큰 $x_i$에 대해 라우팅 확률을 계산하며, 전문가 수 $k$가 커질수록 블록 크기는 $n/k$로 줄어든다 [12]. 조건 $x < y$가 성립하면 토큰은 첫 번째 전문가로 보내진다.',
      '',
      '$$\\mathrm{Attention}(Q, K, V) = \\mathrm{softmax}\\left(\\frac{QK^{\\top}}{\\sqrt{d_k}}\\right) V \\quad (1)$$',
      '',
      '**그림 1.** SparseFlow 층의 전체 구조. 토큰은 라우터를 거쳐 전문가 블록으로 보내진다.',
      '',
      '**표 1.** 문맥 길이별 attention 시간 비율',
      '',
      '| 문맥 길이 | attention 비율 | 처리량 (tokens/s) |',
      '|---|---|---|',
      '| 8K | 23% | 18,200 |',
      '| 32K | 48% | 6,900 |',
      '| 128K | **71%** | 1,420 |',
      '',
      '- 라우팅 확률은 미분 가능하다.',
      '- 부하 균형 손실(load balancing loss)은 $\\lambda = 0.01$로 가중한다.',
      '',
      '```python',
      'def route(x, W_r, k=2):',
      '    return topk(softmax(x @ W_r), k)',
      '```',
      '',
      '<script>alert("xss")</script> 이 문장은 살균 검증용이다. 밑줄_변수_이름과 *강조* 표기도 포함한다 [각주 1].',
      '',
      '**각주**',
      '',
      '1. 모든 실험은 A100 80GB 1장에서 수행되었다.',
      '',
    ].join('\n');
  }

  const abortError = () => new DOMException('The user aborted a request.', 'AbortError');
  const sleep = (ms, signal) => new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(abortError());
    const t = setTimeout(() => { if (signal) signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(abortError()); };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
  const jsonResponse = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
  const usage = (out) => ({ input_tokens: 21000, input_tokens_details: { cached_tokens: 18000 }, output_tokens: out, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 21000 + out });

  function fullResponse(model, text, status = 'completed') {
    return {
      id: 'resp_mock', object: 'response', created_at: 1762300000, model, status,
      error: null, incomplete_details: status === 'incomplete' ? { reason: 'max_output_tokens' } : null,
      output: [
        { type: 'reasoning', id: 'rs_mock', summary: [] },
        { type: 'message', id: 'msg_mock', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] },
      ],
      usage: usage(Math.ceil(text.length / 3)),
    };
  }
  function failedResponse(model, error) {
    return { id: 'resp_mock', object: 'response', created_at: 1762300000, model, status: 'failed', error, incomplete_details: null, output: [], usage: null };
  }

  function sseStream(model, text, { chunkSize = 28, delay = 8, status = 'completed', signal = null, failAfterFirstDelta = null } = {}) {
    let seq = 0;
    const aborted = () => !!(signal && signal.aborted);
    const ev = (type, extra) => `event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: seq++, ...extra })}\n\n`;
    const pieces = [];
    for (let i = 0; i < text.length; i += chunkSize) pieces.push(text.slice(i, i + chunkSize));
    return new ReadableStream({
      async start(controller) {
        if (signal) signal.addEventListener('abort', () => { try { controller.error(abortError()); } catch {} }, { once: true });
        const base = { id: 'resp_mock', object: 'response', status: 'in_progress', output: [] };
        controller.enqueue(enc.encode(ev('response.created', { response: base })));
        controller.enqueue(enc.encode(ev('response.in_progress', { response: base })));
        controller.enqueue(enc.encode(ev('response.output_item.added', { output_index: 0, item: { type: 'reasoning', id: 'rs_mock', summary: [] } })));
        controller.enqueue(enc.encode(ev('response.output_item.added', { output_index: 1, item: { type: 'message', id: 'msg_mock', role: 'assistant', status: 'in_progress', content: [] } })));
        controller.enqueue(enc.encode(ev('response.content_part.added', { item_id: 'msg_mock', output_index: 1, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } })));
        for (const p of pieces) {
          await new Promise(r => setTimeout(r, delay));
          if (aborted()) return;
          controller.enqueue(enc.encode(ev('response.output_text.delta', { item_id: 'msg_mock', output_index: 1, content_index: 0, delta: p, logprobs: [] })));
          if (failAfterFirstDelta) {
            controller.enqueue(enc.encode(ev('response.failed', { response: failedResponse(model, failAfterFirstDelta) })));
            controller.close();
            return;
          }
        }
        if (aborted()) return;
        controller.enqueue(enc.encode(ev('response.output_text.done', { item_id: 'msg_mock', output_index: 1, content_index: 0, text, logprobs: [] })));
        controller.enqueue(enc.encode(ev(status === 'incomplete' ? 'response.incomplete' : 'response.completed', { response: fullResponse(model, text, status) })));
        controller.close();
      },
    });
  }

  const ISSUED_CLIENT = 'oaiapp_test';
  const RESOURCE = 'https://api.openai.com/v1';
  const PLAN_SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
  const IDENTITY_SCOPE = 'openid profile email offline_access resource.invoke';
  const LIMIT_CODE = 'subscription_sharing_usage_limit_exceeded';
  const LIMIT_MSG = 'ChatGPT plan usage limit reached for this app.';
  const PLAN_MODELS = [
    { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1 Sol', visibility: 'list' },
    { slug: 'gpt-6.1-mini', display_name: 'GPT-6.1 Mini', visibility: 'list' },
    { slug: 'hidden-model', display_name: 'Hidden', visibility: 'hidden' },
  ];
  const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  async function s256(verifier) { return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(verifier)))); }
  // 브라우저는 서명을 검증할 수 없으므로 클레임만 담고 서명 세그먼트는 가짜로 채운다
  function idToken(clientId, nonce) {
    const now = Math.floor(Date.now() / 1000);
    const payload = { iss: 'https://auth.openai.com', aud: clientId, sub: 'user_test', exp: now + 3600, iat: now, email: 'tester@example.com', name: 'Tester' };
    if (nonce) payload.nonce = nonce;
    return [b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'mock' }))), b64url(enc.encode(JSON.stringify(payload))), 'mock-signature'].join('.');
  }
  // 토큰 회전 상태는 내비게이션·새로고침을 넘어야 하므로 sessionStorage에 둔다 (seq = 마지막으로 발급한 번호)
  const AUTH_KEY = '__mock.auth';
  const authStore = {
    get() { try { return Object.assign({ seq: 0, usedCodes: [] }, JSON.parse(sessionStorage.getItem(AUTH_KEY)) || {}); } catch { return { seq: 0, usedCodes: [] }; } },
    set(v) { try { sessionStorage.setItem(AUTH_KEY, JSON.stringify(v)); } catch { /* 저장 불가 */ } },
  };
  // 인가 단계는 Playwright 라우트가 처리하므로 challenge·code·nonce는 노출 함수(또는 전역 객체)로 받는다
  async function pendingAuth() {
    try { return typeof window.__mockAuth === 'function' ? await window.__mockAuth() : (window.__mockAuth || null); } catch { return null; }
  }
  function formParams(body) {
    if (body instanceof URLSearchParams) return body;
    if (typeof body === 'string') return new URLSearchParams(body);
    if (body && typeof body.get === 'function') return body;
    return new URLSearchParams();
  }
  function bearerOf(headers) {
    if (!headers) return '';
    if (typeof headers.get === 'function') return headers.get('authorization') || '';
    return headers.Authorization || headers.authorization || '';
  }
  const oauthError = (error, description, status = 400) => jsonResponse({ error, error_description: description }, status);
  function tokenResponse({ seq, scope, nonce, withId }) {
    const body = { access_token: `oat-${seq}`, refresh_token: `rt-${seq}`, token_type: 'Bearer', expires_in: 3600, scope, earliest_refresh_at: new Date(Date.now() + 60000).toISOString() };
    if (withId) body.id_token = idToken(ISSUED_CLIENT, nonce);
    return jsonResponse(body);
  }
  async function authFetch(url, init) {
    const method = (init.method || 'GET').toUpperCase();
    const path = new URL(url).pathname;
    if (path === '/.well-known/openid-configuration') {
      return jsonResponse({ issuer: 'https://auth.openai.com', authorization_endpoint: 'https://auth.openai.com/api/accounts/authorize', token_endpoint: 'https://auth.openai.com/api/accounts/oauth/token', revocation_endpoint: 'https://auth.openai.com/api/accounts/oauth/revoke', jwks_uri: 'https://auth.openai.com/.well-known/jwks.json' });
    }
    if (method !== 'POST') return oauthError('invalid_request', 'unmocked ' + method + ' ' + path, 404);
    const p = formParams(init.body);
    const c = cfg();
    const st = authStore.get();
    if (path === '/api/accounts/oauth/revoke') {
      const token = p.get('token') || '';
      window.__mockRevoked.push({ seq: ++window.__mockSeq, tokenTypeHint: p.get('token_type_hint'), clientId: p.get('client_id'), tokenIsCurrentRefresh: st.seq ? token === `rt-${st.seq}` : /^rt-\d+$/.test(token) });
      return new Response('', { status: c.revokeFails ? 500 : 200 });
    }
    if (path !== '/api/accounts/oauth/token') return oauthError('invalid_request', 'unmocked POST ' + path, 404);
    const grant = p.get('grant_type');
    const rec = { seq: ++window.__mockSeq, grant, ok: false, error: null };
    window.__mockTokenCalls.push(rec);
    const fail = (error, description) => { rec.error = error; return oauthError(error, description); };
    if (p.get('client_id') !== ISSUED_CLIENT) return fail('invalid_client', 'unknown client_id');
    const scope = c.authNoPlanScope ? IDENTITY_SCOPE : PLAN_SCOPE;
    if (grant === 'authorization_code') {
      const pending = await pendingAuth();
      if (!pending || p.get('code') !== pending.code || st.usedCodes.includes(pending.code)) return fail('invalid_grant', 'unknown or reused code');
      if (p.get('redirect_uri') !== pending.redirectUri) return fail('invalid_grant', 'redirect_uri mismatch');
      if (p.get('resource') !== RESOURCE) return fail('invalid_target', 'resource mismatch');
      if (!p.get('code_verifier') || (await s256(p.get('code_verifier'))) !== pending.challenge) return fail('invalid_grant', 'PKCE verification failed');
      // 첫 교환만 실패시킨다. 플래그는 내비게이션을 넘어야 하므로 authStore에 둔다
      if (c.exchangeFailOnce && !st.exchangeFailed) { st.exchangeFailed = true; st.usedCodes.push(pending.code); authStore.set(st); return fail('invalid_grant', 'authorization code is invalid or expired'); }
      st.seq += 1;
      st.usedCodes.push(pending.code);
      authStore.set(st);
      rec.ok = true;
      return tokenResponse({ seq: st.seq, scope, nonce: pending.nonce, withId: true });
    }
    if (grant === 'refresh_token') {
      // 갱신 요청이 오래 걸리는 동안 사용자가 중단하는 경우를 재현한다
      if (c.refreshDelayMs) await sleep(c.refreshDelayMs, init.signal || null);
      if (c.refreshFails) return fail('invalid_grant', 'refresh token is not valid');
      const m = /^rt-(\d+)$/.exec(p.get('refresh_token') || '');
      if (!m) return fail('invalid_grant', 'unknown refresh token');
      const n = Number(m[1]);
      if (st.seq && n < st.seq) return fail('refresh_token_reused', 'refresh token already rotated');
      if (st.seq && n > st.seq) return fail('invalid_grant', 'unknown refresh token');
      st.seq = n + 1;
      authStore.set(st);
      rec.ok = true;
      return tokenResponse({ seq: st.seq, scope, nonce: null, withId: false });
    }
    return fail('unsupported_grant_type', String(grant));
  }

  const planError = (code, status, param, message) => jsonResponse({ error: { message, type: 'invalid_request_error', param, code } }, status);
  function planViolation(body) {
    for (const k of ['max_output_tokens', 'metadata', 'safety_identifier']) if (k in body) return k;
    if (body.store !== false) return 'store';
    if (body.stream !== true) return 'stream';
    if (!Array.isArray(body.input)) return 'input';
    for (let i = 0; i < body.input.length; i++) {
      const item = body.input[i] || {};
      if (item.role === 'system') return `input[${i}].role`;
      const content = Array.isArray(item.content) ? item.content : [];
      for (let j = 0; j < content.length; j++) if (content[j] && 'file_id' in content[j]) return `input[${i}].content[${j}].file_id`;
    }
    return null;
  }
  function hasPath(obj, path) {
    let cur = obj;
    for (const seg of String(path).replace(/\[(\d+)\]/g, '.$1').split('.')) {
      if (cur == null || typeof cur !== 'object' || !(seg in cur)) return false;
      cur = cur[seg];
    }
    return true;
  }
  // 플랜 경로에는 metadata가 없고 text.format도 제거될 수 있어 프롬프트 본문으로 작업 종류를 판별한다
  function inferTask(body, perCall) {
    if (body.metadata && body.metadata.task) return body.metadata.task;
    const name = body.text && body.text.format && body.text.format.name;
    if (name === 'paper_outline') return 'outline';
    if (name === 'paper_summary') return 'summary';
    if (/\[outline\]|total_pages/.test(perCall)) return 'outline';
    if (/tldr_ko/.test(perCall)) return 'summary';
    return 'translate';
  }
  function planGate(body, task, c, seq) {
    const event = (kind, extra) => { window.__mockPlanEvents.push(Object.assign({ kind, seq, task }, extra || {})); };
    if ((c.planAdmission401Once && once('planAdmission401')) || c.planAdmission401Always) { event('admission401'); return jsonResponse({ detail: 'Identity or permission not accepted for direct route.' }, 401); }
    if (c.planNotEligible) { event('notEligible'); return planError('subscription_sharing_user_not_eligible', 403, null, 'ChatGPT plan usage is not available for this user or workspace.'); }
    if (c.planUnavailableOnce && once('planUnavailable')) { event('unavailable'); return planError('subscription_sharing_usage_unavailable', 503, null, 'Usage availability could not be checked.'); }
    const bad = planViolation(body);
    if (bad) { event('violation', { param: bad }); return planError('subscription_sharing_unsupported_capability', 400, bad, `Unsupported parameter: '${bad}' is not supported with ChatGPT plan usage.`); }
    const p = c.planUnsupportedParamOnce;
    if (p && hasPath(body, p) && once('planParam')) { event('paramOnce', { param: p }); return planError('subscription_sharing_unsupported_capability', 400, p, `Unsupported parameter: '${p}' is not supported with ChatGPT plan usage.`); }
    // 경로가 남아 있는 한 매번 거부한다: 앱이 경로를 세션에 기록해 이후 호출부터 빼는지 확인하는 용도
    const pa = c.planUnsupportedParamAlways;
    if (pa && hasPath(body, pa)) { event('paramAlways', { param: pa }); return planError('subscription_sharing_unsupported_capability', 400, pa, `Unsupported parameter: '${pa}' is not supported with ChatGPT plan usage.`); }
    if (task === 'translate' && c.planLimitOnce && once('planLimit')) { event('limit429'); return planError(LIMIT_CODE, 429, null, LIMIT_MSG); }
    // 플랜 전용이 아닌 400(param 포함)은 파라미터 제거 대상이 아니어야 한다
    if (task === 'translate' && c.planContextOnce && once('planContext')) { event('contextLength', { param: 'input' }); return planError('context_length_exceeded', 400, 'input', 'Your input exceeds the context window of this model.'); }
    return null;
  }

  const PROXY_PREFIX = '/__rpt/openai';
  // 중계 기능이 없는 정적 서버(python -m http.server)의 응답: GET·HEAD는 HTML 404, POST·DELETE는 do_POST가 없어 HTML 501
  const htmlError = (status, message) => new Response(`<!DOCTYPE HTML>\n<html><head><title>Error response</title></head><body><h1>Error response</h1><p>Error code: ${status}</p><p>Message: ${message}</p></body></html>`, { status, headers: { 'content-type': 'text/html;charset=utf-8' } });
  const staticServerError = (method) => (method === 'GET' || method === 'HEAD' ? htmlError(404, 'File not found.') : htmlError(501, `Unsupported method ('${method}').`));
  // serve.py가 api.openai.com에 연결하지 못했을 때의 502
  const upstreamDown = () => jsonResponse({ error: { message: 'OpenAI 서버에 연결하지 못했습니다.', code: 'proxy_upstream' } }, 502);

  window.fetch = async (input, init = {}) => {
    let url = typeof input === 'string' ? input : input.url;
    const method = (init.method || 'GET').toUpperCase();
    let viaProxy = false;
    let u = null;
    try { u = new URL(url, location.href); } catch { u = null; }
    // 같은 주소의 /__rpt/ 경로는 serve.py처럼 동작한다: 상태 확인에 답하고 중계 호출은 api.openai.com 주소로 되돌려 아래 API mock에 넘긴다
    if (u && u.origin === location.origin) {
      if (u.pathname === '/__rpt/health') return cfg().proxyMissing ? staticServerError(method) : jsonResponse({ ok: true, proxy: true, version: '1.2.0' });
      if (u.pathname.startsWith(PROXY_PREFIX + '/')) {
        // API mock까지 가지 못한 중계 호출 수: 앱이 재시도 없이 멈추는지 확인하는 용도
        if (cfg().proxyMissing) { window.__mockProxyHits++; return staticServerError(method); }
        if (cfg().proxyUpstreamDown) { window.__mockProxyHits++; return upstreamDown(); }
        url = 'https://api.openai.com' + u.pathname.slice(PROXY_PREFIX.length) + u.search;
        viaProxy = true;
      }
    }
    if (/^https:\/\/auth\.openai\.com\//.test(url)) return authFetch(url, init);
    if (!/^https:\/\/api\.openai\.com/.test(url)) return realFetch(input, init);
    const signal = init.signal || null;
    if (signal && signal.aborted) throw abortError();
    const auth = bearerOf(init.headers);
    if (!/^Bearer \S+/.test(auth)) return jsonResponse({ error: { message: 'Missing bearer', type: 'invalid_request_error', param: null, code: 'invalid_api_key' } }, 401);
    const plan = /^Bearer oat-/.test(auth);
    if (plan && !/^Bearer oat-\d+$/.test(auth)) return jsonResponse({ detail: 'invalid access token' }, 401);
    if (url.endsWith('/v1/models')) {
      if (plan) {
        const c = cfg();
        const mode = c.planModelsFail;
        if (mode && (!c.planModelsFailOnce || once('planModelsFail'))) {
          if (mode === 'network') throw new TypeError('Failed to fetch');
          if (mode === 'forbidden') return planError('subscription_sharing_user_not_eligible', 403, null, 'This user is not eligible for ChatGPT plan usage.');
          if (mode === 'hidden') return jsonResponse({ models: PLAN_MODELS.map((m) => ({ ...m, visibility: 'hidden' })) });
          if (mode === 'legacy') return jsonResponse({ object: 'list', data: ['gpt-5.4-mini', 'gpt-5.4', 'o3'].map((id) => ({ id, object: 'model' })) });
        }
        return jsonResponse({ models: PLAN_MODELS });
      }
      if (/BADKEY/.test(auth)) return jsonResponse({ error: { message: 'Incorrect API key provided', type: 'invalid_request_error', param: null, code: 'invalid_api_key' } }, 401);
      return jsonResponse({ object: 'list', data: ['gpt-5.4-mini', 'gpt-5.4', 'gpt-5.4-2026-03-05', 'gpt-5.5', 'gpt-5.5-pro', 'gpt-5-mini', 'gpt-4.1', 'gpt-5.6-luna', 'gpt-4o-realtime', 'o3'].map(id => ({ id, object: 'model', owned_by: 'openai' })) });
    }
    if (url.includes('/v1/files')) {
      if (plan) {
        if (method === 'DELETE') window.__mockDeletes.push(url); else window.__mockUploads.push({ plan: true });
        return planError('subscription_sharing_route_not_supported', 403, null, 'This route is not supported with ChatGPT plan usage.');
      }
      if (method === 'DELETE') { window.__mockDeletes.push(url); return jsonResponse({ id: 'file-mock', object: 'file', deleted: true }); }
      const fd = init.body;
      const get = (k) => (fd && typeof fd.get === 'function' ? fd.get(k) : null);
      const f = get('file');
      window.__mockUploads.push({ purpose: get('purpose'), anchor: get('expires_after[anchor]'), seconds: get('expires_after[seconds]'), name: f && f.name, size: f && f.size, type: f && f.type });
      return jsonResponse({ id: 'file-mock', object: 'file', bytes: 123456, created_at: 1762300000, filename: 'upload.pdf', purpose: 'user_data', status: 'processed' });
    }
    if (url.endsWith('/v1/responses') && method === 'POST') {
      const body = JSON.parse(init.body);
      const items = Array.isArray(body.input) ? body.input : [];
      const msg = items[items.length - 1] || {};
      const texts = (Array.isArray(msg.content) ? msg.content : [{ type: 'input_text', text: String(msg.content || '') }]).filter(p => p.type === 'input_text').map(p => p.text);
      const perCall = texts[texts.length - 1] || '';
      const task = inferTask(body, perCall);
      const seq = ++window.__mockSeq;
      window.__mockCalls.push(Object.assign({}, body, { auth: plan ? 'plan' : 'key', task, seq, viaProxy }));
      const n = ++window.__mockResponseCount;
      const c = cfg();
      if (plan) {
        const rejected = planGate(body, task, c, seq);
        if (rejected) return rejected;
      } else if (c.auth401AfterCalls && n > c.auth401AfterCalls) {
        return jsonResponse({ error: { message: 'Incorrect API key provided', type: 'invalid_request_error', param: null, code: 'invalid_api_key' } }, 401);
      }
      if (c.unsupportedParamOnce && task === 'outline' && body.reasoning && once('unsupported')) return jsonResponse({ error: { message: "Unsupported parameter: 'reasoning.effort' is not supported with this model.", type: 'invalid_request_error', param: 'reasoning.effort', code: 'unsupported_parameter' } }, 400);
      let text;
      let status = 'completed';
      if (task === 'outline') text = JSON.stringify(outline);
      else if (task === 'summary') {
        text = JSON.stringify(summary);
        if (c.summaryIncompleteOnce && once('summaryIncomplete')) { text = text.slice(0, 1500); status = 'incomplete'; }
      } else {
        if (c.rateLimitOnce && /\(계속, 2\/2\)/.test(perCall) && once('429')) return jsonResponse({ error: { message: 'Rate limit reached for requests', type: 'rate_limit_error', param: null, code: 'rate_limit_exceeded' } }, 429);
        text = translationFor(perCall);
        if (c.translateIncompleteOnce && once('translateIncomplete')) { text = text.slice(0, 420); status = 'incomplete'; }
      }
      // text.format 없이 JSON을 요청받으면 실제 모델처럼 코드 펜스를 두른다 (관대한 파서 검증용)
      if (plan && (task === 'outline' || task === 'summary') && !(body.text && body.text.format)) text = '```json\n' + text + '\n```';
      await sleep(task === 'translate' ? 100 : 400, signal);
      let failAfterFirstDelta = null;
      if (plan && task === 'translate' && c.planFailMidStreamOnce && once('planFailMid')) {
        window.__mockPlanEvents.push({ kind: 'failMidStream', seq, task });
        failAfterFirstDelta = { code: LIMIT_CODE, message: LIMIT_MSG };
      }
      const opts = task === 'translate' ? { chunkSize: 28, delay: c.slowTranslate ? 45 : 8, status, signal, failAfterFirstDelta } : { chunkSize: 400, delay: 2, status, signal };
      if (body.stream) return new Response(sseStream(body.model, text, opts), { status: 200, headers: { 'content-type': 'text/event-stream' } });
      return jsonResponse(fullResponse(body.model, text, status));
    }
    return jsonResponse({ error: { message: 'unmocked ' + method + ' ' + url, type: 'invalid_request_error', param: null, code: null } }, 404);
  };
  return 'mock installed';
})();
