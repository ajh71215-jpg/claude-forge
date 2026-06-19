// GUIDE 탭 — 처음 쓰는 사용자가 스스로 발견하기 어려운 기능들을 한국어로 설명한다.
// 채팅 매직 키워드, 슬래시 명령, 효율/권한 모드, 다중 대화 탭, 워크스페이스 파일,
// 메모리, 무료 프로바이더(delegate), AGENTS/COST 대시보드, 비용 절감 라우팅, EXTEND,
// 페르소나, 데스크톱 펫, 설정 등. 순수 표시용이며 `onGoto`로 카드에서 해당 탭으로 점프한다.
import type { JSX, ReactNode } from 'react'

type View = 'chat' | 'squad' | 'cost' | 'extend' | 'guide' | 'theme'

// 실제 keywords.ts(MODES)와 일치. name = 채팅에 그대로 입력하는 트리거.
const KEYWORDS: { name: string; kind: string; desc: string }[] = [
  { name: 'ralph', kind: 'loop', desc: '목표가 완전히 검증될 때까지 반복 수행 — 부분 결과에서 멈추지 않음.' },
  { name: 'autopilot', kind: 'loop', desc: '전체 계획을 멈춤 없이 끝까지 자율 실행 (별칭: fullsend, full auto).' },
  { name: 'ultrawork', kind: 'parallel', desc: '독립적인 작업으로 쪼개 병렬로 펼쳐 처리 (별칭: ulw).' },
  { name: 'ultrathink', kind: 'reason', desc: '행동 전에 여러 관점에서 깊고 신중하게 추론.' },
  { name: 'cheap', kind: 'delegate', desc: '간단·저위험 하위작업을 무료 모델에 위임해 비용 절약 (별칭: delegate, budget-mode).' },
  { name: 'ponytail', kind: 'style', desc: '동작하는 가장 게으른(최소) 해법을 작성 (별칭: lazy mode, laziest solution).' },
  { name: 'tdd', kind: 'role', desc: '테스트 먼저 작성 → 실패 확인 → 최소 구현 → 통과 (별칭: test first).' },
  { name: 'code-review', kind: 'role', desc: '정확성·엣지케이스·회귀 관점으로 비판적 코드 리뷰.' },
  { name: 'security-review', kind: 'role', desc: '신뢰 경계·인증·데이터 노출·시크릿 관점의 보안 감사.' },
  { name: 'deepsearch', kind: 'role', desc: '코드베이스 전반을 병렬로 샅샅이 탐색 (별칭: search the codebase).' },
  { name: 'deep-analyze', kind: 'role', desc: '변경 전에 정상/고장 동작을 비교하며 맥락부터 수집·분석 (별칭: deepanalyze).' }
]

function Section({
  title,
  children
}: {
  title: string
  children: ReactNode
}): JSX.Element {
  return (
    <section className="gd-section">
      <h2 className="gd-h2">{title}</h2>
      {children}
    </section>
  )
}

export default function GuideView({ onGoto }: { onGoto: (v: View) => void }): JSX.Element {
  return (
    <div className="gd-root">
      <div className="gd-scroll">
        <div className="gd-head">
          <div className="gd-title">
            <span className="gd-mark">⚒</span> Claude Forge 200% 활용하기
          </div>
          <p className="gd-lede">
            첫눈에는 잘 보이지 않는 강력한 기능들을 빠르게 둘러봅니다. 모든 것은 사용자의 구독 또는
            키로 <strong>로컬에서</strong> 실행되며, 어떤 데이터도 기기를 떠나지 않습니다.
          </p>
        </div>

        <Section title="매직 키워드 모드 (채팅에 입력)">
          <p className="gd-p">
            아래 단어를 평범한 채팅 메시지에 섞어 넣으면 해당 모드가 이번 실행에 켜집니다 — 추가 지시
            (때로는 모델 등급)가 위에 얹히고, 에이전트는 실제 도구와 권한 설정을 그대로 유지합니다.
            키워드가 감지되면 작성창 위에 칩이 떠서 발동될 것을 알려줍니다. 키워드를 단지{' '}
            <em>설명/질문</em>하거나 따옴표로 인용하면 오발동하지 않습니다(한국어·일본어 별칭도 인식).
          </p>
          <div className="gd-kw">
            {KEYWORDS.map((k) => (
              <div className="gd-kw-row" key={k.name}>
                <span className="gd-kw-name">{k.name}</span>
                <span className={`gd-kw-kind ${k.kind}`}>{k.kind}</span>
                <span className="gd-kw-desc">{k.desc}</span>
              </div>
            ))}
          </div>
          <p className="gd-note">
            예: “<em>ultrathink — 웹소켓이 왜 재연결 루프를 도나?</em>” 또는 “<em>ralph: 테스트
            스위트 전부 통과시켜줘</em>”. 활성 모드를 끄려면 <code>cancelomc</code> / <code>stopomc</code>{' '}
            (또는 “normal mode”, ponytail은 “stop ponytail”)를 입력하세요.
          </p>
        </Section>

        <Section title="슬래시 명령 & /goal">
          <p className="gd-p">
            작성창에 <code>/</code>를 입력하면 명령 메뉴가 열립니다. <code>/usage</code>,{' '}
            <code>/context</code> 같은 내장 명령은 모델에서 실행되고, 클라이언트 명령은 Forge가 즉시
            처리합니다:
          </p>
          <ul className="gd-ul">
            <li>
              <code>/model &lt;name|id&gt;</code> — 모델 변경(별칭 또는 임의의 id). <code>/persona</code>,{' '}
              <code>/model</code>은 <strong>현재 대화에만</strong> 적용됩니다.
            </li>
            <li>
              <code>/effort &lt;auto|low|medium|high|xhigh|max&gt;</code> — 추론 강도 설정.
            </li>
            <li>
              <code>/permission &lt;plan|ask|auto-edit|yolo&gt;</code> (별칭 <code>/perm</code>) — 권한 모드.
            </li>
            <li>
              <code>/persona &lt;지시문|clear&gt;</code> — 이 대화의 페르소나(전역 설정 위에 덮어쓰기).
            </li>
            <li>
              <code>/clear</code> (별칭 <code>/new</code>) — 새 대화 시작. <code>/help</code> — 명령 목록.
            </li>
          </ul>
          <p className="gd-note">
            <code>/goal [max] &lt;목표&gt;</code> 는 <strong>자율 실행</strong>됩니다: 매 턴 세션을
            이어가며 에이전트가 목표 완료를 보고할 때까지(또는 반복 상한에 닿을 때까지) 대화를
            반복합니다. 작성창 위 배너가 진행 상황을 표시하며 언제든 중지할 수 있습니다. 알 수 없는
            명령은 그냥 텍스트로 전송되지 않고 경고로 표시됩니다.
          </p>
        </Section>

        <Section title="효율(Effort) 레벨">
          <p className="gd-p">
            추론 강도는 <code>AUTO → LOW → MEDIUM → HIGH → XHIGH → MAX</code> 순으로 올라갑니다. 모델이
            지원하지 않는 등급은 자동으로 <code>AUTO</code>로 되돌아갑니다. <code>XHIGH</code> /{' '}
            <code>MAX</code>는 “⚠ 토큰 사용량 많음” 경고가 함께 표시됩니다 — 어려운 문제에만 쓰세요.
          </p>
        </Section>

        <Section title="권한 모드">
          <ul className="gd-ul">
            <li><strong>PLAN</strong> — 읽기 전용, 계획만 제안(파일을 바꾸지 않음).</li>
            <li><strong>ASK</strong> — 도구 사용마다 승인 요청.</li>
            <li><strong>AUTO-EDIT</strong> — 파일 편집은 자동 승인.</li>
            <li><strong>YOLO</strong> — 모든 작업 자동 승인(주의해서 사용).</li>
          </ul>
        </Section>

        <Section title="여러 대화 탭 & 격리 워크스페이스">
          <p className="gd-p">
            최대 <strong>5개</strong>의 대화 탭을 동시에 열 수 있고, 각 탭은 <strong>독립된
            워크스페이스</strong>를 가집니다. 탭을 전환해도 백그라운드에서 스트리밍이 계속되므로, 한
            작업이 도는 동안 다른 대화를 진행할 수 있습니다. <code>＋</code>(“새 대화 — 격리
            워크스페이스”) 버튼으로 새 탭을 엽니다.
          </p>
        </Section>

        <Section title="대화 관리 & 검색">
          <ul className="gd-ul">
            <li>
              <strong>사이드바 관리:</strong> 고정 <code>★/☆</code>, 이름 변경 <code>✎</code>, 삭제{' '}
              <code>✕</code>(확인 후).
            </li>
            <li>
              <strong>전체 대화 검색:</strong> 사이드바 <code>⌕</code>(또는 팔레트 “Search all
              conversations…”)로 저장된 모든 기록을 텍스트로 검색.
            </li>
            <li>
              <strong>현재 대화 검색:</strong> <code>Ctrl/Cmd+F</code>로 지금 대화의 대화록을 필터링하고
              일치 개수를 확인.
            </li>
            <li>
              <strong>프롬프트 기록:</strong> 빈 작성창에서 <code>↑ / ↓</code>로 최근 약 100개 프롬프트를
              순환.
            </li>
          </ul>
        </Section>

        <Section title="에이전트 대시보드 (AGENTS)">
          <p className="gd-p">
            <button className="gd-link" onClick={() => onGoto('squad')}>AGENTS</button> 탭은 실시간
            관측소입니다. 어시스턴트가 하위 에이전트(Task 도구)에게 일을 위임하거나 오케스트레이션
            모드를 돌리면 <strong>Live</strong>에 무엇을 얼마나 오래 하고 있는지 표시됩니다. 끝난
            에이전트는 <strong>History</strong>(재시작해도 유지)로 들어가며 비용·소요시간과 — 오케스트
            레이션 실행이라면 — 객관적 도구 오라클 🔧 또는 LLM 심판 ⚖로 검증됐는지 보여줍니다.
          </p>
        </Section>

        <Section title="실행 상태 관찰 — 작업 스트립 · TASKS · 알림">
          <ul className="gd-ul">
            <li>
              <strong>작업 스트립:</strong> 실행 중 채팅 상단에 현재 동작을 평이한 말로 고정 표시(“Read
              src/main/agent.ts”, “생각 중…”)하고 라이브 타이머와 도구별 스피너+경과초로 멈춤이 아님을
              알려줍니다.
            </li>
            <li>
              <strong>TASKS 진행 바:</strong> 에이전트가 할 일 목록을 만들면 “TASKS X/Y” 진행 바와 펼칠 수
              있는 실시간 작업 리스트(☑/◐/☐)가 고정됩니다.
            </li>
            <li>
              <strong>신뢰성 배너:</strong> “Retrying … attempt X/Y”, “⚠ Rate limit … 리셋 HH:MM”,
              “✦ Context (auto-)compacted — XXk→YYk” 같은 일시 알림을 띄웁니다.
            </li>
          </ul>
        </Section>

        <Section title="비용 절감 자동 라우팅 (cost-saver)">
          <p className="gd-p">
            사이드바에서 <strong>cost-saver</strong>를 켜면 각 메시지가 난이도에 맞는 가장 저렴한 모델
            등급(haiku → sonnet → opus)으로 자동 라우팅됩니다. 헤더에 현재 초안이 어디로 갈지 미리보기가
            표시됩니다.
          </p>
        </Section>

        <Section title="비용·캐시 대시보드 (COST) & 플랜 사용량">
          <p className="gd-p">
            <button className="gd-link" onClick={() => onGoto('cost')}>COST</button> 탭은 모든 실행의
            지출·토큰 수와 <strong>프롬프트 캐시 적중률</strong>을 실행별 표로 집계합니다. 캐시 적중률은
            가장 큰 비용 지렛대입니다(캐시 읽기는 신규 입력의 약 10%로 과금) — SDK가 이미 반환하는
            데이터에서 무료로 수집되므로 추가 토큰이 들지 않습니다. 사이드바의 <strong>PLAN USAGE</strong>{' '}
            미터는 구독 사용 한도 막대와 리셋 시각을 따로 보여줍니다(COST 탭의 지출과는 별개).
          </p>
        </Section>

        <Section title="안전 한도 (LIMITS)">
          <ul className="gd-ul">
            <li><strong>최대 턴 수:</strong> 모델별로 저장되는 한 실행의 턴 상한.</li>
            <li><strong>실행당 최대 $:</strong> 한 실행의 예산 상한.</li>
            <li><strong>80% 자동 압축:</strong> 컨텍스트가 80%를 넘으면 자동으로 오래된 맥락을 요약.</li>
          </ul>
        </Section>

        <Section title="워크스페이스 파일 & 리포지토리 맵">
          <p className="gd-p">
            <code>⌗</code> 버튼(팔레트 “Workspace files (this conversation)…”)으로 “WORKSPACE — this
            conversation” 모달을 엽니다. <strong>Files</strong> 탭은 에이전트가 이 대화에서 만들거나 고친
            파일을 미리보기로 보여주고, <strong>Repo map</strong> 탭은 새 대화 시작 시 자동으로 앞에
            붙는 <strong>리포지토리 맵</strong>(가장 많이 import되는 파일들의 구조 요약)을 보여줍니다 —
            덕분에 에이전트가 모든 파일을 뒤지지 않고도 코드베이스를 탐색합니다.
          </p>
        </Section>

        <Section title="첨부 · 압축 · 내보내기">
          <ul className="gd-ul">
            <li>
              <strong>이미지:</strong> 채팅에 이미지 파일을 드래그&드롭하거나 클립보드에서 붙여넣어 다음
              메시지에 첨부합니다.
            </li>
            <li>
              <strong>압축(Compact):</strong> <code>⟲ compact</code> 버튼이 오래된 맥락을 요약해 토큰을
              확보하고, 라이브 막대로 진행을 표시합니다.
            </li>
            <li>
              <strong>내보내기:</strong> <code>⭳ export</code> 버튼이 전체 대화(복원된 기록 + 현재 턴)를
              Markdown 또는 JSON으로 저장합니다.
            </li>
            <li>
              <strong>중첩 하위 에이전트:</strong> Task 하위 에이전트에 위임하면 그 도구들이 대화록에서
              아래로 들여쓰기되어 접고 펼 수 있습니다.
            </li>
          </ul>
        </Section>

        <Section title="EXTEND — 내 .claude 도구상자">
          <p className="gd-p">
            <button className="gd-link" onClick={() => onGoto('extend')}>EXTEND</button> 탭은 프로젝트의{' '}
            <code>.claude/</code>를 위한 GUI입니다: <strong>Skills</strong>, <strong>Commands</strong>,{' '}
            <strong>Hooks</strong>, <strong>MCP 서버</strong>, <strong>Subagents</strong>,{' '}
            <strong>Plugins</strong>에 더해 <strong>Memory</strong>와 <strong>Providers</strong>까지 관리
            합니다. 시크릿(MCP/플러그인 설정)은 모델이 읽을 수 있는 <code>.claude/</code>가 아니라
            Forge 전용 파일에 보관됩니다.
          </p>
        </Section>

        <Section title="메모리 (Memory)">
          <p className="gd-p">
            EXTEND의 <strong>Memory</strong> 패널은 프로젝트에 대한 사실을 편집·명령에서 자동으로
            포착해 두었다가 대화 시작 시 다시 떠올립니다. <strong>BM25</strong>로 검색(“Search memory
            (BM25)…”)하고, <code>working</code> / <code>episodic</code> / <code>semantic</code> /{' '}
            <code>procedural</code> 종류 배지와 “recalled ×N”을 표시합니다. 시크릿은 제거되며 모두 로컬에
            저장됩니다. 개별 <strong>Forget</strong> 또는 <strong>Forget all</strong>로 지울 수 있습니다.
          </p>
        </Section>

        <Section title="무료·저가 프로바이더 & delegate">
          <p className="gd-p">
            EXTEND의 <strong>Providers</strong> 패널에서 Anthropic 외 프로바이더(OpenRouter의 :free 모델,
            Google Gemini, Groq, 로컬 Ollama, 커스텀)를 추가할 수 있습니다. “+ Add provider”로 등록하고
            “Prefer for easy subtasks (free)”를 켜면, 에이전트가 <code>delegate</code> 도구로 저위험 하위
            작업을 무료 모델에 떠넘겨 비용을 아낍니다. 채팅에서 <code>cheap</code> 키워드로도 이 동작을
            유도할 수 있습니다.
          </p>
        </Section>

        <Section title="명령 팔레트 & 단축키">
          <ul className="gd-ul">
            <li><code>Ctrl/Cmd+K</code> — 명령 팔레트(탭 전환, 대화 시작/이어가기, 모델·효율·권한 변경, cost-saver 토글 등).</li>
            <li><code>Ctrl/Cmd+/</code> — 키보드 단축키 도움말 오버레이.</li>
            <li><code>Ctrl/Cmd+F</code> — 현재 대화 검색.</li>
            <li><code>Enter</code> 전송 · <code>Shift+Enter</code> 줄바꿈 · <code>Esc</code> 모달 닫기.</li>
            <li><code>↑ / ↓</code> 이전 프롬프트 불러오기(빈 작성창) · <code>/</code> 슬래시 명령 메뉴.</li>
          </ul>
        </Section>

        <Section title="페르소나 & 데스크톱 펫">
          <ul className="gd-ul">
            <li>
              <strong>페르소나:</strong> 모든 채팅에 적용되는 전역 커스텀 시스템 프롬프트(덧붙이기 또는
              교체)를 설정. <code>/persona</code>로 <strong>대화별</strong>로 덮어쓸 수 있고, 적용 시
              헤더에 “✦ persona”가 표시됩니다.
            </li>
            <li>
              <strong>Clawd, 데스크톱 펫:</strong> 활동에 반응하는 선택형 떠다니는 친구 — 에이전트가
              일하는 동안 타이핑하고, 성공하면 축하하고, 한가하면 졸아요. 사이드바/설정에서 켜고 아무 곳
              으로나 드래그하세요.
            </li>
          </ul>
        </Section>

        <Section title="설정(Settings) & 로컬 데이터">
          <p className="gd-p">
            브랜드 바의 <code>⚙</code>(팔레트 “Settings…”)는 안전 한도, <strong>Lazy 모드 강도</strong>
            (Off / Lite / Full / Ultra, “ponytail”), <strong>데스크톱 펫(Clawd) 표시</strong> 토글, 그리고{' '}
            <strong>로컬 데이터</strong> 관리(“Clear prompt history”, “Reset all local data…”)가 모인
            중앙 패널입니다. Lazy 모드는 키워드와 별개로 여기서 항상 켜둘 수 있습니다.
          </p>
        </Section>

        <Section title="로그인 옵션">
          <p className="gd-p">
            Forge는 Claude <strong>구독</strong>(기존 <code>~/.claude</code> 로그인 재사용),{' '}
            <strong>설치 토큰(setup token)</strong>, 또는 <strong>API 키</strong> 중 무엇으로도 동작합니다
            — 선택은 자유이며 모두 로컬에서 처리됩니다.
          </p>
        </Section>

        <div className="gd-foot">
          준비됐나요?{' '}
          <button className="gd-link" onClick={() => onGoto('chat')}>CHAT</button>으로 돌아가 키워드를
          하나 써보세요.
        </div>
      </div>
    </div>
  )
}
