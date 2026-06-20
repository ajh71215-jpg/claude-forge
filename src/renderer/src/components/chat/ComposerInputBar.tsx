// The composer input bar (attachment chips + textarea + send/stop controls),
// extracted from Composer.tsx as a presentational component so the parent stays
// focused on state and run wiring. Behavior-preserving.
import { type JSX } from 'react'
import PromptUpgrade from './PromptUpgrade'
import type { Attachment } from './useAttachments'
import type { ComposerInput } from './useComposerInput'

const ACCEPT =
  'image/*,text/*,.txt,.md,.json,.js,.jsx,.ts,.tsx,.mjs,.cjs,.py,.rb,.go,.rs,.java,.kt,.c,.h,.cpp,.cc,.hpp,.cs,.php,.swift,.sh,.bash,.ps1,.sql,.html,.xml,.svg,.css,.scss,.less,.vue,.svelte,.yml,.yaml,.toml,.ini,.cfg,.conf,.env,.csv,.log'

export default function ComposerInputBar({
  prompt,
  setPrompt,
  attachments,
  setAttachments,
  fileRef,
  addFiles,
  taRef,
  input,
  running,
  send,
  stop,
  stickBottom,
  setStickBottom,
  model,
  globalModel
}: {
  prompt: string
  setPrompt: (v: string) => void
  attachments: Attachment[]
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>
  fileRef: React.RefObject<HTMLInputElement | null>
  addFiles: (files: FileList | null) => void
  taRef: React.RefObject<HTMLTextAreaElement | null>
  input: ComposerInput
  running: boolean
  send: () => void
  stop: () => void
  stickBottom: boolean
  setStickBottom: React.Dispatch<React.SetStateAction<boolean>>
  model?: string
  globalModel: string
}): JSX.Element {
  return (
    <>
      {attachments.length > 0 && (
        <div className="attach-row">
          {attachments.map((a) =>
            a.kind === 'image' ? (
              <div className="attach-thumb" key={a.id} title={a.name}>
                <img src={a.preview} alt={a.name} />
                <button
                  className="attach-x"
                  onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                >
                  ×
                </button>
              </div>
            ) : (
              <div className="attach-file" key={a.id} title={a.name}>
                <span className="attach-file-icon">🗎</span>
                <span className="attach-file-name">{a.name}</span>
                <button
                  className="attach-x"
                  onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                >
                  ×
                </button>
              </div>
            )
          )}
        </div>
      )}
      <div className="composer">
        <button
          className="attach-btn"
          title="Attach image or code/text file"
          onClick={() => fileRef.current?.click()}
        >
          ＋
        </button>
        <span className="composer-prompt" aria-hidden="true">
          ›
        </span>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            addFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <textarea
          ref={taRef}
          className="composer-input"
          placeholder="Describe the work…  (Enter send · Shift+Enter newline · / commands · ↑ history)"
          rows={3}
          autoFocus
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value)
            input.setDismissed(false)
            input.resetCursor()
          }}
          onKeyDown={input.onKey}
          onPaste={(e) => {
            const imgs = Array.from(e.clipboardData.items).filter((it) =>
              it.type.startsWith('image/')
            )
            if (imgs.length) {
              e.preventDefault()
              const dt = new DataTransfer()
              imgs.forEach((it) => {
                const f = it.getAsFile()
                if (f) dt.items.add(f)
              })
              addFiles(dt.files)
            }
          }}
        />
        <div className="send-col">
          <PromptUpgrade
            text={prompt}
            model={model && model !== 'default' ? model : globalModel}
            disabled={running}
            onAccept={(next) => {
              setPrompt(next)
              input.resetCursor()
              taRef.current?.focus()
            }}
          />
          <button
            className={`scroll-toggle ${stickBottom ? 'on' : ''}`}
            title={
              stickBottom
                ? 'Auto-scroll: following latest line (click to stop at answers)'
                : 'Auto-scroll: stops at answers (click to follow latest)'
            }
            onClick={() => setStickBottom((v) => !v)}
          >
            {stickBottom ? '⤓ Follow' : '⤒ Manual'}
          </button>
          {running ? (
            <button className="stop" onClick={stop}>
              ■ STOP
            </button>
          ) : (
            <button
              className="primary send"
              disabled={!prompt.trim() && attachments.length === 0}
              onClick={() => send()}
            >
              Send
            </button>
          )}
        </div>
      </div>
    </>
  )
}
