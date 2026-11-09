import { test, expect } from '@playwright/test'
import { readManifest, runSql } from './setup/db.ts'
import { login } from './setup/login.ts'

// Phase 14: the Gantt's pointer drag and its keyboard alternatives, in a real
// browser against the real database. One fixture task (tagged, removed after)
// owned by the member, on the season's first submission with no section. It is
// driven by the Head of the task's department: since the gantt-fix change a plain
// member only views the Gantt (no drag handles, no Move to), even for own tasks.
//   * dragging the bar moves both dates and saves through the ordinary task
//     update — nothing is written while dragging;
//   * the task's own date fields do the same by keyboard;
//   * dragging the row onto a section of the same submission moves it there.
const PREFIX = '[E2E Phase14 gantt]'
const TITLE = `${PREFIX} drag me`
const iso = (d: Date) => d.toISOString().slice(0, 10)
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)

let taskId = ''
test.beforeEach(() => {
  const m = readManifest()
  const start = new Date()
  start.setUTCDate(start.getUTCDate() + 10)
  const due = new Date(start)
  due.setUTCDate(due.getUTCDate() + 8)
  taskId = runSql(
    `insert into tasks (season_id, title, state, owner_id, subteam_key, milestone_key, starts_on, due_date)
     values ('${m.season.id}', '${TITLE}', 'todo', '${m.users.member.id}', '${m.departments.headA.key}', '${m.milestoneKey}', '${iso(start)}', '${iso(due)}')
     returning id`,
  ).trim().split('\n')[0]
})
test.afterEach(() => {
  runSql(`delete from activity where entity = 'task' and entity_id in (select id::text from tasks where title like '${PREFIX}%')`)
  runSql(`delete from tasks where title like '${PREFIX}%'`)
})

const datesOf = (id: string) => runSql(`select starts_on, due_date, section_id from tasks where id = '${id}'`).trim().split('|')

test.describe('Gantt schedule and move (UI-06)', () => {
  test('dragging the deadline dot moves the deadline once, on release; the date fields do the same by keyboard', async ({ page }) => {
    const m = readManifest()
    const [start0, due0] = datesOf(taskId)
    await login(page, m.users.headA.email, m.password)
    await page.goto(`/gantt?open=${encodeURIComponent(m.milestoneKey)}&scale=month`)
    const group = page.getByTestId(`gantt-unsectioned-${m.milestoneKey}`)
    const toggle = group.getByRole('button', { name: /Unsectioned work/ })
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
    const row = page.getByTestId(`gantt-task-${taskId}`)
    await expect(row).toBeVisible()

    // ---- Pointer drag of the bar body ----
    // A pointer affordance for wide screens. On a phone the sticky label column
    // fills the width and the track scrolls under it, so the task's own date
    // fields below are the way (the same change, by touch or keyboard).
    let start1 = start0
    let due1 = due0
    if ((page.viewportSize()?.width ?? 1280) >= 768) {
      // A task with both dates is a bar: dragging its right end moves the deadline and leaves the start alone.
      const body = row.locator('[data-schedule-part="end"]')
      await body.scrollIntoViewIfNeeded()
      const box = (await body.boundingBox())!
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 8 })
      // Nothing is written while dragging.
      expect(datesOf(taskId).slice(0, 2)).toEqual([start0, due0])
      await page.mouse.up()
      await expect.poll(() => datesOf(taskId)[1], { timeout: 10_000 }).not.toBe(due0)
      ;[start1, due1] = datesOf(taskId)
      expect(start1).toBe(start0)
      expect(days(due0, due1)).toBeGreaterThan(0)
    }

    // ---- The keyboard alternative: the task's own fields ----
    await row.getByRole('button', { name: /Show details of/ }).click()
    const panel = page.getByTestId(`gantt-task-more-${taskId}`)
    const newDue = iso(new Date(Date.parse(due1) + 3 * 86_400_000))
    await panel.getByLabel('Deadline').fill(newDue)
    await panel.getByLabel('Deadline').press('Enter')
    await expect(page.getByTestId(`gantt-date-result-${taskId}`)).toContainText('Saved: deadline.')
    await expect.poll(() => datesOf(taskId)[1]).toBe(newDue)

    // A start after the deadline is refused before anything is sent.
    await panel.getByLabel('Start date').fill(iso(new Date(Date.parse(newDue) + 86_400_000)))
    await panel.getByRole('button', { name: 'Save dates' }).click()
    await expect(page.getByTestId(`gantt-date-result-${taskId}`)).toContainText('The start date must be on or before the deadline.')
    expect(datesOf(taskId)[1]).toBe(newDue)

    // A refresh shows what was saved.
    await page.reload()
    await expect(page.getByTestId(`gantt-task-more-${taskId}`).getByLabel('Deadline')).toHaveValue(newDue)
  })

  test('a task with both dates is drawn as a bar; dragging its body moves both dates, its left end only the start', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 1280) < 768, 'the pointer drag is for wide screens; a phone uses the date fields')
    const m = readManifest()
    const [start0, due0] = datesOf(taskId)
    await login(page, m.users.headA.email, m.password)
    await page.goto(`/gantt?open=${encodeURIComponent(m.milestoneKey)}&scale=month`)
    const group = page.getByTestId(`gantt-unsectioned-${m.milestoneKey}`)
    const toggle = group.getByRole('button', { name: /Unsectioned work/ })
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
    const row = page.getByTestId(`gantt-task-${taskId}`)
    await expect(row).toBeVisible()

    // Drawn as a span, not a dot, and the section group above it has its own summary bar.
    await expect(row.locator('[data-gantt-bar="task"]')).toHaveCount(1)
    await expect(group.locator('[data-gantt-bar="summary"]')).toHaveCount(1)

    const dragBy = async (part: string, dx: number) => {
      const handle = row.locator(`[data-schedule-part="${part}"]`)
      await handle.scrollIntoViewIfNeeded()
      const box = (await handle.boundingBox())!
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2, { steps: 8 })
      await page.mouse.up()
    }

    // The body moves both dates by the same number of days, so the length of the task is unchanged.
    await dragBy('move', 80)
    await expect.poll(() => datesOf(taskId)[0], { timeout: 10_000 }).not.toBe(start0)
    const [start1, due1] = datesOf(taskId)
    expect(days(start0, start1)).toBeGreaterThan(0)
    expect(days(due0, due1)).toBe(days(start0, start1))

    // The left end changes the start alone.
    await expect(row.locator('[data-gantt-bar="task"]')).toHaveCount(1)
    await dragBy('start', -40)
    await expect.poll(() => datesOf(taskId)[0], { timeout: 10_000 }).not.toBe(start1)
    const [start2, due2] = datesOf(taskId)
    expect(days(start2, start1)).toBeGreaterThan(0)
    expect(due2).toBe(due1)
  })

  test('the "Link an existing task" box keeps its select inside it and on screen, however long a task title is', async ({ page }) => {
    const m = readManifest()
    // A task nobody has linked yet, with a title near the 200-character limit: the select's width follows its longest option.
    runSql(
      `insert into tasks (season_id, title, state, owner_id, subteam_key)
       values ('${m.season.id}', '${PREFIX} ${'a very long task title that keeps going '.repeat(4)}', 'todo', '${m.users.member.id}', '${m.departments.headA.key}')`,
    )
    await login(page, m.users.headA.email, m.password)
    await page.goto(`/gantt?open=${encodeURIComponent(m.milestoneKey)}&sections=unsectioned:${encodeURIComponent(m.milestoneKey)}&scale=month`)
    const select = page.getByTestId(`gantt-unsectioned-${m.milestoneKey}`).getByLabel(/Link an existing board task to/)
    await expect(select).toBeVisible()
    const inner = (await select.boundingBox())!
    const box = (await select.locator('xpath=..').boundingBox())!
    const screen = page.viewportSize()!.width
    expect(inner.x + inner.width).toBeLessThanOrEqual(box.x + box.width + 0.5) // inside its dashed box
    expect(box.x + box.width).toBeLessThanOrEqual(screen + 0.5) // and the box inside the screen
  })

  test('"Open it in the Gantt" from a Board task lands on that task, with its group already open', async ({ page }) => {
    const m = readManifest()
    await login(page, m.users.headA.email, m.password)
    await page.goto(`/board?task=${taskId}`)
    await page.getByRole('link', { name: 'Open it in the Gantt' }).click()
    await expect(page).toHaveURL(/\/gantt\?/)
    await expect(page.getByTestId(`gantt-task-${taskId}`)).toBeVisible()
  })

  test('dragging the row onto a section of the same submission moves it there, as "Move to" does', async ({ page }) => {
    // A phone shows the list, which moves a row with "Move to"; dragging a row onto a section is for wide screens.
    test.skip((page.viewportSize()?.width ?? 1280) < 768, 'phones use the list and its Move to control')
    const m = readManifest()
    const [sectionId, sectionName] = runSql(`select id, name from milestone_sections where milestone_key = '${m.milestoneKey}' order by ordinal limit 1`).trim().split('|')
    await login(page, m.users.headA.email, m.password)
    await page.goto(`/gantt?open=${encodeURIComponent(m.milestoneKey)}`)
    const group = page.getByTestId(`gantt-unsectioned-${m.milestoneKey}`)
    const toggle = group.getByRole('button', { name: /Unsectioned work/ })
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
    const row = page.getByTestId(`gantt-task-${taskId}`)
    await expect(row).toBeVisible()
    const source = row.locator('[draggable="true"]').first()
    const target = page.getByTestId(`gantt-section-${sectionId}`).locator('[data-drop-target="true"]')
    await source.dragTo(target)
    await expect.poll(() => datesOf(taskId)[2], { timeout: 10_000 }).toBe(sectionId)
    await expect(page.getByTestId(`gantt-section-${sectionId}`)).toContainText(sectionName)
  })
})
