import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ACCESS_CARDS } from '../../auth/accessGuide.ts'
import { PRIVILEGED_ROLES, ROLE_LABELS } from '../../auth/permissions.ts'
import { AccessGuide } from './AccessGuide.tsx'

describe('Who can do what', () => {
  it('has a card for every privileged role, then Head of a department, Member and Trial member', () => {
    expect(ACCESS_CARDS.map((card) => card.id)).toEqual([...PRIVILEGED_ROLES, 'head', 'member', 'trial'])
    for (const role of PRIVILEGED_ROLES) {
      expect(ACCESS_CARDS.find((card) => card.id === role)?.title).toBe(ROLE_LABELS[role])
    }
  })

  it('keeps every card short: a line to say who, and a handful of short permissions', () => {
    for (const card of ACCESS_CARDS) {
      expect(card.who.length).toBeGreaterThan(0)
      expect(card.can.length).toBeGreaterThan(0)
      expect(card.can.length).toBeLessThanOrEqual(7)
    }
  })

  it('shows each card with its permissions', () => {
    render(<AccessGuide />)
    for (const card of ACCESS_CARDS) {
      const el = screen.getByTestId(`access-${card.id}`)
      expect(within(el).getByRole('heading', { name: card.title })).toBeTruthy()
      for (const line of card.can) expect(within(el).getByText(line)).toBeTruthy()
    }
  })

  it('says that a Head is not a role, and what a trial member cannot do', () => {
    render(<AccessGuide />)
    expect(within(screen.getByTestId('access-head')).getByText(/Not a role/)).toBeTruthy()
    expect(within(screen.getByTestId('access-trial')).getByText('Hold a role or be a Head')).toBeTruthy()
  })
})
