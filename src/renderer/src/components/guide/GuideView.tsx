// GUIDE tab — explains the non-obvious features a first-time user wouldn't
// discover on their own: the chat magic-keyword modes, the Agents dashboard,
// cost-saver routing, slash commands, attachments/search, EXTEND, persona, the
// desktop pet, and compaction. Pure presentational; `onGoto` lets a card jump to
// the relevant tab.
import type { JSX, ReactNode } from 'react'

type View = 'chat' | 'squad' | 'cost' | 'extend' | 'guide'

const KEYWORDS: { name: string; kind: string; desc: string }[] = [
  { name: 'ralph', kind: 'loop', desc: 'Work the goal iteratively, self-verifying, until it is fully met.' },
  { name: 'autopilot', kind: 'loop', desc: 'Same as ralph — keep going until the goal verifies.' },
  { name: 'ultrathink', kind: 'reason', desc: 'Engage extended, deliberate reasoning before acting.' },
  { name: 'ultrawork', kind: 'parallel', desc: 'Break independent work into parallel steps where possible.' },
  { name: 'code-review', kind: 'role', desc: 'Act as a critical code reviewer hunting correctness bugs.' },
  { name: 'security-review', kind: 'role', desc: 'Audit the change for security issues and unsafe patterns.' },
  { name: 'tdd', kind: 'role', desc: 'Write tests first, then make them pass.' },
  { name: 'deepsearch', kind: 'role', desc: 'Exhaustively locate the relevant code/files before answering.' },
  { name: 'analyze', kind: 'role', desc: 'Reason about architecture/tradeoffs rather than just coding.' }
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
            <span className="gd-mark">⚒</span> Getting the most out of Claude Forge
          </div>
          <p className="gd-lede">
            A quick tour of the powerful bits that aren’t obvious at first glance. Everything runs
            locally with your own subscription or key — nothing leaves your machine.
          </p>
        </div>

        <Section title="Magic-keyword modes (type them in chat)">
          <p className="gd-p">
            Drop one of these words into a normal chat message and Forge activates that mode for the
            run — an extra directive (and sometimes a model tier) layered on top, while the agent
            keeps its real tools and your permission setting. A chip appears above the composer when
            a keyword is detected, so you know it will fire.
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
            Example: “<em>ultrathink — why does the websocket reconnect loop?</em>” or “<em>ralph:
            get the test suite green</em>”. Type <code>cancelomc</code> to clear an active mode.
          </p>
        </Section>

        <Section title="Agents dashboard">
          <p className="gd-p">
            The <button className="gd-link" onClick={() => onGoto('squad')}>AGENTS</button> tab is a
            live observatory. Whenever the assistant delegates work to a subagent (the Task tool) or
            runs an orchestration mode, it shows up under <strong>Live</strong> with what it’s doing
            and how long it’s taken. Finished agents drop into <strong>History</strong> (kept across
            restarts) with their cost, duration and — for orchestrated runs — whether they were
            verified by an objective tool oracle 🔧 or an LLM judge ⚖.
          </p>
        </Section>

        <Section title="Watch what the agent is doing">
          <p className="gd-p">
            During any run, a pinned strip at the top of the chat shows the current action in plain
            language (“Read src/main/agent.ts”, “thinking…”) with a live timer, and every running
            tool card shows a spinner + elapsed seconds — so you always know it’s actually working,
            not stuck.
          </p>
        </Section>

        <Section title="Cost-saver auto-routing">
          <p className="gd-p">
            Turn on <strong>cost-saver</strong> in the sidebar and each message is automatically
            routed to the cheapest model tier that fits its difficulty (haiku → sonnet → opus). The
            header shows a preview of where the current draft would route.
          </p>
        </Section>

        <Section title="Cost & cache dashboard">
          <p className="gd-p">
            The <button className="gd-link" onClick={() => onGoto('cost')}>COST</button> tab
            aggregates every run’s spend, token counts and{' '}
            <strong>prompt-cache hit rate</strong> — with a per-run breakdown table. A high cache
            hit rate is the headline cost lever (cache reads bill at ~10% of fresh input), so it’s
            worth watching. It’s captured for free from data the SDK already returns — no extra
            tokens.
          </p>
        </Section>

        <Section title="Slash commands & /goal">
          <p className="gd-p">
            Type <code>/</code> in the composer for the command menu. Built-ins like{' '}
            <code>/usage</code> and <code>/context</code> run on the model; client-side ones like{' '}
            <code>/model &lt;id&gt;</code>, <code>/effort</code>, <code>/permission</code> and{' '}
            <code>/clear</code> are handled instantly by Forge. Unknown commands are flagged rather
            than silently sent as text.
          </p>
          <p className="gd-note">
            <code>/goal [max] &lt;objective&gt;</code> runs <strong>autonomously</strong>: it loops
            the conversation, resuming the session each turn, until the agent reports the objective
            complete (or hits the iteration cap). A banner over the composer tracks progress — stop
            it any time.
          </p>
        </Section>

        <Section title="Command palette">
          <p className="gd-p">
            Press <code>Ctrl/Cmd+K</code> anywhere to open the command palette — a keyboard-first
            launcher to switch tabs, start or resume a conversation, change model / effort /
            permission, toggle cost-saver, and more.
          </p>
        </Section>

        <Section title="Attachments & search">
          <ul className="gd-ul">
            <li>
              <strong>Images:</strong> drag-and-drop image files onto the chat, or paste from the
              clipboard, to attach them to your next message.
            </li>
            <li>
              <strong>Search a conversation:</strong> press <code>Ctrl/Cmd+F</code> (or the “find”
              button) to filter the transcript by any text, with a match count.
            </li>
            <li>
              <strong>Compact:</strong> the <code>⟲ compact</code> button summarizes older context
              to free up tokens; a live bar shows progress.
            </li>
            <li>
              <strong>Export:</strong> the <code>⭳ export</code> button saves the whole
              conversation (restored history + current turns) as Markdown or JSON.
            </li>
            <li>
              <strong>Nested subagents:</strong> when the agent delegates to a Task subagent, that
              subagent’s tools nest under it in the transcript — indented and collapsible.
            </li>
          </ul>
        </Section>

        <Section title="EXTEND — your .claude toolbox">
          <p className="gd-p">
            The <button className="gd-link" onClick={() => onGoto('extend')}>EXTEND</button> tab is a
            GUI over your project’s <code>.claude/</code>: manage <strong>Skills</strong>,{' '}
            <strong>Commands</strong>, <strong>Hooks</strong>, <strong>MCP servers</strong>,{' '}
            <strong>Subagents</strong> and <strong>Plugins</strong>. Secrets (MCP/plugin config) are
            kept in Forge-private files, never in model-readable <code>.claude/</code>.
          </p>
        </Section>

        <Section title="Persona & desktop pet">
          <ul className="gd-ul">
            <li>
              <strong>Persona:</strong> set a global custom system prompt (append or replace) that
              applies to every chat.
            </li>
            <li>
              <strong>Clawd, the desktop pet:</strong> an optional floating companion that reacts to
              activity — typing while the agent works, celebrating on success, dozing when idle.
              Toggle it in the sidebar; drag it anywhere.
            </li>
          </ul>
        </Section>

        <Section title="Sign-in options">
          <p className="gd-p">
            Forge works with your Claude <strong>subscription</strong> (reuses your existing
            <code> ~/.claude</code> login), a <strong>setup token</strong>, or an{' '}
            <strong>API key</strong> — your choice, all local.
          </p>
        </Section>

        <div className="gd-foot">
          Ready? Jump back to{' '}
          <button className="gd-link" onClick={() => onGoto('chat')}>CHAT</button> and try a
          keyword.
        </div>
      </div>
    </div>
  )
}
