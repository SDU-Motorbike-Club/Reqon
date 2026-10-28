/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Read as a file, not imported: the test runner turns a stylesheet import into nothing, and this test is about its text.
const CSS = readFileSync('src/index.css', 'utf8') // tests run from the project root

// The theme is made in one place (src/index.css, the @theme block), so it is also checked in one place: every
// pairing the UI draws is read straight from that file and measured, and a change to a colour that would make
// something unreadable fails here, not in somebody's browser.

// Every source file of the app (not the tests, not the generated database types), as text.
const SOURCES = import.meta.glob(['../**/*.{ts,tsx}', '!../**/*.test.*', '!../lib/database.types.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const tokens = new Map([...CSS.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2]]))
const hex = (name: string): string => (name === 'white' ? '#ffffff' : (tokens.get(name) as string))

function luminance(color: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(hex(a)), luminance(hex(b))].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('the theme', () => {
  it('is dark only, with a page that is dark grey and not black', () => {
    expect(CSS).toMatch(/color-scheme:\s*dark/)
    expect(CSS).not.toMatch(/color-scheme:\s*light/)
    expect(CSS).not.toMatch(/prefers-color-scheme:\s*light/)
    for (const name of ['page', 'surface']) {
      const color = hex(name)
      expect(color).not.toBe('#000000')
      expect(luminance(color)).toBeLessThan(0.02)
      expect(luminance(color)).toBeGreaterThan(0.005)
    }
  })

  it('keeps the greys in order, dark to light, so every class still means what it said', () => {
    const steps = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'].map((s) => luminance(hex(`slate-${s}`)))
    expect([...steps].sort((a, b) => a - b)).toEqual(steps)
    expect(luminance(hex('page'))).toBeLessThan(luminance(hex('surface')))
    expect(luminance(hex('surface'))).toBeLessThan(luminance(hex('slate-50')))
  })

  it('accents in red', () => {
    for (const name of ['accent', 'accent-hover', 'accent-ring', 'danger']) {
      const c = hex(name)
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))
      expect(r, name).toBeGreaterThan(g * 2)
      expect(r, name).toBeGreaterThan(b * 2)
    }
  })

  describe('text is readable (4.5:1) wherever the UI puts it', () => {
    for (const fg of ['slate-900', 'slate-800', 'slate-700', 'slate-600', 'slate-500']) {
      for (const bg of ['page', 'surface', 'slate-50', 'slate-100', 'slate-200']) {
        it(`${fg} on ${bg}`, () => expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5))
      }
    }
    for (const hue of ['red', 'amber', 'emerald', 'green', 'sky', 'blue']) {
      for (const fg of ['700', '800', '900', '950']) {
        for (const bg of ['50', '100']) {
          it(`${hue}-${fg} on ${hue}-${bg}`, () => expect(contrast(`${hue}-${fg}`, `${hue}-${bg}`)).toBeGreaterThanOrEqual(4.5))
        }
      }
      it(`${hue}-600 on ${hue}-50`, () => expect(contrast(`${hue}-600`, `${hue}-50`)).toBeGreaterThanOrEqual(4.5))
      it(`${hue}-700 on the page`, () => expect(contrast(`${hue}-700`, 'page')).toBeGreaterThanOrEqual(4.5))
    }
    for (const solid of ['accent', 'accent-hover', 'danger', 'danger-hover', 'ok', 'info']) {
      it(`white on ${solid}`, () => expect(contrast('white', solid)).toBeGreaterThanOrEqual(4.5))
    }
  })

  describe('what is not text can still be seen', () => {
    it('the focus ring (3:1) on the page, a card and a hovered row', () => {
      for (const bg of ['page', 'surface', 'slate-100']) expect(contrast('accent-ring', bg)).toBeGreaterThanOrEqual(3)
    })
    it('placeholder and disabled text (3:1)', () => {
      expect(contrast('slate-400', 'surface')).toBeGreaterThanOrEqual(3)
      expect(contrast('slate-400', 'slate-100')).toBeGreaterThanOrEqual(3)
    })
    it('an input border is visible (2:1) and a divider is there (1.3:1)', () => {
      expect(contrast('slate-300', 'surface')).toBeGreaterThanOrEqual(2)
      expect(contrast('slate-200', 'surface')).toBeGreaterThanOrEqual(1.3)
    })
  })

  it('defines every named colour the code uses, so a typo cannot silently draw nothing', () => {
    const used = new Set<string>()
    for (const text of Object.values(SOURCES)) {
      for (const m of text.matchAll(/(?<![\w/-])(?:[a-z0-9[\]_-]+:)*(?:bg|text|border|ring|outline|fill|stroke)-(page|surface|accent-hover|accent-ring|accent|danger-hover|danger|ok|info)(?![\w-])/g)) {
        used.add(m[1])
      }
    }
    expect(used.size).toBeGreaterThan(0)
    for (const name of used) expect(tokens.has(name), `--color-${name} is used but not defined`).toBe(true)
  })

  it('has no leftover white card or dark button in the code that the theme cannot flip', () => {
    // bg-white would stay white on a dark page; bg-slate-900 with white text would turn light-on-light.
    const offenders: string[] = []
    for (const [path, text] of Object.entries(SOURCES)) {
      if (/(?<![\w/-])(?:[a-z0-9[\]_-]+:)*bg-white(?![\w-])/.test(text)) offenders.push(`${path}: bg-white`)
      if (/(?<![\w/-])(?:[a-z0-9[\]_-]+:)*bg-slate-(?:800|900)(?![\w/-])/.test(text)) offenders.push(`${path}: bg-slate-800/900`)
    }
    expect(Object.keys(SOURCES).length).toBeGreaterThan(100)
    expect(offenders).toEqual([])
  })
})
