(function () {
  'use strict';

  const SYSTEM = `당신은 인공지능·컴퓨터과학·공학 분야 학술 논문을 전문으로 다루는 수석 번역가이자 논문 분석가이다. 사용자는 논문 PDF 전문을 input_file로 첨부하며, 당신은 오직 그 논문의 내용만을 근거로 작업한다.

[공통 원칙]
1. 모든 자연어 출력은 한국어로 작성한다. 단, JSON 필드명, LaTeX 수식, 코드, 인용 표기([12], (Vaswani et al., 2017) 등), 고유명사(모델명·데이터셋명·벤치마크명·기관명·인명·라이브러리명)는 원문 영어 그대로 둔다.
2. 논문에 없는 사실·수치·주장을 만들어 내지 않는다. 수치는 논문의 표·그림·본문에서 자릿수까지 그대로 옮기며, 확인할 수 없으면 null 또는 "논문에 명시되지 않음"으로 처리한다. 추정한 값은 절대 숫자 필드에 넣지 않는다.
3. 전문용어 표기 규약: 용어가 한 출력물 안에서 처음 등장할 때 "한국어 번역(English term)" 형태로 병기하고, 이후에는 한국어 번역만 쓴다. 용어집(glossary)이 제공되면 그 표기를 반드시 우선한다. 영어 약어·고유명사로 굳어진 용어(Transformer, attention, BERT, GPU, softmax 등)는 억지로 번역하지 않고 영어로 둔다.
4. 문체는 학술 논문체(~이다, ~하였다, ~한다, ~된다)를 사용한다. 경어체(~입니다, ~해요)와 구어체는 쓰지 않는다.
5. 요청된 출력 형식(JSON 또는 마크다운) 이외의 머리말·맺음말·설명·사과·코드펜스(\`\`\`)를 덧붙이지 않는다.
6. 페이지 번호는 항상 PDF 파일의 물리적 페이지 순서(첫 장 = 1)를 기준으로 하며, 논문에 인쇄된 페이지 번호나 학회 프로시딩 페이지 번호는 사용하지 않는다.
7. 논문이 영어가 아닌 다른 언어로 쓰여 있어도 동일한 규칙으로 한국어로 작업한다.`;

  const COMMON_RULES = `[공통 규칙]
아래 규칙은 번역문·초록·요약 본문 등 모든 한국어 출력에 적용한다.
1. 완역 원칙: 지정 섹션의 모든 문장을 빠짐없이 번역한다. 요약·축약·의역에 의한 생략·문장 병합·내용 추가를 금지한다. 원문이 길어도 끝까지 번역한다.
2. 문체: 학술 논문체(~이다, ~하였다, ~한다)를 일관되게 사용한다. 'We propose'는 '본 연구는 ~을 제안한다', 'we show'는 '우리는 ~을 보인다/본 논문은 ~을 보인다'로 옮기고 경어체·구어체를 쓰지 않는다.
3. 전문용어: 용어집(glossary)에 있는 용어는 반드시 그 한국어 표기를 쓴다. 용어집에 없는 전문용어는 이 섹션 안에서 첫 등장 시 '한국어(English)'로 병기하고 이후에는 한국어만 쓴다. 영어로 굳어진 용어(attention, Transformer, softmax, fine-tuning 등 용어집이 영어로 지정한 것)는 영어로 둔다.
4. 고유명사 유지: 모델명(GPT-4, LLaMA-2), 데이터셋·벤치마크명(ImageNet, GLUE), 라이브러리·프레임워크명, 기관명, 인명, 알고리즘 고유명(Adam, AdamW)은 영어 원문 그대로 둔다. 약어는 첫 등장 시 '한국어 번역(Full Name, ABBR)' 형태로 풀고 이후 약어를 쓴다.
5. 수식: 인라인 수식은 $...$, 디스플레이 수식은 $$...$$ 로 감싸고 LaTeX 내용(기호, 첨자, \\text{} 안의 영어)은 변경하지 않는다. 식 번호 (1), (2)는 유지한다. 본문 안의 변수명·기호($\\theta$, $L$, $K$)도 수식 표기로 유지한다. 수식 구분자는 $...$ 와 $$...$$ 만 사용하며 \\[ \\], \\( \\), 구분자 밖의 \\begin{align} 같은 환경은 쓰지 않는다. 디스플레이 수식은 앞뒤에 빈 줄을 두고 한 줄에 단독으로 배치한다.
6. 인용 표기: [12], [3, 7], (Vaswani et al., 2017), Vaswani et al. (2017) 등 인용 마커는 번역·변형하지 않고 원래 위치에 그대로 둔다. 'et al.'을 '등'으로 바꾸지 않는다.
7. 그림·표: 캡션은 '**그림 N.** 번역문', '**표 N.** 번역문' 형식으로 번역한다. 표의 내용은 마크다운 표로 옮기되 숫자·굵은글씨·±·기호를 그대로 유지하고, 열/행 이름 중 전문용어만 번역한다. 그림 이미지는 생략하고 캡션만 남긴다. 본문의 'Figure 3', 'Table 2', 'Section 4.1', 'Eq. (5)', 'Appendix B'는 '그림 3', '표 2', '4.1절', '식 (5)', '부록 B'로 옮긴다.
8. 코드·알고리즘: 코드 블록과 알고리즘 의사코드는 코드펜스 안에 원문 그대로 둔다(주석 포함, 번역 금지). 알고리즘 제목만 '**알고리즘 N.** 번역문'으로 번역한다.
9. 제목·구조: 섹션/하위 섹션 제목은 원문 번호를 유지하여 '## 3 제목', '### 3.1 제목', '#### 3.1.2 제목'으로 쓴다. 최상위 제목은 '## 번호 한국어 제목(English Title)' 형식으로 영어 원제를 병기하고, 하위 제목은 한국어만 쓴다. 문단·목록·인용 블록 구조는 원문을 따른다.
10. 각주: [^n] 문법을 쓰지 않는다. 본문의 해당 위치에 '[각주 n]' 표시를 남기고, 섹션 끝에 '**각주**' 줄을 쓴 뒤 '[각주 n] 번역문' 형식의 목록으로 모아 번역한다. 페이지 머리글·꼬리글·페이지 번호·저작권/라이선스 문구·arXiv 워터마크는 제외한다.
11. 참고문헌 처리: 번역 대상이 References(참고문헌) 섹션이면 목록을 번역하지 않고 '> 참고문헌 목록은 원문 N–M 페이지를 참조한다. (총 K편)' 한 줄만 출력한다. 본문 섹션 안의 인용은 그대로 둔다.
12. 범위 엄수: 주어진 페이지 범위와 섹션 안의 내용만 번역한다. 시작 페이지에 남아 있는 직전 섹션 내용은 제외하고, 직후 섹션의 제목이 나타나면 그 직전에서 멈춘다. 직후 섹션 내용을 단 한 문장도 포함하지 않으며, 범위 밖 내용을 기억에 의존해 보충하지 않는다.
13. 분할된 섹션: 섹션이 페이지 범위로 나뉘어 주어진 경우(제목에 '(계속)' 표시) 해당 페이지의 내용만 번역하고, 문장이 페이지 경계에서 잘리면 보이는 부분까지만 번역한 뒤 멈춘다. 앞부분 분할에서는 하위 섹션 제목을 새로 만들지 않는다.
14. 출력 형식: 마크다운 본문만 출력한다. '다음은 번역입니다' 같은 머리말, 맺음말, 설명, 전체를 감싸는 코드펜스, 원문 영어 전문 병기, 번역자 주석을 금지한다. 불가피한 번역 주석이 필요하면 '(역주: ...)' 형태로 최소한만 쓴다.
15. 숫자·단위: 수치·소수점·퍼센트·단위(ms, GB, FLOPs)는 원문 그대로 유지한다. 'points'는 'point', '%p'는 그대로, 'x faster'는 '배 빠르다'로 옮긴다. 천 단위 구분 기호와 과학적 표기법도 변경하지 않는다.`;

  const OUTLINE_PROMPT = `첨부된 논문 PDF 전체를 읽고, 아래 요구사항에 맞는 JSON 하나만 출력하라. 이 결과는 이후 (1) 섹션별 번역 작업의 분할 기준과 (2) 용어 통일의 기준으로 사용되므로 정확한 페이지 범위와 일관된 용어집이 가장 중요하다.

[meta]
- title_en: 논문 원제목(영어 원문 그대로). title_ko: 자연스러운 한국어 제목.
- authors: 저자 전원을 논문 표기 순서대로, 영어 원문 그대로 (소속·이메일·각주 기호 제외).
- venue: 학회/저널명(예: "NeurIPS 2023", "ICLR 2024", "arXiv preprint"). 논문에서 확인되지 않으면 null.
- year: 논문에서 확인되는 발행/투고 연도(정수). 확인 불가 시 null. arXiv 논문이면 arXiv 식별자의 연도도 참고한다.
- arxiv_id: PDF 여백·첫 페이지·각주에서 확인되는 arXiv 식별자(예: "2305.12345", "2305.12345v2"). 없으면 null.
- abstract_ko: 논문 초록 전체를 요약 없이 한국어로 번역(학술체, 용어 병기 규약 준수).
- keywords_ko: 논문의 주제를 나타내는 한국어 키워드 5~10개(필요 시 "한국어(English)" 병기).

[outline]
- 문서의 최상위(top-level) 섹션만 나열한다. 하위 섹션(3.1, 3.2 …)은 포함하지 않는다.
- 문서 전체를 빠짐없이, 순서대로, 겹치지 않게 커버해야 한다: 첫 항목의 start_page는 1, 마지막 항목의 end_page는 total_pages, 그리고 각 항목의 start_page는 직전 항목의 end_page와 같거나 그보다 1 커야 한다(같은 페이지에서 섹션이 바뀌면 end_page와 다음 start_page가 같다).
- number: 논문의 섹션 번호를 그대로("1", "2", "A", "B"). 번호가 없는 섹션(Abstract, References, Acknowledgments, Appendix 머리말 등)은 "" (빈 문자열)로 둔다.
- title_en: 원문 섹션 제목 그대로. title_ko: 한국어 제목.
- kind: abstract(초록, 제목·저자 블록 포함), body(본문 1장~결론), references(참고문헌 목록), acknowledgments(사사), appendix(부록·보충자료·Supplementary·Broader Impact·Ethics Statement 등 참고문헌 뒤에 오는 모든 내용). 체크리스트(Checklist)나 Impact Statement도 appendix로 분류한다.
- 참고문헌(References)은 반드시 독립 항목으로 분리한다. 부록이 여러 개(A, B, C …)면 각각 독립 항목으로 나열한다.
- 섹션이 페이지 중간에서 시작/끝나더라도 해당 페이지를 범위에 포함한다.

[total_pages]
- PDF의 실제 전체 페이지 수(정수).

[glossary]
- 이 논문에서 반복적으로 쓰이며 번역 일관성이 중요한 핵심 전문용어 15~40개.
- en: 원문 표기(소문자 기본, 약어는 "full name (ABBR)" 형태, 예: "retrieval-augmented generation (RAG)").
- ko: 번역에 사용할 한국어 표기. 영어로 유지할 용어는 ko에 영어를 그대로 쓴다(예: en "attention", ko "attention").
- 우선순위: (1) 논문이 새로 제안·정의한 용어 및 방법 이름, (2) 제목·초록·기여(contribution) 문단에 등장하는 용어, (3) 수식 변수에 대응하는 개념어(예: "query", "key", "value"), (4) 평가 지표·데이터셋 관련 용어, (5) 분야 표준 용어.
- 모델명·데이터셋명·인명 등 고유명사는 넣지 않는다. 같은 개념의 변형 표기(단수/복수, 동사/명사형)는 하나로 합친다.
- 한국어 표기는 해당 분야에서 가장 널리 쓰이는 번역어를 택하고, 논문 내 모든 섹션에서 동일하게 쓸 수 있어야 한다.

[작은 예시] 12쪽짜리 논문의 outline 일부:
{"number":"","title_en":"Abstract","title_ko":"초록","start_page":1,"end_page":1,"kind":"abstract"},
{"number":"1","title_en":"Introduction","title_ko":"서론","start_page":1,"end_page":2,"kind":"body"},
{"number":"2","title_en":"Related Work","title_ko":"관련 연구","start_page":2,"end_page":3,"kind":"body"},
...
{"number":"","title_en":"References","title_ko":"참고문헌","start_page":9,"end_page":10,"kind":"references"},
{"number":"A","title_en":"Implementation Details","title_ko":"구현 세부사항","start_page":11,"end_page":12,"kind":"appendix"}
glossary 예시: {"en":"knowledge distillation","ko":"지식 증류"}, {"en":"self-attention","ko":"self-attention"}, {"en":"ablation study","ko":"제거 실험"}

스키마에 맞는 JSON 객체 하나만 출력하고 다른 텍스트는 출력하지 않는다.`;

  const OUTLINE_SCHEMA = {
    type: 'object',
    properties: {
      meta: {
        type: 'object',
        properties: {
          title_en: { type: 'string' },
          title_ko: { type: 'string' },
          authors: { type: 'array', items: { type: 'string' } },
          venue: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          year: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
          arxiv_id: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          abstract_ko: { type: 'string' },
          keywords_ko: { type: 'array', items: { type: 'string' } }
        },
        required: ['title_en', 'title_ko', 'authors', 'venue', 'year', 'arxiv_id', 'abstract_ko', 'keywords_ko'],
        additionalProperties: false
      },
      outline: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            number: { type: 'string' },
            title_en: { type: 'string' },
            title_ko: { type: 'string' },
            start_page: { type: 'integer' },
            end_page: { type: 'integer' },
            kind: { type: 'string', enum: ['body', 'abstract', 'references', 'appendix', 'acknowledgments'] }
          },
          required: ['number', 'title_en', 'title_ko', 'start_page', 'end_page', 'kind'],
          additionalProperties: false
        }
      },
      total_pages: { type: 'integer' },
      glossary: {
        type: 'array',
        items: {
          type: 'object',
          properties: { en: { type: 'string' }, ko: { type: 'string' } },
          required: ['en', 'ko'],
          additionalProperties: false
        }
      }
    },
    required: ['meta', 'outline', 'total_pages', 'glossary'],
    additionalProperties: false
  };

  const SUMMARY_PROMPT = `첨부된 논문 PDF 전체를 정독하고, 아래 요구사항에 맞는 JSON 하나만 출력하라. 이 결과는 독자가 논문을 읽지 않고도 핵심을 정확히 파악하고, 시각화(파이프라인 흐름도·지표 표·레이더 차트·장단점 비교·핵심기술 칩)를 그리는 데 사용된다. 그러므로 "풍부하되 정확하게", 특히 모든 수치는 논문에서 그대로 복사해야 한다.

{{GLOSSARY_BLOCK}}
(위 용어집이 비어 있지 않으면 그 한국어 표기를 반드시 따른다.)

[tldr_ko]
- 논문 전체를 한 문장(60자 내외)으로: "무엇을 위해 무엇을 제안하여 어떤 결과를 얻었다".

[glance] 한눈에 보기용 세 문장. problem(문제): 논문이 푸는 문제를 한 문장으로, method(방법): 제안 기법의 핵심을 한 문장으로, result(결과): 대표 결과를 한 문장으로(수치 포함 가능). 각각 한국어 한 문장(40자 내외)으로 쓴다.

[sections] 다섯 항목 모두 마크다운 문자열이며, 각 항목은 최소 3~6개 문단 또는 글머리 목록으로 충실히 채운다. 수식은 $...$로 쓸 수 있다.
1. problem_definition (문제정의): 논문이 다루는 과제(task)의 정의, 입력/출력, 기존 방법이 실패하는 지점과 그 원인, 왜 이 문제가 중요한지, 논문이 명시한 연구 질문 또는 기여(contribution) 목록. 기존 방법의 한계를 말할 때는 논문이 근거로 드는 수치나 사례를 함께 적는다.
2. proposed_method (해결방법(제안 기법)): 전체 구조 개요 → 각 구성요소의 동작 원리(핵심 수식 포함) → 학습 목표/손실 함수 → 학습·추론 절차 → 기존 방법과의 본질적 차이. 하이퍼파라미터·모델 크기·학습 데이터 규모 등 논문에 적힌 설정값을 구체적으로 포함한다.
3. results_and_strengths (결과(정확한 수치) 및 장점): 주요 실험 결과를 "데이터셋 / 지표 / 비교 대상 / 수치 / 개선폭" 형태로 기술한다. 모든 수치는 논문 표·그림에서 그대로(소수점 자릿수 포함) 옮기고 어느 표(Table N)에서 가져왔는지 적는다. 제거 실험(ablation), 효율성(속도·메모리·파라미터 수), 정성적 결과를 포함하고, 이 결과가 보여 주는 장점을 정리한다. 증가/감소 표현은 절대값 차이(예: +2.3 point)와 상대 비율(예: 12% 상대 향상)을 구분해 쓴다.
4. weaknesses_and_limitations (단점 및 한계점): 아래 세 범주를 소제목(### 단점, ### 한계점, ### 향후 과제)으로 나누어 기술한다. 단점은 저자가 인정하지 않더라도 비판적 독자가 지적할 문제(실험 설계의 공정성, 비교 대상의 적절성, 통계적 유의성 미보고, 재현 정보 부족, 일반화 가능성, 계산 비용 등), 한계점은 저자가 논문에서 직접 밝힌 제약, 향후 과제는 저자가 제안한 후속 연구 방향. 단점을 지적할 때 어떤 근거(어느 표, 어느 문단)에서 비롯된 판단인지 밝힌다.
5. core_technology (핵심기술): 논문을 이해·구현하는 데 반드시 알아야 할 기술 요소를 "기술명 — 역할 — 작동 방식" 형태로 나열하고, 선행 기술에서 가져온 것과 이 논문이 새로 고안한 것을 구분한다.

[strengths] 논문이 보여 주는 장점 2~6개. 각 항목은 한 문장이며 수치를 포함할 수 있다(예: "ImageNet top-1 83.4%로 ViT-B/16 대비 +1.6 point"). sections.results_and_strengths에 적은 장점과 일치해야 한다.

[limitations] sections.weaknesses_and_limitations의 내용을 시각화용으로 항목화한 것. weaknesses(단점), stated_limitations(저자가 밝힌 한계점), future_work(향후 과제) 각각 한 문장짜리 항목 2~6개. 항목이 없으면 빈 배열.

[pipeline] 제안 기법의 처리 흐름을 입력에서 출력까지 순서대로 3~8단계로 분해한다. stage: 단계 이름(짧게, 예: "검색기(Retriever)"), description: 그 단계가 하는 일 1~2문장, input: 들어오는 것, output: 나가는 것. 각 단계의 output이 다음 단계의 input과 자연스럽게 이어져야 한다. 학습 전용 단계(손실 계산 등)가 있으면 stage 이름에 "[학습]"을 붙인다.

[metrics] 시각화용 정량 결과. 규칙:
- 논문의 메인 결과 표에서 가장 중요한 비교를 4~12개 고른다. 각 항목은 하나의 (지표, 데이터셋, 베이스라인) 조합이다.
- baseline_value·proposed_value는 논문 표에 적힌 숫자를 그대로 옮긴다(소수점 자릿수 유지, 단위 기호·±·굵은글씨 표시 제거). 절대 계산·추정·반올림하지 않는다. 표에 없거나 읽을 수 없으면 null.
- 오차 범위(±)는 숫자에 넣지 않고 note에 적는다(예: "±0.3 (3 seeds)").
- baseline_name: 비교 대상 이름(표 표기 그대로, 예: "GPT-3.5 (zero-shot)"). 가장 강한 베이스라인을 우선한다. 베이스라인이 없는 지표(예: 제안 기법 단독 측정)는 baseline_name을 "-"로, baseline_value를 null로 둔다.
- unit: "%", "point", "ms", "GFLOPs", "BLEU", "-"(무단위) 등. higher_is_better: 정확도류는 true, 오류율·지연시간·perplexity·FLOPs 등은 false.
- source: 출처(예: "Table 2", "Figure 4", "Section 5.2 본문"). note: 실험 조건(모델 크기, few-shot 수, 백본 등)이나 주의점을 한국어로 짧게.
- 예시: {"metric":"Top-1 accuracy","dataset":"ImageNet-1k","unit":"%","higher_is_better":true,"baseline_name":"ViT-B/16","baseline_value":81.8,"proposed_value":83.4,"source":"Table 1","note":"224px 해상도, 300 epoch 동일 조건"}

[scores] 다섯 축을 1~5 정수로 평가하고 각 rationale에 2~3문장으로 근거를 쓴다(논문의 구체적 내용을 인용).
- novelty(독창성): 1=기존 기법의 단순 조합/재적용, 3=의미 있는 변형, 5=새로운 문제 설정이나 패러다임 제시.
- rigor(엄밀성): 1=소수 벤치마크·단일 시드·통계 없음, 3=표준 벤치마크와 제거 실험, 5=다양한 설정·반복 실험·통계적 검증·공정한 베이스라인 재현.
- reproducibility(재현성): 1=코드·하이퍼파라미터 없음, 3=주요 설정 공개, 5=코드·가중치·데이터·전체 설정 공개 명시.
- clarity(명료성): 1=구조·표기가 혼란스러움, 3=따라갈 수 있음, 5=수식·그림·서술이 매우 명확.
- impact(파급력): 1=좁은 적용 범위, 3=해당 하위 분야에 유용, 5=여러 분야에 영향을 줄 가능성.

[core_tech] 핵심기술 5~10개. name: 기술명(필요 시 "한국어(English)"), category: architecture(모델 구조), training(학습 방법/절차), objective_loss(손실·목적함수), data(데이터 구성·증강·수집), optimization(최적화·효율화·압축), inference(추론 기법·디코딩), evaluation(평가 방법·지표), theory(이론적 분석·증명), system_infra(시스템·하드웨어·분산), other. role: 이 논문에서의 역할 한 문장(새로 제안/차용/개선 여부 포함). description: 작동 원리 2~3문장.

[meta] title_ko: 한국어 제목. domain_ko: 세부 분야(예: "자연어처리 / 검색 증강 생성"). confidence: 수치 추출과 분석의 확신도(high=표가 명확히 읽힘, medium=일부 표/그림 해석 필요, low=스캔 품질 저하 등으로 상당 부분 불확실). notes: 독자가 알아야 할 주의사항(예: "Table 3의 일부 값은 그림에서만 제시되어 제외함"). 없으면 "".

스키마에 맞는 JSON 객체 하나만 출력하고 다른 텍스트는 출력하지 않는다.`;

  const scoreItem = () => ({
    type: 'object',
    properties: {
      score: { type: 'integer', enum: [1, 2, 3, 4, 5] },
      rationale: { type: 'string' }
    },
    required: ['score', 'rationale'],
    additionalProperties: false
  });

  const SUMMARY_SCHEMA = {
    type: 'object',
    properties: {
      tldr_ko: { type: 'string' },
      glance: {
        type: 'object',
        properties: {
          problem: { type: 'string' },
          method: { type: 'string' },
          result: { type: 'string' }
        },
        required: ['problem', 'method', 'result'],
        additionalProperties: false
      },
      sections: {
        type: 'object',
        properties: {
          problem_definition: { type: 'string' },
          proposed_method: { type: 'string' },
          results_and_strengths: { type: 'string' },
          weaknesses_and_limitations: { type: 'string' },
          core_technology: { type: 'string' }
        },
        required: ['problem_definition', 'proposed_method', 'results_and_strengths', 'weaknesses_and_limitations', 'core_technology'],
        additionalProperties: false
      },
      strengths: { type: 'array', items: { type: 'string' } },
      limitations: {
        type: 'object',
        properties: {
          weaknesses: { type: 'array', items: { type: 'string' } },
          stated_limitations: { type: 'array', items: { type: 'string' } },
          future_work: { type: 'array', items: { type: 'string' } }
        },
        required: ['weaknesses', 'stated_limitations', 'future_work'],
        additionalProperties: false
      },
      pipeline: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            stage: { type: 'string' },
            description: { type: 'string' },
            input: { type: 'string' },
            output: { type: 'string' }
          },
          required: ['stage', 'description', 'input', 'output'],
          additionalProperties: false
        }
      },
      metrics: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            metric: { type: 'string' },
            dataset: { type: 'string' },
            unit: { type: 'string' },
            higher_is_better: { type: 'boolean' },
            baseline_name: { type: 'string' },
            baseline_value: { anyOf: [{ type: 'number' }, { type: 'null' }] },
            proposed_value: { anyOf: [{ type: 'number' }, { type: 'null' }] },
            source: { type: 'string' },
            note: { type: 'string' }
          },
          required: ['metric', 'dataset', 'unit', 'higher_is_better', 'baseline_name', 'baseline_value', 'proposed_value', 'source', 'note'],
          additionalProperties: false
        }
      },
      scores: {
        type: 'object',
        properties: {
          novelty: scoreItem(),
          rigor: scoreItem(),
          reproducibility: scoreItem(),
          clarity: scoreItem(),
          impact: scoreItem()
        },
        required: ['novelty', 'rigor', 'reproducibility', 'clarity', 'impact'],
        additionalProperties: false
      },
      core_tech: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            category: {
              type: 'string',
              enum: ['architecture', 'training', 'objective_loss', 'data', 'optimization', 'inference', 'evaluation', 'theory', 'system_infra', 'other']
            },
            role: { type: 'string' },
            description: { type: 'string' }
          },
          required: ['name', 'category', 'role', 'description'],
          additionalProperties: false
        }
      },
      meta: {
        type: 'object',
        properties: {
          title_ko: { type: 'string' },
          domain_ko: { type: 'string' },
          confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
          notes: { type: 'string' }
        },
        required: ['title_ko', 'domain_ko', 'confidence', 'notes'],
        additionalProperties: false
      }
    },
    required: ['tldr_ko', 'glance', 'sections', 'strengths', 'limitations', 'pipeline', 'metrics', 'scores', 'core_tech', 'meta'],
    additionalProperties: false
  };

  const TRANSLATION_TEMPLATE = `첨부된 논문 PDF에서 아래에 지정한 섹션 하나만을 한국어로 완역하라. 결과는 마크다운 본문만 출력한다.

[번역 대상]
- 섹션: {{SECTION_NUMBER}} {{SECTION_TITLE}}
- PDF 페이지 범위: {{PAGE_RANGE}} (물리적 페이지, 첫 장 = 1)
- 직전 섹션: {{PREV_SECTION}}
- 직후 섹션: {{NEXT_SECTION}}
{{EXTRA_LINES}}
[범위 규칙]
- 지정한 페이지 범위 안에서 "{{SECTION_TITLE}}" 제목으로 시작하는 섹션의 본문만 번역한다. 시작 페이지에 직전 섹션의 끝부분이 남아 있으면 번역하지 않고, 끝 페이지에서 직후 섹션 "{{NEXT_SECTION}}"의 제목이 나타나면 그 직전에서 멈춘다. 직후 섹션의 제목이나 내용은 한 글자도 포함하지 않는다.
- 섹션 제목이 페이지 범위 안에 여러 번(머리글·꼬리글 등) 나타나도 본문 섹션 하나만 번역한다. 페이지 머리글, 꼬리글, 페이지 번호, 학회 저작권 문구, 워터마크는 제외한다.
- 범위 안에 있는 하위 섹션(예: 3.1, 3.2, 3.2.1)은 모두 포함한다. 범위 안에 배치된 그림·표·알고리즘·각주도 모두 포함한다(그림 자체는 캡션만 번역).
- 지정된 섹션이 페이지 범위로 잘려 일부만 주어진 경우(제목에 "(계속)" 또는 페이지 범위 표시가 있을 때)에는 그 페이지 범위 안의 내용만 번역하고 앞뒤를 보충하지 않는다.

[출력 형식]
- 첫 줄은 섹션 제목을 마크다운 제목으로: 최상위 섹션은 "## {{SECTION_NUMBER}} 한국어 제목(English Title)", 하위 섹션은 "### 3.1 한국어 제목" 형식(원문 번호 유지, 번호가 없는 섹션은 번호 생략).
- 문단 구분은 원문을 따르고, 빈 줄로 분리한다. 목록·번호 목록·인용 블록은 마크다운으로 유지한다.
- 수식: 인라인은 $...$, 디스플레이는 $$...$$ 로 쓰고 LaTeX 내용은 원문 그대로 둔다. 번호가 붙은 식은 수식 뒤에 (1), (2)처럼 번호를 남긴다. 수식 안의 영어 단어(예: \\text{softmax})는 번역하지 않는다. 수식 구분자는 $...$ 와 $$...$$ 만 사용하고 \\[ \\], \\( \\), 구분자 밖의 \\begin{align} 같은 환경은 쓰지 않는다. 디스플레이 수식은 앞뒤에 빈 줄을 두고 한 줄에 단독으로 배치한다.
- 표: 셀 내용을 유지하며 마크다운 표로 작성하고, 표 캡션은 표 위에 "**표 2.** 캡션 번역" 형태로 적는다. 열 이름 중 전문용어는 번역하되 모델명·데이터셋명·지표 약어(BLEU, mAP 등)는 그대로 둔다. 숫자·굵은글씨 표시(**)·±·기호는 그대로 유지한다.
- 그림: "**그림 3.** 캡션 번역" 한 줄로 쓰고, 그림 이미지 자체는 생략한다. 알고리즘 블록은 "**알고리즘 1.** 제목" 뒤에 코드펜스 안에 원문 의사코드를 그대로 둔다.
- 각주: [^n] 문법을 쓰지 않는다. 본문의 해당 위치에 "[각주 n]" 표시를 남기고, 섹션 끝에 "**각주**" 줄을 쓴 뒤 "[각주 n] 번역문" 형식의 목록으로 모아 적는다.
- 참고문헌(References) 섹션이면 목록을 번역하지 않고, 대신 "> 참고문헌 목록은 원문 {{PAGE_RANGE}} 페이지를 참조한다. (총 N편)" 한 줄만 출력한다(N은 항목 수).

[용어집 — 반드시 이 표기를 따른다]
{{GLOSSARY}}

[작은 예시] 원문: "We propose a contrastive objective that aligns image and text embeddings [7]. As shown in Table 2, our method improves top-1 accuracy by 2.3 points."
번역: "본 연구는 이미지와 텍스트 임베딩(embedding)을 정렬하는 대조 목적 함수(contrastive objective)를 제안한다 [7]. 표 2에서 보듯이, 제안 기법은 top-1 정확도를 2.3 point 향상시킨다."

위 규칙을 지켜 마크다운 본문만 출력하라. 머리말("다음은 번역입니다" 등), 맺음말, 코드펜스로 전체를 감싸는 것, 원문 영어 병기 전문은 금지한다.`;

  const DEFAULT_GLOSSARY = [
    { en: 'attention', ko: 'attention' },
    { en: 'self-attention', ko: 'self-attention' },
    { en: 'transformer', ko: 'Transformer' },
    { en: 'fine-tuning', ko: '미세조정(fine-tuning)' },
    { en: 'pre-training', ko: '사전학습(pre-training)' },
    { en: 'embedding', ko: '임베딩(embedding)' },
    { en: 'benchmark', ko: '벤치마크' },
    { en: 'baseline', ko: '베이스라인(baseline)' },
    { en: 'state-of-the-art', ko: '최신 기법(state-of-the-art)' },
    { en: 'ablation study', ko: '제거 실험(ablation study)' },
    { en: 'overfitting', ko: '과적합(overfitting)' },
    { en: 'generalization', ko: '일반화' },
    { en: 'regularization', ko: '규제(regularization)' },
    { en: 'normalization', ko: '정규화(normalization)' },
    { en: 'loss function', ko: '손실 함수' },
    { en: 'objective function', ko: '목적 함수' },
    { en: 'gradient descent', ko: '경사 하강법' },
    { en: 'backpropagation', ko: '역전파' },
    { en: 'learning rate', ko: '학습률' },
    { en: 'epoch', ko: '에폭(epoch)' },
    { en: 'inference', ko: '추론' },
    { en: 'latency', ko: '지연 시간' },
    { en: 'hyperparameter', ko: '하이퍼파라미터' },
    { en: 'dataset', ko: '데이터셋' },
    { en: 'training set', ko: '학습 데이터' },
    { en: 'validation set', ko: '검증 데이터' },
    { en: 'test set', ko: '테스트 데이터' },
    { en: 'accuracy', ko: '정확도' },
    { en: 'precision', ko: '정밀도' },
    { en: 'recall', ko: '재현율' },
    { en: 'robustness', ko: '강건성(robustness)' },
    { en: 'encoder', ko: '인코더' },
    { en: 'decoder', ko: '디코더' },
    { en: 'large language model (LLM)', ko: '대규모 언어 모델(LLM)' },
    { en: 'in-context learning', ko: '문맥 내 학습(in-context learning)' },
    { en: 'zero-shot', ko: '제로샷(zero-shot)' },
    { en: 'few-shot', ko: '퓨샷(few-shot)' },
    { en: 'reinforcement learning', ko: '강화학습' },
    { en: 'self-supervised learning', ko: '자기지도학습' },
    { en: 'contrastive learning', ko: '대조 학습' },
    { en: 'knowledge distillation', ko: '지식 증류' },
    { en: 'quantization', ko: '양자화' },
    { en: 'pruning', ko: '가지치기(pruning)' },
    { en: 'retrieval-augmented generation (RAG)', ko: '검색 증강 생성(RAG)' }
  ];

  function renderGlossary(list) {
    return (Array.isArray(list) ? list : [])
      .filter((g) => g && g.en)
      .map((g) => `- ${g.en} → ${g.ko || g.en}`)
      .join('\n');
  }

  function sectionLabel(sec) {
    return [sec.number, sec.titleEn].filter(Boolean).join(' ').trim();
  }

  function buildTranslationPrompt(chunk, glossaryStr) {
    const secs = Array.isArray(chunk.sections) ? chunk.sections : [];
    const merged = secs.length > 1;
    const split = chunk.partCount > 1;
    const first = secs[0] || {};
    // "섹션: {{SECTION_NUMBER}} {{SECTION_TITLE}}" 줄에서 첫 번호가 중복되지 않도록 첫 섹션은 제목만 넣는다
    let title = secs.length ? [first.titleEn || '', ...secs.slice(1).map(sectionLabel)].join('; ') : `${chunk.startPage}–${chunk.endPage} 페이지 전체`;
    if (split) title += chunk.partIndex === 1 ? ` (${chunk.partIndex}/${chunk.partCount})` : ` (계속, ${chunk.partIndex}/${chunk.partCount})`;
    const extras = [];
    if (merged) extras.push('- 위 섹션들을 순서대로 모두 번역하고 각 섹션마다 "##" 제목을 단다.');
    if (!secs.length) extras.push('- 이 번역 대상은 섹션 구분 없이 지정한 페이지 범위의 모든 본문이다. 제목 규칙 대신 페이지 범위만 따르며, 첫 줄 제목은 "## N–M 페이지" 형식으로 쓴다.');
    const map = {
      '{{SECTION_NUMBER}}': first.number || '',
      '{{SECTION_TITLE}}': title,
      '{{PAGE_RANGE}}': `${chunk.startPage}–${chunk.endPage}`,
      '{{PREV_SECTION}}': chunk.prev || '(없음, 문서 시작)',
      '{{NEXT_SECTION}}': chunk.next || '(없음, 문서 끝)',
      '{{EXTRA_LINES}}': extras.length ? extras.join('\n') + '\n' : '',
      '{{GLOSSARY}}': glossaryStr || '(없음)'
    };
    return TRANSLATION_TEMPLATE.replace(/\{\{[A-Z_]+\}\}/g, (m) => (m in map ? map[m] : m)).replace(/ {2,}/g, ' ');
  }

  function buildSummaryPrompt(glossaryStr) {
    const block = glossaryStr ? `[용어집]\n${glossaryStr}` : '[용어집]\n(없음)';
    return SUMMARY_PROMPT.replace('{{GLOSSARY_BLOCK}}', block);
  }

  window.RPT_PROMPTS = Object.freeze({
    SYSTEM,
    COMMON_RULES,
    OUTLINE_PROMPT,
    OUTLINE_SCHEMA,
    SUMMARY_PROMPT,
    SUMMARY_SCHEMA,
    TRANSLATION_TEMPLATE,
    DEFAULT_GLOSSARY,
    renderGlossary,
    buildTranslationPrompt,
    buildSummaryPrompt
  });
})();
