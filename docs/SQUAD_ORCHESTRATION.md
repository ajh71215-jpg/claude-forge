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
