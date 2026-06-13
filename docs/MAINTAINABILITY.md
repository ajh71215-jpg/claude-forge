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
</content>
</invoke>
