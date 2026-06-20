// Attachment state for the composer: drag-and-drop / file-picker / paste of
// files into the next message. Supports images (sent as base64 image blocks) and
// text/code files (inlined into the prompt as fenced blocks). Extracted from
// Composer.tsx (behavior-preserving) so the component file stays focused.
import { useRef, useState, type DragEvent as RDragEvent } from 'react'

export type AttachKind = 'image' | 'text'

export interface Attachment {
  id: string
  kind: AttachKind
  name: string
  /** Image only: MIME type (e.g. image/png). */
  mediaType?: string
  /** Image only: base64-encoded data (no data-URL prefix). */
  base64?: string
  /** Image only: data-URL used for the thumbnail preview. */
  preview?: string
  /** Text/code only: decoded file contents. */
  text?: string
  /** Text/code only: byte size, for the chip label. */
  size?: number
}

export interface Attachments {
  attachments: Attachment[]
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>
  dragOver: boolean
  setDragOver: React.Dispatch<React.SetStateAction<boolean>>
  fileRef: React.RefObject<HTMLInputElement | null>
  /** Read image/text files into attachments. */
  addFiles: (files: FileList | null) => void
  /** Drop handler for the composer drop-zone. */
  onDrop: (e: RDragEvent) => void
}

/** Max bytes for a single text/code attachment — guards against dumping a huge
 * file (or a misdetected binary) into the prompt. Larger files are truncated. */
export const MAX_TEXT_BYTES = 512 * 1024

/** Extensions treated as text/code even when the browser reports an empty or
 * non-text MIME type (common for code files). Lower-cased, no leading dot. */
const TEXT_EXT = new Set([
  'txt', 'text', 'md', 'markdown', 'mdx', 'rst', 'adoc', 'org',
  'json', 'jsonc', 'json5', 'ndjson', 'geojson',
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts', 'vue', 'svelte', 'astro',
  'py', 'pyi', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'scala', 'groovy',
  'c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'hh', 'cs', 'm', 'mm', 'swift', 'php',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1', 'bat', 'cmd',
  'sql', 'graphql', 'gql', 'proto',
  'html', 'htm', 'xml', 'xhtml', 'svg', 'css', 'scss', 'sass', 'less', 'styl',
  'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'env', 'properties',
  'gradle', 'cmake', 'mk', 'r', 'lua', 'pl', 'pm', 'dart', 'ex', 'exs',
  'erl', 'hrl', 'hs', 'clj', 'cljs', 'cljc', 'edn', 'vim', 'el', 'tex', 'bib',
  'csv', 'tsv', 'log', 'diff', 'patch', 'lock', 'gradle', 'tf', 'tfvars', 'hcl'
])

/** Filenames (no extension) that are always text. */
const TEXT_NAMES = new Set([
  'dockerfile', 'makefile', 'cmakelists.txt', 'rakefile', 'gemfile', 'procfile',
  'license', 'notice', 'readme', 'changelog', 'authors', 'codeowners',
  '.gitignore', '.gitattributes', '.editorconfig', '.npmrc', '.nvmrc',
  '.prettierrc', '.eslintrc', '.babelrc', '.env'
])

function isTextFile(file: File): boolean {
  if (file.type.startsWith('image/')) return false
  if (file.type.startsWith('text/')) return true
  if (
    /^application\/(json|xml|javascript|x-sh|x-yaml|yaml|toml|x-httpd-php|sql|graphql)/.test(
      file.type
    )
  ) {
    return true
  }
  const name = file.name.toLowerCase()
  if (TEXT_NAMES.has(name)) return true
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : ''
  return ext !== '' && TEXT_EXT.has(ext)
}

export function useAttachments(): Attachments {
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  function addImage(file: File): void {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result)
      const base64 = dataUrl.split(',')[1] ?? ''
      setAttachments((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          kind: 'image',
          name: file.name,
          mediaType: file.type,
          base64,
          preview: dataUrl
        }
      ])
    }
    reader.readAsDataURL(file)
  }

  function addText(file: File): void {
    const reader = new FileReader()
    reader.onload = () => {
      let text = String(reader.result)
      if (text.length > MAX_TEXT_BYTES) {
        text = text.slice(0, MAX_TEXT_BYTES) + '\n… [truncated]'
      }
      setAttachments((prev) => [
        ...prev,
        { id: crypto.randomUUID(), kind: 'text', name: file.name, text, size: file.size }
      ])
    }
    reader.readAsText(file)
  }

  function addFiles(files: FileList | null): void {
    if (!files) return
    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/')) addImage(file)
      else if (isTextFile(file)) addText(file)
      // Silently skip unsupported (binary) files.
    }
  }

  function onDrop(e: RDragEvent): void {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files)
  }

  return { attachments, setAttachments, dragOver, setDragOver, fileRef, addFiles, onDrop }
}
