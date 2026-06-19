# Token / 비용 최적화 — 설계 (v3, 검증 반영)

> 능력·품질을 유지하면서 비용(API) 또는 rate-limit 소비(구독)를 최소화하는 플랜. v3는 1차 출처
> 검증과 자가비판을 본문에 통합했다. (차이 진단 parity는 "레버 효과 측정"의 기반으로 흡수)
>
> **인식 한계**: 저자(모델) 신뢰 지식 컷오프 2026-01. 2026 인용은 웹 검색 기반 — §0 등급으로 구분.

---

## 0. 근거 검증 원장 (핵심 인용)

| 주장 | 출처 | 등급 | 판정 |
|---|---|---|---|
| cache read **0.1x**, write 1.25x(5분)/2x(1h), 기본 TTL **5분** | 공식 문서 | **primary** | ✅ |
| "TTL 60→5분 단축(2026)" | dev.to 등 2차 | secondary | ❌ **거짓**. 2026-02-05 변경은 TTL 아닌 **workspace 캐시 격리** |
| MCP 코드실행 150k→2k, **−98.7%** | Anthropic 블로그 | **primary** | ✅ 단 *수백 개 도구* 시나리오 한정 |
| 캐싱 "60~90% 절감" | 2차 블로그 | secondary | ◐ 메커니즘(read 0.1x)은 확실, **총 %는 워크로드 의존·API 한정** |
| compression 50~70% / ESC·CISC·ReASC % | preprint·2차 | weak | ⚠️ 메커니즘만 채택, **개별 % 미검증** |
| 멀티에이전트 ~15× 토큰 | Anthropic 블로그 | **primary** | ✅ (Squad 문서와 연동) |

> 교훈: 비용 수치는 반드시 공식 문서로 교차검증. preprint·2차 %는 "방향"으로만.

---

## 1. 이전 프레임(parity)의 한계

이전 버전은 "Forge가 CLI와 어디서 다른가"만 측정했다. 그러나 **CLI 자체가 토큰-최적이 아니다** —
CLI 매칭은 목표가 아니고 최소화 *처방*이 빠졌으며, 2026 최대 레버(caching·동적 tool loading·
compression)가 전부 누락됐다. 또 **tokens를 최적화했지 cost가 아니었다**(cost는 모델 + cache
read/write 분해가 좌우). v3는 이를 비용-우선·임팩트-순으로 재구성한다.

> Forge 현황 정직 고지: CLAUDE.md의 "최적화 tier 1–4"는 과장. 실제로는 cost-saver(Sonnet+LOW 강제,
> `App.tsx:325-327`) + effort 조절 + 수동 `/compact` + usage 패널뿐. 등급화 시스템이 아니다.

---

## 2. 최적화 목표 재정의

- **목표 = 비용(API) 또는 rate-limit 소비(구독) 최소화 × 능력/품질 유지.** tokens는 대리지표.
- **측정축**: `total_cost_usd`, **cache hit %**, 입력분해(fresh/cache-read/cache-write), output·thinking,
  context tokens. (Forge는 이미 cache_read/creation 계측 — `src/main/agent.ts:672-685`)
- **⚠️ 구독 vs API 구분(중요).** 캐싱·라우팅의 *달러* 절감은 **API 모드 기준**이다. **구독 모드는
  토큰당 과금이 없어** 캐시 read 0.1x의 달러 이득이 그대로 적용되는지 **불확실**하다(공식 미확인).
  구독에서 캐싱의 확실한 이득은 *지연 단축*이며, rate-limit 할인 여부는 검증 대상이다.
- **품질 가드**: 압축/도구감축은 정확도 저하 위험 → 모든 레버는 **품질과 동시 측정**(골든셋 ≥50).

---

## 3. 레버 (임팩트 순) + Forge 적용

### 레버 1 — Prompt Caching  (API: 최고 레버 / 구독: 이득 불확실)
- 원리: cacheable **prefix를 크고 안정적**으로(system + 도구스키마 + few-shot + CLAUDE.md), 동적
  꼬리만 변동. 가격(공식): write 1.25x(5분)/2x(1h), **read 0.1x**.
- **사실 정정**: "TTL 60→5분 단축"은 거짓(§0). 기본 5분은 원래부터다. 유휴 5분 후 첫 요청이 write가
  되는 것도 원래 동작. 1시간 TTL은 유료 옵션. 장기 에이전트의 캐시 보존 중요성: "Don't Break the
  Cache"(arXiv 2601.06007).
- **Forge 조치**: ⒜ systemPrompt·도구정의·CLAUDE.md를 prefix에 **고정**, 동적 콘텐츠 prefix 격리
  (persona append/동적 systemPrompt가 prefix 안 깨게). ⒝ SDK가 cache_control 자동 설정하는지 확인.
  ⒞ **cache hit %를 1급 지표로** 상단 노출. ⒟ system 캐시·동적 tool result 캐시 제외.
  - **단 구독 모드**에선 위 이득이 *달러*가 아닐 수 있음 → 먼저 §5로 rate-limit 영향 측정.

### 레버 2 — 동적 Tool Loading / "MCP tax" 제거
- 사실: 모든 MCP/skill/plugin 스키마를 매 턴 싣는 게 큰 숨은 세금. Anthropic code-execution-MCP는
  **150k→2k(−98.7%)** ✅ — **단 수백 개 도구** 상황. MCP 1~2개 쓰는 Forge엔 절감폭이 훨씬 작다(과대광고 금지).
- **실현가능성 분리**:
  - *즉시(Forge 단독 가능)*: EXTEND에서 **활성 도구를 task별로 스코핑 + 비활성 기본**, 각 서버 옆
    "컨텍스트 N토큰 점유" 표시. (도움은 되나 98.7%와는 다른 차원)
  - *SDK 종속*: lazy schema/code-execution-MCP 패턴은 SDK 지원이 있어야 함 → 가능 여부 확인 후 결정.
  - (연구: Tool Gating 2604.21816, Dynamic ReAct 2509.20386 — preprint, 방향 근거)

### 레버 3 — Context Compression / Compaction
- 수동 `/compact`를 **자동·가역 compaction 정책**(임계 노출)으로 승급; 전체파일 덤프 대신 retrieval.
  (ACON 2510.00615, Demand Paging 2603.09023 — preprint; % 미검증, 방법만 채택)

### 레버 4 — Model Routing / Cascade
- 난이도/신뢰도로 Haiku→Sonnet→Opus. **Squad v3와 단일 공유 모듈 `routing.ts`**(중복 구현 금지).
  현재 cost-saver(무조건 Sonnet+LOW)를 난이도 라우터로 승급. (구독 모드 이득은 §2 단서 적용)

### 레버 5 / 6 — Retrieval over full-file / Output·Thinking 절감
- grep·span 검색 + 서브에이전트 격리. effort 튜닝(thinking=출력가격) + 간결 출력 + stop 시퀀스.

---

## 4. Forge 구체 조치 (우선순위)

- **P1 — caching 보존**: prefix 안정화 + cache hit % 상단 지표. (코드 작음, **API 이득 최대**; 구독은 §5 선검증)
- **P1 — MCP/tool 스코핑**: per-task 토글 + 비활성 기본 + 점유 토큰 표시. (즉시 가능, MCP tax 직격)
- **P2 — 자동 compaction**(가역) + **cost-saver→난이도 라우터**(공유 모듈).
- **P3 — retrieval-first**, 장기적으로 lazy tool schema(SDK 지원 시).

---

## 5. 측정·검증 (반증 가능)

- 각 레버 적용 전/후로 `total_cost_usd` · **cache hit %** · 입력분해 · **정확도(골든셋 ≥50)** 비교.
  계측: Forge `result.usage`(`agent.ts:672-685`) ↔ CLI `claude -p --output-format json`/`/cost`/`/context`/OTEL.
  콜드/웜 분리(캐시 효과 격리). (AHE decision-observability *방법*만 채택)
- **구독 반증 조건**: "캐싱/라우팅이 구독 rate-limit 소비를 유의미하게 줄이지 못하면 → 구독 모드에선
  레버 1·4를 *지연 개선* 용도로 강등." 이건 출하 전 반드시 측정한다.
- **품질 반증 조건**: 압축/도구감축으로 골든셋 정확도가 유의미하게 떨어지면 해당 레버 롤백.

---

## 6. 단계별 플랜

- **Phase 0**: 계측 정비(cost/cache/도구토큰 분해 대시보드) + 골든셋(≥50) + 구독 rate-limit 측정 기준.
- **Phase 1**: 레버 1(caching 보존, API) + 레버 2(즉시-스코핑) — 측정·반증 검사.
- **Phase 2**: 레버 3(자동 compaction) + 레버 4(공유 라우터).
- **Phase 3**: 레버 5 + lazy schema(SDK 지원 시).

---

## 7. 참고문헌 (등급 표기)

- ✅ Prompt caching(공식, TTL·가격): https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- ✅ Anthropic — Code execution with MCP(−98.7%, 시나리오 한정): https://www.anthropic.com/engineering/code-execution-with-mcp
- ✅ Anthropic — Multi-agent(15× 토큰): https://www.anthropic.com/engineering/built-multi-agent-research-system
- ◐ Don't Break the Cache(arXiv 2601.06007): https://arxiv.org/pdf/2601.06007
- ⚠️ 방향만(preprint·미검증 %): Tool Gating 2604.21816 · Dynamic ReAct 2509.20386 · ACON 2510.00615 ·
  Demand Paging 2603.09023 · Model Routing 서베이 2603.04445 · ESC/CISC/ReASC 수치

> 멀티에이전트(15×) 비용은 `docs/SQUAD_ORCHESTRATION.md`의 cascade·격리·kill-criteria와 함께 볼 것.
> 라우터는 양 문서 공유 모듈(`routing.ts`).

---

## 8. 실행 결과 — 검증된 메커니즘 채택 (2026-06-14)

**결과 요약: 데이터 레이어 + 공유 라우터(레버4 ∩ Squad) + 캐시 지표(레버1)를 구현. 수치 절감은
미측정(구독/API 세션 필요) — 본문 §0/§2 원칙대로 "메커니즘만 채택, % 보류".**
typecheck ✅ · build ✅ · lint 신규 0 · 라우터 로직 `npm run selftest`로 실증(SQUAD §10과 공유).

### 레버 1 — Prompt Caching 지표화 (데이터 레이어)
- **`agent/types.ts` 결과 이벤트에 `cacheWriteTokens`(=`cache_creation_input_tokens`) 추가** +
  `runStreaming`에서 채움. 기존 `cacheReadTokens`(이미 계측)와 합쳐 **입력 분해(fresh/read/write) 완비.**
- **`lib/format.ts` `cacheHitPercent(fresh, read, write)`** 순수 헬퍼 — read/(fresh+read+write).
  *근거: 공식 문서 cache read 0.1× → hit %가 API 모드 최고 비용 레버(§3 레버1).*
- ⚠️ **상단 1급 지표 노출(UI)·prefix 안정화 감사**는 렌더러 작업 + 라이브 측정 필요 → 보류. 데이터·계산은
  준비됨(이 헬퍼 + 이벤트 필드).

### 레버 4 — Model Routing / Cascade (공유 모듈 구현)
- **`src/main/routing.ts` 신설 = 양 문서 단일 공유 라우터**(중복 구현 금지 §3 준수). `route`(난이도→
  tier+effort) · `escalate`(cascade 캡) · `resolveModelId`(라이브 매칭). *근거: 난이도 라우팅 + 실패시 cascade.*
- **현 cost-saver(무조건 Sonnet+LOW, `App.tsx`) → 난이도 라우터 승급**은 렌더러 배선(behavior-changing,
  라이브 검증 권장)이라 **다음 단계**. 라우터 코어는 완성·실증(selftest 9/9).

### 미수행 — 라이브/측정 의존 (정직한 한계, 본문 §5 반증조건 그대로)
- **레버 2(동적 tool 스코핑 UI)** · **레버 3(자동 compaction)** · **레버 5(retrieval/lazy schema)** 미착수.
- **§5 측정**(cost/cache-hit/도구토큰 대시보드 + **구독 rate-limit 반증조건**) 미수행 — 라이브 앱 + 구독
  세션 필요. 구독 모드에서 캐싱/라우팅의 *달러* 이득 불확실(§2 단서)은 **출하 전 반드시 측정** 대상으로 유지.

> 요약: 검증된 메커니즘(캐시 read 0.1× 지표화, 난이도 라우팅+cascade 공유 모듈)은 **코드로 채택**.
> %·rate-limit 절감 *수치*는 골든셋(≥50) 실측 게이트로 — 라이브 세션에서 검증.

---

## 9. 실행 결과 — 렌더러 배선 + dev CDP 런타임 검증 (2026-06-14)

**§8에서 "보류/다음 단계"였던 레버 1·4 렌더러 배선을 완료하고 dev CDP로 런타임 실증.** 모델 호출 없이
*라우팅 결정*과 *캐시 UI*를 DOM 상호작용으로 검증(세션 불필요). 정적 게이트: typecheck ✅ · build ✅
(렌더러 307모듈 — `routing.ts`가 렌더러 번들에 깔끔히 포함, type-only import만이라 electron/node 의존성 0) ·
selftest 59/59 ✅ · lint 신규문제 0(26 problems = 기존 3 errors + 23 warnings 유지).

### 레버 1 — Prompt Caching 지표 일원화 + write side 노출 ✅
- **데이터 관통 완료**: `cacheWriteTokens`가 `runStreaming` result → `useAgentEvents`(`AgentResultPayload`/
  `onResult`) → `App.tsx` usage state(`cacheWrite`)까지 흐름.
- **검증된 헬퍼로 일원화**: `App.tsx`의 인라인 `cacheRead/promptTotal` 중복을 제거하고
  **`cacheHitPercent(usage.input, usage.cacheRead, usage.cacheWrite)`** 호출로 교체. 수학적으로 동일
  (`runStreaming`의 `contextTokens == input+read+write`)하지만 이제 **단일 소유자**(format.ts) + write 분모 명시.
- **UI**: TOKENS 패널이 `{read} read · {written} written of {total} input tokens` 표기로 캐시 write를 노출
  (이전엔 read만). *근거: cache write는 1.25× 가격 → read/write 분리가 비용 스토리에 필요.*
- **CDP 확인**: `.tok-cache .usage-reset` = `"0 read · 0 written of 0 input tokens"`(세션 초기값).

### 레버 4 — cost-saver → per-prompt 난이도 라우터 승급 ✅
- **`App.tsx`**: `effModel = costSaver ? 'sonnet'` (flat) 제거 → Composer에 `costSaver` 플래그 + raw model/effort
  전달. cost-saver는 더 이상 모델을 App에서 고정하지 않음.
- **`Composer.tsx`**: 순수 `routing.ts`를 import(`route`/`resolveModelId`). `send()`에서 cost-saver면
  `route({instruction:text})`로 tier+effort 결정 → `resolveModelId(tier, models)`로 **라이브 모델 id 해석**.
  **Haiku effort 가드**: 모델이 effort level을 보고하지 않으면 effort 생략(수동 경로와 동일, 미지원 effort 전송 시 에러 방지).
- **UI 투명성**: work-header에 라우트 프리뷰 칩(`→ {model} ({difficulty})`) — 현 초안이 어느 tier로 갈지 표시.
  cost-saver OFF면 칩 소멸·헤더가 수동 모델 복원.
- **CDP 실증**(`scripts/verify-token.js`, PASS:true):
  - `rename the variable foo to bar` (trivial) → **`→ haiku (trivial)`**
  - 295자 일반 프롬프트 (moderate) → **`→ sonnet (moderate)`**
  - `design a distributed consensus algorithm…` (hard) → **`→ opus[1m] (hard)`** (라이브 모델 목록의 1M opus id 해석)
  - cost-saver ON → 헤더 `⚒ ⚡ cost-saver`; OFF → 프리뷰 소멸 + `⚒ default` 복원.

### 단일 소유자 원칙 준수
`routing.ts`는 본문 §3의 "중복 구현 금지" 그대로 — SQUAD conductor(cascade)와 cost-saver(렌더러)가 **동일
모듈**을 사용. 렌더러가 main의 순수 모듈을 import하는 것은 설계 의도("BOTH the cost optimizer ... import from
here")이며, 빌드상 안전(esbuild가 type-only import 제거 → 방출 JS에 런타임 의존성 0).

### 여전히 미수행 (라이브/측정 의존)
- **레버 2/5/6** 미착수 · **레버 3**는 `auto-compact at 80%` 토글만 존재(가역 정책 미완).
- **§5 측정**(대시보드 + 구독 rate-limit 반증) — 라이브 구독 세션 필요. cost-saver의 *실제* 달러/rate-limit
  이득은 출하 전 측정 대상으로 유지.

---

## 10. 구조적 토큰 절감 심층 보고서 반영 — Forge가 *실제로* 제어하는 레버만 (2026-06-19)

외부 기술 보고서("LLM 에이전트 하니스의 구조적 토큰 절감")를 정독해 Forge에 매핑했다. 핵심 결론은
**아키텍처 진실 하나**로 수렴한다: **Forge는 `claude` CLI를 서브프로세스로 띄우는 래퍼**이므로, 보고서의
최고 레버 다수가 *CLI 내부에서 이미 처리*되거나 *Agent SDK Options에 노출되지 않는다*. 따라서 절감 작업은
"있어 보이는 기능을 흉내 내기"가 아니라 **Forge가 실제로 소유한 토큰만 줄이기**다.

### 10.1 두 가지 구분 (보고서 §0)
- **COUNT 감소** = 컨텍스트에 들어가는 토큰 수 자체를 줄임(컴팩션·프루닝·압축·캡).
- **COST 감소** = 토큰 수는 같고 단가를 낮춤(프롬프트 캐싱 = 캐시 읽기 ≈ 입력가 10%).
- 두 축은 곱셈. Forge의 캐시 정렬(COST)은 이미 잘 되어 있고(§8/§9), 이번 작업은 남은 **COUNT** 레버 중
  *Forge가 실제로 제어 가능한 것*에 집중.

### 10.2 레버 소유권 분류 (가장 중요)

| 보고서 레버 | Forge에서 누가 제어? | 상태 |
|---|---|---|
| **프롬프트 캐싱 / KV prefix 안정성**(최고 레버) | CLI가 `cache_control` 브레이크포인트를 내부 설정. Forge 역할은 **prefix를 깨지 않는 것**뿐 | ✅ 감사 확인 — 시스템 프롬프트 안정·디렉티브는 user-message·repo/memory는 fresh-turn-only. **추가 작업 불필요** |
| **서버측 컴팩션** | CLI(`/compact`·auto-compact) | ✅ Forge가 위임(`compact.ts`). 변경 없음 |
| **컨텍스트 편집 `clear_tool_uses` · 툴서치 `defer_loading` · PTC(코드실행)** | 원시 Anthropic API 베타 — **Agent SDK Options에 미노출** | ⛔ Forge에서 설정 불가. "SDK 지원 대기"로 정직하게 표기, 흉내 금지 |
| **모델 자신의 툴 결과(Read/Bash)** + **네이티브 서브에이전트 격리** | CLI 내부 | ✅ 이미 격리. 변경 없음 |
| **Forge가 *직접 구성해 주입*하는 컨텍스트** | **100% Forge** | ⚠️ 두 군데가 무경계였음 — **이번 수정 대상** |
| **턴마다 싣는 tool/MCP 정의 footprint** | 부분적으로 Forge(어떤 서버를 넘길지) · 스키마 직렬화는 CLI | ⚠️ 정확 측정은 CLI 소관(아래 한계) |

### 10.3 이번에 구현 (Phase 1 — 순수 main-process, `npm run test`/`selftest`로 검증)

1. **goose `delegate` 결과 캡 (실제 런타임 이득).** `delegateTool.ts`가 자유-모델 서브에이전트의 출력
   **전체**를 무제한으로 툴 결과에 인라인 → 이후 매 턴 재전송(O(n²))되던 것을, 신설 `capToolResult()`로
   **기본 8k 토큰 상한**(마킹된 손실 압축)으로 제한. 보고서의 "큰 관찰을 경계하라 / <25k 토큰" 규칙을
   Forge가 실제로 적용할 수 있는 **유일한 라이브 툴-결과** 지점. 공급자 설정 전엔 비활성(영향 0).
2. **오케스트레이션 blackboard 컨텍스트 캡 (잠재/라이브러리 정합성).** `subtaskRunner.ts`의 prior-output
   컨텍스트도 동일 캡 적용. **단, 정직 고지**: conductor/topology/loop/subtaskRunner 엔진은 현재
   **런타임 호출자가 없는 selftest 전용 라이브러리**(`ipc/orchestrate.ts` 헤더 참조, `runSubtaskQuery`
   미사용). 따라서 이는 *엔진 재배선 시를 대비한 무비용 정합성 수정*이지 현재 토큰 절감이 아니다.
3. **주입 컨텍스트 토큰 계측 (데이터 레이어).** repo-map + recalled-memory로 Forge가 주입하는 토큰량을
   `injectedTokens`로 측정해 result 이벤트 → `AgentActivity`에 영속화(fresh 턴만, resume은 0). 보고서 §9의
   "주입 occupancy" 지표. **§8/§9가 cache-write를 데이터-우선으로 출하한 패턴과 동일** — UI 노출은 렌더러
   후속(Phase 2)으로 보류.

`capToolResult` + `FORGE_CONTEXT_TOKEN_CAP`(8k, 단일 소유 상수)는 순수·테스트됨(efficiency.test 58/58).
typecheck ✅ · selftest 133 ✅.

### 10.4 측정의 정직한 한계
- **MCP tool-definition occupancy는 Forge에서 정확 측정 불가.** 사용자 등록 MCP 서버의 툴 스키마는 CLI가
  런타임에 직렬화하므로 Forge 프로세스엔 그 문자열이 없다. 따라서 "각 서버 N토큰" 표시는 추정조차 신뢰
  어려움 → 본 작업에서 제외, 한계로 명시. (delegate 툴 스키마만 알려져 있고 ~350토큰으로 작다.)
- `injectedTokens`는 cheap ~4 chars/token 추정(실 토크나이저 아님) — 내부 비교용으로만 신뢰.

### 10.5 Phase 2 구현 (2026-06-19, 렌더러 — 라이브 미검증)
보고서 §5(MCP tax)·§9(occupancy)의 렌더러 측 작업을 완료. **클라우드 세션엔 키/GUI가 없어 렌더러
*동작*은 미검증** — typecheck·build(렌더러 339모듈)·순수 코어 테스트로만 확인. 로컬 Electron 실행에서
확인 필요(이 repo의 기존 렌더러 기능들과 동일한 정직 고지).

1. **`injectedTokens` Cost 탭 노출** ✅ — Cost & Cache 대시보드에 "INJECTED CTX" 타일 추가(repo map +
   memory가 차지하는 주입 토큰 합계). 순수 관측 — 추가 토큰 0.
2. **대화별 MCP 스코핑** ✅ (보고서 §5 "MCP tax" 직격 레버) — 각 MCP 서버의 툴 정의가 매 턴 재전송되므로,
   대화별로 *필요한 서버만* 로드하도록 선택. `RunOptions.mcpScope`(undefined ⇒ 전체, 기본 무변경) →
   `toSdkMcpServers(scope)`가 `scopeMcpServers`(순수·테스트됨, `src/main/mcpScope.ts`)로 필터 → 채팅
   컨트롤바의 `mcp` 토글 + 멀티셀렉트 모달. 선택은 per-tab 상태 + 세션별 localStorage 영속(model/effort/
   persona override와 동일 패턴). 무거운 MCP 세트를 쓰는 사용자에게 O(n²) 재전송 비용 직접 절감.
   delegate 툴(provider 게이트, ~350토큰)은 스코핑 대상 아님.

### 10.6 미수행 / 후속 (정직)
- **SDK 종속(차단)**: `clear_tool_uses` 컨텍스트 편집·툴서치·PTC는 Agent SDK가 옵션으로 노출하기 전엔 불가.
- **skill 스코핑**: 이번엔 MCP 서버만. skill은 SDK가 트리거 시 본문을 로드(점진적 공개)라 메타데이터
  (~100토큰/개)만 상시 비용 → 우선순위 낮음.
- **제약 준수**: 본 작업은 보고서의 하드 제약("모델·노력 불변, 하니스 구조만 변경")을 지킨다 — thinking
  budget 캡·강제 모델 다운그레이드·서브에이전트 수 축소는 *하지 않았다*(품질 저하 레버라 제외).

---

## 11. 남은 4개 레버 — 정직하게 적용 가능한 만큼만 (2026-06-19)

보고서의 "미적용" 4개(관찰 마스킹·시맨틱 응답 캐싱·프롬프트 압축·RAG)를 진행. **핵심: 각 레버의
"진짜" 버전은 Forge의 로컬-전용·CLI-래퍼 구조에서 부분적으로만 가능**하다. 모든 레버는 **순수 코어 +
헤들리스 테스트**(`npm run test`, 효율 12 + 청크 4 신규)로 검증하고, 불가능한 부분은 흉내 내지 않고
명시한다. 정적 게이트: typecheck ✅ · build ✅(렌더러 339모듈, main 번들에 retrieval/efficiency 포함) ·
test 75 ✅ · selftest 133 ✅ · lint 신규 0.

| 레버 | "진짜" 버전 가능? | Forge가 한 것 | 라이브 배선 |
|---|---|---|---|
| **RAG / Contextual Retrieval** | ✅ 가능 | 워크스페이스 **콘텐츠 청크**를 BM25로 top-k 검색해 주입 | ✅ 라이브 |
| **시맨틱 응답 캐싱** | ◐ 부분 | 임베딩 없음 → **정규화-정확/렉시컬** 캐시 | ✅ delegate(읽기전용)만 |
| **프롬프트 압축(LLMLingua)** | ◐ 부분 | 소형 LM 없음 → **모델-프리 prose squeeze** | ✅ memory 주입 |
| **관찰 마스킹** | ⛔ 라이브 불가 | 순수 코어만 | ❌ (CLI가 히스토리 소유) |

### 11.1 RAG / Contextual Retrieval ✅ (라이브, 최고 가치)
- `src/main/retrieval/` — `chunk.ts`(순수: 파일→라인윈도우 청크, 오버랩) + `scan.ts`(콘텐츠 스캔,
  fingerprint 캐시) + `index.ts`(기존 `memory/bm25` 재사용해 쿼리로 top-k 랭크). repo-map(구조)을
  실제 **코드 구절**로 보완.
- 주입: **fresh 턴만**(캐시 안정), 1200토큰 예산, top-6, 각 청크에 `// path:line` 헤더 = **모델-프리
  Contextual Retrieval**(Anthropic은 LM으로 맥락 문장 생성; Forge는 경로를 맥락으로 사용 — 토큰 0).
- **자연 게이트**: BM25는 용어가 겹칠 때만 청크 반환 → 무관한 프롬프트엔 0 주입(노이즈/블로트 방지).
  쿼리 토큰 <3이면 스킵.

### 11.2 시맨틱 응답 캐싱 ◐ (delegate 읽기전용만)
- `src/main/efficiency/responseCache.ts` — 순수 LRU+TTL 캐시. **임베딩 모델이 in-process에 없어
  진짜 시맨틱(벡터) 매칭은 불가** → 기본 **정규화-정확 매칭**(threshold 1, false-positive=0), 옵션
  렉시컬 Jaccard(threshold<1).
- 배선: **goose `delegate`의 읽기전용 위임만** 캐시(cwd+instruction 키, 5분 TTL). 쓰기 위임은
  부작용이 있어 **절대 캐시 안 함**. 상태 의존적 메인 에이전트 턴엔 적용 안 함(보고서의 "조용히 틀린
  답" 위험 회피). 같은 lookup 반복 시 무료-모델 재호출 절약.

### 11.3 프롬프트 압축(LLMLingua) ◐ (모델-프리)
- `compress.ts`에 `squeezeProse()` 추가 — **저신호 필러 *구문* 제거**(stopword 제거가 아님: 코드 손상·
  의미 변화 위험 회피) + 공백 정리. **진짜 LLMLingua는 소형 LM의 perplexity 점수가 필요해 모델-프리로는
  불가** → 보수적 휴리스틱임을 명시.
- 배선: **memory 주입 prose에만** 적용(코드엔 미적용). 효과는 작지만 안전.

### 11.4 관찰 마스킹 ⛔ (순수 코어만, 라이브 불가)
- `src/main/efficiency/mask.ts` — `maskObservations()`(최근 k개 full, 오래된 건 `[masked: ~N tokens]`).
  JetBrains "The Complexity Trap" 충실 구현 + 테스트.
- **라이브 배선 불가**: 마스킹은 *진행 중 대화 히스토리*의 옛 툴 출력을 교체하는 기법인데, Forge의
  히스토리는 `claude` CLI 서브프로세스가 소유 → 중간에 재작성 불가(`clear_tool_uses`와 동일 한계).
  Forge가 소유한 라이브 "관찰 리스트"가 없어, 흉내 배선 대신 **테스트된 순수 코어로만** 출하. 의도된
  적용처는 오케스트레이션 blackboard(현재 chat-트리거 전용·런타임 호출자 없음)이며, 엔진 재배선 시 사용.
