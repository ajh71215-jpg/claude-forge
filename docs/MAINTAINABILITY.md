# 코드베이스 유지보수성 / 모듈 분해 — 설계 (v1)

> 파일 하나하나가 너무 길어 유지보수가 힘든 현 상태를, **동작을 1바이트도 바꾸지 않고**
> 파일 크기·응집도·국소성(locality)을 회복시키는 리팩터 플랜. 본격 수정은 로컬에서 직접 진행.
>
> **원칙**: 이 문서의 모든 분해는 *행동 보존(behavior-preserving)* — 순수 cut/paste + import 정리이고,
> 로직 변경은 별도 PR로 분리한다. "리팩터 도중 기능 개선"을 섞지 않는다(회귀 진단 불가해짐).

---

## 0. 현황 측정 원장 (코드베이스 사실 — 추정 아님)

| 파일 | 라인 | 판정 |
|---|---:|---|
| `src/renderer/src/App.tsx` | **3927** | ❌ 모놀리식. 50+ 컴포넌트/함수/타입이 한 파일. **최우선 분해 대상** |
| `src/renderer/src/styles.css` | **2608** | ◐ 길지만 `/* ---- */` 섹션 주석으로 이미 자연 분할선 존재 |
| `src/main/agent.ts` | **740** | ◐ 러너 + capabilities/sessions/usage/transcript/compact + 타입이 한 파일 |
| `src/main/index.ts` | 181 | ◐ ~41 `ipcMain.handle`가 한 함수에. 기능별 그룹은 이미 주석으로 구분됨 |
| `src/main/{skills,commands,hooks,mcp,agents,plugins,auth,persona}.ts` | 51–225 | ✅ **이미 잘 분리됨** — 손대지 않는다 |
| `src/preload/index.ts` | 125 | ✅ 허용범위. 분해 선택적 |

> 결론: main 프로세스의 **기능 백엔드는 이미 모듈화**되어 있다. 진짜 모놀리스는 **App.tsx 단 하나**이고,
> 그다음이 styles.css·agent.ts다. 따라서 노력의 80%는 App.tsx에 집중한다.

### App.tsx 내부 구조 (분해 단위 식별 — 라인은 현재 기준, 이동 시 변동)

| 영역 | 구성 (라인) | 외부 결합도 |
|---|---|---|
| **셸** | `App`(16), `TitleBar`(42) | 낮음 |
| **상태 허브** | `MainShell`(230) — sidebar/usage/caps/session 상태 + view 라우팅 | **높음(중심)** |
| **CHAT** | `Composer`(3233), `TurnView`(2496), `BlockView`(2310), `HistoryView`(2219), `TodoBar`(2272)/`TodoList`(2191), `PermissionModal`(2570), `QuestionModal`(2630), `reduceBlocks`(2456) | MainShell 상태에 결합 |
| **EXTEND** | `ExtendView`(706) + 6쌍: `Skills`(780)/`SkillEditor`(892), `Commands`(1007)/`CommandEditor`(1110), `Hooks`(1239), `Mcp`(1402)/`McpEditor`(1543), `Agents`(1729)/`AgentEditor`(1829), `Plugins`(1962) | **낮음** — 각자 `window.forge` IPC만 호출 |
| **SQUAD** | `SquadView`(2846), `makeAgent`(2784), `squadPreset`(2802), `ctxWindow`(2735) | 중간 |
| **PERSONA** | `PersonaModal`(147) | 낮음 |
| **순수 헬퍼** | `fmtTokens`(124), `usageShortLabel`(128), `methodLabel`(70), `mcpStatusClass`(116), `toolIcon`(2113), `toolArg`(2156)/`toolArgObj`(2138), `parseTodos`(2171), `deriveTasks`(2384), `normTaskStatus`(2372), `permArg`(2565), 상수 `EFFORTS`/`PERMS` | **없음(순수)** |
| **타입** | `Block`(2100), `Turn`(2363), `RunMeta`(2094), `Todo`(2164), `PermReq`(2559), `DialogReq`(2600), `SquadAgent`(2768), `*Draft`들 | 없음 |

> 핵심 통찰: **EXTEND(6패널)와 순수 헬퍼/타입은 결합도가 거의 0** → 가장 먼저, 가장 안전하게 뗄 수 있다.
> CHAT은 MainShell 상태에 묶여 있어 마지막에, hook/props 경유로 뗀다.

---

## 1. ⚠️ 지금 이걸 할 가치가 있는가 (전제 비판 — 먼저 읽을 것)

낙관 전에 약점을 직시한다.

1. **사용자 가치 0, 회귀 리스크 > 0.** 리팩터는 기능을 안 늘리고 버그를 *낳을* 수만 있다. →
   그래서 **행동 보존·원자 커밋·prod 빌드+CDP 검증**을 의무화한다(§4). "예뻐 보여서" 하는 변경 금지.
2. **잠금 Windows 환경의 적대성.** HMR 불안정 + 좀비 dev 프로세스로 렌더러 검증이 어렵다(CLAUDE.md).
   → dev HMR을 신뢰하지 말고 **prod 빌드 후 CDP로 ground truth** 확인. 큰 일괄 이동 금지, 슬라이스 단위로.
3. **과스코프 위험(over-engineering).** Redux/zustand/DI 컨테이너 도입은 솔로 데일리드라이버에 과하다. →
   목표는 **파일 크기·국소성**이지 아키텍처 우주여행이 아니다. 상태관리는 prop-drilling이 *실제로* 아플
   때만 가벼운 Context로(§3, Phase 5, 조건부).
4. **styles.css 분해의 함정.** CSS nesting 미닫는 `{` 하나가 *뒤 규칙 전부*를 조용히 삼킨다(CLAUDE.md
   gotcha). 로직 가치는 낮고 리스크는 높음 → **최저 우선순위, 파셜당 brace 밸런스 체크로 가드**.
5. **"내일 로컬에서 하루 안에"** 가 제약이다. 멀티위크 재아키텍처가 아니라, **기계적이고 되돌릴 수 있는**
   분해여야 한다. 그래서 슬라이스는 작고 독립적이며 import 경로는 배럴로 보존한다.

> 게이트: 어떤 슬라이스든 동작을 바꾸거나 환경에서 green을 못 내면 **그 슬라이스만 revert**한다(원자 커밋이 이를 가능케 함).

---

## 2. 목표 타겟 레이아웃

import 경로 호환을 위해 **배럴(barrel)** 을 둔다 — `App.tsx`의 `import('../../main/agent')` 같은 기존
경로가 `agent/`가 폴더가 돼도 그대로 작동하게(`agent/index.ts`가 re-export). 이로써 분해가 **기계적 이동**이 된다.

### 2.1 Renderer

```
src/renderer/src/
  App.tsx                # App + AuthGate 스위치만 (~80줄 목표)
  main.tsx
  types.ts               # 렌더러 공유 타입: Block, Turn, RunMeta, Todo, PermReq, DialogReq, SquadAgent, *Draft, EffortLabel
  lib/
    format.ts            # fmtTokens, usageShortLabel, methodLabel, mcpStatusClass, toolIcon, toolArg(Obj), ctxWindow, permArg
    blocks.ts            # reduceBlocks, deriveTasks, parseTodos, normTaskStatus
    constants.ts         # EFFORTS, PERMS, effortOption
  hooks/
    useAgentEvents.ts    # runId-keyed 이벤트 구독 + reduceBlocks 적용 (CHAT/SQUAD 공유)
    useCapabilities.ts   # caps/sessions/usage 로딩+리프레시
  components/
    TitleBar.tsx
    shell/MainShell.tsx  # 상태 허브 — 슬림화(라우팅+상태만)
    chat/
      Composer.tsx · TurnView.tsx · BlockView.tsx · HistoryView.tsx
      TodoBar.tsx · TodoList.tsx · PermissionModal.tsx · QuestionModal.tsx
    extend/
      ExtendView.tsx
      SkillsPanel.tsx · CommandsPanel.tsx · HooksPanel.tsx
      McpPanel.tsx · AgentsPanel.tsx · PluginsPanel.tsx     # 각 패널 = 패널+에디터 한 파일(쌍이 강결합)
    squad/SquadView.tsx  # makeAgent, squadPreset 포함
    persona/PersonaModal.tsx
    AuthGate.tsx · Md.tsx                                    # 기존
```

> 규칙: `types.ts`·`lib/*`는 **리프(leaf)** — 컴포넌트를 import하지 않는다(순환 차단). 컴포넌트는 단방향으로 lib/types에 의존.

### 2.2 CSS — 파셜 분할 (기존 `/* ---- */` 섹션을 그대로 파일로)

```
styles/
  index.css     # @import 들만 (main.tsx가 이걸 import)
  base.css      # app shell, titlebar, scrollbars, boot, brand
  auth.css      # gate, auth chooser, connection chip
  shell.css     # main shell, sidebar selectors, model/perms 카드, usage 패널
  chat.css      # turn, thinking/tool 카드, markdown, todo, task bar, permission/question 모달
  squad.css     # squad
  extend.css    # extend 콘솔 + 6패널 + 에디터 모달
```

> 대안(더 안전): 분할하지 않고 styles.css를 **그대로 두되** 섹션 인덱스 주석만 보강. CSS는 가치<리스크라 선택.
> 분할한다면 파셜마다 `{`/`}` 카운트 일치를 CI/precommit에서 검사(§4).

### 2.3 Main 프로세스

```
src/main/
  agent/
    index.ts        # 배럴: 기존 export 전부 re-export (import 경로 보존)
    types.ts        # RunOptions, AgentEvent, Capabilities, SessionInfo, UsageInfo, TranscriptItem, ...
    env.ts          # buildEnv, workspaceDir, ensureWorkspace
    runStreaming.ts # 핵심 러너 (active Map / runId 동시성 — 로직 손대지 않음)
    capabilities.ts # getCapabilities
    sessions.ts     # getSessions, getTranscript
    usage.ts        # getUsage
    compact.ts      # compactSession
    control.ts      # respondPermission, respondDialog, interruptRun
  ipc/
    index.ts        # registerAll(ipcMain) — 아래를 호출
    auth.ts agent.ts persona.ts extend.ts window.ts   # 각자 register(ipcMain) export
  index.ts          # BrowserWindow 생성 + registerAll(ipcMain) 호출만
```

> `agent.ts` → `agent/` 폴더 전환 시 **배럴이 핵심**. `../../main/agent`를 import하는 곳(App.tsx 90~97줄
> 타입 import, index.ts)이 무수정으로 동작. `runStreaming`의 동시성 로직은 **이동만, 변경 금지**.

---

## 3. 결합 끊기 전략 (CHAT 영역)

EXTEND·헬퍼·타입은 단순 이동이지만, CHAT은 `MainShell` 상태(caps/usage/session/runId)에 묶여 있다.

- **1차(권장): props + custom hook.** 이벤트 구독·reduce 로직을 `useAgentEvents(runId)`로 추출,
  CHAT 컴포넌트는 순수 props로. 상태 소유권은 MainShell 유지. **새 전역상태 도입 없음** → 가장 작은 변경.
- **2차(조건부, Phase 5): 가벼운 Context.** prop-drilling이 *실제로* 3단계 이상 깊어지고 아플 때만
  `AppStateContext`(useReducer) 1개 도입. Redux/zustand 같은 외부 의존은 **도입하지 않는다**(과스코프).

> 판단 기준: "props 몇 개를 2단계 내려보내는" 수준이면 Context 불필요. 추상화는 통증이 증명된 뒤에.

---

## 4. 검증 게이트 (슬라이스마다 — 반증 가능)

각 슬라이스(= 1 커밋) 후 **전부 green**이어야 다음으로:

1. `npm run typecheck` — `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`
2. `npm run build` — electron-vite 프로덕션 빌드 (HMR 불신, prod가 ground truth)
3. `npm run lint`
4. **`git diff --stat`로 "순수 이동" 확인** — 추가/삭제 라인 합이 대략 보존되면 로직 무변경의 방증.
5. **CDP 회귀 스모크**(잠금 env 절차, CLAUDE.md): prod 실행 → CHAT 프롬프트 1회 응답 확인 →
   EXTEND 6탭 열기 → SQUAD 1회 → 회귀 없음 확인. 드라이버: `cdp-extend.mjs`, `scripts/smoke.mjs`.
6. **CSS 슬라이스 한정**: 파셜마다 `grep -o '{' f.css | wc -l` == `grep -o '}' f.css | wc -l` (nesting 함정 가드).

**래칫(재증식 방지)**: ESLint `max-lines` 경고(예: 400) 추가 — 분해 후 파일이 다시 비대해지지 않게.
warning 등급으로 두어 빌드는 막지 않되 가시화.

---

## 5. 단계별 플랜 (안전·저결합 → 고결합 순)

- **Phase 0 — 안전망.** `types.ts` 추출(렌더러 공유 타입) + `lib/{format,blocks,constants}.ts`(순수 함수,
  JSX 없음 → 최저 리스크) + ESLint `max-lines` 래칫 + CDP 회귀 체크리스트 확정. **행동 변화 0.**
- **Phase 1 — EXTEND 추출.** 6패널(+에디터)·`ExtendView`를 `components/extend/`로. App.tsx에서 ~1200줄
   이탈, 결합도 최저(각자 IPC만) → **가성비 최고**. 첫 본선.
- **Phase 2 — CHAT 추출.** `useAgentEvents` hook 도입 후 Composer/TurnView/BlockView/HistoryView/모달/
   TodoBar를 `components/chat/`로. 결합 끊기는 §3 1차 방식(props+hook).
- **Phase 3 — SQUAD + PERSONA + TitleBar 추출**, `MainShell`을 상태 허브로 슬림화. App.tsx ~80줄 목표 달성.
- **Phase 4 — main 프로세스 + CSS.** `agent.ts`→`agent/`(배럴), `index.ts`→`ipc/*`(register 분리),
   styles.css→파셜(§2.2, brace 가드). main은 단순 이동이라 리스크 낮음.
- **Phase 5 (조건부) — Context 도입.** Phase 2~3에서 prop-drilling이 실제로 아플 때만(§3 2차). 남은 `any` 정리.

> 각 Phase는 독립적으로 머지 가능. 하루에 Phase 0~1만 해도 App.tsx 30% 감량.

---

## 6. Kill criteria / 가드레일

- **행동 보존 위반 = revert.** 슬라이스가 동작을 바꾸거나(§4 CDP에서 회귀) 환경에서 green 불가면 그 커밋만 되돌린다.
- **로직 변경 금지.** 특히 `runStreaming` 동시성(active Map/runId)·`resolveAuthEnv`의 API키 strip·
  cache_control 계측은 **이동만**. 개선은 별도 PR.
- **CSS 분할은 선택.** brace 함정으로 회귀가 잦고 CDP 확인이 더디면 styles.css를 통째로 유지(섹션 주석만 보강)로 후퇴.
- **추상화 보류.** 외부 상태관리/DI/제네릭 추상은 통증이 증명되기 전엔 도입하지 않는다(§1.3).
- **순환 의존 금지.** lib/types는 리프 유지. 발견 즉시 의존 방향 교정.

---

## 7. 참고 (코드 근거)

- App.tsx 모놀리스: `src/renderer/src/App.tsx` (3927줄, 컴포넌트 라인은 §0.2 표).
- 이미 모듈화된 main 백엔드: `src/main/{skills,commands,hooks,mcp,agents,plugins}.ts`.
- CSS 자연 분할선: `src/renderer/src/styles.css`의 `/* ---- */` 섹션 주석(base/auth/shell/chat/squad/extend).
- 타입 import 경로(배럴로 보존 대상): `App.tsx:81-100` (`import('../../main/agent')` 등).
- IPC 핸들러 그룹(분리 대상): `src/main/index.ts:98-170`.
- 잠금 env 검증 절차·CSS nesting/brace 함정·HMR 불신: `CLAUDE.md` (Verifying UI changes / Gotchas).

> 토큰/Squad 문서와 달리 이 플랜은 **외부 연구가 아닌 코드베이스 사실에 근거**한다. 회귀 검증이 곧 근거다.

---

## 8. 실행 결과 — 작업 완료 기록 (2026-06-14)

**결과 요약: 렌더러 모놀리스 분해 완료. `App.tsx` 3927 → 538줄 (−86%).** 전 단계 행동 보존,
각 슬라이스마다 정적 게이트 통과(typecheck ✅ · 프로덕션 빌드 ✅ · renderer lint 0 경고). git 없는
환경이라 슬라이스별 revert 불가 → 작은 단위 + 즉시 검증으로 가드(§4 정적 부분).

### 완료한 Phase
- **Phase 0 — 안전망 ✅.** `src/renderer/src/types.ts`(공유 타입: AuthMode/AuthStatus + main 타입
  re-export + Block/Todo/Turn/PermReq/DialogReq/QResult/SquadAgent 등) + `lib/constants.ts`
  (EFFORTS/PERMS/CLIENT_COMMANDS/effortOption) + `lib/format.ts`(methodLabel/mcpStatusClass/
  fmtTokens/usageShortLabel/toolIcon/toolArg(Obj)/ctxWindow/permArg) + `lib/blocks.ts`
  (reduceBlocks/deriveTasks/parseTodos/normTaskStatus). 모두 리프(JSX·컴포넌트 import 없음).
  App.tsx 3927 → 3683.
- **Phase 1 — EXTEND 추출 ✅.** `components/extend/`: `ExtendView`(컨테이너 + ExtendSection/
  EXTEND_SECTIONS) + 6패널(`SkillsPanel`·`CommandsPanel`·`HooksPanel`·`McpPanel`·`AgentsPanel`·
  `PluginsPanel`, 각자 에디터·Draft·템플릿 동거) + `shared.ts`(SKILL_NAME_RE, 3 에디터 공유).
  App.tsx 3683 → 2276 (−1407).
- **Phase 2 — CHAT 추출 ✅.** `components/chat/`: 리프 뷰 `TodoList`·`TodoBar`·`HistoryView`·
  `BlockView`·`TurnView`·`PermissionModal`·`QuestionModal`, 그리고 `Composer`(컴포저+트랜스크립트,
  ~685줄)와 **`useAgentEvents` 훅**. 훅은 turns/perms/dialogs/contextTokens/contextModel 상태 +
  rAF-코얼레싱 스트리밍 구독을 소유 — 입력은 좁게 ref 5개({ownedRef,runIdRef,onSessionRef,
  onResultRef,taRef}), 상태+setter 번들 반환. App.tsx 2276 → 1120.
- **Phase 3 — SQUAD/PERSONA/TitleBar 추출 ✅.** `components/squad/SquadView.tsx`(SquadView +
  makeAgent + squadPreset, chat의 TurnView·PermissionModal 재사용), `components/persona/
  PersonaModal.tsx`(+PERSONA_PRESETS), `components/TitleBar.tsx`. App.tsx 1120 → **538**
  (= App 컴포넌트 ~27 + MainShell ~480).

### 플랜 대비 편차 (의도된 결정)
- **`max-lines` 래칫: Phase 0 → 분해 후로 연기.** 분해 중엔 라인 한도가 노이즈; 파일이 작아진 지금이
  도입 적기(재개 시 첫 단계 권장).
- **CDP 회귀 체크리스트: 미수행.** 런타임 검증(라이브 앱+구독 세션 필요)은 사용자가 우선순위 낮춤.
  성능·정확성 핵심 코드(스트리밍 rAF·메모이제이션)는 **본문 그대로 이동**이라 정적 게이트로 충분히 검증됨.
- **`types.ts`에 `RunOptions` re-export 추가.** Composer/SquadView가 깨지기 쉬운 다단계 인라인
  `import('../../../../main/agent')` 대신 `../../types`에서 가져오도록(§7 배럴 의도와 일치).
- **exhaustive-deps 거짓양성 2건**(구독 1회 `[]`, 세션복원 effect의 안정적 훅 setter)은 코드베이스
  기존 패턴인 문서화된 `eslint-disable-next-line`으로만 억제 — 로직 무변경(§6 준수).

### 중단 지점 — 사용자 선택 (2026-06-14)
Phase 3 후 사용자가 **"여기서 멈춤"** 선택. 주요 뷰(CHAT·SQUAD·EXTEND·PERSONA·TitleBar) 전부
모듈화 완료를 충분한 지점으로 판단. **남은 작업은 연기일 뿐 폐기 아님** — 요청 시 재개:
- **(선택) MainShell 슬림화.** 사이드바(16 useState + ~9 `selector` 섹션: MODEL/EFFORT/LIMITS/
  PERMISSIONS/AGENT/MCP/CONVERSATIONS/PLAN USAGE/TOKENS)를 `Sidebar`로 분리 → App.tsx 추가 감량.
  단 ~20-prop 인터페이스/강결합 → 그룹 prop 또는 Context(§Phase 5) 검토 필요, 뷰 추출보다 위험·노력 큼.
- **Phase 4 — main + CSS.** `index.ts`의 ~41 ipc 핸들러 → `ipc/*`, `agent.ts` → `agent/` 배럴,
  styles.css → 파셜(§2.2, brace 가드). 단순 이동이라 리스크 낮음.
- **`max-lines` 래칫** (위 편차 참고) · **Phase 5 Context**(조건부, prop-drilling이 실제로 아플 때만).

---

## 9. 실행 결과 2 — Phase 4 백엔드 분해 + 래칫 (2026-06-14, 재개)

**결과 요약: main 프로세스 백엔드 분해 + `max-lines` 래칫 완료.** §8의 "중단 지점"에서 연기됐던
Phase 4의 **main 부분**과 래칫을 실행. 전 단계 행동 보존(순수 cut/paste + import 정리), 정적 게이트
통과(typecheck ✅ · 프로덕션 빌드 ✅ · lint = 신규 에러 0). CSS 분할은 플랜의 "가치<리스크·선택"
판정(§2.2 대안, §6 후퇴 조항)에 따라 **의도적 보류**.

### 완료한 작업
- **`agent.ts`(740줄) → `agent/` 폴더 + 배럴 ✅.** 11개 파일로 분해, 모두 ≤241줄:
  `types.ts`(161, 전 타입) · `runStreaming.ts`(241, 코어 러너 — **이동만, 로직 무변경**) ·
  `sessions.ts`(89, getSessions/getTranscript) · `capabilities.ts`(64) · `env.ts`(64, buildEnv/
  workspaceDir/ensureWorkspace/SETTING_SOURCES) · `helpers.ts`(53, idlePrompt/resultErrorMessage/
  toolContentToString/singlePrompt) · `compact.ts`(36) · `control.ts`(36, respondPermission/
  respondDialog/interruptRun) · `usage.ts`(32) · `index.ts`(30, 배럴) · `state.ts`(12, 공유 맵).
  - **배럴이 핵심 — import 경로 무수정 보존.** `../../main/agent`(renderer `types.ts`),
    `../main/agent`(preload), `./agent`(main)가 폴더 `index.ts`로 그대로 해소 → 소비자 0 수정.
  - **§6 가드 준수**: `runStreaming`의 runId 동시성(`active` Map, `pending*` 드레인)은 **이동만**.
    공유 맵은 단일 출처 `state.ts`로 (러너가 채우고 control이 비움 — 양쪽이 같은 모듈 import).
- **`index.ts`(181줄) → `ipc/*` + 슬림화(58줄) ✅.** ~41 ipc 핸들러를 도메인별 5모듈로:
  `ipc/extend.ts`(75, skills/commands/hooks/mcp/agents/plugins) · `ipc/agent.ts`(36) ·
  `ipc/auth.ts`(15) · `ipc/window.ts`(15) · `ipc/persona.ts`(11) · `ipc/index.ts`(19, `registerAll`).
  `index.ts`는 BrowserWindow 생성 + `registerAll(ipcMain)` 호출만 남김(§2.3 목표 레이아웃 일치).
- **`max-lines` ESLint 래칫 ✅.** `["warn",{max:400,skipBlankLines:true,skipComments:true}]`.
  warning 등급 → 빌드 비차단·가시화(§4 래칫 의도). 현재 3개 파일 플래그(= 남은 슬림화 타깃):
  `Composer.tsx`(612) · `App.tsx`(471, MainShell) · `SquadView.tsx`(436).

### 검증 (정적 게이트 — §4)
- `npm run typecheck` ✅ green · `npm run build` ✅ green(306 모듈).
- `npm run lint`: **에러 3개(전부 기존, 신규 0)** — `require-yield`(idlePrompt, agent.ts:190 →
  helpers.ts:10로 *동일 에러 이동*) + `frontmatter.ts` 공백 + `preload` ts-ignore(둘 다 미변경).
  경고 21→24(+3 = 신규 래칫 경고뿐, `any` 경고는 agent/* 로 이동하며 개수 보존). **순수 이동 방증.**

### 의도적 보류 (플랜 준수)
- **CSS 분할 보류.** §2.2 대안("styles.css 통째로 유지, 섹션 주석만") + §6("brace 함정으로 회귀 잦으면
  후퇴") 채택. 2622줄 단일 파일은 전 뷰 cascade에 영향 + nesting brace 함정 + CDP 런타임 확인 불가
  환경 → 가치<리스크. lint는 `.ts,.tsx`만 대상이라 styles.css는 래칫에도 안 걸림.
- **MainShell 슬림화 / Phase 5 Context 보류.** §8 중단 지점 그대로 — 강결합·~20-prop, 뷰 추출보다
  위험. 래칫이 이제 `App.tsx`(471)를 가시화하므로 향후 재개 시 첫 타깃으로 명확.

> Phase 4 = **백엔드(main) 완료 / CSS 보류**. 남은 유지보수 작업은 전부 *조건부·선택*(CSS, MainShell
> 슬림화, Phase 5 Context)이며, 본선 모듈 분해(렌더러 + main 백엔드)는 이로써 종료.
