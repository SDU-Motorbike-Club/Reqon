import { lazy, Suspense } from 'react'
import { Outlet, Route, Routes, useLocation } from 'react-router-dom'
import RequireAuth from './auth/RequireAuth.tsx'
import NotFound from './pages/NotFound.tsx'
import { SeasonGate } from './season/SeasonGate.tsx'
import { SeasonProvider } from './season/SeasonProvider.tsx'
import { TutorialProvider } from './tutorial/TutorialProvider.tsx'
import { AppHeader } from './ui/AppHeader.tsx'
import { ErrorBoundary } from './ui/ErrorBoundary.tsx'
import { pageMain } from './ui/layout.ts'
import { LoadingState } from './ui/states.tsx'
import { useRealtimeNotifications } from './data/useNotifications.ts'
import { useScrollRestoration } from './ui/useScrollRestoration.ts'
import { useRealtimeSubteams } from './data/useRealtimeSubteams.ts'

// Route-level code splitting (Phase 7 §7.1): the authenticated shell — auth
// gate, season handling, the tutorial overlay, the header, navigation and the
// error boundary — loads eagerly, since every screen needs it immediately.
// Each screen itself is its own chunk, fetched only when its route is
// visited. NotFound stays eager: it is a few lines, and the 404 case should
// never show a loading flicker.
const Now = lazy(() => import('./pages/Now.tsx'))
const Priorities = lazy(() => import('./pages/Priorities.tsx'))
const Tasks = lazy(() => import('./pages/Tasks.tsx'))
const Register = lazy(() => import('./pages/Register.tsx'))
const Book = lazy(() => import('./pages/Book.tsx'))
const Milestones = lazy(() => import('./pages/Milestones.tsx'))
const Gantt = lazy(() => import('./pages/Gantt.tsx'))
const Board = lazy(() => import('./pages/Board.tsx'))
const Proposals = lazy(() => import('./pages/Proposals.tsx'))
const Archive = lazy(() => import('./pages/Archive.tsx'))
const Files = lazy(() => import('./pages/Files.tsx'))
const Meetings = lazy(() => import('./pages/Meetings.tsx'))
const SpecSheet = lazy(() => import('./pages/SpecSheet.tsx'))
const Finances = lazy(() => import('./pages/Finances.tsx'))
const Settings = lazy(() => import('./pages/Settings.tsx'))
const Inbox = lazy(() => import('./pages/Inbox.tsx'))
const Contacts = lazy(() => import('./pages/Contacts.tsx'))
const Contributions = lazy(() => import('./pages/Contributions.tsx'))
const Team = lazy(() => import('./pages/Team.tsx'))

// What a person sees while a route's chunk is still downloading. Same shell
// shape as every page (`#main-content`, the skip-link target) so the layout
// does not jump once the real screen replaces it, and `role="status"`
// (inside LoadingState) so a screen reader announces it the way it already
// announces every other in-page loading state.
function RouteFallback() {
  return (
    <main id="main-content" tabIndex={-1} className={pageMain()}>
      <LoadingState label="Loading page…" />
    </main>
  )
}

// Every screen that reads season-scoped data lives under this layout route.
// Settings does not — it is how a club with no current season gets one, so it
// must render regardless of season status (see SeasonGate.tsx's own
// "no-current-season" state, which links back here).
function SeasonScopedLayout() {
  return (
    <SeasonGate>
      <Outlet />
    </SeasonGate>
  )
}

// Departments and Heads are global reference/authorization data. Keep exactly
// one channel for the authenticated shell so every screen learns about a Head
// replacement, including screens that do not themselves render departments.
// The signed-in person's inbox is the same: the header's count must stay live
// on every screen.
function GlobalRealtime() {
  useRealtimeSubteams()
  useRealtimeNotifications()
  return null
}

// Every route lives inside <RequireAuth>, so there is no URL an unauthenticated
// visitor can type to reach a screen. Signed out, the only thing that renders
// is the login form.
export default function App() {
  const location = useLocation()
  useScrollRestoration()
  return (
    <RequireAuth>
      <SeasonProvider>
        <TutorialProvider>
          <GlobalRealtime />
          {/* WCAG 2.4.1. The Register puts ~2,000 controls after the navigation;
              without this a keyboard user tabs through all of them to reach the
              content. Off-screen until focused, then visible. */}
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-slate-900 focus:px-3 focus:py-2 focus:text-sm focus:text-white"
          >
            Skip to main content
          </a>
          <AppHeader />
          {/* Keyed on the path: a screen that crashed recovers simply by navigating
              somewhere else, instead of staying broken until a full reload. */}
          <ErrorBoundary key={location.pathname}>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                {/* Season-scoped: SeasonGate stands in for the page itself
                    whenever the season is loading, failed, or missing, so no
                    page below ever has to render its own "0 tasks" for that
                    reason. */}
                <Route element={<SeasonScopedLayout />}>
                  <Route path="/" element={<Now />} />
                  {/* Not in the menu any more: the Tasks page took its place. Now's tiles still drill down here. */}
                  <Route path="/priorities" element={<Priorities />} />
                  <Route path="/tasks" element={<Tasks />} />
                  <Route path="/register" element={<Register />} />
                  <Route path="/book" element={<Book />} />
                  <Route path="/milestones" element={<Milestones />} />
                  <Route path="/gantt" element={<Gantt />} />
                  <Route path="/board" element={<Board />} />
                  <Route path="/proposals" element={<Proposals />} />
                  <Route path="/archive" element={<Archive />} />
                  <Route path="/files" element={<Files />} />
                  <Route path="/meetings" element={<Meetings />} />
                  <Route path="/specs" element={<SpecSheet />} />
                  <Route path="/finances" element={<Finances />} />
                </Route>
                {/* Not season-scoped: this is where a season with no current
                    one gets created or switched, so it must render regardless
                    of season status. */}
                <Route path="/settings" element={<Settings />} />
                {/* Not season-scoped either: what needs you does not depend on
                    which season is on screen. */}
                <Route path="/inbox" element={<Inbox />} />
                {/* Not season-scoped either: the people you can ask outlive a season. */}
                <Route path="/contacts" element={<Contacts />} />
                {/* Across seasons by design: it is a person's record, not a season's. */}
                <Route path="/contributions" element={<Contributions />} />
                {/* Your first steps and the club's tools outlive a season too. */}
                <Route path="/team" element={<Team />} />
                {/* Any other address: say so, with a way back. */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </TutorialProvider>
      </SeasonProvider>
    </RequireAuth>
  )
}
