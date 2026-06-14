# Squad Orchestration — 설계 (v3, 검증 반영)

> 메인 채팅에서 서브에이전트를 하이브리드(토글)로 조율하고, Squad 탭은 진행률 모니터로
> 전환하는 재설계. 목표는 "여러 모델 병렬"이 아니라 **효율·능력·결과 품질을 동시에 높이는
> 결정론적 오케스트레이션**이다. v3는 1차 출처 검증과 적대적 자가비판을 본문에 통합했다.
>
> **인식 한계**: 저자(모델) 신뢰 지식 컷오프는 2026-01. 2026-02~06 arXiv 인용은 웹 검색으로만
> 접했고 다수가 미동료평가 preprint다 — 아래 §0 등급으로 구분한다.

---

## 0. 근거 검증 원장 (핵심 인용)

| 주장 | 출처 | 등급 | 판정 |
|---|---|---|---|
| 멀티에이전트(Opus 리드+Sonnet 워커) 단일 대비 **+90.2%** | Anthropic 블로그(내부 eval) | primary(내부) | ✅ 단 **breadth-first 리서치** 과제 — 코딩 아님 |
| 에이전트 ~4×, 멀티에이전트 **~15× 토큰** | Anthropic 블로그 | **primary** | ✅ |
| 토큰이 성능분산 80% 설명(3요인 95%) | Anthropic 블로그(BrowseComp) | **primary** | ✅ |
| naive 스케일 실패: 병렬=verification gap, 순차=context ceiling | arXiv 2602.18998 | preprint(컷오프 후) | ✅ abstract. "self-choice 뒤처짐" 세부는 2차발 → 보류 |
| 결정론(blueprint) > free-form 위임 | arXiv 2508.02721 | preprint | ◐ 논지만 확인 |
| Debate(3에이전트·2라운드) 환각↓ | ICML 2024 (Du et al.) | **peer-reviewed** | ✅ 가장 단단 |
| DACS 격리 90–98% vs 21–60%, 3.53× | arXiv 2604.07911 | preprint(컷오프 후) | ⚠️ 200시도 중 실제 LLM 40개뿐, **대부분 합성** |
| AHE / AOrchestra / ESC·CISC 수치 | 컷오프 후 preprint·2차 | weak | ⚠️ **미검증 — 동기로만, 수치 인용 금지** |

> 교훈: 강한 근거(Anthropic·공식문서·ICML)만 단정조로 쓰고, preprint·2차는 "방향 시사"로만 쓴다.

---

## 1. 검증 결과 — 현재 Squad는 "오케스트레이션 없는 병렬 팬아웃"

- `runAll()`은 각 에이전트에 `runAgent()`를 도는 단순 루프 (`src/renderer/src/App.tsx:3007-3009`).
- 각 `runAgent()`는 **독립된** `window.forge.agent.start(...)` 호출(`App.tsx:2990`) — N개의 별개
  `query()` 세션이 서로의 출력을 못 본다. 종합/투표/심판 없음.
- 메인 러너 `runStreaming`은 SDK에 `options.agents`를 **안 넘긴다**(`src/main/agent.ts:537-569`).
- → 사용자가 느낀 "한 질문에 3개 모델이 따로 답할 뿐"이 정확. 트리(orchestrator-worker)로 가야 한다.

---

## 2. ⚠️ 이 기능을 지을 가치가 있는가 (전제 비판 — 먼저 읽을 것)

낙관 전에 4가지 약점을 직시한다. 이걸 못 넘기면 **만들지 않는 게 합리적**이다.

1. **도메인 전이 미입증.** 멀티에이전트의 최강 증거(+90.2%, debate, DACS)는 전부 *리서치/
   breadth-first*다. **Forge는 코딩 도구** — 코딩은 수렴·롱호라이즌이라 병렬 팬아웃 이득이 약하고
   파일 충돌 위험이 크다. 리서치용 수치가 코딩으로 전이된다는 보장은 **없다**.
2. **공정 베이스라인 문제.** 15× 컴퓨트 멀티에이전트가 1× 단일을 이기는 건 당연하다. 의미 있는
   비교는 **단일 에이전트에 동일 토큰 예산**(best-of-N 단일, 더 긴 thinking)을 준 것과 겨루는 것.
   2602.18998도 "naive 병렬 스케일은 실효 없음"이라 한다 → §6 eval은 *동일 컴퓨트*로 한다.
3. **구독 경제성.** Forge는 구독 우선. 15× 토큰 = **rate-limit 15배 소진**. 데일리 드라이버에서
   Squad 몇 번이면 한도가 바닥난다 → 기술적으로 돼도 실사용이 비현실적일 수 있다.
4. **Forge 성숙도 대비 과스코프.** App.tsx 3600줄 모놀리식 + 깨지기 쉬운 dev 루프. 솔로 프로젝트가
   Conductor+Verifier+라우터를 다 짓는 건 비현실적 → **Phase 1만 본선, 나머지는 조건부(§5)**.

---

## 3. 설계 원칙 (근거 매핑)

- **하이브리드 결정론 — 단, SDK `Workflow` 위에.** Forge가 골격(상태머신)을 소유하고 모델은 경계
  안에서 전술만 결정. **바닥부터 만들지 말 것**: SDK의 `Workflow` 툴이 이미 "대화 컨텍스트 밖
  결정론적 오케스트레이션(=blueprint-first)"을 1차 제공한다. Conductor는 그 위의 얇은 레이어로 둔다.
  (Blueprint-First 2508.02721; 산업 hybrid 표준)
- **외부 검증 우선.** naive 스케일은 verification gap/ceiling에 막힌다(2602.18998). best-of-N은
  생성자가 아니라 **검증자가** 선택. 가능하면 **도구기반(테스트/타입체크)** = 객관 검증.
  ⚠️ 단 객관 오라클이 있는 과제에만 성립 — 리팩터 판단·설계·문서는 다시 gap이다(과장 금지).
  (MAV 2502.20379; VerifiAgent 2504.00406; Marco 2603.28376 — preprint, 방향 근거)
- **타겟 컴퓨트 > brute force.** ceiling을 존중해 무작정 N을 안 늘리고: cascade(싼→자기검증 실패 시
  승급), early-stopping(합의 시 중단), 신뢰가중 투표. (수치는 §0대로 보류, 메커니즘만 채택)
- **컨텍스트 격리.** 워커는 최소 슬라이스만, 요약만 부모로(오케스트레이터 오염 방지). (DACS — 합성
  위주 preprint지만 방향은 SDK 서브에이전트 기본 동작과 일치)
- **eval 게이트 + 결정-관찰가능성**(AHE 방법론 — 수치는 미검증, *방법*만 채택): 변경마다 예측→결과 검증.
- **강건성**: judge 편향 완화(순서 스왑·복수 judge·도구 그라운딩); reward-hacking 방지(생성자에
  테스트 오라클 비노출); 단계간 체크포인트(오류 복리 차단); bounded execution(runaway 차단).

---

## 4. 아키텍처 — "Conductor" (SDK Workflow 위)

```
사용자 작업 ─▶ Planner ─▶ Plan(DAG, JSON) ─▶ [plan 검증 게이트 + 사용자 승인/편집]
 (CHAT 토글)   (lead)                          (하이브리드=force; 나쁜 plan 차단)
                                  │
                                  ▼  SDK Workflow/subagents 위의 Conductor(결정론)
        Worker pool(격리·cascade) ─▶ Verifier(외부·도구기반 우선) ─▶ Synthesizer
                                  └────── Blackboard(typed) ──────┘
        Budget Governor(투영·하드캡)        Squad 탭 = Plan 편집기 + Blackboard 모니터
```

- **Planner(lead)** — 작업을 constrained JSON plan으로(프로즈 아님): subtask·의존(DAG)·토폴로지·
  모델티어·도구범위·**성공 루브릭**·예산. **plan 자체 검증 게이트**(sanity 체크 + 하이브리드 승인)를
  통과해야 실행 — plan은 미검증 단일 실패점이므로 필수.
- **Conductor(Forge main)** — plan을 **SDK `Workflow`/서브에이전트로** 결정론적으로 실행. 병렬/재시도/
  예산/캐시 관리. (bespoke 상태머신 신규 구축은 최후수단)
- **Worker pool** — cascade(Haiku→Sonnet→Opus), 공유 cacheable prefix(토큰 문서와 연동).
- **Verifier(외부)** — 도구기반(테스트/타입체크) 우선 / 루브릭 pointwise / pairwise(순서스왑) /
  self-consistency(early-stop) / debate. 생성자와 분리, 싼 모델 우선.
- **Synthesizer / Blackboard / Budget Governor** — 최종 합성 / typed 공유상태 / 실행 전 비용투영·하드캡.

**토폴로지 라우터(task type별)**: 코딩/롱호라이즌→plan–execute–verify–revise(도구기반 verifier+
체크포인트) · 사실/추론→self-consistency/debate · 리서치→fan-out+외부 verifier · 모호/닫힌→cascade.

---

## 5. 데이터 계약

```ts
type Plan = { goal: string; subtasks: Subtask[]; edges: [from,to][]; budgetUsd: number }
type Subtask = { id; instruction; topology:'single'|'fanout'|'self_consistency'|'debate'|'cascade'
                 model:'haiku'|'sonnet'|'opus'|'cascade'; tools:string[]; rubric; n?; maxTurns? }
type Verdict = { subtaskId; pass:boolean; score; confidence; rationale; evidence:string[] }
type Artifact = { subtaskId; output; costUsd; verdict? }
```
Conductor는 이 위의 상태머신, Squad 모니터는 Blackboard를 렌더한다.

---

## 6. 구현 변경점

- **`agent.ts`** — `RunOptions`에 `agents`/`orchestrate`/`forceAgents` 추가, `options.agents` 전달 +
  `allowedTools`에 `Agent`(+`Workflow`). 서브에이전트 이벤트 표면화(`parent_tool_use_id` 태깅,
  `subagent-start/result`). Planner용 constrained JSON 출력. Budget Governor 연동.
- **`conductor.ts`(신규, 얇게)** — plan을 SDK `Workflow`로 실행하는 레이어 + plan 검증 게이트.
- **`verifier.ts`(신규)** — 검증 모드(도구기반/루브릭/pairwise+스왑/early-stop/debate) + judge 편향 완화.
- **`App.tsx`** — CHAT에 Orchestrate 토글; Squad 탭 = Plan 편집기(승인/수정) + Blackboard 모니터(독립 RUN 제거).
- **`scripts/eval.mjs`(신규)** — 골든셋 + **동일-컴퓨트** 베이스라인 비교(§7).
- **모델 라우터는 토큰 문서와 단일 공유 모듈**로(중복 금지) — 소유권: `routing.ts`.

---

## 7. 단계별 플랜 (Phase 1만 본선, 나머지 조건부)

- **Phase 0 (foundational)**: eval 하니스 + 골든셋(≥50) + Budget Governor + Blackboard. *기능보다 측정/안전 먼저.*
- **Phase 1 (본선)**: 코딩용 **plan–execute–verify–revise**(단일 드라이버 + 도구기반 verifier +
  체크포인트). 이걸 1순위로 두는 이유: 도구기반 검증은 객관적이고 Forge(코딩)에 직결.
- **Phase 2~4 (조건부 — Phase 1이 §8 게이트 통과 시에만)**: self-consistency+early-stop / cascade /
  fan-out+외부 verifier / debate / planner 자동 전문가 생성 / 대형 DAG Workflow / resume.

---

## 8. Kill criteria (반증 가능)

- **게이트**: Phase 1이 골든셋에서 **동일 토큰 예산을 받은 단일 에이전트(best-of-N)**를
  *유의미하게* 이겨야 한다. 같은 작업 더 많은 컴퓨트로 이기는 건 무효. context ceiling(2602.18998)과
  "16개사 중 1곳만 Level 3"(Apostolou 2026, 2차) 현실상 멀티에이전트는 공짜가 아니다.
- **구독 가드**: 예상 rate-limit 소비를 실행 전 투영하고, 일정 배수 초과 시 경고/차단. 토글 OFF면
  언제나 단일 채팅 복귀.
- **이기지 못하면 — 충분히 가능한 시나리오 — Phase 2~4를 보류한다.**

---

## 9. 참고문헌 (등급 표기)

- ✅ Anthropic 멀티에이전트(+90.2%, 15×): https://www.anthropic.com/engineering/built-multi-agent-research-system
- ✅ General AgentBench TTS 한계(arXiv 2602.18998): https://arxiv.org/abs/2602.18998
- ✅ Multiagent Debate(ICML 2024, peer-reviewed): https://github.com/composable-models/llm_multiagent_debate
- ◐ Blueprint-First(arXiv 2508.02721) · MAV(2502.20379) · VerifiAgent(2504.00406) · Marco(2603.28376)
- ◐ Claude Agent SDK Subagents/**Workflow**(공식): https://code.claude.com/docs/en/agent-sdk/subagents
- ⚠️ 미검증(동기만): DACS 2604.07911 · AHE 2604.25850 · AOrchestra 2602.03786 · ESC/CISC 수치

> 토큰/비용(15× 포함)은 `docs/TOKEN_OPTIMIZATION.md`와 함께 볼 것. 라우터는 양 문서 공유 모듈.

---

## 10. 실행 결과 — 검증된 메커니즘 코어 구현 (2026-06-14)

**결과 요약: Phase 1의 결정론 오케스트레이션 코어를 *순수·주입형* 모듈로 구현하고 헤드리스로 실증.**
"검증된 *메커니즘*은 채택, *수치*만 실측 보류"(본문 §0 원칙)에 따라, 모델 호출을 의존성 주입으로
분리해 **컨덕터 제어흐름·라우팅·검증 로직을 라이브 세션 없이 실제 실행·검증**했다.
`npm run selftest` **39/39 통과** · typecheck ✅ · build ✅ · lint 신규 0.

### 구현한 모듈 (모두 electron/SDK 의존 0 → 헤드리스 테스트 가능)
- **`src/main/orchestration.ts`** — §5 데이터 계약(`Plan`/`Subtask`/`Verdict`/`Artifact` + `Topology`/
  `ModelTier` enum) + DAG 헬퍼(`deriveDeps`, `topoSort` Kahn + 사이클 감지). *근거: blueprint-first
  결정론 2508.02721.*
- **`src/main/conductor.ts`** — **plan 검증 게이트**(`validatePlan`: 유니크 id·유효 edge·비순환·enum·
  **빈 rubric 거부(검증불가)**·예산>0) + **결정론 실행기**(`executePlan`: 토폴로지 순서 → 실행 →
  외부검증 → 실패 시 **cascade 승급 재시도**(maxRevisions) → **체크포인트** → **예산 하드캡 선차단**) +
  `projectPlanCost`. *근거: 외부검증 우선(verification-gap 가드), bounded execution, §8 구독 가드.*
- **`src/main/verifier.ts`** — `aggregateVotes`(다수결/신뢰가중, **동점=fail**) · `shouldEarlyStop`
  (self-consistency) · `pairwiseWithSwap`(**순서스왑 편향상쇄**) · `debateConverged`. *근거: **ICML 2024
  Du et al. debate(동료평가, 최강근거)** + judge 편향 완화.*
- **`src/main/routing.ts`** — **양 문서 공유 라우터**(§6 단일 소유권). `classifyDifficulty`(휴리스틱) +
  `route`(난이도→tier+effort, **explicit plan tier 우선**) + `escalate`(haiku→sonnet→opus 캡) +
  `resolveModelId`(라이브 모델목록 매칭, **id 하드코딩 회피**). *근거: 난이도 라우팅 + 실패시 cascade(타겟
  컴퓨트). TOKEN 레버4와 동일 모듈.*

### SDK 네이티브 위임 배선 (행동 보존)
- `agent/types.ts` `RunOptions.agents?`(SDK `AgentDefinition` 부분집합) 추가 + `runStreaming`에서
  `options.agents` **가산 전달**(없으면 위임 없음 = 현행 동일). `Agent` SDK 옵션 기반 orchestrator-worker가
  이제 가능. *주의: §6의 `allowedTools` 강제는 **의도적 미적용** — allowedTools 설정 시 여타 도구 접근이
  끊겨 회귀 위험. 위임은 bypassPermissions + agents 정의로 충분.*

### 헤드리스 검증 (반증 가능 — 실측 없이 가능한 부분)
- `scripts/orchestration-selftest.cjs` + `tsconfig.selftest.json`(순수 코어만 CommonJS 컴파일) →
  `npm run selftest`. **39 체크**: 라우팅(난이도·cascade·escalate·resolve) · 검증(투표·동점fail·
  early-stop·debate·order-swap) · DAG(순서·사이클) · 게이트(7개 거부 케이스) · 실행(happy-path 순서·
  revise 승급·예산캡·invalid 단락). 빌드 산출물 `out-selftest/`는 `.gitignore` 처리.

### 미수행 — 라이브 환경 필요 (정직한 한계, 본문 §8 게이트 그대로)
- **Planner(lead) constrained-JSON 출력 · 실제 subtask 실행/검증 모델 호출**: 주입 인터페이스(`runSubtask`/
  `verify`)는 정의됐으나, 실제 SDK 호출 어댑터 + 골든셋(≥50) eval은 **구독/API 세션 필요**.
- **§8 Kill 게이트(동일토큰 단일 best-of-N 대비 우위)** 미측정 — 이게 통과해야 Phase 2~4 진행.
- **렌더러 UI**(CHAT Orchestrate 토글 · Squad 탭 Plan 편집기 + Blackboard 모니터) 미착수 — 라이브 검증 권장.

> 요약: **메커니즘(결정론 컨덕터·cascade·debate·order-swap·게이트·예산거버너)은 코드로 채택 + 실증 완료.**
> 남은 것은 (a) 모델 호출 어댑터 배선과 (b) 골든셋 실측 게이트 — 둘 다 라이브 세션 의존.

---

## 11. 실행 결과 2 — 도구기반 Verifier · 토폴로지 실행기 · eval 코어 (2026-06-14)

**결과 요약: 라이브 세션이 불필요한 검증 메커니즘 3종을 추가 구현·실증.** `npm run selftest` **59/59**
(8모듈) · typecheck ✅ · build ✅ · lint 신규 0 · `node scripts/eval.mjs` 골든셋 53개 검증 통과.
세 모듈 모두 *모델 호출은 주입*이거나 *툴체인 호출*이라 헤드리스로 실제 동작 검증됨.

### ① 도구기반 Verifier — `src/main/toolVerifier.ts`
- **플랜 §3이 1순위로 꼽은 검증자**(LLM judge 아닌 **객관 도구 오라클**) → **모델 불필요.**
  `runChecks`(주입 러너로 typecheck/test/build 실행) + `checksToVerdict`(전부 통과해야 pass,
  confidence=1) + 프로덕션 `execCommandRunner`(child_process, 지연 import). selftest 6체크.
- *의의*: verification-gap·reward-hacking이 구조적으로 없는 유일한 검증 경로. 코딩(Forge)에 직결.

### ② 토폴로지 실행기 — `src/main/topology.ts`
- §4 토폴로지 라우터를 **주입형 러너 위 순수 오케스트레이션**으로 구현. `executeTopology`가
  subtask.topology로 분기: **fanout**(verifier-선택 best-of-N) · **self_consistency**(early-stop) ·
  **debate**(ICML 2024, 수렴까지 라운드) · **cascade**(실패 시 tier 승급) · single. 전 샘플을 반환 →
  Squad 탭 모니터가 샘플별 작업을 렌더할 데이터. selftest 8체크(early-stop·best-of-N·escalation 실증).

### ③ eval 코어 + 골든셋 — `src/main/eval.ts` · `eval/golden-set.json`(53) · `scripts/eval.mjs`
- **골든셋 53개**(코딩 과제+rubric, 카테고리 15종·난이도 3단계) **작성** — 순수 데이터. `validateGoldenSet`로
  실증(unique id·rubric·≥50). `scoreRun`/`summarize`/`baselineDelta`/**`gateVerdict`**(§8 kill-criteria:
  *동일 컴퓨트에서 품질 우위*여야 pass — 토큰 더 써서 이기면 실패) 전부 순수·테스트됨. selftest 6체크.
- `scripts/eval.mjs`는 **세션 없이 지금 실행 가능**(골든셋 로드·검증·분포 출력). 실제 run 루프(모델 호출 +
  동일토큰 baseline 비교)만 라이브 TODO — *채점·게이트 로직은 이미 구현·검증*이라 어댑터만 남음.

> 정리: SQUAD §8 Kill 게이트의 **채점·판정 메커니즘은 완성**(eval.ts), **데이터(골든셋)도 완성**.
> 라이브에 남은 건 "각 과제를 실제로 돌려 점수를 채우는" 모델 호출뿐. selftest로 메커니즘 상시 재확인.

---

## 12. 실행 결과 3 — Squad 탭 전환(하이브리드 모니터) + 런타임 CDP 검증 (2026-06-14)

**결과 요약: Squad 탭을 "병렬 답변" → "서브에이전트 작업률 모니터(하이브리드)"로 전환하고, dev 앱을
CDP로 띄워 *런타임 동작*까지 검증 완료.** 사용자가 원한 가시적 변화가 실제로 동작함을 라이브로 확인.

### 구현 (행동 보존 — MANUAL 모드는 기존 그대로)
- **`SquadView`에 모드 토글**: `⚔ MANUAL SQUAD`(기존 병렬 팬아웃, 무변경) ↔ `⚙ ORCHESTRATE`(신규).
- **`OrchestrateView`(신규, 동일 파일)**: ⒜ goal + **`AI delegates` 토글(하이브리드: AI 위임/수동 지정)**,
  ⒝ **Plan 편집기**(subtask별 instruction·topology·tier 편집·추가·삭제), ⒞ **Blackboard 모니터**
  (subtask별 상태 dot·tier 배지·샘플 수·verdict ✓/✗·점수, 전체 done·spent 요약).
- **IPC 파이프라인(신규)**: `ipc/orchestrate.ts`의 `orchestrate:dry-run` → **실제 `conductor.executePlan`
  + `topology.executeTopology`를 *시뮬레이션 러너*(모델 없음)로 실행**하고 `ConductorEvent`를 스트리밍.
  preload `window.forge.orchestrate.{dryRun,validate,onEvent}` 노출. *모델 호출만 빼면 진짜 엔진 경로.*

### 런타임 검증 (dev + CDP — 사용자 요청)
- `FORGE_CDP=9222 electron-vite dev`로 dev 앱 기동(`index.ts`의 CDP 스위치) → CDP 도달 확인. 앱은
  `auth.json` 존재로 **게이트 통과**(MainShell 렌더). 드라이버: `scripts/cdp.mjs`(eval)·`scripts/cdp-shot.mjs`(스크린샷).
- **검증 결과(라이브 DOM)**: ORCHESTRATE 전환 → 패널 렌더(goal·3 subtask·모니터) → **DRY RUN** 클릭 →
  Blackboard가 실시간 갱신·완료:
  - `scan`(single·sonnet): 1× → ✓ 1.00 · done
  - `fix`(cascade): **haiku → sonnet → opus 승급(escalation) 표시** · 3× → ✓ 1.00 · done
  - `test`(fanout·opus): 2×(best-of-N) → ✓ 1.00 · done · 요약 `$0.03 · complete`
  - 스크린샷으로 시각 확인(`BLACKBOARD MONITOR · 3/3 DONE`). **MANUAL 모드 회귀 없음**(RUN ALL + 3 패널 유지).
- 정적 게이트: typecheck ✅ · build ✅ · `npm run selftest` 59/59 ✅ · lint 신규 0(기존 에러 3개 중 preload는 위치만 이동).

### 미수행 — 라이브 모델 세션 필요 (여전한 경계)
- **RUN (live)** 버튼은 의도적 disabled — 시뮬레이션 러너를 **실제 SDK 호출(runStreaming 어댑터)**로 교체하면
  활성화. 엔진·UI·IPC·이벤트는 검증됨 → 남은 건 어댑터 1개 + §8 골든셋 *수치* 측정.

> 정리: **"엔진 → 화면 → 런타임"** 3단이 모두 연결·검증됨. Squad 탭은 이제 하이브리드 작업률 모니터다.
> 유일한 라이브 잔여 = 시뮬레이션 러너 ↔ 실제 모델 호출 스왑.

---

## 13. 실행 결과 4 — 레거시 병렬(MANUAL squad) 완전 삭제 (2026-06-14)

**결과 요약: 기존 "병렬 팬아웃(N개 독립 답변)" 모드를 코드에서 완전 제거. Squad 탭은 오케스트레이션
전용.** 사용자 요청("기존 병렬은 아예 삭제"). 런타임 CDP로 삭제 확인 완료.

### 삭제한 것
- `SquadView`의 **MANUAL 모드 전부**: `makeAgent`·`squadPreset`(race/review/research 프리셋)·수동 상태
  (agents/broadcast/configOpen/perms/runMap)·수동 이벤트 구독·`runAgent`/`runAll`/`stopAll` 등 핸들러·
  squad-bar/controls/config/grid JSX·`MANUAL↔ORCHESTRATE` 모드 토글.
- `types.ts`의 **`SquadAgent` 인터페이스**(이제 미사용 → 제거).
- `App.tsx`의 `<SquadView models/defaults/maxTurns/maxBudget/onResult>` → **`<SquadView />`** (무프롭).
- 결과: `SquadView`가 max-lines 래칫 아래로 축소(lint 경고 24→23).

### 검증
- typecheck ✅ · build ✅ · `npm run selftest` 59/59 ✅ · lint 신규 0(에러 3은 기존).
- **런타임(dev+CDP)**: Squad 탭 진입 시 **토글 없이 오케스트레이션 뷰 직행** 확인 —
  `squad-mode-btn` 0개 · `agent-panel` 0개 · `RUN ALL` 없음 · `.orch` + 3 subtask + DRY RUN 존재 ·
  DRY RUN 재실행 `3/3 done · $0.03 · complete`(cascade 승급 정상). 스크린샷 확인.

### 잔여 (선택적 정리)
- 수동 squad용 **죽은 CSS**(`squad-bar`/`squad-config`/`agent-row`/`agent-panel`/`squad-mode-*` 등)는
  남겨둠 — 매칭 요소가 없어 무해하고, CSS nesting brace 함정(CLAUDE.md) 리스크 회피. 필요 시 별도 정리.
