import { describe, expect, it } from 'vitest'
import { searchTasks } from './taskSearch.ts'

const names: Record<string, string> = { ELEC: 'Electronics', BODY: 'Bodywork' }
const dept = (key: string | null) => (key ? (names[key] ?? key) : 'No department')
const t = (title: string, subteam_key: string | null) => ({ title, subteam_key })
const tasks = [t('Wiring harness', 'ELEC'), t('Harness clips', 'BODY'), t('Fairing mould', 'BODY'), t('Battery box', 'ELEC'), t('Lost task', null)]

describe('searchTasks', () => {
  it('lists the first few by title when nothing is typed', () => {
    const { matches, total } = searchTasks(tasks, '', dept, 3)
    expect(matches.map((m) => m.title)).toEqual(['Battery box', 'Fairing mould', 'Harness clips'])
    expect(total).toBe(5)
  })

  it('needs every word, in any order and any case, across title and department', () => {
    expect(searchTasks(tasks, 'ELEC harness', dept).matches.map((m) => m.title)).toEqual(['Wiring harness'])
    expect(searchTasks(tasks, 'harness', dept).total).toBe(2)
  })

  it('puts a title that starts with the first word before one that only contains it', () => {
    expect(searchTasks(tasks, 'harness', dept).matches.map((m) => m.title)).toEqual(['Harness clips', 'Wiring harness'])
  })

  it('finds a task with no department by that phrase, and says how many more there are', () => {
    expect(searchTasks(tasks, 'no department', dept).matches.map((m) => m.title)).toEqual(['Lost task'])
    expect(searchTasks(tasks, '', dept, 2)).toMatchObject({ total: 5 })
  })

  it('finds nothing for words that match nothing', () => {
    expect(searchTasks(tasks, 'zzz', dept)).toEqual({ matches: [], total: 0 })
  })
})
