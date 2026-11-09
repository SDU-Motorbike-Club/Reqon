import { Link } from 'react-router-dom'
import { PageHeader } from '../ui/PageHeader.tsx'
import { pageMain } from '../ui/layout.ts'
import { PublicFooter } from '../ui/PublicFooter.tsx'

// Reachable without signing in (App.tsx renders it before the sign-in gate), so a
// person can read it before they have an account. Plain text: keep it in step with
// what the app actually stores (README "Architecture").
const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: 'Who runs Reqon',
    body: ['Reqon is the internal team tool of the SDU Motorbike Club. The club board decides what it is used for and is the contact for anything on this page.'],
  },
  {
    title: 'What it stores',
    body: [
      'Your account: name, email, role, department and, if you add them, a profile photo and contact details.',
      'The club’s work: tasks, comments, meetings and notes, finances, specification sheets, announcements and messages between members, and the history of who changed what.',
      'Files you attach to tasks (photos, PDFs and videos) and bug reports you send.',
    ],
  },
  {
    title: 'Why',
    body: ['Only to run the club’s competition work. Nothing is used for advertising, and nothing is sold or shared for marketing.'],
  },
  {
    title: 'Who can see it',
    body: ['Only signed-in club members, and only what their role allows. There is no public sign-up and no public page except this one.'],
  },
  {
    title: 'Where it is kept',
    body: [
      'The database and sign-in run on Supabase; attached files and encrypted backups are kept on Cloudflare R2, with a private copy of the backups on GitHub; the site is served by Vercel.',
      'Backups are encrypted, and only the board’s key holders can open them.',
    ],
  },
  {
    title: 'Cookies and tracking',
    body: ['Your browser keeps your sign-in session and your tutorial progress. There are no advertising or analytics trackers.'],
  },
  {
    title: 'How long',
    body: ['While you are a member. Seasons stay as the club’s history; archived work is kept until the board deletes it. Ask the board and your account and personal details will be removed.'],
  },
  {
    title: 'Your rights',
    body: ['You can ask the board to show you, correct or delete your personal data, or to stop using it in a way you object to. You can also complain to your data protection authority (in Denmark, Datatilsynet).'],
  },
]

export default function Privacy() {
  return (
    <>
      <main id="main-content" tabIndex={-1} className={pageMain('reading')}>
        <PageHeader title="Privacy policy" description="What Reqon stores about you, why, and who can see it. Last updated 9 November 2026." />
        <div className="space-y-6 text-sm leading-relaxed text-slate-700">
          {SECTIONS.map((s) => (
            <section key={s.title}>
              <h2 className="text-base font-semibold text-slate-950">{s.title}</h2>
              {s.body.map((p) => (
                <p key={p} className="mt-1 max-w-[65ch]">
                  {p}
                </p>
              ))}
            </section>
          ))}
          <p>
            <Link
              to="/"
              className="rounded font-medium text-slate-900 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
            >
              Back to Reqon
            </Link>
          </p>
        </div>
      </main>
      <PublicFooter />
    </>
  )
}
