# Squad Orchestration — 상세 설계 & 구현 플랜

> 메인 채팅에서 서브에이전트를 **하이브리드(토글) 방식**으로 조율하고, Squad 탭은
> 세밀한 진행률 모니터로 전환하는 재설계. 2026년 하네스 엔지니어링 논문·활용사례와
> Claude Agent SDK 공식 동작에 근거한다.

---

## 0. 검증 결과 — 현재 Squad는 "오케스트레이션 없는 병렬 팬아웃"

코드로 확인된 사실(평결: 기능은 동작하나 멀티에이전트가 아니라 *동시 멀티런*):

- `runAll()` → 각 에이전트에 `runAgent()`를 도는 단순 루프 (`src/renderer/src/App.tsx:3007-3009`).
- 각 `runAgent()`는 **완전히 독립된** `window.forge.agent.start(runId, task, opts)` 호출
  (`App.tsx:2990`). N개의 별개 `query()` 세션이며 서로의 출력을 못 본다.
- 종합/투표/심판 단계 없음. `onResult`는 비용 합산만.
- 메인 러너 `runStreaming`은 SDK에 `options.agents`를 **전달하지 않는다**
  (`src/main/agent.ts:537-569` — skills/mcp/plugins만 와이어링). 따라서 현재는 메인
  채팅도 서브에이전트를 띄울 수 없다.
- Squad는 비대화형이라 질문 이벤트를 자동 거부 (`App.tsx:2879-2884`).
- 이벤트는 runId로 패널에 분배 (`App.tsx:2869-2871`).

→ 사용자가 느낀 "한 질문에 3개 모델이 따로 답할 뿐"이 정확. 트리 구조(orchestrator-worker)로 가야 한다.

---

## 1. 연구 근거 (2026 중심) — 무엇을, 왜

### 1.1 오케스트레이터-워커가 능력을 키운다 (단, 비싸다)
- **Anthropic, 멀티에이전트 리서치 시스템**: Opus 오케스트레이터 + Sonnet 워커 →
  단일 Opus 대비 **+90.2%**. 단 토큰 **~15배**. 토큰 사용량이 성능 분산의 **80%**를
  설명(나머지는 도구호출·모델선택). 고가치 breadth-first 작업에만 경제성이 성립.
  → *모델 티어링(Opus=리드, Sonnet/Haiku=워커) + 강한 예산 가드레일*이 필수.
- **AOrchestra (arXiv 2602.03786)**: 서브에이전트 **자동 생성** 오케스트레이션,
  GAIA/SWE-Bench/Terminal-Bench에서 최강 베이스라인 대비 **+16.28%**.
  → *AgentDefinition 자동 제안* 기능의 근거(후순위).

### 1.2 컨텍스트 격리 = 효율의 핵심
- **Dynamic Attentional Context Scoping / DACS (arXiv 2604.07911)**: N개 동시 에이전트가
  오케스트레이터의 컨텍스트 창을 두고 경쟁해 의사결정 품질이 저하("context pollution").
  에이전트별 격리 스티어링으로 **90.0–98.4%** vs 평면 컨텍스트 **21.0–60.0%**,
  컨텍스트 효율 최대 **3.53×**.
  → *워커의 중간 산출은 부모 컨텍스트에 누적시키지 말고 요약만 올려라.* (SDK 기본 동작과 일치)
- **Context Engineering: From Prompts to Corporate Multi-Agent (arXiv 2603.09619)**:
  "attenuation 원칙"(Tomasev 2026) — 서브에이전트엔 작업에 필요한 **권한의 좁은 조각만**
  넘긴다. StrongDM 사례: 테스트 시나리오를 에이전트 시야에서 제거했더니 reward-hacking 해소.
  → *워커별 `tools`/권한 최소화*는 안전이자 효율.

### 1.3 검증(Verification)은 추론-시점 스케일링의 핵심 레버
- **Multi-Agent Verification (arXiv 2502.20379)**: 다수 검증자로 test-time compute 스케일.
- **Marco DeepResearch (arXiv 2603.28376)**: 무작정 라운드/롤아웃만 늘리면 초기 도구 오류·노이즈가
  누적되어 신뢰도 하락 → **검증자-가이드(verifier-guided) test-time scaling**으로 명시적 검증 삽입.
- **VerifiAgent (arXiv 2504.00406)**: 통합 검증 에이전트.
- **Inference-Time Scaling of Verification (arXiv 2601.15808)**: 루브릭-가이드 자기진화 리서치.
- **Multiagent Debate (ICML 2024, composable-models/llm_multiagent_debate)**: 3 에이전트·2 라운드 →
  수학·사실성 향상, 환각 감소.
- **Agentic Test-Time Scaling for WebAgents (arXiv 2602.12276)**: 순차 작업은 단계별 오류가
  복리로 누적 → 한 번의 나쁜 결정이 복구 불가 궤적을 만든다(중간 검증의 필요).
- ⚠️ **LLM-as-judge 편향**: 단일 심판은 게이밍 가능(설득조 헛소리에 높은 점수),
  position bias(순서 바꾸면 판정 뒤집힘). 완화책: **순서 스왑 검사**, pointwise+pairwise 혼용,
  복수 심판, 가능하면 **도구/테스트 결과로 그라운딩**(순수 self-critique는 약함).

### 1.4 하네스는 측정 없이 개선 불가 (Forge 최대 공백)
- **AHE: Agentic Harness Engineering (arXiv 2604.25850)**: 관찰가능성 3축 —
  (1) component(편집 가능한 컴포넌트의 파일 단위 표현·되돌리기), (2) experience(수백만 토큰
  궤적을 드릴다운 가능한 증거로 증류), (3) **decision(모든 편집에 예측을 달고 다음 라운드
  결과로 검증)**. 10회 반복으로 Terminal-Bench 2 **69.7→77.0%**, 사람이 설계한 Codex-CLI(71.9%)
  초과; frozen harness가 SWE-bench-verified로 **12% 적은 토큰**에 전이.
  → Forge에 **eval 골든셋 + 회귀 측정**이 있어야 "오케스트레이션이 실제로 단일 에이전트를
  이겼는지"를 증명할 수 있다.
- 활용사례 현실 점검: Klarna·Cisco·Vizient 등 프로덕션 배포 사례 있으나, 16개사 실무자 조사
  (Apostolou 2026)에서 **"Level 3: 멀티에이전트 오케스트레이션"에 도달한 곳은 1곳뿐**.
  → 단계적·검증가능하게 가야 하며, 토글로 끌 수 있어야 한다.

---

## 2. 목표 아키텍처 — 하이브리드 토글 오케스트레이터-워커

```
CHAT 탭 (메인 대화)                          SQUAD 탭 (모니터)
┌─────────────────────────────┐            ┌────────────────────────────┐
│ [🜂 Orchestrate ▢/▣]  토글   │            │ Run: <runId>               │
│ 사용자 프롬프트 …            │            │  ├─ research-a  ▓▓▓░ running │
│                              │  parent_   │  │   model=sonnet $0.02    │
│ 메인=리드(Opus)              │  tool_use  │  ├─ research-b  ▓▓▓▓ done   │
│  └ Agent 툴로 워커 위임 ─────┼──_id 묶음─▶│  └─ judge       ░░░░ queued │
│  └ 최종 요약만 대화에 남김   │            │  (세밀 진행률·토큰·도구)   │
└─────────────────────────────┘            └────────────────────────────┘
        (auto 위임)  +  (force: "use X agent")     설정: AgentDefinition 편집
```

핵심 원리(연구 매핑):
- **하이브리드 = auto + force.** 기본은 리드가 `description` 보고 위임(네이티브). 사용자가
  특정 워커를 강제하려면 "Use the X agent to …"를 프롬프트에 주입(공식 문서상 호출 보장).
- **컨텍스트 격리**(DACS·SDK): 워커 중간 산출은 부모로 누적 안 됨, 최종 메시지만. 메인 대화 깨끗.
- **모델 티어링**(Anthropic): 리드=Opus, 워커=Sonnet/Haiku 기본.
- **권한 attenuation**(2603.09619): 워커별 `tools` 최소화가 기본.
- **검증 스테이지**(§4): 선택적 수렴 단계(투표/디베이트/심판).

---

## 3. 컴포넌트별 변경 설계

### 3.1 `src/main/agent.ts`
- `RunOptions` 확장:
  ```ts
  agents?: Record<string, AgentDefinition>   // 사용 가능한 워커 풀
  orchestrate?: boolean                       // 토글 ON → agents/Agent 툴 활성
  forceAgents?: string[]                      // hybrid: 강제 위임할 워커 이름
  verify?: VerifyConfig                       // §4
  ```
- `runStreaming`에서 `opts.orchestrate`일 때:
  - `options.agents = opts.agents`
  - `options.allowedTools`에 `Agent`(필요 시 `Workflow`) 포함 → 자동승인.
    (현재 bypass 모드면 canUseTool이 전부 allow하지만, ASK 모드 호환 위해 명시.)
  - `forceAgents`가 있으면 프롬프트 앞에 위임 지시문 주입.
- **서브에이전트 이벤트 표면화** (신규 `AgentEvent` 패밀리):
  - `Agent` 툴 `tool_use` 감지 → `{type:'subagent-start', subId, name, prompt, parentToolUseId}`
    (SDK 노트: 툴명이 버전에 따라 `Task`/`Agent` 둘 다 → 둘 다 매칭).
  - 중첩 메시지의 `parent_tool_use_id`를 모든 이벤트에 실어 보냄(`parentToolUseId?` 필드 추가).
  - `Agent` `tool_result` → `{type:'subagent-result', subId, agentId, summary, costUsd?}`
    (`agentId`는 resume용으로 파싱).
- 스트림 루프(`agent.ts:620~`)에서 `msg.parent_tool_use_id`를 읽어 태깅하도록 보강.

### 3.2 `src/preload/index.ts`
- 추가 IPC 불필요(이벤트는 기존 `agent:event` 채널로 흐름). 새 이벤트 타입만 통과시키면 됨.
- `agent.start` opts 타입에 위 신규 필드만 노출.

### 3.3 `src/renderer/src/App.tsx`
- **CHAT(Composer 근처)**: `🜂 Orchestrate` 토글 + (hybrid) 워커 칩 선택기(강제 위임용).
  토글 ON이면 `agent.start` opts에 `agents`(Squad 설정에서 빌드) + `orchestrate:true`
  (+ 선택된 `forceAgents`) 포함.
- **이벤트 라우팅**: 활성 run의 `subagent-*` 이벤트를 `parentToolUseId/agentId`로 묶어
  `subagents: Map<subId, SubAgentRun>` 상태 유지 → Squad 모니터에 공급. 메인 대화에는
  "🜂 delegated to research-a…" 같은 경량 카드만.
- **SquadView 리팩터** → 둘로 분리:
  - `SquadConfig`: **AgentDefinition 편집기**(name·**description**(자동 위임 핵심)·prompt·
    model·**tools**·effort·permission·maxTurns). 기존 `SquadAgent` UI를 대부분 재활용.
    저장은 기존 `forge-squads`(localStorage) 유지.
  - `SquadMonitor`: 진행률 트리(상태·토큰·비용·현재 도구·턴). 독립 RUN 버튼은 제거하거나
    "standalone test"로 격하.
- **비용 가드레일**: 워커 수 × per-agent max$ 합계 + "~15× 토큰" 경고 배지.

### 3.4 `src/renderer/src/styles.css`
- 모니터 트리/진행바/서브에이전트 카드 스타일. (편집 후 중괄호 균형 점검 — CLAUDE.md 풋건)

---

## 4. 검증(Verification) 스테이지 — 사용자가 강조한 부분

Squad 설정에서 선택하는 **선택적 수렴 단계**. 연구 매핑 포함:

| 모드 | 절차 | 근거 | 적합 |
|---|---|---|---|
| **A. Self-consistency 투표** | 동일 작업 N 워커 → 다수결/캘리브레이션 | TTS·self-consistency | 닫힌/사실형 답 |
| **B. Debate** | N 워커, 2 라운드 토론 후 합의 | ICML 2024 debate | 추론·사실성, 환각↓ |
| **C. Judge / critique-revise** | 워커 산출 → judge 비평 → 워커 수정 | VerifiAgent·Marco | 개방형 산출 |

구현: 가장 단순하게는 리드 오케스트레이터의 시스템 프롬프트에 수렴 프로토콜을 심고,
모드 C는 전용 `judge` AgentDefinition 템플릿을 추가. **judge 편향 완화 필수**:
1. pairwise 비교 시 **순서 스왑 검사**(뒤집히면 무효),
2. pointwise+pairwise 혼용,
3. 가능하면 **테스트 실행/컴파일 결과로 그라운딩**(순수 self-critique는 약함; Marco의
   "무작정 스케일은 오류 누적" 경고 반영 — 검증을 *명시적*으로),
4. 고비용/고위험 작업은 복수 judge.

---

## 5. 효율·능력 가드레일 (설계에 내장)

- **모델 티어링**: 리드=Opus, 워커 기본=Sonnet, 단순 워커=Haiku.
- **예산**: per-agent max$/run(기존 제약) 유지 + 합계 투영 + 워커 수 상한(현 6).
- **컨텍스트 위생**(DACS): 워커 요약만 부모로; 모니터는 별도 탭이라 메인 컨텍스트 오염 없음.
- **권한 attenuation**: 워커 `tools` 최소 집합 기본(read-only 분석 워커 등).
- **수렴≠병렬 충돌**(기존 Forge 제약): 같은 파일을 고치는 수렴 작업은 병렬 금지, breadth-first만 병렬.

---

## 6. 단계별 플랜

- **Phase 1 — PoC(파이프라인 검증)**: 토글 뒤에서 메인 run에 `agents` + `Agent` 툴 전달,
  `subagent-start/result` 이벤트 표면화, Squad에 최소 진행 트리. → 위임→격리→요약 전 구간 동작 확인.
- **Phase 2 — 하이브리드 UI**: force-dispatch 칩 + AgentDefinition 편집기(description/tools/model)
  로 SquadConfig 리팩터, 비용 투영·예산 캡.
- **Phase 3 — 검증 스테이지**: 투표 → 디베이트 → judge(편향 완화 포함) 순으로 추가.
- **Phase 4 — 스케일 & eval**: 대규모 팬아웃은 `Workflow` 툴(TS SDK v0.3.149+), 서브에이전트
  resume, 그리고 **eval 골든셋**(AHE의 decision-observability 식: 변경마다 예측을 달고 결과로 검증)
  으로 "오케스트레이션이 단일 에이전트를 이겼는지" 회귀 측정.

---

## 7. 리스크 & 결정사항

- **SDK 버전**: `Workflow` 툴 = TS SDK v0.3.149+; 중첩 서브에이전트 = Claude Code v2.1.172+;
  툴명 `Task`→`Agent` 전환(v2.1.63) → 양쪽 매칭.
- **Windows 긴 프롬프트**: 서브에이전트 프롬프트 8191자 제한 → 긴 건 `.claude/agents/` 파일로.
- **프로덕션 난이도**: 16개사 중 1곳만 Level 3 도달 → 토글 OFF로 항상 단일 채팅 복귀 가능해야.
- **judge 게이밍/편향**: §4 완화책 미적용 시 검증이 오히려 품질을 떨어뜨릴 수 있음.
- **비용 15×**: 기본을 보수적으로(워커=Sonnet/Haiku, 캡 ON).

---

## 8. 참고문헌 (2026 중심)

논문/1차 출처
- Claude Agent SDK — Subagents(공식): https://code.claude.com/docs/en/agent-sdk/subagents
- Anthropic, 멀티에이전트 리서치 시스템(orchestrator-worker, +90.2%, ~15×):
  https://www.anthropic.com/engineering/built-multi-agent-research-system
- AHE — Agentic Harness Engineering (arXiv 2604.25850): https://arxiv.org/abs/2604.25850
- AOrchestra — Automating Sub-Agent Creation (arXiv 2602.03786): https://arxiv.org/abs/2602.03786
- Dynamic Attentional Context Scoping / DACS (arXiv 2604.07911): https://arxiv.org/abs/2604.07911
- Context Engineering: From Prompts to Corporate Multi-Agent (arXiv 2603.09619): https://arxiv.org/pdf/2603.09619
- Multi-Agent Verification (arXiv 2502.20379): https://arxiv.org/pdf/2502.20379
- Marco DeepResearch — Verifier-Guided TTS (arXiv 2603.28376): https://arxiv.org/pdf/2603.28376
- VerifiAgent (arXiv 2504.00406): https://arxiv.org/pdf/2504.00406
- Inference-Time Scaling of Verification (arXiv 2601.15808): https://arxiv.org/html/2601.15808v2
- Agentic Test-Time Scaling for WebAgents (arXiv 2602.12276): https://arxiv.org/pdf/2602.12276
- Multiagent Debate (ICML 2024): https://composable-models.github.io/llm_debate/ ·
  repo https://github.com/composable-models/llm_multiagent_debate

큐레이션/허브
- VoltAgent/awesome-ai-agent-papers (2026): https://github.com/VoltAgent/awesome-ai-agent-papers
- LLM-Harness Survey (ETCLOVG): https://picrew.github.io/LLM-Harness/
- awesome-harness-engineering: https://github.com/ai-boost/awesome-harness-engineering
- self-correction-llm-papers: https://github.com/teacherpeterpan/self-correction-llm-papers
- Awesome-LLM-Self-Consistency: https://github.com/SuperBruceJia/Awesome-LLM-Self-Consistency

> 비고: AHE의 Terminal-Bench 2 수치(예: GPT-5.4 69.7→77.0, NexAU-AHE 84.7%)는 위 arXiv 논문
> 본문 출처. 일부 콘텐츠팜성 2차 글은 배제했다.
