import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { PublicFooter } from './PublicFooter.tsx'

describe('PublicFooter', () => {
  it('names the club and links to the privacy policy', () => {
    render(<MemoryRouter><PublicFooter /></MemoryRouter>)
    expect(screen.getByRole('contentinfo')).toHaveTextContent('Reqon · SDU Motorbike Club')
    expect(screen.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute('href', '/privacy')
  })

  // jsdom has no layout, so the class is the only thing a unit test can see. The real pinning (a short page
  // ends with the footer at the bottom of the window) needs #root to be a flex column; see src/index.css.
  it('asks to be pushed to the bottom of a short page', () => {
    render(<MemoryRouter><PublicFooter /></MemoryRouter>)
    expect(screen.getByRole('contentinfo')).toHaveClass('mt-auto')
  })
})
