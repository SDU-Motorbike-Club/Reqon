import { useMemo } from 'react'
import { backupHealth } from '../../backups/status.ts'
import { useBackupRuns } from '../../data/useBackups.ts'

// Which Settings sections have something wrong that the person should see first. Today: Backups, when any
// destination has failed, is overdue, or has never recorded a copy. Only asked for someone who can read the
// backup table; for everyone else it settles at once with nothing to report.
export function useSettingsAttention({ backups }: { backups: boolean }): { ids: ReadonlySet<string>; settled: boolean } {
  // No retries: this only decides where a section sits, and waiting out three failed attempts would re-sort the page
  // seconds after it loaded. A failure is settled at once (and shown as nothing to report).
  const runs = useBackupRuns({ enabled: backups, retry: false })
  const settled = !backups || !runs.isPending
  const ids = useMemo(() => {
    const found = new Set<string>()
    if (backups && runs.data && backupHealth(runs.data, new Date()).some((h) => h.state === 'failed' || h.state === 'stale' || h.state === 'never')) {
      found.add('backups')
    }
    return found
  }, [backups, runs.data])
  return { ids, settled }
}
