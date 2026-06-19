# 플랜 진행률 추적 & 다음 할일 (2026-06-14)

> `docs/` 5개 플랜의 진행 상태를 **실제 코드 검증** 기반으로 추적한다. 각 플랜의 자체 원칙
> ("추측 말고 측정")에 따라, 문서의 진행 기록을 코드와 대조해 확인한 결과만 기록한다.
>
> **업데이트(2026-06-14, 재개)**: MAINTAINABILITY Phase 4(main 백엔드 분해) + `max-lines` 래칫
> 실행 완료 — `agent.ts`(740) → `agent/`(11파일·배럴), `index.ts`(181→58) → `ipc/*`. 정적 게이트
> 통과(typecheck·build green, lint 신규 에러 0). 상세는 §2 / MAINTAINABILITY.md §9.
>
> **업데이트(2026-06-14, TOKEN 렌더러 배선)**: 레거시 병렬(MANUAL squad) 완전 삭제 + **TOKEN 레버 1·4
> 렌더러 배선 완료 + dev CDP 런타임 검증**. 레버1 캐시 지표를 검증된 `cacheHitPercent()` 헬퍼로 일원화
> + write side 노출, 레버4 cost-saver를 per-prompt 난이도 라우터(`route()`/`resolveModelId()`)로 승급 —
> trivial→haiku · moderate→sonnet · hard→opus[1m] 실증. 정적 게이트 통과(typecheck·build·selftest 59/59,
> lint 신규문제 0). 상세는 §5 / TOKEN_OPTIMIZATION.md §9.
>
> **업데이트(2026-06-15, GOOSE 무료-프로바이더 위임 — Plan A)**: 새 플랜 `docs/GOOSE_INTEGRATION.md`.
> 메인 Claude가 in-process MCP **`delegate` 툴**로 간단한 서브태스크를 **무료 모델(OpenRouter/Gemini/Groq/
> Ollama/임의 goose 프로바이더)** 에 위임 → goose(ACP/stdio JSON-RPC)로 실행 → 결과 인라인 반환(허브-앤-
> 스포크; agent-to-agent 자유채팅 없음). **구현·검증 완료**: `providers.ts`(+forge-providers.json)+IPC+
> ProvidersPanel(Custom 옵션), `goose/*`(binary·env·acpClient·mapper·runGooseSubtask·delegateTool·registry·
> quota), runStreaming 배선, routing.pickProvider/orderProviders, `cheap` 키워드, Agents 대시보드 중첩,
> 인터럽트 정리·동시성캡·런어웨이가드·**429 쿼터 폴백**(프로바이더 순환+쿨다운). 정적 게이트: typecheck 0·
> **selftest 105**·ensure/spike 스크립트. **라이브 검증(goose 1.37.0)**: initialize→session/new→set_mode→
> session/prompt 생명주기·env 키주입·usage_update 토큰·다운로드/추출. **잔여(키 필요, GOOSE_INTEGRATION §9
> 체크리스트)**: session/request_permission 형태→read-only 게이트 확정(현재 fail-closed)·mapper 필드명·
> quota 정규식·eval 회귀가드. PR #18.
>
> **업데이트(2026-06-14, 라이브 세션 — 실제 모델 호출 검증)**: dev(`electron-vite dev --remoteDebuggingPort
> 9222`) + CDP로 **실제 구독 모델 호출까지 검증**. ① TOKEN 레버1·4 라이브: trivial→haiku 1콜 $0.0452 +
> 캐시 **22.2k written**, 2콜째 **22.2k read·50% hit**·per-run $0.0452→**$0.0025(18×↓)**. ② **P0 SQUAD
> 실제 SDK 어댑터 배선+라이브 PASS** — `ipc/orchestrate.ts`에 `orchestrate:run`(실제 `runSubtaskQuery`
> read-only + haiku rubric judge) 추가, preload/SquadView `RUN (live)` 활성. 2-subtask DAG(a→b) 실행:
> 실모델 호출·blackboard 주입·verdict·$0.0747/2 artifacts. ③ PERFORMANCE Phase 0: 50k paste→paint **46ms**
> (<100ms), 스트리밍 plain-pre→`<Md>` 1회전환 런타임 확인. ④ **eval 라이브 run-loop 구현**(`scripts/eval.mjs`
> `EVAL_LIVE=1`: orchestrated[난이도라우팅+cascade] vs baseline + haiku 채점 + §8 게이트). 정적 게이트 통과
> (typecheck 0·selftest 59/59·신규 lint 0). 상세는 §3/§4/§5.

---

## 0. 전체 요약

| # | 플랜 | 상태 | 진행률 | 다음 본선 단계 |
|---|---|---|---:|---|
| 1 | `ROADMAP.md` (EXTEND 확장) | ✅ 완료 | **100%** | 없음 (유지보수 모드) |
| 2 | `MAINTAINABILITY.md` (모듈 분해) | ✅ 본선 완료 | **~90%** | 잔여는 조건부·선택뿐 |
| 3 | `PERFORMANCE.md` (렌더 성능) | 🟢 dev·prod frame-time 실측 | **~95%** | 레버5/6 조건부만 잔여 |
| 4 | `SQUAD_ORCHESTRATION.md` (오케스트레이션) | 🟢어댑터 PASS·⚠️§8 혼합 | **~85%** | §8 풀셋(moderate서 FAIL) |
| 5 | `TOKEN_OPTIMIZATION.md` (비용/토큰) | 🟡 레버1·4 라이브실증 | **~62%** | 레버2/3/5/6 + 구독 rate측정 |

**검증 근거(갱신)**: `App.tsx`=538줄 · `agent.ts` → `agent/`(11파일) · `index.ts`=58줄 + `ipc/*`(6파일) ·
`settingSources` 설정됨 · 신설 순수 모듈 **`orchestration`/`routing`/`verifier`/`conductor`/`toolVerifier`/
`topology`/`eval`**(주입형) · `options.agents` 전달(가산) · **`eval/golden-set.json` 53과제** ·
`npm run selftest` **59/59 통과(8모듈)** · `node scripts/eval.mjs` 세션없이 검증 OK · **라이브(dev+CDP) 실모델
검증 ✅**: TOKEN 캐시/라우팅·SQUAD `orchestrate:run`·PERFORMANCE paste·eval §8 게이트(서브셋) 전부 실호출로 실증.

> **공통 갭(갱신)**: 측정/검증 인프라(eval 하니스·골든셋·CDP 베이스라인·라이브 어댑터)는 이번 세션에
> **구축+실행**됐다 — eval 라이브 run-loop·SQUAD `orchestrate:run`·perf CDP·캐시/라우팅 실측 모두 작동.
> 남은 단일 최대 항목은 **규모/대시보드**: eval 풀 53셋 통계 점수, cost/cache 대시보드 UI,
> 구독 rate-limit 반증 — 전부 라이브 비용·시간 의존(배치 실행). *(prod frame-time 트레이싱은 이번 세션 완료.)*

---

## 1. ✅ ROADMAP.md — 완료 (100%)

Phase 0(settingSources) + 6개 기능 전부 EXTEND 탭에 출하. 코드로 확인:
`components/extend/`에 `ExtendView` + 6패널(Skills·Commands·Hooks·Mcp·Agents·Plugins) 존재,
`settingSources:['user','project']` 설정됨.

- [x] Phase 0 — settingSources + 안정 workspace
- [x] #1 Skills · #2 Hooks · #3 Commands · #4 MCP · #5 Agents · #6 Plugins

**다음 할일**: 없음 (신규 SDK 기능 추가 시 패널 확장 정도). 유지보수 모드.

---

## 2. ✅ MAINTAINABILITY.md — 본선 분해 완료 (~90%)

`App.tsx` **3927 → 538줄(−86%)** (렌더러) + `agent.ts` **740 → 11파일** + `index.ts` **181 → 58줄**(main).
렌더러 전 영역 + main 백엔드 모듈화 완료. 잔여는 전부 조건부·선택(CSS, MainShell, Context).

- [x] Phase 0 — `types.ts` + `lib/{format,blocks,constants}.ts` (리프 추출)
- [x] Phase 1 — EXTEND 6패널 → `components/extend/`
- [x] Phase 2 — CHAT → `components/chat/` + `useAgentEvents` 훅
- [x] Phase 3 — SQUAD/PERSONA/TitleBar 추출, MainShell 뷰 라우팅
- [x] **Phase 4 (백엔드) — main 분해** ✅ (2026-06-14 재개, MAINTAINABILITY.md §9)
  - [x] `agent.ts`(740) → `agent/` 폴더 + 배럴 (11파일, import 경로 무수정 보존)
  - [x] `index.ts`(~41 ipc 핸들러) → `ipc/*` (도메인 5모듈 + `registerAll`), index.ts 58줄로 슬림
  - [~] `styles.css`(2622) → 파셜 분할: **의도적 보류** (플랜 §2.2 대안·§6 후퇴: 가치<리스크)
- [x] **`max-lines` ESLint 래칫** ✅ (warn·400, 비차단) — 현재 Composer/App/SquadView 3건 가시화
- [ ] (선택) MainShell 슬림화 — Sidebar 분리 (강결합·~20-prop, 뷰 추출보다 위험)
- [ ] (조건부) Phase 5 — Context 도입 (prop-drilling이 실제로 아플 때만)

> 정적 게이트: typecheck ✅ · build ✅ · lint 신규 에러 0(기존 3개 유지·1개는 helpers.ts로 이동) +
> 신규 경고는 래칫 3건뿐. 행동 보존 = 순수 cut/paste + import 정리.

---

## 3. 🟢 PERFORMANCE.md — 스트리밍 레버 완료 + dev·prod frame-time 실측 (~95%)

스트리밍 핵심 레버(1·2·3·4) 적용 확인 — `components/chat/BlockView.tsx`·`TurnView.tsx`·`useAgentEvents.ts`로 이동됨.

- [x] 레버 1 — O(n²) 스트리밍 마크다운 제거 (plain↔Md 분기 + `Md` memo)
- [x] 레버 2 — rAF 코얼레싱 (프레임당 1회 flush)
- [x] 레버 3 — 메모이제이션 (`BlockView`/`TurnView` memo + 안정 콜백)
- [x] 레버 4 — autoscroll 리플로우 제거 (near-bottom 가드 + rAF)
- [x] 레버 5 부분집합 — 슬래시 매칭 `useMemo`
- [x] **Phase 0 — CDP 베이스라인 측정 (dev+prod 실측 완료 ✅)**
  - [x] dev + `--remoteDebuggingPort 9222`, 골든 입력 실측: **50k paste→paint 46ms**(<100ms ✅,
    `scripts/perf-paste.js`) · 대용량값 키스트로크 49ms · 스트리밍 plain `<pre>`→`<Md>` 1회전환 런타임 확인
    (`scripts/perf-stream.js`, 132 샘플)
  - [x] **prod 빌드(out/) frame-time 트레이싱** (`scripts/perf-frames.js`, rAF 인터벌 샘플러 873프레임):
    스트리밍 중 **median 16.7ms·p95 17.4ms = vsync 고정(60fps)** · **>50ms 단 2프레임**(초기 markdown 전환,
    max 80ms) · renderCommits **27**(1617자 응답을 토큰별 아닌 27커밋으로 배치). prod paste→paint **35ms**
    (dev 46ms보다 빠름 — HMR/devtools 오버헤드 없음). *정직: 리포트의 "jankPct 52%"는 임계 16.7ms가 vsync
    주기에 정확히 걸친 착시(절반 프레임이 16.6~16.8ms 착지=60Hz 정상); 의미지표는 >50ms=2프레임뿐 → 실질 jank 없음.*
- [ ] (보류) 레버 5 전체 — textarea 리프 격리 (memo로 한계효용 작음)
- [ ] (조건부·최후) 레버 6 — 가상화 (긴 세션 실측 렉 확인 후에만)

> 정직한 한계: 레버 1·2·3가 **실측으로 입증됨**(스트리밍 60fps·27커밋 배치=O(n²) 재렌더 없음). LayoutDuration
> 세부 분해(Tracing 도메인)는 미수행이나 rAF 샘플러로 핵심 목표지표(프레임타임/커밋수)는 정량 확보.

---

## 4. 🟢 SQUAD_ORCHESTRATION.md — 라이브 어댑터 배선+PASS (~85%)

설계 문서(v3) → **결정론 오케스트레이션 코어를 순수·주입형 모듈로 구현 + 헤드리스 실증**(SQUAD.md §10).
모델 호출을 의존성 주입으로 분리해 제어흐름을 라이브 없이 실제 테스트. `npm run selftest` 39/39.

- [~] **Phase 0** — Budget Governor ✅(executePlan 하드캡) · Blackboard ✅(typed Map) · **eval 하니스/골든셋 미수행**(세션 필요)
- [~] **Phase 1 (본선)** — plan–execute–verify–revise **코어 구현**:
  - [x] `conductor.ts` — plan 검증 게이트(`validatePlan`, 7거부케이스) + 결정론 실행기(`executePlan`)
  - [x] `verifier.ts` — 투표/동점fail · self-consistency early-stop · **order-swap** · debate(ICML 2024)
  - [x] `orchestration.ts` — §5 데이터 계약(Plan/Subtask/Verdict/Artifact) + topoSort/사이클감지
  - [x] **`toolVerifier.ts`** — 도구기반(typecheck/test/build) 객관 검증자(§3 1순위, 모델 불필요)
  - [x] **`topology.ts`** — fanout/self-consistency/debate/cascade 실행기(주입형, 샘플별 반환)
  - [x] **`eval.ts` + `golden-set.json`(53) + `eval.mjs`** — §8 채점·게이트 코어 + 골든셋(세션없이 검증)
  - [x] `agent.ts` `options.agents` 가산 전달(SDK 네이티브 위임). *`allowedTools` 강제는 회귀위험으로 의도적 미적용.*
  - [x] **Squad 탭 = 오케스트레이션 전용 ✅ + dev CDP 런타임 검증** — `OrchestrateView`(Plan 편집기 +
    Blackboard 모니터 + AI-위임/수동지정 토글) + `ipc/orchestrate.ts` dry-run. 라이브: cascade 승급
    (haiku→sonnet→opus)·fanout 2×·3/3 done 확인(SQUAD §12).
  - [x] **레거시 병렬(MANUAL squad) 완전 삭제** — makeAgent/squadPreset/수동 UI/SquadAgent 제거,
    토글 제거 → Squad 탭 직행. 런타임 확인(SQUAD §13).
  - [x] **실제 subtask 실행/검증 모델 호출 어댑터 — 배선+라이브 PASS** ✅: `ipc/orchestrate.ts`에
    `orchestrate:run` 채널 추가 — `streamExecute()`가 dry-run과 **동일 엔진**(conductor+topology+예산거버너)을
    구동하되 `run`=실제 `runSubtaskQuery`(read-only SDK, tier별 라우팅) · `verify`=haiku rubric judge(판정비용을
    artifact에 folding → 예산 정직). preload `run` + SquadView `RUN (live)` 활성. **dev CDP 라이브**: 2-subtask
    DAG(a→b) 실행 → 실모델 호출·blackboard context 주입·verdict PASS(score 1.0)·checkpoint $0.0368→$0.0747·
    2 artifacts·budget $2 내. `PASS:true`(`scripts/live-orch.js`). *시뮬 아님 — 실제 추론 호출.*
- [~] **§8 Kill 게이트 — 라이브 run-loop 구현·실행, 다중 서브셋 실판정** ✅(구현)/⚠️(혼합결과)
  (`scripts/eval.mjs EVAL_LIVE=1`: orchestrated[난이도라우팅+cascade] vs single sonnet baseline, haiku rubric
  채점, `summarize`/`baselineDelta`/`gateVerdict` 산출). **§8 판정은 과제믹스에 민감 — 라이브 3런 실측**:
  - **3과제(easy 위주) → GATE PASS ✓**: orch passRate **1.0**·score 1.0·**$0.235** vs base **0.667**·0.889·**$0.288**
    → 4지표 WIN. 난이도 라우팅이 easy를 haiku로 보내 orch가 *더 싸고* 품질도 높음.
  - **6과제(moderate 위주) → GATE FAIL ✗**: orch passRate **1.0**·score 1.0·**$0.675**·472,714 tok vs
    base **0.833**·0.944·**$0.302**·399,110 tok → 품질 WIN(+0.167/+0.056)이나 **컴퓨트 2.2× 더 씀**(돈으로 품질
    구매) → §8 공정성 미달. 원흉 `async-001`: orch $0.317 vs base $0.048(6.6×, cascade 에스컬레이션/다중샘플).
  - **2과제(tool-fighter 노이즈) → FAIL**: 프롬프트 보강 전 잡음. 보강 후 위 클린런들.
  **정직한 종합**: "orchestration 항상 이김"은 **거짓**. easy/저가-라우팅 구간만 §8 통과; 컴퓨트 무거운
  moderate에선 품질↑가 비용↑를 동반 → 게이트 탈락. 풀 53셋 통계 미수집(배경잡 환경서 중단·라이브 비용).
  → **Phase 2~4 확장 금지 근거 강화**: 토폴로지가 §8을 일반적으로는 통과 못함.
- [ ] Phase 2~4 (조건부) — 대형 DAG/planner 자동전문가생성/resume (토폴로지 메커니즘은 구현·실증됨)

> ⚠️ §2 전제 비판 유효: 코딩 전이 미입증 + 구독 15× → **메커니즘은 채택했으나 게이트 통과 전 확장 금지.**

---

## 5. 🟡 TOKEN_OPTIMIZATION.md — 레버 1·4 라이브 실증 (~62%)

설계 문서(v3) → **공유 라우터(레버4) + 캐시 지표(레버1)를 렌더러에 배선하고 dev CDP로 실증**(TOKEN.md §9).
수치 절감은 미측정(§0/§2 원칙: 메커니즘만 채택, %는 라이브 실측).

- [x] **Phase 0** — 입력분해(fresh/read/write) 완비 ✅ (`runStreaming` `contextTokens = input+read+write`) ·
  **대시보드 UI/골든셋/rate-limit 기준 미수행**(세션 필요)
- [x] **레버 1 (caching) — 완료+검증** ✅: `cacheWriteTokens` 이벤트 → `useAgentEvents`→`onResult`→usage state
  까지 관통, 캐시 % 를 검증된 **`cacheHitPercent()` 헬퍼로 일원화**(인라인 중복 제거, write side 분모 명시),
  TOKENS 패널이 `read · written of … input tokens` 표기. **라이브 실측(haiku 2콜)**: 1콜째 캐시
  `0 read · 22.2k written` → 2콜째 `22.2k read · 22.3k written of 44.5k · 50% hit`, per-run 비용
  **$0.0452 → $0.0025(≈18×↓)** — warm 캐시의 실제 절감 실증(`scripts/live-smoke.js`·`live-warm.js`).
- [x] **레버 4 (routing) — 완료+검증** ✅: cost-saver를 flat Sonnet → **per-prompt 난이도 라우터**로 승급.
  `Composer.send()`가 `route()`+`resolveModelId(models)`로 모델/effort 결정(haiku엔 effort 생략 가드),
  헤더에 라우트 프리뷰 칩. CDP 실증: trivial→`haiku (trivial)` · 295자→`sonnet (moderate)` ·
  hard→`opus[1m] (hard)`(라이브 모델 id 해석) · OFF 복귀 시 프리뷰 소멸·`default` 복원. **PASS:true**.
  **라이브 실호출**: cost-saver ON + trivial 프롬프트 → 실제 haiku로 라우팅돼 응답 완료(위 live-smoke).
- [~] **레버 3 (compaction)** — `auto-compact at 80%` 토글 존재(기존, Composer `ctxWindow` 80% 트리거) /
  플랜의 *가역 정책*(요약본↔원문 복원)은 미착수
- [x] **레버 2 (동적 tool 스코핑) — 대화별 MCP 스코핑 구현** ✅ (2026-06-19, TOKEN.md §10.5): `RunOptions.mcpScope`
  → `toSdkMcpServers(scope)`(순수 `scopeMcpServers` 필터, 테스트 5) → 채팅 컨트롤 `mcp` 토글+모달, per-tab
  영속. 무거운 MCP 세트의 매-턴 재전송 비용 직격. **렌더러 동작 미검증(클라우드 키/GUI 없음)** · build 339모듈 ✅.
- [x] **레버 5 (retrieval-first) — RAG 구현** ✅ (2026-06-19, TOKEN.md §11.1): `src/main/retrieval/`
  (chunk+scan+bm25 재사용) → fresh 턴에 top-k 콘텐츠 청크 주입(`path:line` 헤더 = 모델-프리 Contextual
  Retrieval), BM25 자연 게이트. 라이브.
- [x] **보고서 미적용 4종 진행** ✅ (2026-06-19, TOKEN.md §11): RAG(라이브) · 응답캐싱(delegate 읽기전용만,
  렉시컬·임베딩 아님) · prose squeeze(memory prose, 모델-프리·LLMLingua 아님) · 관찰 마스킹(순수 코어만 —
  CLI가 히스토리 소유라 라이브 불가). 순수 코어 전부 테스트(test 75) · typecheck · build · selftest 133 ✅.
- [ ] **레버 6 (output 절감)** — 미착수
- [x] **§10 (구조적 보고서 반영, 2026-06-19)** ✅ — Forge가 *실제로 소유한* 토큰만 줄임: goose `delegate`
  결과를 `capToolResult`(기본 8k)로 캡(라이브 O(n²) 방지) · subtaskRunner 컨텍스트 캡(잠재/라이브러리) ·
  주입 컨텍스트 `injectedTokens` 계측(데이터 레이어). SDK-제어 vs Forge-제어 레버 분류 + MCP occupancy
  측정 불가 한계를 TOKEN.md §10에 정직 기록. 순수+테스트(efficiency.test 58) · typecheck · selftest 133 ✅.
- [ ] **§5 구독 반증**: 캐싱/라우팅이 구독 rate-limit을 못 줄이면 → 레버 1·4를 *지연 개선*으로 강등 (미측정)

> 정적 게이트: typecheck ✅ · build ✅(렌더러 307모듈 — `routing.ts` 렌더러 번들에 깔끔히 포함) ·
> selftest 59/59 ✅ · lint 신규문제 0. 렌더러가 순수 `routing.ts`를 import(설계 의도: "단일 소유자").
> ⚠️ 구독 vs API 구분(§2): 달러 절감은 API 기준. 구독 모드 이득은 출하 전 **반드시 측정**.

---

## 6. 🎯 권장 다음 할일 (우선순위·교차 의존 반영)

### ✅ 완료 (2026-06-14, 정적/헤드리스로 완결 검증 · `npm run selftest` 59/59)
- ~~**MAINTAINABILITY Phase 4**~~ — main 백엔드 분해(`agent/`·`ipc/*`) + `max-lines` 래칫.
- ~~**SQUAD 오케스트레이션 코어**~~ — `conductor`/`verifier`/`orchestration` + `agents` 전달.
- ~~**TOKEN 공유 라우터 + 캐시 지표**~~ — `routing.ts` + `cacheWriteTokens`/`cacheHitPercent`.
- ~~**① 도구기반 Verifier**~~ — `toolVerifier.ts`(모델 불필요, 툴체인 오라클).
- ~~**② 토폴로지 실행기**~~ — `topology.ts`(fanout/self-consistency/debate/cascade, 주입형).
- ~~**③ eval 코어 + 골든셋(53)**~~ — `eval.ts`/`golden-set.json`/`eval.mjs`(§8 채점·게이트, 세션없이 검증).
- ~~**Squad 탭 전환(하이브리드 모니터) + dev CDP 런타임 검증**~~ — `OrchestrateView` + `ipc/orchestrate.ts`
  dry-run. 라이브 앱에서 모니터 애니메이션·cascade 승급·fanout 확인(SQUAD §12). 검증 드라이버:
  `scripts/cdp.mjs`·`cdp-shot.mjs`(재사용 가능).
- ~~**TOKEN 레버 1·4 렌더러 배선 + dev CDP 런타임 검증**~~ — 레버1 캐시 % `cacheHitPercent()` 일원화
  +write 노출, 레버4 cost-saver→per-prompt `route()` 라우터(haiku/sonnet/opus[1m] 난이도별 실증).
  검증 드라이버: `scripts/verify-token.js`(재사용 가능, PASS:true). 시뮬레이션 아님 — **실제 라우팅 결정**을
  DOM 상호작용으로 확인(모델 호출만 미발생).

> 위는 **검증된 메커니즘을 코드로 채택**하고 **헤드리스/정적/런타임(CDP) 게이트로 실증**한 부분.

### ✅ 완료 (2026-06-14, 라이브 세션 — dev+CDP로 **실제 구독 모델 호출** 검증)
- ~~**P0 SQUAD 실제 SDK 어댑터**~~ — `ipc/orchestrate.ts orchestrate:run`(실 `runSubtaskQuery` + haiku judge),
  preload/SquadView `RUN (live)` 활성. 2-subtask DAG 라이브 PASS·$0.0747(`scripts/live-orch.js`). [§4]
- ~~**TOKEN 레버 1·4 라이브 실측**~~ — 캐시 22.2k write→read·50% hit·per-run $0.0452→$0.0025(`live-smoke`·
  `live-warm`); cost-saver ON trivial→실제 haiku 라우팅. [§5]
- ~~**eval 라이브 run-loop 구현·실행(다중 서브셋)**~~ — `scripts/eval.mjs EVAL_LIVE=1`(orchestrated vs baseline +
  haiku 채점 + `gateVerdict`). **3과제(easy) → §8 PASS**(orch 1.0/$0.235 vs base 0.667/$0.288, 4지표 WIN) ·
  **6과제(moderate) → §8 FAIL**(orch 1.0/$0.675 vs base 0.944/$0.302 — 품질↑이나 컴퓨트 2.2×). **정직: §8은
  과제믹스 의존 — orchestration이 일반적으로는 게이트 통과 못함.** 풀 53셋 미수집. [§4 §8]
- ~~**PERFORMANCE Phase 0 일부**~~ — 50k paste→paint 46ms·스트리밍 plain-pre→`<Md>` 1회전환(`perf-paste`·
  `perf-stream`). prod frame-time 트레이싱만 잔여. [§3]
> 검증 드라이버(재사용): `scripts/cdp.mjs` + `live-orch.js`/`live-smoke.js`/`live-warm.js`/`perf-*.js`,
> `EVAL_LIVE=1 node scripts/eval.mjs`. dev 기동: `electron-vite dev --remoteDebuggingPort 9222`.

### P1 — 남은 측정 (수치 채우기) ⚠️ 세션 필요·비용
3. **eval 풀셋 점수** — 루프는 완성·실행됨. 남은 건 53과제 전부(또는 큰 서브셋)를 돌려 통계적으로 유의한
   SQUAD §8 / TOKEN §5 수치 산출(라이브 비용 큼 → 배치/예산 관리 권장).
4. **측정 베이스라인 잔여** — PERFORMANCE prod **frame-time 트레이싱**(Tracing 도메인) + TOKEN cost/cache-hit/
   도구토큰 대시보드 UI + **구독 rate-limit 반증**(§5).

### P2 — 선택·조건부 (유지보수)
5. MAINTAINABILITY: MainShell 슬림화(래칫이 `App.tsx` 471줄 가시화) · CSS 파셜 · Phase 5 Context.
6. PERFORMANCE: 레버 5 전체(textarea 격리) · 레버 6 가상화 — 둘 다 실측 렉 확인 후 조건부.
7. SQUAD Phase 2~4 — §8 게이트(P1-3) 통과 시에만 self-consistency/cascade/fan-out/debate/대형 DAG.

> **정직한 경계(갱신)**: 라이브 세션에서 (a) 코어 ↔ SDK 모델 호출 어댑터(SQUAD `orchestrate:run`)와
> (b) 핵심 *수치* 실측(캐시 18×↓·라우팅·paste 46ms·eval 게이트 작동)을 **실제 구독 모델 호출로 검증**했다.
> 남은 것은 **규모 채우기**뿐 — eval 풀 53셋 통계·prod frame-time 트레이싱·구독 rate-limit 반증(전부
> 라이브 비용/시간 의존이라 배치 실행 권장). 메커니즘 정합성은 `npm run selftest`(59/59)로 상시 재확인 가능.
