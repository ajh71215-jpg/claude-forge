# Forge ↔ Claude Code CLI 토큰 사용량 차이 — 검증 & 측정 플랜

> 같은 작업을 **Claude Forge**와 **로컬 `claude` CLI**로 돌렸을 때 토큰(=비용)이 갈릴 수
> 있는 지점을 코드로 검증하고, 실제로 측정·귀속하는 실험 플랜.

---

## 0. 대전제 — 엔진은 같다, 차이는 "설정 델타"에서 온다

Forge는 SDK가 번들한 **같은 `claude.exe` 엔진**을 `query()`로 구동한다(CLAUDE.md 참조).
따라서 per-turn 토큰 기계(컨텍스트 조립·캐싱·도구 루프)는 CLI와 **동일**하다. 토큰 차이는
거의 전부 **Forge가 SDK에 넘기는 옵션이 CLI 기본과 다른 데서** 발생한다. 아래는 그 델타 목록
(영향 큰 순).

---

## 1. 검증된 차이 지점 (코드 근거, 영향 순)

### ⭐ #1 — 시스템 프롬프트 preset 누락 (가장 큼)
- `personaToSystemPrompt`는 **persona가 꺼져 있거나 비어 있으면 `undefined`를 반환**
  (`src/main/persona.ts:64`). 그러면 `runStreaming`은 `options.systemPrompt`를 **설정하지 않는다**
  (`src/main/agent.ts:565-566`).
- Claude Agent SDK는 `systemPrompt`를 생략하면 **claude_code 프리셋을 쓰지 않는다**(빈/최소
  시스템 프롬프트). Claude Code와 같은 동작을 받으려면
  `systemPrompt:{type:'preset',preset:'claude_code'}`를 **명시**해야 한다.
  - 정황 근거: `scripts/smoke.mjs`가 일부러 `preset:'claude_code'`를 명시. `persona.ts`의 주석도
    "undefined → keep SDK defaults"라고 적어 SDK 기본이 claude_code가 아님을 전제.
- **결과**: persona OFF(기본)인 Forge 런은 CLI보다 시스템 프롬프트 입력 토큰이 **훨씬 적을 수
  있음**(동시에 도구 사용 가이드 등 능력도 빠짐). persona를 append로 켜면 그제서야 claude_code
  preset + 사용자 텍스트가 들어가 토큰이 늘고 동작이 CLI에 가까워짐.
- ⚠️ 이 항목은 SDK 버전에 따라 기본값이 바뀔 수 있으니 §2.A로 **반드시 실측**한다.

### #2 — 주입되는 MCP·Skills·Plugins 세트가 다름
- Forge는 **Forge 전용 설정**에서 도구/서버를 주입한다: MCP(`forge-mcp.json` → `toSdkMcpServers`),
  Skills 토글(`forge-skills.json` → `resolveSkillsOption`), Plugins(`forge-plugins.json`)
  (`agent.ts:551-561`).
- 일반 CLI 세션은 `.mcp.json`/`~/.claude` 등 **다른 출처**에서 로드한다. 두 세트가 다르면
  **도구 스키마·스킬 메타데이터가 매 턴 컨텍스트에 실려** 입력 토큰이 달라진다(캐시는 되지만
  cache-read로 계속 카운트). MCP 서버 스키마는 특히 무겁다.

### #3 — `settingSources`에 `local`이 빠짐
- Forge: `SETTING_SOURCES = ['user','project']` (`agent.ts:219`, `:541`). CLI 기본은 보통
  `local`(`.claude/settings.local.json`)까지 읽는다.
- `local`에 든 hooks·permissions·추가 메모리가 있으면 그만큼 컨텍스트(=토큰)가 달라진다.
  또한 CLAUDE.md(user+project 메모리)는 양쪽 다 로드되지만, 큰 CLAUDE.md(이 repo ≈10KB)는
  매 요청 토큰을 점유(캐시됨)한다.

### #4 — effort 기본값 / cost-saver
- Forge UI 기본 effort = `AUTO`, cost-saver ON 시 **Sonnet + LOW 강제**(`App.tsx:325-327`).
  effort(추론 예산)는 **thinking/출력 토큰**을 직접 좌우한다. CLI의 기본 effort와 다르면
  출력 토큰이 갈린다. `XHIGH/MAX`엔 "high token use" 경고도 있음(`App.tsx:402-403`).

### #5 — 캐시 프리픽스 안정성
- 프롬프트 캐싱은 **캐시 가능한 prefix가 요청 간 안정적**일 때만 히트한다. persona append나
  동적 systemPrompt가 끼면 prefix가 흔들려 **cache miss → 풀 가격 입력 토큰**이 된다.
- Forge는 이미 `cache_read_input_tokens`를 계측해 "cache reuse %"로 노출(`agent.ts:685`,
  `App.tsx:306,572-581`) → 이 지표로 양쪽 캐시 효율을 직접 비교할 수 있다.

### #6 — compaction 정책
- Forge엔 수동 `/compact`(`compactSession`)가 있다. SDK 자동 compaction이 임계치에서 도는지,
  CLI 자동 compaction과 임계가 같은지에 따라 **긴 세션의 누적 토큰이 크게 갈린다**.

### #7 — 모델 기본값 & 기타
- 기본 모델이 다르면 토큰 수는 비슷해도 **비용(`total_cost_usd`)**이 다르다(`agent.ts:680`).
- `maxTurns`/`maxBudgetUsd` 캡은 런을 중단시켜 **누적 총량**에 영향(`agent.ts:546-547`).
- 첨부 이미지 토큰, resume 시 트랜스크립트 재전송도 변수.
- `includePartialMessages:true`(`agent.ts:538`)는 **스트리밍 granularity일 뿐 과금엔 영향 없음**(노이즈 제거용 메모).

---

## 2. 측정 플랜 (controlled experiment)

원리: **변수를 하나씩 통제**하고, Forge `result.usage`와 CLI usage를 같은 작업에서 비교.
AHE의 decision-observability처럼 **옵션을 한 번에 하나만 토글**하며 델타를 귀속한다.

### 계측 수단
- **Forge**: `result` 이벤트의 `input_tokens / output_tokens / cache_read / cache_creation`
  (`agent.ts:669-687`), usage 패널, `getUsage`. 필요시 `getTranscript`.
- **CLI**: `claude -p "<task>" --output-format json` → 결과 JSON에 `usage` + `total_cost_usd`
  포함. 세션 중 `/cost`·`/context`. 정밀 추적은 OpenTelemetry
  (`CLAUDE_CODE_ENABLE_TELEMETRY=1` + OTLP exporter)로 토큰 카운터 수집.

### 단계
- **A. 1턴 베이스라인 (시스템프롬프트+도구정의 토큰 격리)** — ⭐#1·#2·#3 확인
  - 동일 모델·동일 `cwd`·도구 호출 없는 사소 작업("say hi")로:
    - Forge(persona OFF) vs `claude -p "say hi" --output-format json` 의 **`input_tokens` +
      `cache_creation`** 비교.
    - Forge가 현저히 작으면 **#1(claude_code preset 누락) 확정**.
    - 그 다음 persona를 append(빈 텍스트 불가 → 한 글자)로 켜고 재측정 → 격차가 메워지는지.
  - MCP/skills/plugins를 모두 끈 상태 vs 켠 상태 델타 → **#2 정량화**.
  - `settingSources`에 `local` 추가 빌드 vs 미추가 → **#3 정량화**.
- **B. 다턴 작업 (cache·compaction 거동)** — #5·#6
  - 같은 5~10턴 시나리오를 양쪽에서 실행, **cache reuse %** 곡선과 누적 입력 토큰 비교.
  - 긴 세션으로 밀어 compaction 발화 시점·전후 토큰 점프 비교.
- **C. effort/모델 매트릭스** — #4·#7
  - effort {LOW, AUTO, HIGH} × 동일 작업으로 **출력/ thinking 토큰** 비교, CLI 동일 effort와 정렬.

### 통제 변수(고정)
같은 모델 ID·같은 `cwd`/`.claude`·persona 상태 명시·MCP 동일·네트워크 동일·동일 프롬프트
(가능하면 시드 고정 작업). 캐시 영향 분리를 위해 **콜드/웜 각각** 측정.

---

## 3. 패리티 조치 (측정 후, 원하면)

- **#1**: persona OFF여도 `systemPrompt:{type:'preset',preset:'claude_code'}`를 **항상 명시**
  → CLI와 동일 기준선. (능력↑, 토큰↑ — 의도된 트레이드오프이니 토글로 노출 가능.)
- **#3**: `settingSources`에 `local` 추가를 옵션화.
- **#2**: EXTEND에서 활성 MCP/skills를 **토큰 비용과 함께** 가시화(끄면 얼마 절약되는지).
- **#4/#7**: effort·모델 기본값을 "CLI 패리티 프리셋"으로 정렬하는 모드 제공.
- 회귀 방지: §2 실험을 `scripts/`에 **재현 스크립트**로 박아 빌드마다 토큰 패리티 측정.

---

## 4. 단계별 플랜

- **Phase 1 — 베이스라인 실측(§2.A)**: #1 확정/반증이 최우선. 1턴 비교로 preset 누락 여부 결론.
- **Phase 2 — 델타 귀속(§2.A 나머지 + B)**: MCP/skills/local/cache/compaction 각각 정량화.
- **Phase 3 — effort/모델 매트릭스(§2.C)** 및 결과 표 작성.
- **Phase 4 — 패리티 조치(§3)** 중 합의된 항목 구현 + 재현 스크립트 추가.

---

## 5. 참고

- Claude Agent SDK — Subagents/옵션(공식): https://code.claude.com/docs/en/agent-sdk/subagents
- Claude Code CLI — `--output-format json`, `/cost`, `/context`, OpenTelemetry 토큰 계측
  (공식 문서 `code.claude.com/docs`)
- AHE — decision-observability(변경마다 예측→결과 검증) 방법론: https://arxiv.org/abs/2604.25850
- 코드 근거: `src/main/agent.ts`(옵션 빌드 537-612, usage 669-687), `src/main/persona.ts:60-67`,
  `src/main/skills.ts`/`mcp.ts`/`plugins.ts`, `src/renderer/src/App.tsx`(usage 패널·cost-saver).

> 주의: §1.#1의 "SDK 기본 systemPrompt" 동작은 SDK 버전 의존이므로 **결론 내리기 전 §2.A로
> 실측**할 것. 본 문서는 코드상 *어디서* 차이가 날 수 있는지를 특정하고, 측정 절차를 규정한다.
