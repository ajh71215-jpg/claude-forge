# 계획 검증 & 자가비판 (최종 라운드)

> `SQUAD_ORCHESTRATION.md`(v2)와 `TOKEN_OPTIMIZATION.md`(v2)를 1차 출처로 검증하고 적대적으로
> 비판한다. 각 핵심 주장을 출처 등급(primary/peer-reviewed vs preprint vs secondary)과 함께
> 판정한다. **인식 한계 고지: 본 저자(모델)의 신뢰 지식 컷오프는 2026-01이다.** 인용된 2026년
> 2~6월 arXiv는 컷오프 이후라 *웹 검색으로만* 접했고, 다수가 미동료평가 preprint다. 이 점을
> 판정에 반영했다.

---

## 1. 인용 검증 원장 (load-bearing claims)

| 주장 | 출처 | 등급 | 판정 |
|---|---|---|---|
| MCP 도구 코드실행: 150k→2k 토큰, −98.7% | Anthropic 엔지니어링 블로그 | **primary** | ✅ 확인. 단 *수백 개 도구* 시나리오 한정. |
| 멀티에이전트(Opus 리드+Sonnet 워커) 단일 대비 **+90.2%** | Anthropic 블로그(내부 eval) | primary(내부) | ✅ 확인. **단 breadth-first 리서치 과제** — 코딩 아님. |
| 에이전트 ~4×, 멀티에이전트 ~15× 토큰 | Anthropic 블로그 | **primary** | ✅ 확인. |
| 토큰이 성능분산 80% 설명(3요인 95%) | Anthropic 블로그(BrowseComp) | **primary** | ✅ 확인. |
| naive 스케일 실패: 병렬=verification gap, 순차=context ceiling | arXiv 2602.18998 | preprint(컷오프 후) | ✅ abstract 확인. "self-choice 뒤처짐" 세부는 2차발 → **보류**. |
| cache read 0.1x / write 1.25x(5분)·2x(1h), 기본 TTL 5분 | 공식 문서 | **primary** | ✅ 확인. |
| "TTL 60→5분 단축(2026)" | dev.to 등 2차 블로그 | secondary | ❌ **거짓**. 2026-02-05 변경은 TTL 아닌 **workspace 캐시 격리**. 문서 정정함. |
| DACS 90–98% vs 21–60%, 3.53×, contamination 28–57%→0–14% | arXiv 2604.07911 | preprint(컷오프 후) | ⚠️ abstract엔 있음(p<0.0001). **단 200시도 중 실제 LLM은 40(Haiku)뿐, 대부분 합성**. |
| Blueprint-First: 결정론 > free-form | arXiv 2508.02721 | preprint | ◐ 논지 확인, 수치 미검증(PDF 추출 실패). |
| Debate(3에이전트·2라운드) 환각↓ | ICML 2024 (Du et al.) | **peer-reviewed** | ✅ 가장 단단한 인용. |
| AHE 69.7→77.0 / NexAU 84.7%, "GPT-5.5/5.4" | arXiv 2604.25850 | preprint(컷오프 후) | ⚠️ **모델명 'GPT-5.5'를 컷오프 시점 지식으로 확인 불가** → 수치 신뢰 보류. |
| AOrchestra +16.28% | arXiv 2602.03786 | preprint | ⚠️ 검색 요약만, **본문 미확인** → 보류. |
| ESC −80% / CISC −40~50% / ReASC −70~80% | 라우팅 서베이·2차 | secondary/preprint | ◐ 메커니즘 타당, **개별 % 1차 미검증**. |
| "캐싱으로 60~90% 절감" | 2차 블로그 | secondary | ◐ 메커니즘(read=0.1x)은 확실, **총 % 는 워크로드 의존**. 보장 아님. |

**요지**: 가장 강한 근거(Anthropic 블로그·공식 문서·ICML 2024)는 견고하다. 그러나 v2 문서들이
인용한 **preprint·2차 수치 상당수는 검증·동료평가가 약하고**, 한 건(TTL)은 명백히 틀렸다.
문서에 *false precision*(예: "−98.7%", "3.53×")을 단정조로 옮긴 것은 과신이었다.

---

## 2. `SQUAD_ORCHESTRATION.md` 비판

### 2.1 치명적 — 동기 증거의 도메인 불일치
멀티에이전트의 최강 증거(Anthropic +90.2%, debate, DACS)는 모두 **리서치/추론/breadth-first**
도메인이다. 그런데 **Forge는 코딩 도구**다. 코딩은 수렴(convergent)·롱호라이즌 과제라 병렬
팬아웃의 이득이 약하고 파일 충돌 위험이 크다. 즉 **헤드라인 동기(90.2%)는 Forge로 전이된다는
보장이 없다.** v2가 Phase 1을 "도구기반 코딩 verify 루프"로 잡은 건 옳지만, 문서는 여전히
리서치용 수치로 기대를 부풀린다. → 동기 섹션을 *코딩 도메인 증거*로 교체하거나 기대치를 낮춰야.

### 2.2 치명적 — kill-criteria의 베이스라인이 불공정
"Phase 1이 단일 에이전트를 이기면 출하"는 **총 컴퓨트를 통제하지 않으면 무의미**하다.
15× 토큰 쓰는 멀티에이전트가 1× 단일 에이전트를 이기는 건 당연하다. 공정 비교는 **단일 에이전트에
동일 토큰 예산**을 준 것(예: best-of-N 단일, 더 긴 thinking)과 겨뤄야 한다. 2602.18998이
"naive 병렬 스케일은 실효 없음"이라 한 것도 같은 맥락 — 비교는 *동일 예산*에서 해야 한다.
이게 현재 계획의 가장 큰 방법론적 구멍.

### 2.3 중대 — 구독 경제성이 기능을 무력화할 수 있음
Forge는 구독 우선이다. 15× 토큰 = **rate-limit을 15배 빨리 소진**. "데일리 드라이버"에서
Squad를 몇 번 돌리면 한도가 바닥난다. 즉 *기술적으로 되더라도 실사용이 비현실적*일 수 있다.
이건 기능 가치 자체에 대한 의문이다 — 문서가 정면으로 안 다룬다.

### 2.4 중대 — Conductor가 SDK `Workflow`를 재발명할 위험
v2는 `conductor.ts`라는 결정론적 상태머신을 새로 만들자고 한다. 그런데 SDK엔 이미 **`Workflow`
툴**(대화 컨텍스트 밖 결정론적 오케스트레이션)이 있다. 바로 그 "blueprint-first"를 SDK가 1차
제공한다. → 바닥부터 만들지 말고 **`Workflow` 위에 얹어** 코드/유지보수를 줄여야 한다(3600줄
모놀리식 App.tsx 현실 고려).

### 2.5 중대 — "도구기반 검증"의 적용 범위 과장
Phase 1의 강점은 "테스트/타입체크 = gap 없는 객관 검증". 맞다. 그러나 **객관 오라클이 있는
과제에만** 성립한다. 리팩터 판단·API 설계·문서·UX는 객관 테스트가 없어 다시 verification gap으로
돌아간다. 문서는 "gap 없음"을 과하게 일반화한다.

### 2.6 보통 — Planner가 미검증 단일 실패점
계획(plan DAG) 품질이 모든 하류를 좌우하는데, **plan 자체의 검증 단계가 없다**. 나쁜 plan →
전체 실패. 최소한 plan에 대한 sanity 게이트나 사람 승인(하이브리드)이 *필수*로 묶여야 한다.

### 2.7 정직한 재평가
2602.18998의 결론은 양날이다: verifier-guided 설계를 정당화하는 동시에 **"정교한 스케일조차
ceiling에 막힌다"**고 경고한다. 정직한 기대치는 *과제 의존적인 완만한 향상*이지 혁명이 아니다.
"16개사 중 1곳만 Level 3"(Apostolou 2026, 2차) 현실과 합쳐 보면 — **이 복잡도를 감당할 만큼의
이득이 코딩 도메인에서 나올지는 미지수**이고, 그래서 §G의 eval 게이트가 더욱 핵심이다.

---

## 3. `TOKEN_OPTIMIZATION.md` 비판

### 3.1 치명적(수정됨) — TTL 사실 오류
2차 블로그발 "TTL 60→5분" 주장을 단정조로 실었다. **거짓**이며 정정했다(§1). 교훈: 비용 관련
수치는 반드시 공식 문서로 교차검증.

### 3.2 치명적 — 구독 모드에서 캐싱의 *비용* 이득이 불확실
"prompt caching = 최고 레버(−60~90%)"는 **API(달러 과금) 기준**이다. Forge 주력인 **구독 모드에선
사용자가 토큰당 과금되지 않으므로 캐시 read 0.1x의 *달러* 절감이 그대로 적용되는지 불명**이다.
구독에서 캐시가 rate-limit 소비를 할인하는지는 **검증 안 됨**. → 캐싱을 "구독의 #1 레버"로
단정하면 안 된다. *API 모드의 #1*, 구독에선 *주로 지연 개선 + (불확실한) 한도 완화*로 표기해야.

### 3.3 중대 — MCP-tax 해법의 실현 가능성이 SDK에 종속
−98.7%는 **code-execution-with-MCP 패턴** 전제다. Forge가 SDK 기본 경로로 MCP 도구를 주입하면
이 패턴을 그냥 켤 수 없다. Forge가 당장 할 수 있는 건 **per-task 서버 on/off 스코핑**(도움은 되나
98.7%와는 다른 차원). 문서는 이 실현가능성 격차를 흐릿하게 뒀다.

### 3.4 중대 — −98.7%는 시나리오 한정, 일반화 금지
그 수치는 *수백 개 도구* 상황. MCP 1~2개 쓰는 Forge 사용자에겐 절감폭이 훨씬 작다. 헤드라인
숫자를 그대로 약속하면 과대광고.

### 3.5 보통 — 라우팅/캐스케이드가 두 문서에 중복
모델 라우팅이 Squad v2와 Token v2 양쪽에 있다. 구현 시 **단일 모듈로 공유**해야 중복/불일치를
피한다(문서엔 "공유"라 적었으나 소유권·인터페이스 미정의).

### 3.6 정직한 평가(긍정)
프레이밍 전환(parity 진단 → cost-first 최적화, 임팩트 순 레버, 품질 동시측정 가드)은 옳다.
특히 "압축은 정확도 저하 위험 → 골든셋 ≥50 동시측정"은 1차 경고와 일치하는 건전한 원칙이다.

---

## 4. 교차 비판 (두 문서 공통)

1. **인프라 가정의 핸드웨이빙.** 두 계획 모두 *존재하지 않는* eval 하니스+골든셋에 게이트를 건다.
   그런데 그 하니스 구축 자체가 큰 작업이고 "Phase 0"로 한 줄 처리됐다. 인프라가 사실상 전제.
2. **Forge 성숙도 대비 과스코프.** App.tsx 3600줄 모놀리식, 깨지기 쉬운 dev 루프(CDP/PrintWindow),
   리부트 초기화 환경 — 이 현실에서 Conductor+Verifier+라우터+압축+캐시전략+eval을 다 짓는 건
   솔로 프로젝트엔 비현실적이다. **범위를 Phase 1 하나로 좁히고 나머지는 "조건부"로 강등**해야.
3. **인용 위생.** 컷오프 이후 preprint·2차 수치를 단정조로 옮긴 사례가 다수(§1). 문서에 **출처
   등급 표기**를 추가하고, 미검증 수치는 "preprint, 미검증"으로 명시해야 한다.
4. **반증 가능성 부재.** "최고 결과/효율"을 주장하면서 *무엇이 관측되면 틀린 것인지*를 Squad의
   kill-criteria 말곤 안 적었다. 토큰 문서에도 "캐싱이 구독에서 한도를 안 줄이면 레버1 강등" 같은
   반증 조건이 필요.

---

## 5. 적용한 수정 + 남은 액션

적용함(이번 커밋):
- `TOKEN_OPTIMIZATION.md`: TTL 사실 오류 정정(공식 수치로).
- `SQUAD_ORCHESTRATION.md`: generator-verifier "self-choice" 과한 표현을 abstract 검증 범위로 축소.

권고(다음 편집 대상):
- Squad: ⒜ 동기 섹션을 코딩 도메인 증거로 교체/완화, ⒝ kill-criteria에 **동일-컴퓨트 베이스라인**
  명시, ⒞ Conductor를 **SDK `Workflow` 위에** 재정의, ⒟ 구독 경제성 한계를 1급 리스크로,
  ⒠ plan 자체 검증 게이트 추가.
- Token: ⒜ 캐싱을 **API #1 / 구독 불확실**로 재표기, ⒝ MCP-tax 해법을 "스코핑(즉시) vs
  code-exec 패턴(SDK 종속)"으로 분리, ⒞ −98.7%에 "시나리오 한정" 라벨, ⒟ 라우터 공유 모듈 소유권 정의.
- 공통: 각 문서에 §1 같은 **출처 등급 표** 삽입, Phase 1 외 전부 "조건부" 강등.

---

## 6. 결론 (냉정)

두 계획은 **방향과 최신 기법 매핑은 타당**하나, ⑴ 멀티에이전트 이득의 **도메인 전이가 입증되지
않았고**(코딩≠리서치), ⑵ **비교 베이스라인이 불공정**하며, ⑶ **구독 경제성**이 두 기능 모두의
실사용을 위협하고, ⑷ **Forge 성숙도 대비 과스코프**다. 인용은 대체로 맞았지만 **한 건은 거짓
(TTL), 여러 건은 미검증 preprint**였다.

가장 정직한 다음 수순: 계획을 키우지 말고 **Phase 1 하나(도구기반 코딩 verify 루프 + 동일-컴퓨트
eval)**로 좁혀, "멀티에이전트가 코딩에서 *동일 예산* 단일 에이전트를 실제로 이기는가"를 먼저
반증 가능하게 측정한다. 이기지 못하면 — 연구가 시사하듯 그럴 가능성도 충분하다 — **두 계획 모두
보류**하는 것이 합리적이다.

### 출처 (1차 우선)
- Anthropic — Code execution with MCP(−98.7%): https://www.anthropic.com/engineering/code-execution-with-mcp
- Anthropic — Multi-agent research system(+90.2%, 15×, 80% 분산): https://www.anthropic.com/engineering/built-multi-agent-research-system
- Prompt caching(공식, TTL·가격): https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- General AgentBench — TTS 한계(arXiv 2602.18998): https://arxiv.org/abs/2602.18998
- Blueprint First, Model Second(arXiv 2508.02721): https://arxiv.org/pdf/2508.02721
- DACS(arXiv 2604.07911, 다수 합성): https://arxiv.org/abs/2604.07911
- Multiagent Debate(ICML 2024, peer-reviewed): https://github.com/composable-models/llm_multiagent_debate
- ⚠️ 신뢰 보류(컷오프 후 preprint/미검증): AHE 2604.25850, AOrchestra 2602.03786, ESC/CISC/ReASC 수치
