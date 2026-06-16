// Unit tests for the pure repo-map cores absorbed from Understand-Anything:
// static parse + importance ranking + compact rendering. No DOM/Electron/SDK.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseFile, detectLang } from '../src/main/repomap/parse'
import { rankFiles, buildRepoMap } from '../src/main/repomap/build'

// ── parse.ts ─────────────────────────────────────────────────────────────────
test('detectLang: by extension', () => {
  assert.equal(detectLang('a.ts'), 'ts')
  assert.equal(detectLang('a.tsx'), 'tsx')
  assert.equal(detectLang('a.py'), 'py')
  assert.equal(detectLang('a.unknown'), 'other')
})

test('parseFile: TS imports, exports, symbols', () => {
  const src = [
    "import { foo } from './foo'",
    "import bar from '../bar'",
    'export function doThing() {}',
    'export class Widget {}',
    'const helper = 1',
    'export type T = string'
  ].join('\n')
  const f = parseFile('src/app.ts', src)
  assert.deepEqual(f.imports, ['./foo', '../bar'])
  assert.ok(f.exports.includes('doThing'))
  assert.ok(f.exports.includes('Widget'))
  assert.ok(f.exports.includes('T'))
  assert.ok(f.symbols.some((s) => s.name === 'helper' && s.kind === 'const'))
  assert.equal(f.lang, 'ts')
})

test('parseFile: export { a, b as c } and default', () => {
  const f = parseFile('x.ts', 'export { a, b as c }\nexport default function main() {}')
  assert.ok(f.exports.includes('a'))
  assert.ok(f.exports.includes('c'))
  assert.ok(f.exports.includes('default'))
})

test('parseFile: Python def/class, private excluded from exports', () => {
  const f = parseFile('m.py', 'import os\nfrom pkg.sub import thing\ndef run():\n  pass\ndef _hidden():\n  pass\nclass Big:\n  pass')
  assert.ok(f.imports.includes('os'))
  assert.ok(f.imports.includes('pkg.sub'))
  assert.ok(f.exports.includes('run'))
  assert.ok(!f.exports.includes('_hidden'))
  assert.ok(f.exports.includes('Big'))
})

test('parseFile: never throws, forward-slashes paths', () => {
  const f = parseFile('a\\b\\c.ts', '')
  assert.equal(f.path, 'a/b/c.ts')
  assert.equal(f.loc, 0)
})

// ── build.ts ─────────────────────────────────────────────────────────────────
test('rankFiles: most-imported ranks first', () => {
  const files = [
    parseFile('src/util.ts', 'export function u() {}'),
    parseFile('src/a.ts', "import { u } from './util'\nexport function a() {}"),
    parseFile('src/b.ts', "import { u } from './util'\nexport function b() {}")
  ]
  const ranked = rankFiles(files)
  assert.equal(ranked[0].path, 'src/util.ts')
})

test('buildRepoMap: compact map with exports and symbols', () => {
  const files = [parseFile('src/app.ts', 'export function go() {}\nexport class C {}')]
  const map = buildRepoMap(files)
  assert.match(map, /src\/app\.ts \(ts, \d+ loc\)/)
  assert.match(map, /exports: go, C/)
})

test('buildRepoMap: empty → empty string', () => {
  assert.equal(buildRepoMap([]), '')
})

test('buildRepoMap: caps file count with a +N marker', () => {
  const files = Array.from({ length: 70 }, (_, i) => parseFile(`src/f${i}.ts`, 'export const x = 1'))
  const map = buildRepoMap(files, { maxFiles: 10 })
  assert.match(map, /\+60 more files/)
})
