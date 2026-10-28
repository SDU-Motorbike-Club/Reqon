import { ACCESS_CARDS } from '../../auth/accessGuide.ts'

// Settings → "Who can do what": one short card per kind of access. Read-only reference;
// what a person can actually do is decided by the database.
export function AccessGuide() {
  return (
    <ul className="grid gap-2 sm:grid-cols-2" data-testid="access-guide">
      {ACCESS_CARDS.map((card) => (
        <li key={card.id} className="rounded border border-slate-200 bg-surface p-3" data-testid={`access-${card.id}`}>
          <h3 className="text-sm font-semibold text-slate-900">{card.title}</h3>
          <p className="mt-0.5 text-xs text-slate-600">{card.who}</p>
          <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-slate-800">
            {card.can.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {card.cannot && (
            <>
              <p className="mt-2 text-[11px] font-medium text-slate-600">Cannot</p>
              <ul className="list-disc space-y-0.5 pl-4 text-xs text-slate-700">
                {card.cannot.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          )}
        </li>
      ))}
    </ul>
  )
}
