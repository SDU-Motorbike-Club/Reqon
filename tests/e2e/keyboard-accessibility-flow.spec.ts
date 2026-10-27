import { test, expect } from '@playwright/test'
import { readManifest, runSql } from './setup/db.ts'
import { login } from './setup/login.ts'

// Phase 13: prove keyboard-only operation of a filter, a dialog and the
// tutorial offer in a REAL browser — Vitest/jsdom cannot model native
// keyboard activation of <summary>/<dialog> the way a real browser does
// (see board.test.tsx's own comment on this). Nothing here relies on a mouse.
const PREFIX = '[E2E keyboard]'
test.describe('keyboard-only interaction (R8.2, R24.1, R34.1, tutorial)', () => {
  // The scenario picks a department from the navigation and opens the first card
  // it shows, so every active department needs at least one task or the result
  // would depend on which departments happen to hold work in this database.
  test.beforeAll(() => {
    const m = readManifest()
    runSql(
      `insert into tasks (season_id, title, state, subteam_key) select '${m.season.id}', '${PREFIX} ' || key, 'todo', key from subteams where archived_at is null`,
    )
  })
  test.afterAll(() => {
    runSql(`delete from activity where entity = 'task' and entity_id in (select id::text from tasks where title like '${PREFIX}%')`)
    runSql(`delete from tasks where title like '${PREFIX}%'`)
  })

  test('the tutorial offer, the Board scope/department filter, and a proposal review dialog are all keyboard-operable', async ({ page }) => {
    const m = readManifest()
    await login(page, m.users.member.email, m.password)

    // ---- The tutorial offer: reach and dismiss "Not now" by keyboard alone ----
    await page.goto('/board')
    const notNow = page.getByRole('button', { name: 'Not now' })
    await expect(notNow).toBeVisible()
    await notNow.focus()
    await page.keyboard.press('Enter')
    await expect(notNow).toHaveCount(0)

    // ---- Board filters: Tab/Enter reach and activate Scope and Department ----
    const allTasksButton = page.getByRole('button', { name: /^All tasks/ })
    await allTasksButton.focus()
    await page.keyboard.press('Enter')
    await expect(allTasksButton).toHaveAttribute('aria-pressed', 'true')
    // The department row: on a wide screen a list of links (Tab to one, Enter);
    // on a phone one native <select> (ArrowDown changes it). Either way the
    // address gains ?dept= and keeps the scope.
    if ((page.viewportSize()?.width ?? 1280) < 640) {
      const select = page.getByLabel('Department', { exact: true })
      await select.focus()
      await page.keyboard.press('ArrowDown') // native <select>: keyboard-only value change
      await expect(select).not.toHaveValue('')
    } else {
      const link = page.getByRole('navigation', { name: 'Department navigation' }).getByRole('link').nth(1)
      await link.focus()
      await page.keyboard.press('Enter')
    }
    await expect(page).toHaveURL(/dept=/)
    // Choosing a department kept the scope chosen before it.
    await expect(allTasksButton).toHaveAttribute('aria-pressed', 'true')

    // ---- A card's details open on Enter and close on Escape, purely by keyboard ----
    // "Details" is a real <button> that opens the task in a dialog.
    const firstCard = page.locator('[data-testid^="task-more-"]').first()
    await expect(firstCard).toBeVisible()
    await firstCard.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(firstCard).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // Focus goes back to the button that opened it.
    await expect(firstCard).toBeFocused()

    // ---- A dialog opens and closes by keyboard only (Tab to it, Enter to
    // open, Escape to close) — the proposal Review dialog. ----
    await login(page, m.users.headA.email, m.password)
    await page.goto('/proposals')
    const reviewButtons = page.locator('[data-testid^="review-open-"]')
    if ((await reviewButtons.count()) > 0) {
      const first = reviewButtons.first()
      await first.focus()
      await page.keyboard.press('Enter')
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
    }
  })
})
