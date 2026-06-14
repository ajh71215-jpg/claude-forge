# 애플리케이션 성능 최적화 — 설계 (v1)

> 대량 컨텍스트가 **스트리밍으로 들어올 때**, 또는 큰 텍스트를 **붙여넣을 때** 렌더러가 렉 걸리는 문제를
> 제거하고 모든 상호작용을 60fps에 가깝게 부드럽게 만드는 플랜. 본격 수정은 로컬에서 직접 진행.
>
> **원칙**: 추측 말고 **측정**(§5). 모든 레버는 적용 전/후 프레임타임·렌더 횟수로 검증한다.
> 마이크로 최적화(예: 인라인 함수 제거)는 프로파일이 가리킬 때만. 구조적 병목부터.

---

## 0. 병목 진단 원장 (코드 근거 — 추정 아님)

| # | 증상 | 근원 (코드) | 복잡도 | 등급 |
|---|---|---|---|---|
| B1 | **스트리밍 시 토큰마다 전체 마크다운 재파싱** | `BlockView`가 매 delta에 *커지는 전체 문자열*을 `Md`(react-markdown)로 렌더 (`App.tsx:2315`), delta는 문자열 누적 (`App.tsx:2473-2478`) | **O(n²)** | ❌ 치명 |
| B2 | **메모이제이션 전무** | 렌더러 전체에 `React.memo`/`useMemo`/`useCallback` **0건** (grep) | — | ❌ 치명 |
| B3 | **이벤트마다 전체 트랜스크립트 재렌더** | `setTurns(prev => prev.map(...))`가 매 delta에 새 배열 (`App.tsx:3367`) → 모든 `TurnView`/`BlockView` 재렌더 (`App.tsx:3758`, memo 없음) | O(turns×delta) | ❌ |
| B4 | **delta마다 강제 리플로우(autoscroll)** | `useEffect(... el.scrollTop = el.scrollHeight, [turns])` — `scrollHeight` 읽기 = 레이아웃 강제, 토큰마다 발생 (`App.tsx:3373-3376`) | 레이아웃 thrash | ❌ |
| B5 | **delta마다 setState(배치 안 됨)** | IPC 이벤트 핸들러가 토큰 단위로 `setTurns` (`App.tsx:3366-3367`) — rAF 코얼레싱 없음 | 렌더 폭주 | ❌ |
| B6 | **큰 텍스트 붙여넣기 = controlled textarea 전체 재렌더** | `value={prompt}` + `onChange→setPrompt` (`App.tsx:3832-3837`)가 ~600줄 `Composer` 전체를 재렌더 | O(component) | ◐ |
| B7 | **슬래시 매칭이 매 렌더 재계산** | `matches` filter가 useMemo 없이 매 렌더 실행 (`App.tsx:3632-3642`) — 타이핑마다 | 소~중 | ◐ |
| B8 | **memo를 깨는 인라인 클로저** | `onRetry`/`onEdit`가 매 렌더 새 함수 (`App.tsx:3762-3766`) → B2 고치면 이게 memo 무력화 | — | ◐ (B2 동반) |
| B9 | **가상화 없음** | `react-window`/virtuoso 등 **0** (grep). 긴 대화·복원 히스토리(`HistoryView`, `App.tsx:2219`)가 전 노드 렌더 | O(전체) | ◐ (긴 세션 한정) |

> 이미 잘 된 것(유지): 툴 결과는 700자 절단(`App.tsx:2349,2253`), 이미지 붙여넣기는 첨부로 분기(`App.tsx:3839-3852`).

### 두 시나리오의 주범 분리
- **스트리밍 렉** = B1 + B3 + B4 + B5 (토큰 1개가 *전체 트랜스크립트 재렌더 + 전체 마크다운 재파싱 + 강제 리플로우*를 유발).
- **붙여넣기 렉** = B6 + B7 (controlled textarea의 거대 value가 큰 컴포넌트를 동기 재렌더 + 슬래시 매칭 재계산).

> 환경: React `latest`(18/19 — `useDeferredValue`/`startTransition`/자동배칭 가용), react-markdown `^10`.

---

## 1. ⚠️ 함정과 전제 비판 (먼저 읽을 것)

1. **측정 없는 최적화 금지.** "느낌상 빠르다"는 잠금 Windows + 불안정 HMR에서 특히 못 믿는다. 모든 레버는
   **prod 빌드 + CDP 프로파일**로 전/후 수치를 남긴다(§5). 추측으로 memo를 뿌리면 오히려 느려질 수 있다.
2. **가상화는 만병통치약 아님.** 가변 높이 마크다운 + autoscroll과 충돌이 크고 복잡하다. **마지막 수단**(§4
   Phase 4, 조건부). 그 전에 B1·B5만 잡아도 대부분 해소될 가능성이 높다.
3. **마이크로 최적화 함정.** 인라인 클로저(B8) 같은 건 *memo를 켠 뒤에야* 의미가 생긴다. 순서가 중요:
   B2(memo) 없이 useCallback만 추가하면 효과 0.
4. **스트리밍 마크다운의 본질.** B1은 react-markdown 자체가 *증분 파싱을 안 하는* 구조적 한계다. 정답은
   "더 빠른 파서"가 아니라 **스트리밍 중엔 파싱하지 않기**(완료 시 1회) 또는 **프레임당 1회로 throttle**.
5. **행동 보존.** 최적화로 출력 내용·마크다운 결과·스크롤 UX가 바뀌면 안 된다. 특히 "완료 후 마크다운
   결과"는 동일해야 한다(스트리밍 중 plain → 완료 시 md 전환은 깜빡임 없게).

---

## 2. 최적화 레버 (임팩트 순)

### 레버 1 — 스트리밍 마크다운 O(n²) 제거  (B1) ★최대
- **스트리밍 중엔 plain text로**, 블록 *완료 시 1회만* 마크다운 파싱. `BlockView`의 `streaming` 플래그가
  이미 있음(`App.tsx:2310,2316`) → `streaming ? <pre className="response-text-stream">{text}</pre> : <Md>{text}</Md>`.
- 또는 파싱을 **rAF/16ms throttle**(스트리밍 중 최대 60회/초). 깜빡임 싫으면 이 방식.
- `Md`를 `React.memo`로 감싸 동일 문자열이면 재파싱 스킵(완료 블록 보호).
- 효과: 스트리밍 비용이 O(n²)→O(n). **단일 최대 레버.**

### 레버 2 — delta 코얼레싱(rAF 배칭)  (B5) ★구조적
- IPC 이벤트마다 setState 하지 말고, delta 텍스트를 **버퍼에 누적**하고 `requestAnimationFrame`에서
  **프레임당 1회 flush**(`App.tsx:3366-3367` 핸들러 재구성). 토큰 수백 개 → 프레임 수십 개로.
- runId별 버퍼 Map. flush 시 한 번의 `setTurns`로 합친 텍스트 반영. (이동/추출은 §maintainability의 `useAgentEvents` hook과 합치면 깔끔)

### 레버 3 — 트랜스크립트 메모이제이션  (B2·B3·B8)
- `TurnView`·`BlockView`를 `React.memo`로. 완료된 turn은 props 안정 → 재렌더 스킵.
- 핸들러를 `useCallback`으로 안정화하되, **turn별 클로저는 turn.id를 인자로** 받는 형태로 바꿔
  (`onRetry(t.id)`) memo가 깨지지 않게(`App.tsx:3762-3766`). 콜백은 안정 참조로 위에서 1개만.
- 효과: N개 완료 turn이 매 토큰 재렌더 → 활성 turn 1개만 재렌더.

### 레버 4 — autoscroll 리플로우 제거  (B4)
- `[turns]` 의존 제거. **"바닥 근처일 때만" 스크롤**: 쓰기 전에 `scrollHeight - scrollTop - clientHeight < 임계`
  확인(사용자가 위로 스크롤하면 안 따라가게) + rAF로 throttle. IntersectionObserver 센티넬도 가능.
- 효과: 토큰마다 강제 레이아웃 → 프레임당 1회 이하.

### 레버 5 — Composer 입력 격리  (B6·B7)
- 거대 `Composer`에서 **textarea + prompt 상태를 작은 리프 컴포넌트로 분리** → 타이핑/붙여넣기가 트랜스크립트·
  사이드바를 재렌더하지 않게.
- `matches`(슬래시)는 `useMemo`로, 그리고 **`prompt[0] === '/'`일 때만 계산**(`App.tsx:3632-3642`).
- 파생 UI(문자수·슬래시 메뉴)는 `useDeferredValue(prompt)`로 미뤄 입력 지연 체감 제거. textarea 자체는
  controlled 유지(즉시 반응), 무거운 파생만 deferred.
- 매우 큰 붙여넣기 한정 대비책: 입력을 `startTransition`로 감싸 비긴급 처리.

### 레버 6 — 가상화 (조건부, 최후)  (B9)
- 위 레버 적용 후에도 **수백 turn**에서 느리면 turn 리스트 가상화(react-window/virtuoso). 가변 높이 +
  autoscroll 호환 비용 큼 → 신중히. 더 싼 대안: 오래된 turn 접기/렌더 상한 + "이전 더 보기".
- `HistoryView`(복원 히스토리, `App.tsx:2219`)는 한 번에 다 그림 → 길면 동일 처리.

---

## 3. 핵심 변경점 (파일)

- **`App.tsx`(또는 §maintainability 분해 후 `components/chat/*`)**
  - `BlockView`: 스트리밍=plain / 완료=Md 분기(레버1) + `React.memo`.
  - `Md.tsx`: `React.memo` 래핑(동일 문자열 재파싱 차단).
  - 이벤트 핸들러: rAF 코얼레싱 버퍼(레버2).
  - `TurnView`: `React.memo` + 콜백 안정화(레버3).
  - autoscroll effect: near-bottom 가드 + rAF(레버4).
  - `Composer`: 입력 리프 분리 + `matches` useMemo/조건부 + `useDeferredValue`(레버5).
- **(조건부) 새 의존성**: 가상화 시 `react-window`(레버6) — Phase 4 게이트 통과 시에만.

> 레버 1·2·4는 신규 의존성 없이 가능 — **가성비 최고, 먼저**.

---

## 4. 단계별 플랜 (임팩트·저리스크 순)

- **Phase 0 — 측정 베이스라인.** CDP로 현재 수치 채집(§5): 스트리밍 중 프레임타임·turn당 렌더 횟수,
  대형 붙여넣기 input-to-paint 지연. 골든 입력 고정(대형 마크다운 응답 1개, 5만자 붙여넣기 1개).
- **Phase 1 — 스트리밍 (레버 1+2+4).** B1·B5·B4 제거. **스트리밍 렉의 90%가 여기서 해소될 것**(가설→§5로 검증).
- **Phase 2 — 메모이제이션 (레버 3).** memo+useCallback로 트랜스크립트 재렌더 격리.
- **Phase 3 — 붙여넣기/입력 (레버 5).** Composer 입력 격리 + deferred 파생. B6·B7 제거.
- **Phase 4 (조건부) — 가상화 (레버 6).** Phase 1~3 후에도 긴 세션이 느릴 때만.

> Phase 1만으로 체감 대부분 해결 가능성이 높다(§1.2). 가상화부터 손대는 과한 길로 가지 말 것.

---

## 5. 측정·검증 (반증 가능)

- **도구**: prod 빌드 후 `electron.exe . --remote-debugging-port=9222`, CDP로 ① `Performance.metrics`
  (LayoutDuration/RecalcStyleDuration/ScriptDuration) ② React DevTools Profiler(렌더 횟수/커밋 시간)
  ③ 간이 렌더 카운터 주입. 드라이버는 기존 `cdp-*.mjs` 재사용.
- **지표(전/후 비교)**:
  - 스트리밍: 평균 프레임타임 < 16.7ms(60fps) 목표, turn당 커밋 횟수, LayoutDuration 합.
  - 붙여넣기: 5만자 paste의 input→paint 지연 < 100ms 목표.
- **반증 조건**: 어떤 레버가 위 지표를 *유의미하게* 못 줄이면 롤백(괜한 복잡도 금지). 특히 가상화가
  autoscroll/높이측정 회귀를 부르면 Phase 4 보류.
- **행동 보존 검증**: 완료된 응답의 마크다운 렌더 결과·스크롤 UX·슬래시 메뉴 동작이 전과 동일한지 CDP로 확인.

---

## 6. Kill criteria / 가드레일

- **측정이 가리키지 않은 최적화 금지.** memo 남발·조기 가상화로 코드만 복잡해지고 더 느려지면 revert.
- **스트리밍 plain↔md 전환 깜빡임 0.** 전환 시 레이아웃 점프/깜빡이면 throttle 방식(레버1 대안)으로 후퇴.
- **입력 즉시성 유지.** textarea는 controlled로 즉답, deferred는 *파생 UI만*. 입력 자체가 늦으면 잘못된 것.
- **로직 변경 금지.** delta 코얼레싱이 메시지 순서/내용을 바꾸면 안 됨(버퍼 flush 순서 보존).
- **가상화는 최후.** §4 Phase 1~3로 목표 미달일 때만.

---

## 7. 참고 (코드 근거)

- O(n²) 스트리밍 마크다운: `BlockView` `App.tsx:2310-2318`, delta 누적 `App.tsx:2473-2478`, `Md.tsx`.
- 메모이제이션 전무: 렌더러 grep `React.memo|useMemo|useCallback` = 0.
- 전체 재렌더/배칭 부재: 이벤트 핸들러 `App.tsx:3366-3367`, turn 리스트 `App.tsx:3758-3768`.
- autoscroll 리플로우: `App.tsx:3372-3376`.
- controlled textarea 붙여넣기: `App.tsx:3826-3853`; 슬래시 매칭 `App.tsx:3632-3642`; 인라인 콜백 `App.tsx:3762-3766`.
- 가상화 부재: grep `react-window|virtuoso|virtual` = 0.
- 검증 절차(CDP/prod 빌드, HMR 불신): `CLAUDE.md` (Verifying UI changes).

> 이 플랜은 `docs/MAINTAINABILITY.md`와 함께 본다 — 분해 후 `components/chat/*`·`useAgentEvents` hook에
> 레버들을 얹으면 자연스럽다. 단, **성능 레버는 분해와 독립적으로도 먼저 적용 가능**(분해를 기다릴 필요 없음).

---

## 8. 실행 결과 — 작업 완료 기록 (2026-06-14)

**결과: 스트리밍 핵심 레버(1·2·3·4) 적용 완료.** 정적 게이트 통과(typecheck ✅ · 프로덕션 빌드 ✅ ·
renderer lint 0). 당시 `App.tsx` 단일 파일에 적용했고, 이후 `docs/MAINTAINABILITY.md` 분해로 모든
레버가 `components/chat/*`(`BlockView`·`TurnView`)와 `useAgentEvents` 훅으로 자연 이동함(§152-153 예측대로).

### 적용한 레버
- **레버 1 (O(n²) 마크다운 제거) ✅.** 스트리밍 중엔 plain `<pre className="response-text-stream">`로
  렌더(O(n) append), 완료 시 `<Md>`로 1회만 파싱. `Md`는 `memo`로 래핑. → 지금은 `components/chat/
  BlockView.tsx`.
- **레버 2 (rAF 코얼레싱) ✅.** block 이벤트를 버퍼에 모아 애니메이션 프레임당 1회 flush(`result`
  이벤트는 flush 먼저 → turn 완료 표시). 버퍼 flush 순서 보존(§6 준수). → 지금은 `useAgentEvents.ts`.
- **레버 3 (메모이제이션) ✅.** `BlockView`·`TurnView` `memo` + 안정 콜백(retry는 `sendRef` 경유로
  최신 send 호출하되 identity 유지 → memo 안 깨짐). 순효과: 스트리밍 flush가 활성 turn의 활성 블록만
  재렌더(plain text).
- **레버 4 (autoscroll 리플로우 제거) ✅.** near-bottom(120px) 가드 + rAF로 프레임당 scrollTop 1회.
  사용자가 위로 스크롤해 읽는 중이면 끌어내리지 않음. → 지금은 `components/chat/Composer.tsx`.
- **레버 5 영역 부분집합 ✅.** 슬래시 매칭을 `useMemo`로(스트리밍 flush마다 재계산 안 함).

### 의도적으로 보류 (Kill criteria/§1 정신)
- **레버 5 전체(textarea 리프 격리) 보류.** Phase 2 memo가 이미 트랜스크립트를 입력 재렌더로부터 격리해
  한계효용 작음. (분해로 Composer는 별 모듈이 됐지만 textarea는 여전히 controlled in-Composer.)
- **`useDeferredValue` 회피.** 슬래시 메뉴 키보드 네비게이션 동작 보존 위해 의도적 제외.
- **레버 6(가상화) 미착수.** 조건부·최후 수단 — Phase 1~3로 체감 대부분 해소 가정, 긴 세션 실측 렉
  확인 전엔 손대지 않음.

### 미수행 — 측정 (정직한 한계)
- **Phase 0 CDP 베이스라인 + 전/후 수치(§5) 미채집.** 라이브 앱 + 구독 세션 필요 → 사용자 우선순위 낮춤.
  즉 레버들은 **코드 근거(§0 병목)와 정적 게이트**로만 검증됨; 프레임타임·input-to-paint의 정량 전/후
  비교는 아직 없음. 재개 시 첫 할 일: prod 빌드 + `--remote-debugging-port=9222`로 골든 입력 실측.
</content>
