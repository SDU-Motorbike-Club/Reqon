import { test, expect } from '@playwright/test'
import { readManifest, runSql } from './setup/db.ts'
import { login } from './setup/login.ts'

// The leadership announces something to the whole club from the Inbox. Every member finds it there under its own
// "Announcement" label, and all of them can read the list of previous announcements. Rows made here are tagged and
// removed after each test (which also resets the per-hour sending limit).
const TAG = '[E2E announcement]'

test.afterEach(() => {
  runSql(`delete from notifications where kind = 'announcement' and body like '${TAG}%'`)
  runSql(`delete from announcements where body like '${TAG}%'`)
})

test.describe('announcements', () => {
  test('the Vice President announces; a member sees it labelled in the inbox and in the history', async ({ page }) => {
    const m = readManifest()
    const title = `${TAG} Workshop closed`
    const body = `${TAG} back on Monday`

    await login(page, m.users.vicepresident.email, m.password)
    await page.goto('/inbox')
    await page.getByRole('button', { name: 'New announcement' }).click()
    const compose = page.getByTestId('announce-dialog')
    await compose.getByLabel('Title').fill(title)
    await compose.getByLabel('Description').fill(body)
    await compose.getByRole('button', { name: /^Send to all \d+ members?$/ }).click()
    await expect(compose.getByRole('status')).toContainText(/It reached \d+ members?/)
    await compose.getByRole('button', { name: 'Close' }).click()

    expect(runSql(`select count(*) from announcements where title = '${title}' and body = '${body}' and author_id = '${m.users.vicepresident.id}'`).trim()).toBe('1')
    expect(runSql(`select count(*) from notifications where kind = 'announcement' and body = '${body}' and member_id = '${m.users.member.id}'`).trim()).toBe('1')
    // The sender does not announce to themselves.
    expect(runSql(`select count(*) from notifications where kind = 'announcement' and body = '${body}' and member_id = '${m.users.vicepresident.id}'`).trim()).toBe('0')

    await login(page, m.users.member.email, m.password)
    await page.goto('/inbox')
    const item = page.locator('[data-testid^="notification-"]', { hasText: body })
    await expect(item).toBeVisible()
    await expect(item.getByText('Announcement', { exact: true })).toBeVisible()
    await expect(item.getByText(title, { exact: true })).toBeVisible()
    // A plain member reads the history but cannot write an announcement.
    await expect(page.getByRole('button', { name: 'New announcement' })).toHaveCount(0)
    await item.click()
    const history = page.getByTestId('announce-history')
    await expect(history).toBeVisible()
    await expect(history).toContainText(title)
    await expect(history).toContainText(body)
    await history.getByRole('button', { name: 'Close' }).click()
    await expect(history).toHaveCount(0)
  })

  test('a member can open the previous announcements but is not offered a way to send one', async ({ page }) => {
    const m = readManifest()
    await login(page, m.users.member.email, m.password)
    await page.goto('/inbox')
    await expect(page.getByRole('button', { name: 'New announcement' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Previous announcements' }).click()
    await expect(page.getByTestId('announce-history')).toBeVisible()
  })
})
