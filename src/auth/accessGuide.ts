import { PRIVILEGED_ROLES, ROLE_LABELS, type PrivilegedRole } from './permissions.ts'

// What each kind of access allows, in short lines, for Settings → "Who can do what".
// Written from the rules in permissions.ts and the migrations it mirrors; when a rule
// changes there, change the line here. Words only: nothing in the app reads this to
// decide access.
export type AccessCard = {
  id: string
  title: string
  // One line that says who this is.
  who: string
  can: readonly string[]
  // What it deliberately cannot do, where that is the point of the access.
  cannot?: readonly string[]
}

const ROLE_CARDS: Record<PrivilegedRole, Omit<AccessCard, 'id' | 'title'>> = {
  president: {
    who: 'Runs the club.',
    can: [
      'Everything a Head can do, in every department',
      'Roster, departments, milestones, rulebook, weekly meeting',
      'Add members and reset their passwords',
      'Give and take away roles, except Developer',
      'Create and switch seasons',
      'Club accounts, and delete records',
      'See finances',
    ],
    cannot: ['Change finances'],
  },
  vicepresident: {
    who: 'Runs the club with the President.',
    can: [
      'Everything a Head can do, in every department',
      'Roster, departments, milestones, rulebook, weekly meeting',
      'Add members and reset their passwords',
      'Give and take away Treasurer and Documentation',
      'See finances',
    ],
    cannot: ['Switch seasons', 'See club accounts', 'Change finances', 'Give the President or Vice President role'],
  },
  treasurer: {
    who: 'Keeps the money.',
    can: ['See finances', 'Add, edit and delete financial entries'],
    cannot: ['Roster, departments or roles'],
  },
  documentation: {
    who: 'Keeps the record.',
    can: ['Call meetings; write agenda and minutes; tick who came', 'Edit the default agenda', 'Create, rename and delete milestone sections'],
    cannot: ['See finances'],
  },
  developer: {
    who: 'Maintains the app.',
    can: ['Everything every other role can do, roles included', 'The only one who can give or take the Developer role'],
  },
}

export const ACCESS_CARDS: readonly AccessCard[] = [
  ...PRIVILEGED_ROLES.map((role) => ({ id: role, title: ROLE_LABELS[role], ...ROLE_CARDS[role] })),
  {
    id: 'head',
    title: 'Head of a department',
    who: 'Appointed per department. Not a role: it comes with the department, and ends when they are replaced or leave.',
    can: [
      'Edit any task, and create tasks directly',
      'In their own department: assign owners, archive and restore tasks, move tasks to their other departments',
      'Review, approve and promote proposals for their department, their own included',
      'Edit contacts',
    ],
  },
  {
    id: 'member',
    title: 'Member',
    who: 'Everyone on the roster with the status Active.',
    can: [
      'Read everything except finances',
      'Edit and move their own tasks; attach files to them',
      'Suggest proposals and discuss them',
      'Record spec measurements; tick requirements and link tasks',
      'List and use tools',
    ],
    cannot: ['Create tasks directly (they suggest them)'],
  },
  {
    id: 'trial',
    title: 'Trial member',
    who: 'New on the roster. A President, Vice President or Developer sets them to Active when the trial is over.',
    can: [
      'Read everything except finances',
      'Edit and move their own tasks; attach files to them',
      'Suggest proposals',
      'Record spec measurements',
      'List and use tools',
      'Be given a task by a leader',
    ],
    cannot: [
      'Change requirement status or link tasks',
      'Hold a role or be a Head',
      'Be named the owner of a proposal',
    ],
  },
]
