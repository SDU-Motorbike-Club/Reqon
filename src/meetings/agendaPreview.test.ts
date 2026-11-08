import { describe, expect, it } from 'vitest'
import { agendaItems } from './agendaPreview.ts'

describe('agendaItems', () => {
  it('skips headings and strips bullets and marks', () => {
    expect(agendaItems('## Agenda\n\n- **Frame** status\n- Tyres\n1. Budget')).toEqual(['Frame status', 'Tyres', 'Budget'])
  })

  it('is empty for an empty agenda or the untouched template', () => {
    expect(agendaItems('')).toEqual([])
    expect(agendaItems('## Agenda\n\n- ')).toEqual([])
  })
})
