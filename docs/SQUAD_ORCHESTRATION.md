# Squad Orchestration — 설계 (v2)

> v1을 냉정하게 비판하고, 2026 최신 연구로 다시 설계한 버전. 목표는 "여러 모델 병렬"이
> 아니라 **효율(비용/지연) · 능력 · 결과 품질을 동시에 최대화하는 결정론적 오케스트레이션
> 런타임**이다. 핵심 전제: 멀티에이전트는 공짜 점심이 아니다 — eval로 단일 에이전트를
> 이기지 못하면 만들지 않는다(§G).

---

## A. v1 자기비판 (냉정하게)

v1(`이전 버전`)의 결함들:

1. **Free-form 위임에 과의존.** "메인 `query()`에 `agents`를 넘기고 리드가 알아서 위임"은
   2026 기준 안티패턴이다. 자유 위임은 무한 reflection 루프·환각 툴콜·토큰 폭주라는 신규
   실패모드를 만든다. 산업/연구 표준은 **하이브리드(결정론적 골격 + 그 안에서 모델이 전술
   결정)** 다. (Blueprint-First, arXiv 2508.02721)
2. **"리드가 종합·선택한다"는 가정이 약하다.** 2026 General AgentBench(arXiv 2602.18998)는
   **"병렬 스케일의 verification gap + 순차 스케일의 context ceiling"**으로 *naive 스케일은 실효가
   없다*고 직접 밝힌다(원문: "neither scaling methodology yields effective performance improvements").
   즉 리드가 워커 결과를 그냥 고르게 두면 안 되고 **외부/도구기반 검증자**가 선택해야 한다.
   (단, "self-choice가 pass@K에 뒤처진다"는 더 강한 표현은 2차 요약발이라 본문 검증 전엔 보류.)
3. **검증 스테이지가 프롬프트 의존.** "프로토콜을 오케스트레이터 시스템 프롬프트에 심는다"는
   취약하고 검증 불가. 검증은 **결정론적 코드 게이트**로 만들어야 한다.
4. **무작정 N 스케일.** 순차 스케일은 **context ceiling**에 막히고 병렬 스케일은 실익이 제한적
   (arXiv 2602.18998). 효율 기법(early-stopping, cascade, confidence-weighted vote)이 전무했다.
5. **Eval을 Phase 4로 미룸.** 측정 없이 "최고 결과"는 공허. AHE의 decision-observability를
   **foundational(Phase 0)**로 끌어와야 한다.
6. **비용 현실 안일.** 오케스트레이션은 ~15× 토큰(Anthropic). pre-run **비용 투영 + 하드 캡**이
   1급 아키텍처 제약이어야 하는데 "경고 배지"로 끝냈다.
7. **데이터 계약 부재.** UI·이벤트만 있고 오케스트레이션 상태(plan DAG·blackboard·verdict)라는
   1급 자료구조가 없었다.
8. **토폴로지 고정 프리셋.** task type별로 최적 토폴로지가 다른데 router가 없었다.

---

## B. 설계 원칙 (연구 매핑)

- **하이브리드 결정론.** Forge가 골격(상태머신)을 소유하고, 모델은 그 경계 안에서 전술만
  결정. 추적성은 코드에 있고 실행은 bounded. (Blueprint-First; 산업 hybrid orchestration)
- **검증자-가이드 TTS + 외부 검증.** self-choice가 약하므로(§A.2) 검증은 생성자와 분리.
  best-of-N은 **검증자가** 선택. 가능하면 **도구기반(테스트/타입체크)** = gap 없는 객관 검증.
  (Multi-Agent Verification 2502.20379; Marco DeepResearch 2603.28376; VerifiAgent 2504.00406;
  RLV 2505.04842)
- **효율은 brute force가 아니라 타겟 컴퓨트.** ceiling을 존중해 무작정 N을 늘리지 않고:
  - **Cascade**: 싼 모델 먼저, 자기검증 실패/저신뢰 시에만 상위로 승급 (AutoMix; routing survey 2603.04445; 2511.06190)
  - **Early-Stopping Self-Consistency(ESC)**: 윈도가 합의하면 즉시 중단 → 최대 80% 샘플 절감
  - **Confidence-weighted vote(CISC/ReASC)**: 균등투표 대신 신뢰가중 → 40~80% 절감
- **컨텍스트 격리/attenuation.** 워커는 작업에 필요한 최소 슬라이스만. 오케스트레이터 컨텍스트
  오염 방지. (DACS 2604.07911; Context Engineering 2603.09619)
- **결정-관찰가능성 eval.** 변경마다 예측을 달고 결과로 검증 (AHE 2604.25850).
- **강건성**: judge 편향 완화(순서 스왑·복수 judge·도구 그라운딩); reward-hacking 방지(생성자에게
  테스트 오라클 비노출 — StrongDM 사례); 단계간 체크포인트로 오류 복리 차단(WebAgents 2602.12276);
  bounded execution(최대 깊이/턴/예산)으로 runaway 차단.

---

## C. v2 아키텍처 — "Conductor" 런타임

```
                      ┌────────────── Blackboard (typed state) ──────────────┐
사용자 작업 ─▶ Planner ─▶ Plan(DAG) ─▶ [사용자 승인/편집] ─▶ Conductor ─┐    │
 (CHAT 토글)   (lead)    JSON(constrained)   (hybrid=force)   (결정론적)  │    │
                                                                          ▼    │
                                              Worker pool (격리·cascade) ──┐   │
                                                                          ▼   │
                                              Verifier(외부·모드선택·ESC) ─┤   │
                                                                          ▼   │
                                              Synthesizer(lead) ─▶ Final ─┘   │
                      Budget Governor(투영·하드캡)  +  Eval harness ──────────┘
                      Squad 탭 = Plan 편집기 + Blackboard 라이브 모니터
```

컴포넌트:
- **Planner(lead, Opus)** — 작업을 **구조화 plan**으로 출력(프로즈 아님, constrained JSON
  툴콜): subtask 목록·의존(DAG)·subtask별 토폴로지·모델 티어·도구 범위·**성공 루브릭**·예산.
- **하이브리드 제어 = 편집 가능한 plan** (진짜 "force" 메커니즘). auto면 승인 생략, 아니면
  Squad 탭에서 사람이 plan을 보고 수정/승인 후 실행.
- **Conductor(Forge main, 결정론적)** — plan DAG를 상태머신으로 실행. SDK 서브에이전트/`Workflow`
  툴로 워커 spawn(격리 컨텍스트), 병렬/재시도/예산/캐시 관리.
- **Worker pool** — cascade(Haiku→Sonnet→Opus, AutoMix식 자기검증 후 승급), 공유 cacheable prefix.
- **Verifier(외부)** — 모드 선택: 도구기반(테스트/타입체크) / 루브릭 pointwise / pairwise(순서스왑) /
  self-consistency(ESC) / debate. 생성자와 분리, 싼 모델 우선, 불일치 시 승급.
- **Synthesizer(lead)** — 검증 통과 결과 + verdict·근거로 최종 산출.
- **Blackboard** — typed 공유 상태(아래 §D). 단계 간 흐르는 단일 진실원, 오케스트레이터 컨텍스트
  깨끗하게 유지.
- **Budget Governor** — 실행 전 비용 투영(워커×토큰×모델), 하드 캡, 한계효용 소진 시 early-stop.
- **Eval harness** — 골든셋 + 단일에이전트 베이스라인 비교(§G).

**토폴로지 라우터(task type별):**
- 코딩/롱호라이즌 → **plan–execute–verify–revise**, 단일 드라이버 + **도구기반 verifier** + 체크포인트
- 사실/추론 수렴 → **self-consistency(ESC, CISC)** 또는 **debate**
- breadth-first 리서치 → **fan-out + 외부 verifier 선택**
- 모호/닫힌 답 → **cascade**(AutoMix 자기검증 후 승급)

---

## D. 데이터 계약 (v1에서 빠졌던 핵심)

```ts
type Plan = { goal: string; subtasks: Subtask[]; edges: [from,to][]; budgetUsd: number }
type Subtask = {
  id: string; instruction: string
  topology: 'single'|'fanout'|'self_consistency'|'debate'|'cascade'
  model: 'haiku'|'sonnet'|'opus'|'cascade'; tools: string[]
  rubric: string; n?: number; maxTurns?: number
}
type Verdict = { subtaskId: string; pass: boolean; score: number
                 confidence: number; rationale: string; evidence: string[] }
type Artifact = { subtaskId: string; output: string; costUsd: number; verdict?: Verdict }
```
Conductor는 이 자료구조 위의 상태머신이고, Squad 모니터는 Blackboard를 그대로 렌더한다.

---

## E. 구현 변경점 (v1 대비 수정)

- **`src/main/conductor.ts` 신규** — plan 실행 상태머신. 여러 `query()`/서브에이전트 호출을
  결정론적으로 조율(대형 DAG는 `Workflow` 툴). v1처럼 "그냥 `agents` 넘기고 끝"이 아니다.
- **`src/main/agent.ts`** — Planner용 constrained JSON 출력(plan 스키마 툴), verdict/blackboard
  이벤트, 워커 호출 시 격리 컨텍스트·cascade 훅, Budget Governor 연동.
- **`src/main/verifier.ts` 신규** — 검증 모드 구현(도구기반/루브릭/pairwise+스왑/ESC/debate),
  judge 편향 완화 내장.
- **`App.tsx`** — Squad 탭 = **Plan 편집기(승인/수정)** + Blackboard 라이브 모니터. CHAT 토글이
  Conductor 기동. v1의 "독립 RUN" 제거.
- **`scripts/eval.mjs` 신규** — 골든셋 + 베이스라인 비교(§G), decision-observability 로깅.

---

## F. 단계별 플랜 (재배치 — 인프라·측정 우선)

- **Phase 0 (foundational)**: Eval harness + Budget Governor + Blackboard 자료구조. **기능보다 측정/
  안전장치 먼저.**
- **Phase 1**: **단일 토폴로지 end-to-end — 코딩용 plan–execute–verify–revise.** 단일 드라이버 +
  **도구기반 verifier**(테스트/타입체크) + 체크포인트. 이걸 1순위로 고르는 이유: 도구기반 검증은
  generator–verifier gap이 없는 **객관 검증**이라 가장 신뢰도 높고 Forge(코딩 도구)에 직결.
  → 골든셋에서 단일 에이전트 대비 측정.
- **Phase 2**: self-consistency + **ESC/CISC**(닫힌/사실형) + **cascade 라우팅(AutoMix)**.
- **Phase 3**: fan-out 리서치 + **외부 verifier 선택**; debate.
- **Phase 4**: planner가 전문가 자동 생성(AOrchestra 2602.03786); 대형 DAG `Workflow`; 서브에이전트 resume.

---

## G. 냉정한 전제 (kill criteria)

- **Phase 1이 골든셋에서 단일 에이전트를 "수용 가능한 비용 배수 안에서" 이기지 못하면 중단한다.**
  context ceiling(2602.18998)과 "16개사 중 1곳만 Level 3"(Apostolou 2026) 현실상 멀티에이전트는
  공짜가 아니다. **eval이 게이트**다 — 이기는 증거가 없으면 이 복잡도를 출하하지 않는다.
- 비용은 보수적으로: 기본 워커 = Sonnet/Haiku, cascade·ESC 기본 ON, 실행 전 비용 투영 필수.
- 토글 OFF면 언제나 단일 채팅으로 복귀 가능해야 한다.

---

## H. 참고문헌

핵심 전환 근거(신규)
- Benchmark Test-Time Scaling of General LLM Agents — generator–verifier gap·context ceiling
  (arXiv 2602.18998): https://arxiv.org/abs/2602.18998
- Blueprint First, Model Second — 결정론적 LLM 워크플로 (arXiv 2508.02721): https://arxiv.org/pdf/2508.02721
- Dynamic Model Routing & Cascading 서베이 (arXiv 2603.04445): https://arxiv.org/abs/2603.04445
- Confidence-Guided Stepwise Model Routing (arXiv 2511.06190): https://arxiv.org/pdf/2511.06190
- RLV: reasoner+verifier 통합, 8–32× 효율 (arXiv 2505.04842): https://arxiv.org/html/2505.04842v2
- AutoMix(자기검증 후 승급), ESC(early-stopping self-consistency), CISC/ReASC(신뢰가중 투표) — 위 서베이/topics 참조

검증·오케스트레이션·효율(기존)
- Multi-Agent Verification (arXiv 2502.20379) · Marco DeepResearch (2603.28376) · VerifiAgent (2504.00406)
- Anthropic 멀티에이전트 리서치(+90.2%, ~15×): https://www.anthropic.com/engineering/built-multi-agent-research-system
- AOrchestra (2602.03786) · DACS (2604.07911) · Context Engineering (2603.09619) · AHE (2604.25850)
- Multiagent Debate (ICML 2024): https://github.com/composable-models/llm_multiagent_debate
- Claude Agent SDK Subagents/Workflow(공식): https://code.claude.com/docs/en/agent-sdk/subagents

> v1 대비 요지: "리드가 자유 위임·자기선택" → "결정론적 Conductor + 외부 검증 + 타겟 컴퓨트 +
> eval 게이트". 토큰 패리티 관점은 `docs/TOKEN_PARITY.md` 참조.
