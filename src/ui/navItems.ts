import { attachmentsEnabled } from '../attachments/flag.ts'

// The screens people use week to week, grouped by how they use them: Now first; daily work; planning; the
// competition rules; Contacts and Finances; Settings last. The occasional pages (Files, Contributions) are in
// MORE_PAGES instead and are opened from Settings. This is the only place the main navigation is defined — add a
// screen here and it appears in the header on desktop and in the Menu on a
// phone.
//
// `requires` leaves a screen out of the menu for people who could see nothing
// on it. It is not security — the database decides what anyone may read — it
// just avoids a menu item that always leads to "nothing to show you here".
// `group` only draws a thin divider between neighbours that differ on a wide screen; it never hides anything.
export type NavGroup = 'home' | 'work' | 'plan' | 'rules' | 'records' | 'admin'
export type NavItem = { to: string; label: string; group: NavGroup; end?: boolean; requires?: 'canViewFinances' | 'attachmentsEnabled' }

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Now', group: 'home', end: true },
  { to: '/board', label: 'Board', group: 'work' },
  { to: '/tasks', label: 'Tasks', group: 'work' },
  { to: '/meetings', label: 'Meetings', group: 'work' },
  { to: '/tools', label: 'Tools', group: 'work' },
  { to: '/milestones', label: 'Milestones', group: 'plan' },
  { to: '/gantt', label: 'Gantt', group: 'plan' },
  { to: '/register', label: 'Register', group: 'rules' },
  { to: '/book', label: 'Book', group: 'rules' },
  { to: '/specs', label: 'Spec sheet', group: 'rules' },
  { to: '/contacts', label: 'Contacts', group: 'records' },
  { to: '/finances', label: 'Finances', group: 'admin', requires: 'canViewFinances' },
  { to: '/settings', label: 'Settings', group: 'admin' },
]

// Pages that are not part of the weekly routine. Same routes as ever (links and the tutorial still work); they are
// listed in Settings, under "More pages", instead of in the header.
export const MORE_PAGES: { to: string; label: string; about: string; requires?: NavItem['requires'] }[] = [
  { to: '/files', label: 'Files', about: 'Everything attached to a task', requires: 'attachmentsEnabled' },
  { to: '/contributions', label: 'Contributions', about: 'What each member finished' },
]

// Leaves out what would show this person nothing (a shared rule for the header and Settings).
export function isOffered(item: { requires?: NavItem['requires'] }, can: { canViewFinances: boolean }): boolean {
  return !item.requires || (item.requires === 'attachmentsEnabled' ? attachmentsEnabled() : can[item.requires])
}
