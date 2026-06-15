// Pure source parser — the deterministic, static half of the idea absorbed from
// Egonex-AI/Understand-Anything (MIT): turn files into a structural map (exports,
// imports, top-level symbols) so an agent can navigate by map instead of blindly
// reading files. Understand-Anything pairs Tree-sitter (static) with an LLM
// (semantic); Forge ships only the static layer, by lightweight regex, to stay
// dependency-free and local — an honest, best-effort subset (no full grammar, so
// exotic syntax may be missed). NO electron/SDK imports → unit-tested headlessly.

export type Lang = 'ts' | 'tsx' | 'js' | 'jsx' | 'py' | 'go' | 'rs' | 'java' | 'rb' | 'other'

export interface SourceSymbol {
  name: string
  kind: 'function' | 'class' | 'interface' | 'type' | 'const' | 'enum' | 'def' | 'struct'
}

export interface FileNode {
  /** Path relative to the scan root, with forward slashes. */
  path: string
  lang: Lang
  /** Line count. */
  loc: number
  /** Exported / public symbol names. */
  exports: string[]
  /** Imported module specifiers (dedup, in source order). */
  imports: string[]
  /** Notable top-level declarations. */
  symbols: SourceSymbol[]
}

export function detectLang(path: string): Lang {
  const m = /\.([a-z0-9]+)$/i.exec(path)
  switch ((m?.[1] ?? '').toLowerCase()) {
    case 'ts':
      return 'ts'
    case 'tsx':
      return 'tsx'
    case 'js':
    case 'cjs':
    case 'mjs':
      return 'js'
    case 'jsx':
      return 'jsx'
    case 'py':
      return 'py'
    case 'go':
      return 'go'
    case 'rs':
      return 'rs'
    case 'java':
      return 'java'
    case 'rb':
      return 'rb'
    default:
      return 'other'
  }
}

function uniq(xs: string[]): string[] {
  return [...new Set(xs.filter(Boolean))]
}

const JS_LANGS: Lang[] = ['ts', 'tsx', 'js', 'jsx']

/** Best-effort structural parse. Never throws — returns an empty-ish node on doubt. */
export function parseFile(path: string, content: string): FileNode {
  const lang = detectLang(path)
  const loc = content.length ? content.split('\n').length : 0
  const exports: string[] = []
  const imports: string[] = []
  const symbols: SourceSymbol[] = []

  if (JS_LANGS.includes(lang)) {
    for (const m of content.matchAll(/(?:^|\n)\s*import\s+[^;]*?from\s+['"]([^'"]+)['"]/g)) imports.push(m[1])
    for (const m of content.matchAll(/(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g)) imports.push(m[1])
    for (const m of content.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) imports.push(m[1])

    // export { a, b as c }
    for (const m of content.matchAll(/export\s*\{([^}]*)\}/g)) {
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop()?.trim()
        if (name) exports.push(name)
      }
    }
    if (/export\s+default\b/.test(content)) exports.push('default')

    // export-prefixed (and bare) top-level declarations.
    const decl =
      /(?:^|\n)\s*(export\s+)?(?:default\s+)?(?:async\s+)?(function|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/g
    for (const m of content.matchAll(decl)) {
      const exported = !!m[1]
      const kw = m[2]
      const name = m[3]
      const kind: SourceSymbol['kind'] =
        kw === 'function' ? 'function'
          : kw === 'class' ? 'class'
            : kw === 'interface' ? 'interface'
              : kw === 'type' ? 'type'
                : kw === 'enum' ? 'enum'
                  : 'const'
      symbols.push({ name, kind })
      if (exported) exports.push(name)
    }
  } else if (lang === 'py') {
    for (const m of content.matchAll(/(?:^|\n)\s*from\s+([\w.]+)\s+import\b/g)) imports.push(m[1])
    for (const m of content.matchAll(/(?:^|\n)\s*import\s+([\w.]+)/g)) imports.push(m[1])
    for (const m of content.matchAll(/(?:^|\n)(?:async\s+)?def\s+([A-Za-z_]\w*)/g)) {
      symbols.push({ name: m[1], kind: 'def' })
      if (!m[1].startsWith('_')) exports.push(m[1])
    }
    for (const m of content.matchAll(/(?:^|\n)class\s+([A-Za-z_]\w*)/g)) {
      symbols.push({ name: m[1], kind: 'class' })
      if (!m[1].startsWith('_')) exports.push(m[1])
    }
  } else if (lang === 'go') {
    for (const m of content.matchAll(/(?:^|\n)\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/g)) {
      symbols.push({ name: m[1], kind: 'function' })
      if (/^[A-Z]/.test(m[1])) exports.push(m[1]) // Go: capitalized = exported
    }
    for (const m of content.matchAll(/(?:^|\n)\s*type\s+([A-Za-z_]\w*)\s+struct/g)) {
      symbols.push({ name: m[1], kind: 'struct' })
      if (/^[A-Z]/.test(m[1])) exports.push(m[1])
    }
  } else if (lang === 'rs') {
    for (const m of content.matchAll(/(?:^|\n)\s*(pub\s+)?fn\s+([A-Za-z_]\w*)/g)) {
      symbols.push({ name: m[2], kind: 'function' })
      if (m[1]) exports.push(m[2])
    }
    for (const m of content.matchAll(/(?:^|\n)\s*(pub\s+)?struct\s+([A-Za-z_]\w*)/g)) {
      symbols.push({ name: m[2], kind: 'struct' })
      if (m[1]) exports.push(m[2])
    }
  }

  return {
    path: path.replace(/\\/g, '/'),
    lang,
    loc,
    exports: uniq(exports),
    imports: uniq(imports),
    symbols
  }
}
