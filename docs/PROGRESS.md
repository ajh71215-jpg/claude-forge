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

---

## 0. 전체 요약

| # | 플랜 | 상태 | 진행률 | 다음 본선 단계 |
|---|---|---|---:|---|
| 1 | `ROADMAP.md` (EXTEND 확장) | ✅ 완료 | **100%** | 없음 (유지보수 모드) |
| 2 | `MAINTAINABILITY.md` (모듈 분해) | ✅ 본선 완료 | **~90%** | 잔여는 조건부·선택뿐 |
| 3 | `PERFORMANCE.md` (렌더 성능) | 🟡 진행중 | **~80%** | Phase 0 측정(미수행) |
| 4 | `SQUAD_ORCHESTRATION.md` (오케스트레이션) | 🟡 코어+UI, 런타임검증 | **~70%** | 실제 모델 호출 어댑터(1개) |
| 5 | `TOKEN_OPTIMIZATION.md` (비용/토큰) | 🟡 레버1·4 배선+검증 | **~55%** | 레버2/3/5/6 + 측정(세션) |

**검증 근거(갱신)**: `App.tsx`=538줄 · `agent.ts` → `agent/`(11파일) · `index.ts`=58줄 + `ipc/*`(6파일) ·
`settingSources` 설정됨 · 신설 순수 모듈 **`orchestration`/`routing`/`verifier`/`conductor`/`toolVerifier`/
`topology`/`eval`**(주입형) · `options.agents` 전달(가산) · **`eval/golden-set.json` 53과제** ·
`npm run selftest` **59/59 통과(8모듈)** · `node scripts/eval.mjs` 세션없이 검증 OK · 라이브 측정은 미수행.

> **공통 갭(정직 고지)**: 4·5번 플랜의 Phase 0과 3번 Phase 0은 모두 **측정/검증 인프라**(eval 하니스,
> 골든셋 ≥50, CDP 베이스라인, cost/cache 대시보드)다. 이 인프라가 **전혀 구축되지 않았다** —
> 프로젝트 전반의 단일 최대 미완 항목. 4·5번은 이게 없으면 시작조차 게이트에 막힌다.

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

## 3. 🟡 PERFORMANCE.md — 스트리밍 레버 완료, 측정 미수행 (~80%)

스트리밍 핵심 레버(1·2·3·4) 적용 확인 — `components/chat/BlockView.tsx`·`TurnView.tsx`·`useAgentEvents.ts`로 이동됨.

- [x] 레버 1 — O(n²) 스트리밍 마크다운 제거 (plain↔Md 분기 + `Md` memo)
- [x] 레버 2 — rAF 코얼레싱 (프레임당 1회 flush)
- [x] 레버 3 — 메모이제이션 (`BlockView`/`TurnView` memo + 안정 콜백)
- [x] 레버 4 — autoscroll 리플로우 제거 (near-bottom 가드 + rAF)
- [x] 레버 5 부분집합 — 슬래시 매칭 `useMemo`
- [ ] **Phase 0 — CDP 베이스라인 측정 (미수행, 재개 시 첫 할일)**
  - [ ] prod 빌드 + `--remote-debugging-port=9222`, 골든 입력(대형 md 응답 1 + 5만자 paste 1)
  - [ ] 전/후 프레임타임(<16.7ms 목표) · turn당 커밋 횟수 · LayoutDuration · paste input→paint(<100ms)
- [ ] (보류) 레버 5 전체 — textarea 리프 격리 (memo로 한계효용 작음)
- [ ] (조건부·최후) 레버 6 — 가상화 (긴 세션 실측 렉 확인 후에만)

> 정직한 한계: 레버들은 **코드 근거 + 정적 게이트**로만 검증됨. 정량 전/후 비교 없음.

---

## 4. 🟡 SQUAD_ORCHESTRATION.md — 코어+UI 구현, 런타임 검증 (~70%)

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
  - [ ] 실제 subtask 실행/검증 **모델 호출 어댑터**(시뮬레이션 러너 ↔ 실제 SDK 스왑) — 세션 필요
- [ ] **§8 Kill 게이트**: 채점·판정 메커니즘+골든셋 ✅ / 실제 *수치* 측정만 세션 필요 → 통과해야 Phase 2~4
- [ ] Phase 2~4 (조건부) — 대형 DAG/planner 자동전문가생성/resume (토폴로지 메커니즘은 구현·실증됨)

> ⚠️ §2 전제 비판 유효: 코딩 전이 미입증 + 구독 15× → **메커니즘은 채택했으나 게이트 통과 전 확장 금지.**

---

## 5. 🟡 TOKEN_OPTIMIZATION.md — 레버 1·4 렌더러 배선+런타임 검증 (~55%)

설계 문서(v3) → **공유 라우터(레버4) + 캐시 지표(레버1)를 렌더러에 배선하고 dev CDP로 실증**(TOKEN.md §9).
수치 절감은 미측정(§0/§2 원칙: 메커니즘만 채택, %는 라이브 실측).

- [x] **Phase 0** — 입력분해(fresh/read/write) 완비 ✅ (`runStreaming` `contextTokens = input+read+write`) ·
  **대시보드 UI/골든셋/rate-limit 기준 미수행**(세션 필요)
- [x] **레버 1 (caching) — 완료+검증** ✅: `cacheWriteTokens` 이벤트 → `useAgentEvents`→`onResult`→usage state
  까지 관통, 캐시 % 를 검증된 **`cacheHitPercent()` 헬퍼로 일원화**(인라인 중복 제거, write side 분모 명시),
  TOKENS 패널이 `read · written of … input tokens` 표기. CDP: `"0 read · 0 written of 0 input tokens"` 확인.
- [x] **레버 4 (routing) — 완료+검증** ✅: cost-saver를 flat Sonnet → **per-prompt 난이도 라우터**로 승급.
  `Composer.send()`가 `route()`+`resolveModelId(models)`로 모델/effort 결정(haiku엔 effort 생략 가드),
  헤더에 라우트 프리뷰 칩. CDP 실증: trivial→`haiku (trivial)` · 295자→`sonnet (moderate)` ·
  hard→`opus[1m] (hard)`(라이브 모델 id 해석) · OFF 복귀 시 프리뷰 소멸·`default` 복원. **PASS:true**.
- [~] **레버 3 (compaction)** — `auto-compact at 80%` 토글 존재(기존, Composer `ctxWindow` 80% 트리거) /
  플랜의 *가역 정책*(요약본↔원문 복원)은 미착수
- [ ] **레버 2 (동적 tool 스코핑)** · **레버 5 (retrieval-first)** · **레버 6 (output 절감)** — 미착수
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
> 아래는 **실제 모델 추론(구독/API)** 이 있어야만 *검증* 가능 → 사용자 로컬 환경 권장.

### P0 — 모델 호출 어댑터 배선 (코어를 라이브에 연결) ⚠️ 세션 필요
1. **SQUAD 실행 어댑터** — `ipc/orchestrate.ts`의 *시뮬레이션 러너*를 실제 SDK 호출로 스왑
   (`runStreaming` + `route()`/`resolveModelId()` 연결) → `RUN (live)` 버튼 활성화. UI·IPC·이벤트·엔진은
   **런타임 검증 완료**(SQUAD §12) → 어댑터 1개만 남음.
   - 참고: cost-saver는 이미 `route()`/`resolveModelId()`를 렌더러에서 호출 중(레버4 배선 완료) →
     SQUAD 어댑터도 동일 라우터를 재사용하면 됨(단일 소유자).
   - ~~**남은 렌더러 배선(작음)** — TOKEN cache hit % 상단 노출 · cost-saver→`route()` 승급~~ ✅ 완료·검증.

### P1 — 측정/검증 인프라 (게이트 — 여러 플랜 잠금 해제) ⚠️ 세션 필요
3. **eval *실행 루프*만** — 골든셋(53)·채점·`gateVerdict`·`eval.mjs` 골격은 **완성·실증**. 남은 건 각 과제를
   orchestrated + 동일토큰 baseline으로 *실제로 돌려 점수 채우기*(모델 호출) → SQUAD §8 / TOKEN §5 수치 산출.
4. **측정 베이스라인** — PERFORMANCE Phase 0(CDP 프레임타임/paste) + TOKEN cost/cache-hit/도구토큰 대시보드.

### P2 — 선택·조건부 (유지보수)
5. MAINTAINABILITY: MainShell 슬림화(래칫이 `App.tsx` 471줄 가시화) · CSS 파셜 · Phase 5 Context.
6. PERFORMANCE: 레버 5 전체(textarea 격리) · 레버 6 가상화 — 둘 다 실측 렉 확인 후 조건부.
7. SQUAD Phase 2~4 — §8 게이트(P1-3) 통과 시에만 self-consistency/cascade/fan-out/debate/대형 DAG.

> **정직한 경계**: 이번 회차는 "논문·오픈소스에서 검증된 *메커니즘*"을 **코드로 채택 + 헤드리스 실증**까지
> 끝냈다. 남은 것은 (a) 코어 ↔ SDK 모델 호출 어댑터, (b) *수치* 실측(eval·CDP·캐시) — 둘 다 라이브 세션
> 의존이라 이 환경에서 완결 불가. 메커니즘의 정합성은 `npm run selftest`로 언제든 재확인 가능.
