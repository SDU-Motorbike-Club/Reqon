import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ProposalForm } from './ProposalForm.tsx'
import { buildRequirementOptions } from './requirementOptions.ts'

const requirements = buildRequirementOptions([
  { clause_key: 'A.1', printed_ref: 'A.1', body: 'The vehicle must fit.', section: 'A', article: 1, article_title: null },
  { clause_key: 'B.2', printed_ref: 'B.2', body: 'Fairing width is limited.', section: 'B', article: 2, article_title: null },
])
const base = {
  departments: [{ value: 'AERO', label: 'Aerodynamics' }],
  milestones: [{ value: 'MS1', label: 'MS1 — Team plan' }],
  owners: [{ value: 'm2', label: 'Bo Wrench' }],
  requirements,
  pending: false,
  canConfigure: false,
}

function renderForm(over: Partial<Parameters<typeof ProposalForm>[0]> = {}, onRaise = vi.fn().mockResolvedValue(undefined)) {
  render(
    <MemoryRouter>
      <ProposalForm {...base} onRaise={onRaise} {...over} />
    </MemoryRouter>,
  )
  return onRaise
}

async function fillAll(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^Title/), '  Mount the wing  ')
  await user.selectOptions(screen.getByLabelText(/^Department/), 'AERO')
  fireEvent.change(screen.getByLabelText(/^Deadline/), { target: { value: '2026-12-01' } })
  await user.selectOptions(screen.getByLabelText(/^Related milestone/), 'MS1')
  await user.type(screen.getByLabelText('Find a requirement'), 'A.1')
  await user.click(screen.getByRole('checkbox', { name: /A\.1/ }))
}

describe('the proposal form fields', () => {
  it('defaults to normal priority, offers only Normal and Urgent, and never chooses a deadline', () => {
    renderForm()
    const priority = screen.getByLabelText('Priority') as HTMLSelectElement
    expect(priority.value).toBe('normal')
    expect(within(priority).getAllByRole('option').map((o) => o.textContent)).toEqual(['Normal', 'Urgent'])
    expect(screen.getByLabelText(/^Deadline/)).toHaveValue('')
  })

  it('marks the mandatory fields and leaves description and owner optional', () => {
    renderForm()
    for (const label of [/^Title/, /^Deadline/]) {
      expect(screen.getByLabelText(label)).toBeRequired()
    }
    // Everything else is optional, and not marked as required.
    for (const label of [/^Department/, /^Related milestone/]) {
      expect(screen.getByLabelText(label)).not.toBeRequired()
    }
    expect(screen.getByLabelText('Description (optional)')).not.toBeRequired()
    expect(screen.getByLabelText(/^Proposed owner/)).not.toBeRequired()
    expect(screen.getByLabelText(/^Proposed owner/)).toHaveValue('')
  })

  it('submits the trimmed values with the chosen requirement keys, description and owner optional', async () => {
    const user = userEvent.setup()
    const onRaise = renderForm()
    await fillAll(user)
    await user.click(screen.getByRole('button', { name: 'Raise proposal' }))
    await waitFor(() => expect(onRaise).toHaveBeenCalledTimes(1))
    expect(onRaise).toHaveBeenCalledWith({
      title: 'Mount the wing',
      description: null,
      departmentKey: 'AERO',
      dueDate: '2026-12-01',
      milestoneKey: 'MS1',
      requirementKeys: ['A.1'],
      priority: 'normal',
      ownerId: null,
    })
  })
})

describe('suggested starting values', () => {
  it('starts from the suggested department and milestone, which the person can change', async () => {
    const user = userEvent.setup()
    renderForm({ defaultDepartment: 'AERO', defaultMilestone: 'MS1' })
    expect(screen.getByLabelText(/^Department/)).toHaveValue('AERO')
    expect(screen.getByLabelText(/^Related milestone/)).toHaveValue('MS1')
    await user.selectOptions(screen.getByLabelText(/^Department/), '')
    expect(screen.getByLabelText(/^Department/)).toHaveValue('')
    // The deadline is still never chosen for anyone.
    expect(screen.getByLabelText(/^Deadline/)).toHaveValue('')
  })

  it('ignores a suggestion that is not among the choices offered', () => {
    renderForm({ defaultDepartment: 'RETIRED', defaultMilestone: 'MS9' })
    expect(screen.getByLabelText(/^Department/)).toHaveValue('')
    expect(screen.getByLabelText(/^Related milestone/)).toHaveValue('')
  })
})

describe('each required field refuses on its own', () => {
  it.each(['title', 'dueDate'] as const)('missing %s', async (problem) => {
    const user = userEvent.setup()
    const onRaise = renderForm()
    await fillAll(user)
    // Undo just one field.
    if (problem === 'title') await user.clear(screen.getByLabelText(/^Title/))
    if (problem === 'dueDate') fireEvent.change(screen.getByLabelText(/^Deadline/), { target: { value: '' } })
    await user.click(screen.getByRole('button', { name: 'Raise proposal' }))

    expect(onRaise).not.toHaveBeenCalled()
    expect(await screen.findByTestId(`error-${problem}`)).toBeInTheDocument()
    expect(screen.getByTestId('proposal-summary')).toHaveTextContent('One thing needs fixing')
    // The other field reports nothing.
    expect(screen.getAllByTestId(/^error-/)).toHaveLength(1)
  })

  it('raises a proposal with only a title and a deadline: no department, milestone or requirement', async () => {
    const user = userEvent.setup()
    const onRaise = renderForm()
    await user.type(screen.getByLabelText(/^Title/), 'Just an idea')
    fireEvent.change(screen.getByLabelText(/^Deadline/), { target: { value: '2026-12-01' } })
    await user.click(screen.getByRole('button', { name: 'Raise proposal' }))
    await waitFor(() => expect(onRaise).toHaveBeenCalledTimes(1))
    expect(onRaise.mock.calls[0][0]).toMatchObject({ title: 'Just an idea', dueDate: '2026-12-01', departmentKey: '', milestoneKey: '', requirementKeys: [] })
  })
})

describe('accessibility of errors', () => {
  it('moves focus to the summary, links each item to its field, and ties the message to the input', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.click(screen.getByRole('button', { name: 'Raise proposal' }))
    const summary = await screen.findByTestId('proposal-summary')
    expect(summary).toHaveFocus()
    expect(summary).toHaveAttribute('role', 'alert')
    expect(summary).toHaveTextContent('2 things need fixing')

    const title = screen.getByLabelText(/^Title/)
    expect(title).toHaveAttribute('aria-invalid', 'true')
    const describedBy = title.getAttribute('aria-describedby') ?? ''
    expect(document.getElementById(describedBy)).toHaveTextContent(/Enter a title/)

    await user.click(within(summary).getByRole('link', { name: /Choose a deadline/ }))
    expect(screen.getByLabelText(/^Deadline/)).toHaveFocus()
  })
})

describe('failure and repeat submission', () => {
  it('keeps the entered values and shows the reason when the server refuses', async () => {
    const user = userEvent.setup()
    const onRaise = vi.fn().mockRejectedValueOnce(new Error('A proposal can only be raised to an active department.'))
    renderForm({}, onRaise)
    await fillAll(user)
    await user.click(screen.getByRole('button', { name: 'Raise proposal' }))
    expect(await screen.findByTestId('proposal-server-error')).toHaveTextContent('active department')
    expect(screen.getByLabelText(/^Title/)).toHaveValue('  Mount the wing  ')
    expect(screen.getByLabelText(/^Deadline/)).toHaveValue('2026-12-01')
    expect(screen.getByRole('checkbox', { name: /A\.1/ })).toBeChecked()
  })

  it('does not submit again while one is pending', async () => {
    const user = userEvent.setup()
    const onRaise = renderForm({ pending: true })
    await user.click(screen.getByRole('button', { name: 'Raising…' }))
    expect(onRaise).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/^Title/)).toBeDisabled()
  })
})

describe('honest empty states', () => {
  it('still offers the form when there is no department, milestone or requirement to choose from', () => {
    renderForm({ departments: [], milestones: [], requirements: [] })
    expect(screen.queryByTestId('proposal-empty')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/^Title/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Deadline/)).toBeInTheDocument()
  })

  it('does not call a still-loading list empty, and reports a load failure', () => {
    renderForm({ departments: [], loading: true })
    expect(screen.getByTestId('proposal-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('proposal-empty')).not.toBeInTheDocument()
  })

  it('reports a load failure instead of an empty form', () => {
    renderForm({ loadError: 'network down' })
    expect(screen.getByTestId('proposal-load-error')).toHaveTextContent('network down')
  })
})
