import { useMemo } from 'react'
import { useAuth } from '../auth/context.ts'
import { usePermissions } from '../auth/usePermissions.ts'
import { useMembers } from '../data/useMembers.ts'
import { useTools } from '../data/useTeam.ts'
import { ToolsPanel } from '../team/ToolsPanel.tsx'
import { pageMain } from '../ui/layout.ts'
import { PageHeader } from '../ui/PageHeader.tsx'
import { ErrorState, LoadingState } from '../ui/states.tsx'

// The tools the club shares and where each one is now. Not season-scoped: a tool
// outlives a season.
export default function Team() {
  const auth = useAuth()
  const me = auth.status === 'member' ? auth.member.id : undefined
  // A retired member reads but does not write; the database refuses it too. A trial member uses the tools.
  const canWrite = auth.status === 'member' && auth.member.status !== 'alumni'
  // Changing a tool is for full members: every active member may, a member on trial may only read (and list their own).
  const canModify = auth.status === 'member' && auth.member.status === 'active'
  const can = usePermissions()
  const tools = useTools()
  const members = useMembers()
  const names = useMemo(() => new Map((members.data ?? []).map((m) => [m.id, m.full_name])), [members.data])
  const roster = useMemo(
    () => (members.data ?? []).filter((m) => m.status !== 'alumni').sort((a, b) => a.full_name.localeCompare(b.full_name)),
    [members.data],
  )
  const error = tools.error ?? members.error

  return (
    <main id="main-content" tabIndex={-1} className={pageMain('wide')}>
      <PageHeader title="Tools" description="Where every tool is. Each one is a member’s own or a club tool; you choose which when you list it." tutorialId="team-overview" />
      {error ? (
        <ErrorState title="Could not load the tool list" error={error} onRetry={() => void tools.refetch()} />
      ) : tools.isPending ? (
        <LoadingState label="Loading the tool list…" />
      ) : (
        <ToolsPanel tools={tools.data ?? []} names={names} me={me} canWrite={canWrite} canModify={canModify} isAdmin={can.canAddMembers} roster={roster} />
      )}
    </main>
  )
}
