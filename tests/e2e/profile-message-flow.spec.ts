import { test, expect } from '@playwright/test'
import { readManifest, runSql } from './setup/db.ts'
import { login } from './setup/login.ts'

// A member opens a colleague's profile (?profile=<id>, the address every member name links to), sees the
// colleague's login email, sends a message, and the colleague finds it in their inbox. Nothing is written
// to the club-wide activity trail. Messages made here are tagged and removed after each test.
const TAG = '[E2E profile message]'

test.afterEach(() => {
  runSql(`delete from notifications where kind = 'message' and body like '${TAG}%'`)
})

test.describe('profile and messages', () => {
  test('a member reads a colleague’s login email and messages them; it lands in their inbox', async ({ page }) => {
    const m = readManifest()
    const body = `${TAG} can you cover Friday?`
    const activityBefore = runSql('select count(*) from activity').trim()

    await login(page, m.users.member.email, m.password)
    await page.goto(`/?profile=${m.users.headB.id}`)
    const profile = page.getByTestId('profile-dialog')
    await expect(profile).toBeVisible()
    // The email is the one they sign in with, shown as a mail link; there is no phone line.
    await expect(profile.getByRole('link', { name: m.users.headB.email })).toHaveAttribute('href', `mailto:${m.users.headB.email}`)
    await expect(profile.getByText(/phone/i)).toHaveCount(0)

    await profile.getByLabel(/^Message to /).fill(body)
    await profile.getByRole('button', { name: 'Send message' }).click()
    await expect(profile.getByRole('status')).toContainText('Message sent')
    expect(
      runSql(`select count(*) from notifications where member_id = '${m.users.headB.id}' and actor_id = '${m.users.member.id}' and kind = 'message' and body = '${body}'`).trim(),
    ).toBe('1')
    expect(runSql('select count(*) from activity').trim()).toBe(activityBefore)

    // The colleague sees it, in full, and opening it shows the sender's profile.
    await login(page, m.users.headB.email, m.password)
    await page.goto('/inbox')
    const item = page.locator('[data-testid^="notification-"]', { hasText: body })
    await expect(item).toBeVisible()
    await item.click()
    await expect(page.getByTestId('profile-dialog')).toBeVisible()
    await expect(page.getByTestId('profile-dialog').getByRole('link', { name: m.users.member.email })).toBeVisible()
  })

  test('a retired member’s profile has no message box', async ({ page }) => {
    const m = readManifest()
    await login(page, m.users.member.email, m.password)
    await page.goto(`/?profile=${m.users.alumni.id}`)
    const profile = page.getByTestId('profile-dialog')
    await expect(profile).toBeVisible()
    await expect(profile.getByTestId('profile-no-message')).toContainText('Retired members cannot receive messages.')
    await expect(profile.getByRole('button', { name: 'Send message' })).toHaveCount(0)
  })
})
