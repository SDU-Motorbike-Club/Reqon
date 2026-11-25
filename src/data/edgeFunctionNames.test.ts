import { describe, expect, it } from 'vitest'

// The browser reaches an Edge Function by a string name, which TypeScript cannot check (RPC and table names it can,
// through database.types.ts). A typo, a rename or a function that was never added only shows up as "Could not reach
// the server" in front of a member. This ties every name the app invokes to a real supabase/functions/<name>/.

// `?raw` only reads the files as text; nothing under supabase/functions is executed (it is Deno code).
const sources = import.meta.glob(['/src/**/*.ts', '/src/**/*.tsx', '!/src/**/*.test.*'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const functionDirs = Object.keys(import.meta.glob('/supabase/functions/*/index.ts', { query: '?raw', import: 'default' })).map(
  (path) => path.split('/')[3],
)

// Called by the ops scripts and the scheduler with a shared secret, never by the browser.
const SERVER_ONLY = ['attachment-purge', 'backup-record']

// invoke('name', ...) / invokeEdgeFunction<T>('name', ...), including a generic written across lines.
const CALL = /\binvoke(?:EdgeFunction)?(?:<[\s\S]*?>)?\(\s*'([a-z0-9-]+)'/g

const invoked = new Set<string>()
for (const text of Object.values(sources)) for (const match of text.matchAll(CALL)) invoked.add(match[1])

describe('Edge Function names', () => {
  it('finds the calls (guards this test against going vacuous if the call style changes)', () => {
    expect(invoked.size).toBeGreaterThanOrEqual(9)
    expect(functionDirs.length).toBeGreaterThanOrEqual(10)
  })

  it('every function the app invokes exists in supabase/functions', () => {
    expect([...invoked].filter((name) => !functionDirs.includes(name)).sort()).toEqual([])
  })

  it('every function is either invoked by the app or declared server-only', () => {
    expect(functionDirs.filter((name) => !invoked.has(name) && !SERVER_ONLY.includes(name)).sort()).toEqual([])
  })

  it('a function listed as server-only really is not invoked by the browser', () => {
    expect(SERVER_ONLY.filter((name) => invoked.has(name))).toEqual([])
  })
})
