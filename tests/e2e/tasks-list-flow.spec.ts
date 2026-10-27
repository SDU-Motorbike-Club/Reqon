import { test, expect } from '@playwright/test'
import { readManifest, runSql } from './setup/db.ts'
import { login } from './setup/login.ts'

// The Tasks page's queries against the real PostgREST (sort, search and paging over every row) and New task from the Board.
const PREFIX = '[E2E tasklist]'
test.afterEach(() => {
  runSql(`delete from activity where entity = 'task' and entity_id in (select id::text from tasks where title like '${PREFIX}%')`)
  runSql(`delete from tasks where title like '${PREFIX}%'`)
})

test('the Tasks page sorts, searches and pages over every row', async ({ page }) => {
  const m = readManifest()
  for (let i = 1; i <= 30; i++) {
    runSql(`insert into tasks (season_id, title, state, owner_id, milestone_key, starts_on, due_date, subteam_key)
            values ('${m.season.id}', '${PREFIX} ${String(i).padStart(2, '0')} ${i % 2 ? 'odd' : 'even'}', 'todo', '${m.users.member.id}', '${m.milestoneKey}', current_date, current_date + ${40 - i}, '${m.departments.headA.key}')`)
  }
  await login(page, m.users.member.email, m.password)
  await page.goto('/tasks?q=%5BE2E%20tasklist%5D')
  await expect(page.getByTestId('tasks-summary')).toContainText('of 30 tasks', { timeout: 15_000 })
  // Default: soonest deadline first = highest number first (deadline = today + 40 - i).
  const titles = () => page.locator('[data-testid^="task-row-"] a').allInnerTexts()
  expect((await titles())[0]).toContain('30 even')
  // Sort by task name ascending, then flip.
  await page.getByTestId('sort-title').click()
  await expect(page).toHaveURL(/sort=title&dir=asc/)
  await expect.poll(async () => (await titles())[0]).toContain('01 odd')
  await page.getByTestId('sort-title').click()
  await expect.poll(async () => (await titles())[0]).toContain('30 even')
  // Page 2 continues the order of page 1.
  await page.getByRole('button', { name: /Next/ }).click()
  await expect(page).toHaveURL(/page=2/)
  await expect(page.getByTestId('tasks-summary')).toContainText('Showing 26–30 of 30')
  await expect.poll(async () => (await titles())[0]).toContain('05')
  // Search words from the title narrow the whole list, the sort stays.
  await page.getByLabel('Search tasks').fill('[E2E tasklist] odd')
  await expect(page.getByTestId('tasks-summary')).toContainText('of 15 tasks')
  await expect(page).toHaveURL(/sort=title&dir=desc/)
  // Sorting by department / owner / milestone names works server-side too.
  for (const column of ['department', 'owner', 'milestone', 'state', 'priority', 'due']) {
    await page.getByTestId(`sort-${column}`).click()
    await expect(page.getByTestId('tasks-summary')).toContainText('of 15 tasks')
  }
})

test('a Head creates a task from the Board; a plain member is not offered it', async ({ page }) => {
  const m = readManifest()
  await login(page, m.users.vicepresident.email, m.password)
  await page.goto('/board')
  await page.getByTestId('board-new-task').click()
  const form = page.getByTestId('new-task-form')
  await form.getByLabel('Title').fill(`${PREFIX} made on the board`)
  await form.getByLabel('Deadline').fill('2099-01-01')
  await form.getByLabel('Milestone').selectOption(m.milestoneKey)
  await form.getByLabel('Department').selectOption({ label: m.departments.headA.name })
  await form.getByLabel('Find a requirement').fill('1')
  await form.getByRole('checkbox').first().check()
  await form.getByTestId('new-task-submit').click()
  await expect(page.getByTestId('board-task-created')).toContainText('made on the board')
  expect(runSql(`select count(*) from tasks where title = '${PREFIX} made on the board' and links_required and source_proposal is null`).trim()).toBe('1')

  await login(page, m.users.member.email, m.password)
  await page.goto('/board')
  await expect(page.getByTestId('board-new-task')).toHaveCount(0)
})
