import { describe, expect, it } from 'vitest'
import { coverProblem, isUpcoming, orderApplications, orderEvents, orderPosts, readAnswers, slugify, type Application, type BlogPost, type ClubEvent } from './usePublicSite.ts'

describe('public site helpers', () => {
  it('reads answers stored by submit_application() and by a plain {question: answer} form', () => {
    expect(readAnswers([{ question: 'Why join?', answer: 'Bikes' }, { question: 'Year?', answer: null }, 'junk'])).toEqual([
      { question: 'Why join?', answer: 'Bikes' },
      { question: 'Year?', answer: null },
    ])
    expect(readAnswers({ 'Why join?': 'Bikes', Age: 21 })).toEqual([
      { question: 'Why join?', answer: 'Bikes' },
      { question: 'Age', answer: '21' },
    ])
    expect(readAnswers(null)).toEqual([])
  })

  it('makes a web address from a title', () => {
    expect(slugify('  Our first Track Day!  ')).toBe('our-first-track-day')
    expect(slugify('Ősz a pályán')).toBe('osz-a-palyan')
  })

  it('accepts only images the website bucket takes', () => {
    expect(coverProblem(new File(['x'], 'a.png', { type: 'image/png' }))).toBeNull()
    expect(coverProblem(new File(['x'], 'a.pdf', { type: 'application/pdf' }))).toMatch(/JPEG/)
    expect(coverProblem(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.jpg', { type: 'image/jpeg' }))).toMatch(/10 MB/)
  })

  it('orders applications and posts, newest first on ties', () => {
    const app = (full_name: string, status: Application['status'], created_at: string) => ({ full_name, status, created_at }) as Application
    const apps = [app('Bea', 'accepted', '2026-01-02'), app('Ann', 'new', '2026-01-01'), app('Cid', 'new', '2026-01-03')]
    const names = (sort: Parameters<typeof orderApplications>[1]) => orderApplications(apps, sort).map((a) => a.full_name)
    expect(names('newest')).toEqual(['Cid', 'Bea', 'Ann'])
    expect(names('oldest')).toEqual(['Ann', 'Bea', 'Cid'])
    expect(names('name')).toEqual(['Ann', 'Bea', 'Cid'])
    expect(names('status')).toEqual(['Cid', 'Ann', 'Bea'])

    const post = (title: string, category: BlogPost['category'], published_at: string | null, updated_at: string) =>
      ({ title, category, published_at, updated_at, status: published_at ? 'published' : 'draft' }) as BlogPost
    const posts = [post('Old', 'tech', '2026-01-01', '2026-01-01'), post('Draft', 'ride', null, '2025-12-01'), post('New', 'news', '2026-02-01', '2026-02-01')]
    const titles = (sort: Parameters<typeof orderPosts>[1]) => orderPosts(posts, sort).map((p) => p.title)
    expect(titles('drafts')).toEqual(['Draft', 'New', 'Old'])
    expect(titles('newest')).toEqual(['New', 'Old', 'Draft'])
    expect(titles('oldest')).toEqual(['Draft', 'Old', 'New'])
    expect(titles('title')).toEqual(['Draft', 'New', 'Old'])
    expect(titles('category')).toEqual(['New', 'Draft', 'Old'])
  })

  it('orders events and counts today as upcoming, as the website does', () => {
    const ev = (title: string, starts_at: string) => ({ title, starts_at }) as ClubEvent
    const events = [ev('B', '2026-03-01T10:00:00Z'), ev('A', '2026-04-01T10:00:00Z'), ev('C', '2026-02-01T10:00:00Z')]
    expect(orderEvents(events, 'soonest').map((e) => e.title)).toEqual(['C', 'B', 'A'])
    expect(orderEvents(events, 'latest').map((e) => e.title)).toEqual(['A', 'B', 'C'])
    expect(orderEvents(events, 'title').map((e) => e.title)).toEqual(['A', 'B', 'C'])

    const now = new Date(2026, 2, 10, 15, 0)
    expect(isUpcoming(ev('morning', new Date(2026, 2, 10, 8, 0).toISOString()), now)).toBe(true)
    expect(isUpcoming(ev('yesterday', new Date(2026, 2, 9, 23, 0).toISOString()), now)).toBe(false)
  })
})
