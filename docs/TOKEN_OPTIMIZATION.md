# Token / 비용 최적화 — 설계 (v2)

> 이전 `TOKEN_PARITY.md`(Forge↔CLI 차이 검증)를 냉정하게 비판하고, 2026 최신 기법으로
> **실제 최적화 플랜**으로 다시 짠 버전. 목표: 능력·품질을 유지하면서 비용(또는 구독
> rate-limit 소비)을 최소화. 차이 진단(parity)은 "최적화 효과 측정"의 기반으로 흡수한다.

---

## A. 이전 문서(parity) 자기비판

1. **parity ≠ optimization.** "Forge가 CLI와 어디서 다른가"만 측정했다. 그런데 CLI 자체가
   토큰-최적이 아니다 — CLI 매칭은 목표가 아니다. 최소화 *처방*이 없었다.
2. **최적화 기법이 0개.** 2026 최대 레버인 **prompt caching(−60~90%)**, **동적 tool loading
   (−최대 98.7%)**, **context compression(−50~70%)** 이 전부 빠졌다. 측정만 있고 행동이 없었다.
3. **preset 누락을 "버그"로만 취급.** 실은 *능력↔토큰 트레이드오프*다. 의식적으로 결정할 사안.
4. **tokens를 최적화했지 cost가 아니다.** 비용은 모델 + **cache read/write 분해**가 좌우한다
   (cache write ≈ +25%, cache read ≈ −90%). 구독 모드에선 목표가 "달러"가 아니라 "rate-limit 소비"다.
5. **$ 임팩트 우선순위 없음.** 델타를 나열만 하고 무엇이 가장 큰 돈인지 안 따졌다.
6. **Squad v2의 15× 문제와 미연결.** 토큰 최적화가 가장 절실한 곳이 멀티에이전트인데 빠졌다.
7. **Forge 기존 "최적화 tier 1–4"는 실체가 얇다.** 코드상 실제로는 cost-saver(Sonnet+LOW 강제,
   `App.tsx:325-327`) + effort 조절 + 수동 `/compact` + usage 패널뿐. 등급화된 시스템이 아니다.
   CLAUDE.md 문구는 과장이다.

---

## B. 최적화 목표 재정의

- **목표 = 비용(API) 또는 rate-limit 소비(구독) 최소화 × 능력/품질 유지.** tokens는 대리지표.
- **측정축**: `total_cost_usd`, **cache hit %**, 입력 분해(fresh / cache-read / cache-write),
  output·thinking, context tokens. (Forge는 이미 cache_read/creation을 계측 — `agent.ts:672-685`)
- **모드 구분**: 구독(BYO subscription)은 달러가 아니라 5h/주간 한도 소비가 목표; API 키 모드는 달러.
- **철칙**: 공격적 압축/감축은 정확도를 떨어뜨릴 수 있다 → 모든 레버는 **품질과 함께** 측정
  (골든셋 ≥50 쿼리). eval이 게이트다.

---

## C. 레버 (임팩트 순) + Forge 적용

### 레버 1 — Prompt Caching (최대 −60~90%, 최고 레버)
- 원리: 캐시 가능한 **prefix는 크고 안정적**으로(system prompt + 도구 스키마 + few-shot +
  CLAUDE.md), **동적 꼬리만 변동**. 첫 호출은 cache write(풀+25%), 이후 TTL 내 cache read(≈10%).
- 함정: **prefix가 흔들리면 cache miss**. persona append·동적 systemPrompt·MCP 도구 순서 변동이
  prefix를 깬다(이전 문서 #5). "Don't Break the Cache"(arXiv 2601.06007)는 장기 에이전트에서
  캐시 보존이 비용/지연을 좌우함을 보인다.
- **사실 정정(1차 출처 확인)**: "TTL이 2026에 60분→5분으로 단축됐다"는 2차 블로그 주장은 **틀렸다**.
  공식 문서상 **기본 TTL은 원래 5분**, **1시간은 유료 옵션**(write 2x). 가격 배수는 cache write
  1.25x(5분)/2x(1h), **cache read 0.1x**. 2026-02-05 변경은 TTL이 아니라 **캐시 격리(workspace 단위)**다.
  유휴 5분 경과 후 첫 요청이 cache write가 되는 건 *원래부터의 동작*이다.
- **Forge 조치**: ⒜ systemPrompt·도구 정의·CLAUDE.md를 prefix에 **고정/안정화**, 동적 콘텐츠를
  prefix에 넣지 않기. ⒝ SDK가 cache_control을 자동 설정하는지 확인하고 깨지 않게. ⒞ **cache hit %를
  1급 지표로** 대시보드 상단에. ⒟ 전략적 경계: system은 캐시, 동적 tool result는 캐시 제외.

### 레버 2 — 동적 Tool Loading / "MCP tax" 제거 (최대 −98.7%)
- 원리: 모든 MCP/skill/plugin 스키마를 **매 턴 컨텍스트에 싣는 것**이 가장 큰 *숨은* 세금.
  Anthropic의 code-execution-with-MCP는 전체 프리로드 **~150k → 온디맨드 ~2k 토큰(−98.7%)**.
  연구: Tool Gating·Lazy Schema(arXiv 2604.21816), Dynamic ReAct(2509.20386),
  Tool Dependency Retrieval(2512.17052).
- **Forge 조치**(이전 문서 #2와 직결): ⒜ EXTEND에서 **활성 도구를 task별로 좁히고 기본은 최소**.
  ⒝ 각 MCP/skill 옆에 "컨텍스트 N토큰 점유" 표시 → 세금 가시화. ⒞ 장기적으로 lazy schema(이름만
  싣고 호출 시 스키마 로드) 또는 code-execution-MCP 패턴.

### 레버 3 — Context Compression / Compaction (−50~70%)
- 원리: 임계 도달 시 오래된 컨텍스트를 요약/오프로드. **reversible** 압축이 핵심(필요 시 원본
  복원). Headroom(압축+캐시 안정화+가역), Demand Paging(arXiv 2603.09023), ACON(2510.00615, 장기
  에이전트용 컨텍스트 압축).
- **Forge 조치**: 수동 `/compact`를 **자동 compaction 정책**(임계·노출)으로 승급; 전체 파일 덤프
  대신 retrieval; 압축 산출을 가역적으로 보관.

### 레버 4 — Model Routing / Cascade (−40~70%)
- 난이도/신뢰도로 Haiku→Sonnet→Opus 라우팅. (Squad v2의 cascade·AutoMix와 공유 — 중복 구현 금지)
- **Forge 조치**: 현재 cost-saver(무조건 Sonnet+LOW)를 **난이도 기반 라우터**로 승급.

### 레버 5 — Retrieval over full-file
- 파일 통째로 넣지 말고 grep/span 검색; 서브에이전트 컨텍스트 격리(DACS)로 부모 오염 방지.

### 레버 6 — Output / Thinking 절감
- thinking 토큰은 **출력 가격**이라 effort가 비용을 직접 좌우. effort 튜닝 + 간결 출력 + stop 시퀀스.

---

## D. Forge 구체 조치 (우선순위)

- **P1 — caching 보존**: systemPrompt/도구 순서 안정화, 동적 콘텐츠 prefix 격리, cache hit %를
  상단 지표로. (코드 작음, 효과 최대)
- **P1 — MCP/tool 스코핑**: per-task 도구 토글 + 비활성 기본 + 점유 토큰 표시. (MCP tax 직격)
- **P2 — 자동 compaction 정책** + 임계 노출 + 가역 요약.
- **P2 — cost-saver → 난이도 라우터** 승급.
- **P3 — retrieval-first 파일 접근**, 장기적으로 lazy tool schema.

---

## E. 측정·검증 (이전 parity 진단을 흡수)

이전 문서의 parity 실험을 **"레버 효과 측정"** 프레임으로 재사용:
- 각 레버 적용 전/후로 `total_cost_usd` · **cache hit %** · 입력분해 · **정확도(골든셋 ≥50)** 비교.
  AHE decision-observability(변경마다 예측→결과 검증).
- 계측 정비: Forge `result.usage`(`agent.ts:672-685`) ↔ CLI `claude -p --output-format json` /
  `/cost` / `/context` / OTEL. 콜드/웜 분리 측정(캐시 효과 분리).
- **품질 가드**: 압축/도구감축은 정확도 저하 위험 → 토큰 절감과 품질을 **항상 동시 측정**.

---

## F. 단계별 플랜

- **Phase 0**: 계측 정비(cost/cache/도구토큰 분해 대시보드) + 골든셋(≥50) 구축.
- **Phase 1**: 레버 1(caching 보존) + 레버 2(MCP/tool 스코핑) — 최대 레버 둘. 전/후 측정.
- **Phase 2**: 레버 3(자동 compaction) + 레버 4(라우팅; Squad cascade와 공유).
- **Phase 3**: 레버 5(retrieval-first) + lazy schema.

---

## G. 참고문헌

캐싱
- Prompt caching(공식): https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- Don't Break the Cache (장기 에이전트, arXiv 2601.06007): https://arxiv.org/pdf/2601.06007

동적 도구 / MCP tax
- Tool Attention Is All You Need — Dynamic Tool Gating & Lazy Schema (arXiv 2604.21816): https://arxiv.org/abs/2604.21816
- Dynamic ReAct (arXiv 2509.20386) · Tool Dependency Retrieval (arXiv 2512.17052)
- Anthropic — code execution with MCP(150k→2k, −98.7%): anthropic.com 엔지니어링 블로그

압축 / 메모리 계층
- ACON — long-horizon 컨텍스트 압축 (arXiv 2510.00615): https://arxiv.org/pdf/2510.00615
- Demand Paging for LLM Context Windows (arXiv 2603.09023): https://arxiv.org/pdf/2603.09023

라우팅
- Dynamic Model Routing & Cascading 서베이 (arXiv 2603.04445): https://arxiv.org/abs/2603.04445

> 연관: 멀티에이전트(15×) 비용은 `docs/SQUAD_ORCHESTRATION.md`의 cascade·ESC·격리와 함께 봐야 한다.
> 코드 근거: `src/main/agent.ts`(옵션 537-612, usage 672-685), `skills.ts`/`mcp.ts`/`plugins.ts`,
> `src/renderer/src/App.tsx`(cost-saver·usage 패널).
