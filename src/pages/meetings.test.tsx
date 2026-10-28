import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The Meetings screen over mocked data hooks: how stored Markdown is read, and
// how the default agenda is edited. Who may do what is the database's
// (20260108 policies, checked in supabase/tests); here only which controls the
// screen offers for each permission, and that it never loses typed text.
const state = vi.hoisted(() => ({
  can: { canCreateMeeting: false, canDeleteMeeting: false, canEditMeetingTemplate: false },
  meetings: [] as Record<string, unknown>[],
  template: '## Agenda\n\n- ',
  saveError: null as Error | null,
  saved: [] as string[],
  created: [] as Record<string, unknown>[],
  updated: [] as Record<string, unknown>[],
  deleted: [] as string[],
  writeError: null as Error | null,
  // meeting id -> member ids that came; and what the dialog asked to be saved.
  attendance: {} as Record<string, string[]>,
  attendanceWrites: [] as { meetingId: string; memberIds: readonly string[] }[],
}))

vi.mock('../data/useSubteams.ts', () => ({
  useSubteams: () => ({
    data: [
      { key: 'chassis', name: 'Chassis', archived_at: null },
      { key: 'old', name: 'Old team', archived_at: '2026-01-01T00:00:00Z' },
    ],
  }),
}))
vi.mock('../data/useMembers.ts', () => ({
  useMembers: () => ({
    data: [
      { id: 'u1', full_name: 'Ada Rider', status: 'active' },
      { id: 'u2', full_name: 'Bo Wrench', status: 'active' },
      { id: 'u3', full_name: 'Cy Old', status: 'alumni' },
    ],
  }),
}))
vi.mock('../auth/usePermissions.ts', () => ({ usePermissions: () => state.can }))
// jsdom cannot drive a contenteditable, so the document editor is stood in for by a textarea holding the same
// Markdown. The real editor, and that it writes back exactly what it was given, is meetings/editorMarkdown.test.ts.
vi.mock('../meetings/RichTextField.tsx', () => ({
  RichTextField: ({ id, label, value, onChange, disabled, placeholder }: { id: string; label: string; value: string; onChange: (v: string) => void; disabled?: boolean; placeholder?: string }) => (
    <div>
      <label htmlFor={id}>{label}</label>
      <textarea id={id} value={value} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  ),
}))
vi.mock('../data/useMeetings.ts', async () => {
  const { useState } = await import('react')
  return {
  useMeetings: () => ({ data: state.meetings, error: null, isPending: false, refetch: vi.fn() }),
  useMeetingAttendance: () => ({ data: new Map(Object.entries(state.attendance)), isPending: false, error: null }),
  useSetMeetingAttendees: () => ({
    mutateAsync: async (v: { meetingId: string; memberIds: readonly string[] }) => { state.attendanceWrites.push(v) },
    reset: vi.fn(), isPending: false, error: null,
  }),
  useMeetingTemplate: () => ({ data: state.template, error: null, isPending: false }),
  useDeleteMeeting: () => ({ mutateAsync: async (id: string) => { state.deleted.push(id) }, reset: vi.fn(), isPending: false, error: null }),
  useCreateMeeting: () => {
    const [error, setError] = useState<Error | null>(null)
    return {
      reset: () => setError(null), isPending: false, error,
      mutateAsync: async (draft: Record<string, unknown>) => {
        if (state.writeError) { setError(state.writeError); throw state.writeError }
        state.created.push(draft)
      },
    }
  },
  useUpdateMeeting: () => ({ mutateAsync: async (draft: Record<string, unknown>) => { state.updated.push(draft) }, reset: vi.fn(), isPending: false, error: null }),
  useSaveMeetingTemplate: () => {
    const [error, setError] = useState<Error | null>(null)
    return {
      isPending: false,
      error,
      reset: () => setError(null),
      mutateAsync: async (body: string) => {
        if (state.saveError) {
          setError(state.saveError)
          throw state.saveError
        }
        state.saved.push(body)
      },
    }
  },
  }
})

const { default: Meetings } = await import('./Meetings.tsx')

const meeting = (over: Record<string, unknown> = {}) => ({
  id: 'm1', season_id: 's1', title: 'Weekly build', held_on: '2026-09-10', starts_at: '18:00:00', ends_at: null,
  location: 'Workshop', agenda: null, notes: null, attendees: null, summary: null, created_by: null,
  created_at: '', updated_at: '', ...over,
})

const renderPage = () => render(<MemoryRouter><Meetings /></MemoryRouter>)

beforeEach(() => {
  state.can = { canCreateMeeting: false, canDeleteMeeting: false, canEditMeetingTemplate: false }
  state.meetings = []
  state.template = '## Agenda\n\n- '
  state.saveError = null
  state.saved = []
  state.created = []
  state.updated = []
  state.deleted = []
  state.writeError = null
  state.attendance = {}
  state.attendanceWrites = []
})

describe('sharing a meeting', () => {
  it('shows the department and ready-made texts anyone can copy', async () => {
    state.meetings = [meeting({ subteam_key: 'chassis', agenda: '## Agenda\n\n- Frame' })]
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderPage()
    expect(screen.getByText(/For Chassis/)).toBeInTheDocument()
    await user.click(screen.getByText('Share this meeting'))
    expect(screen.getByLabelText('WhatsApp message')).toHaveValue(
      '*Weekly build*\nWhen: Thu, 10/09/26, 18:00\nWhere: Workshop\nFor: Chassis\n\n*Agenda*\n\n- Frame',
    )
    await user.click(screen.getByRole('button', { name: 'Copy WhatsApp text' }))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('*Weekly build*'))
    expect(await screen.findByText('WhatsApp text copied.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Copy email text' }))
    expect(writeText).toHaveBeenLastCalledWith(expect.stringMatching(/^Subject: Weekly build, Thu, 10\/09\/26, 18:00\n\nHi all,/))
  })

  it('says so when the browser will not copy, and selects the text instead', async () => {
    state.meetings = [meeting()]
    const user = userEvent.setup()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true })
    renderPage()
    await user.click(screen.getByText('Share this meeting'))
    await user.click(screen.getByRole('button', { name: 'Copy WhatsApp text' }))
    expect(await screen.findByText(/Could not copy on its own/)).toBeInTheDocument()
  })
})

describe('reading a meeting', () => {
  it('draws stored Markdown as headings, paragraphs and nested lists', async () => {
    state.meetings = [meeting({ agenda: '## Build status\n\nWhere we are.\n\n- Frame\n  - welds checked\n  - jig ordered\n- Fairing', notes: '**Decided:** order tyres.' })]
    renderPage()
    const agenda = await screen.findByTestId('meeting-agenda-m1')
    // A heading one level below the meeting's own title.
    expect(await within(agenda).findByRole('heading', { level: 4, name: 'Build status' })).toBeInTheDocument()
    expect(within(agenda).getByText('Where we are.').tagName).toBe('P')
    const outer = within(agenda).getAllByRole('list')[0]
    const frame = within(outer).getByText('Frame').closest('li') as HTMLElement
    expect(within(frame).getByRole('list')).toHaveTextContent('welds checked')
    expect(within(screen.getByTestId('meeting-notes-m1')).getByText('Decided:').tagName).toBe('STRONG')
  })

  it('never renders raw HTML or a script link from the stored text', async () => {
    state.meetings = [meeting({ agenda: 'Hi <img src="x" onerror="alert(1)"> <script>alert(2)</script>\n\n[click](javascript:alert(3)) and [site](https://example.org)' })]
    renderPage()
    const agenda = await screen.findByTestId('meeting-agenda-m1')
    await within(agenda).findByRole('link', { name: /site/ })
    expect(agenda.querySelector('img, script')).toBeNull()
    expect(within(agenda).getByRole('link', { name: /site/ })).toHaveAttribute('href', 'https://example.org')
    expect(within(agenda).getByText('click').closest('a')?.getAttribute('href') ?? '').not.toMatch(/javascript/i)
  })
})

describe('the default agenda', () => {
  it('is not offered to someone who neither calls meetings nor edits it', () => {
    renderPage()
    expect(screen.queryByText('Default agenda for new meetings')).not.toBeInTheDocument()
  })

  it('is readable, but not editable, by a Vice President who calls meetings', async () => {
    state.can = { canCreateMeeting: true, canDeleteMeeting: false, canEditMeetingTemplate: false }
    renderPage()
    expect(screen.getByText('Default agenda for new meetings')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit default agenda' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByText('Show the default agenda'))
    expect(await within(screen.getByTestId('template-view')).findByRole('heading', { name: 'Agenda' })).toBeInTheDocument()
  })

  it('opens in a dialog only when asked, and saves what was written', async () => {
    state.can = { canCreateMeeting: true, canDeleteMeeting: true, canEditMeetingTemplate: true }
    renderPage()
    // No editor on the page itself.
    expect(screen.queryByLabelText('Default agenda')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Edit default agenda' }))
    const dialog = screen.getByRole('dialog')
    const box = within(dialog).getByLabelText('Default agenda')
    await userEvent.clear(box)
    await userEvent.type(box, '## Safety{enter}{enter}- helmets')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save default agenda' }))
    await waitFor(() => expect(state.saved).toEqual(['## Safety\n\n- helmets']))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText(/Default agenda saved/)).toBeInTheDocument()
  })

  it('keeps what was typed after a failed save, and after closing the dialog, until it is discarded', async () => {
    state.can = { canCreateMeeting: true, canDeleteMeeting: true, canEditMeetingTemplate: true }
    state.saveError = new Error('network down')
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Edit default agenda' }))
    const box = within(screen.getByRole('dialog')).getByLabelText('Default agenda')
    await userEvent.type(box, 'my change')
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save default agenda' }))
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('network down')
    expect(within(screen.getByRole('dialog')).getByLabelText('Default agenda')).toHaveValue('## Agenda\n\n- my change')

    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))
    expect(screen.getByTestId('template-draft-kept')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Edit default agenda' }))
    expect(within(screen.getByRole('dialog')).getByLabelText('Default agenda')).toHaveValue('## Agenda\n\n- my change')

    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard changes' }))
    expect(screen.queryByTestId('template-draft-kept')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Edit default agenda' }))
    expect(within(screen.getByRole('dialog')).getByLabelText('Default agenda')).toHaveValue('## Agenda\n\n- ')
    expect(state.saved).toEqual([])
  })
})

describe('calling and editing a meeting', () => {
  const admin = () => { state.can = { canCreateMeeting: true, canDeleteMeeting: true, canEditMeetingTemplate: false } }

  it('needs a name and a date, and an end after the start, before anything is sent', async () => {
    admin()
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'New meeting' }))
    const dialog = within(screen.getByRole('dialog'))
    await user.click(dialog.getByRole('button', { name: 'Add meeting' }))
    expect(dialog.getByText('Give the meeting a name.')).toBeInTheDocument()
    expect(dialog.getByText('A meeting needs a date.')).toBeInTheDocument()
    expect(dialog.getByLabelText('Name')).toHaveFocus()
    await user.type(dialog.getByLabelText('Name'), 'Weekly build')
    await user.type(dialog.getByLabelText('Date'), '2026-10-01')
    await user.type(dialog.getByLabelText('Starts (optional)'), '18:00')
    await user.type(dialog.getByLabelText('Ends (optional)'), '17:00')
    await user.click(dialog.getByRole('button', { name: 'Add meeting' }))
    expect(dialog.getByText('The end must be after the start.')).toBeInTheDocument()
    expect(state.created).toEqual([])
  })

  it('starts the agenda from the default agenda and sends exactly what was typed', async () => {
    admin()
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'New meeting' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByLabelText('Agenda')).toHaveValue('## Agenda\n\n- ')
    await user.type(dialog.getByLabelText('Name'), '  Weekly build  ')
    await user.type(dialog.getByLabelText('Date'), '2026-10-01')
    await user.type(dialog.getByLabelText('Agenda'), 'tyres')
    await user.click(dialog.getByRole('button', { name: 'Add meeting' }))
    await waitFor(() => expect(state.created).toHaveLength(1))
    expect(state.created[0]).toEqual({
      title: 'Weekly build', heldOn: '2026-10-01', startsAt: null, endsAt: null, location: null, subteamKey: null,
      agenda: '## Agenda\n\n- tyres', notes: null, attendees: null,
    })
    expect(screen.getByText('Meeting added.')).toBeInTheDocument()
  })

  it('lets the meeting be called for a department, and offers only active ones', async () => {
    admin()
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'New meeting' }))
    const dialog = within(screen.getByRole('dialog'))
    const options = dialog.getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(expect.arrayContaining(['The whole club', 'Chassis']))
    expect(options).not.toContain('Old team')
    await user.type(dialog.getByLabelText('Name'), 'Chassis sync')
    await user.type(dialog.getByLabelText('Date'), '2099-01-01')
    await user.selectOptions(dialog.getByLabelText('For (optional)'), 'chassis')
    expect(dialog.queryByTestId('past-date-warning')).not.toBeInTheDocument()
    await user.click(dialog.getByRole('button', { name: 'Add meeting' }))
    await waitFor(() => expect(state.created).toHaveLength(1))
    expect(state.created[0]).toMatchObject({ title: 'Chassis sync', subteamKey: 'chassis' })
  })

  it('warns about a past date but still saves it', async () => {
    admin()
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'New meeting' }))
    const dialog = within(screen.getByRole('dialog'))
    await user.type(dialog.getByLabelText('Name'), 'Minutes after the fact')
    await user.type(dialog.getByLabelText('Date'), '2020-01-01')
    expect(dialog.getByTestId('past-date-warning')).toHaveTextContent('already passed')
    await user.click(dialog.getByRole('button', { name: 'Add meeting' }))
    await waitFor(() => expect(state.created).toHaveLength(1))
    expect(state.created[0]).toMatchObject({ heldOn: '2020-01-01' })
  })

  it('does not warn when editing a meeting that already happened', async () => {
    admin()
    state.meetings = [meeting({ held_on: '2020-01-01' })]
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Edit Weekly build' }))
    expect(within(screen.getByRole('dialog')).queryByTestId('past-date-warning')).not.toBeInTheDocument()
  })

  it('keeps what was typed when the save is refused', async () => {
    admin()
    state.writeError = new Error("You don't have permission to call meetings.")
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'New meeting' }))
    const dialog = within(screen.getByRole('dialog'))
    await user.type(dialog.getByLabelText('Name'), 'Weekly build')
    await user.type(dialog.getByLabelText('Date'), '2026-10-01')
    await user.click(dialog.getByRole('button', { name: 'Add meeting' }))
    expect(await dialog.findByRole('alert')).toHaveTextContent('permission')
    expect(dialog.getByLabelText('Name')).toHaveValue('Weekly build')
  })

  it('edits an existing meeting with its own values, and deletes only after confirming', async () => {
    admin()
    state.meetings = [meeting({ agenda: '## Old', notes: 'Decided things', attendees: 'Ada' })]
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Edit Weekly build' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByLabelText('Name')).toHaveValue('Weekly build')
    expect(dialog.getByLabelText('Starts (optional)')).toHaveValue('18:00')
    expect(dialog.getByLabelText('Minutes (optional)')).toHaveValue('Decided things')
    await user.clear(dialog.getByLabelText('Where (optional)'))
    await user.click(dialog.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(state.updated).toHaveLength(1))
    expect(state.updated[0]).toMatchObject({ id: 'm1', title: 'Weekly build', location: null, notes: 'Decided things' })

    await user.click(screen.getByRole('button', { name: 'Delete Weekly build' }))
    expect(state.deleted).toEqual([])
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete meeting' }))
    await waitFor(() => expect(state.deleted).toEqual(['m1']))
    expect(screen.getByText('Meeting deleted.')).toBeInTheDocument()
  })

  it('shows who came by name, and the old free text only for a meeting with no tick list', () => {
    state.meetings = [meeting({ id: 'a' }), meeting({ id: 'b', title: 'Older', attendees: 'Ada and Bo' })]
    state.attendance = { a: ['u2', 'u1', 'u3'] }
    renderPage()
    expect(screen.getByTestId('meeting-who-a')).toHaveTextContent('Who came (3): Ada Rider, Bo Wrench, Cy Old')
    expect(screen.queryByTestId('meeting-who-b')).not.toBeInTheDocument()
    expect(screen.getByText('Who came: Ada and Bo')).toBeInTheDocument()
  })

  it('ticks who came when editing, and saves the list with the meeting', async () => {
    admin()
    state.meetings = [meeting({ id: 'a' })]
    state.attendance = { a: ['u1'] }
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Edit Weekly build' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByRole('checkbox', { name: 'Ada Rider' })).toBeChecked()
    expect(dialog.getByRole('checkbox', { name: 'Bo Wrench' })).not.toBeChecked()
    // Retired members are not offered, unless they were already ticked.
    expect(dialog.queryByRole('checkbox', { name: /Cy Old/ })).not.toBeInTheDocument()
    await user.click(dialog.getByRole('checkbox', { name: 'Bo Wrench' }))
    expect(dialog.getByTestId('attendance-count')).toHaveTextContent('2 of 2 came')
    await user.click(dialog.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(state.attendanceWrites).toHaveLength(1))
    expect(state.attendanceWrites[0].meetingId).toBe('a')
    expect([...state.attendanceWrites[0].memberIds].sort()).toEqual(['u1', 'u2'])
    expect(state.updated).toHaveLength(1)
  })

  it('leaves the saved list alone when nothing was ticked or unticked', async () => {
    admin()
    state.meetings = [meeting({ id: 'a' })]
    state.attendance = { a: ['u1'] }
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Edit Weekly build' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(state.updated).toHaveLength(1))
    expect(state.attendanceWrites).toEqual([])
  })

  it('keeps the old free-text line visible, unchanged, beside the tick list', async () => {
    admin()
    state.meetings = [meeting({ id: 'a', attendees: 'Ada and Bo' })]
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Edit Weekly build' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByTestId('legacy-attendees')).toHaveTextContent('Written before the tick list: Ada and Bo')
    await user.click(dialog.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(state.updated).toHaveLength(1))
    expect(state.updated[0]).toMatchObject({ attendees: 'Ada and Bo' })
  })

  it('draws every element meeting notes use: sub-headings, numbered lists, code, quotes and emphasis', async () => {
    state.meetings = [meeting({ notes: '### Sub\n\n1. first\n2. second\n\n> quoted\n\n`code` and *soft* ~~gone~~\n\n---' })]
    renderPage()
    const notes = await screen.findByTestId('meeting-notes-m1')
    expect(await within(notes).findByRole('heading', { level: 5, name: 'Sub' })).toBeInTheDocument()
    expect(notes.querySelector('ol')?.children).toHaveLength(2)
    expect(notes.querySelector('blockquote')).toHaveTextContent('quoted')
    expect(notes.querySelector('code')).toHaveTextContent('code')
    expect(notes.querySelector('em')).toHaveTextContent('soft')
    expect(notes.querySelector('hr')).not.toBeNull()
  })
})
