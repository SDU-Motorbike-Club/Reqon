import { useEffect, useId, useMemo, useState, type FormEvent } from 'react'
import { usePermissions } from '../auth/usePermissions.ts'
import {
  APPLICATION_STATUSES,
  BLOG_CATEGORIES,
  coverProblem,
  EVENT_TYPES,
  isUpcoming,
  orderApplications,
  orderEvents,
  orderPosts,
  slugify,
  useApplications,
  useBlogPosts,
  useDeleteApplication,
  useDeleteBlogPost,
  useDeleteEvent,
  useEvents,
  useSaveBlogPost,
  useSaveEvent,
  uploadBlogCover,
  useSetApplicationStatus,
  type ApplicationSort,
  type ApplicationStatus,
  type BlogCategory,
  type BlogPost,
  type ClubEvent,
  type EventSort,
  type EventType,
  type PostSort,
  COVER_TYPES,
} from '../data/usePublicSite.ts'
import { formatInstant, toDateTimeInput } from '../lib/dates.ts'
import { mergeSearchParams } from '../lib/searchParams.ts'
import { useUrlParams } from '../lib/useUrlParams.ts'
import { MeetingText } from '../meetings/MeetingText.tsx'
import { RichTextField } from '../meetings/RichTextField.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { PageHeader } from '../ui/PageHeader.tsx'
import { buttonDanger, buttonPrimary, buttonSecondary } from '../ui/buttons.ts'
import { pageMain } from '../ui/layout.ts'
import { ActionError, EmptyState, ErrorState, LoadingState } from '../ui/states.tsx'

// The club's public website, run from here: the applications people send (Recruitment, can_manage_applicants()),
// the blog and the events (Blog, can_post_blog()). The website reads the same rows, so a saved post or event is live
// there at once. The database checks every write (20260162000100, 20260163000200).

const input =
  'mt-1 block min-h-11 w-full rounded border border-slate-300 bg-surface px-2.5 text-base text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring sm:min-h-9 sm:text-sm'
const label = 'block text-sm font-medium text-slate-900'
const chip = (active: boolean) =>
  `inline-flex min-h-11 items-center gap-1 rounded-full border px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring sm:min-h-8 ${
    active ? 'border-slate-400 bg-slate-200 text-slate-950' : 'border-slate-300 bg-surface text-slate-700 hover:bg-slate-100'
  }`
const card = 'rounded-lg border border-slate-200 bg-surface p-3'
const blankToNull = (value: FormDataEntryValue | null) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null)

type Section = 'applicants' | 'blog' | 'events'

// Filters and order live in the address (?app_status=new&app_sort=name), so a filtered list survives a reload or a shared link.
const pick = <T extends string>(value: string | null, labels: Record<T, string>): T | null =>
  value !== null && Object.hasOwn(labels, value) ? (value as T) : null

function ChipFilter<T extends string>({
  label: name,
  value,
  options,
  onChange,
}: {
  label: string
  value: T | null
  options: { id: T | null; label: string; count: number }[]
  onChange: (value: T | null) => void
}) {
  return (
    <div role="group" aria-label={name} className="flex flex-wrap items-center gap-1.5">
      <span className="text-sm text-slate-600">{name}:</span>
      {options.map((o) => (
        <button key={o.id ?? 'all'} type="button" aria-pressed={value === o.id} className={chip(value === o.id)} onClick={() => onChange(o.id)}>
          {o.label} <span className="text-xs text-slate-500">{o.count}</span>
        </button>
      ))}
    </div>
  )
}

function SortSelect<T extends string>({ value, labels, onChange }: { value: T; labels: Record<T, string>; onChange: (value: T) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm font-medium text-slate-900">
      Order
      <select value={value} onChange={(e) => onChange(e.target.value as T)} className={`${input} mt-0 w-auto`}>
        {(Object.keys(labels) as T[]).map((k) => (
          <option key={k} value={k}>{labels[k]}</option>
        ))}
      </select>
    </label>
  )
}

function NoMatch({ what, onClear }: { what: string; onClear: () => void }) {
  return (
    <p className="py-3 text-sm text-slate-600">
      No {what} match these filters.{' '}
      <button type="button" className="font-medium text-slate-900 underline" onClick={onClear}>Show all</button>
    </p>
  )
}

export default function Public() {
  const can = usePermissions()
  const [params, setParams] = useUrlParams()
  const sections: { id: Section; label: string }[] = [
    ...(can.canManageApplicants ? [{ id: 'applicants' as const, label: 'Applicants' }] : []),
    ...(can.canPostBlog ? [{ id: 'blog' as const, label: 'Blog' }, { id: 'events' as const, label: 'Events' }] : []),
  ]
  const current = sections.find((s) => s.id === params.get('section'))?.id ?? sections[0]?.id

  return (
    <main id="main-content" tabIndex={-1} className={pageMain('wide')}>
      <PageHeader title="Public" tutorialId="public-overview" description="What the club’s public website shows: the people who applied, the blog and upcoming events." />
      {current === undefined ? (
        <EmptyState title="Nothing here for you">The Recruitment and Blog roles open this page. Ask the President or Vice President for one.</EmptyState>
      ) : (
        <>
          <nav aria-label="Sections" className="mb-4">
            <ul className="flex flex-wrap gap-1.5">
              {sections.map((s) => (
                <li key={s.id}>
                  <button type="button" aria-pressed={current === s.id} className={chip(current === s.id)} onClick={() => setParams((c) => mergeSearchParams(c, { section: s.id }), { replace: true })}>
                    {s.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          {current === 'applicants' ? <Applicants /> : current === 'blog' ? <Blog /> : <Events />}
        </>
      )}
    </main>
  )
}

// ------------------------------------------------------------------ applicants

const STATUS_LABELS: Record<ApplicationStatus, string> = { new: 'New', contacted: 'Contacted', accepted: 'Accepted', rejected: 'Rejected' }
const APPLICATION_SORT_LABELS: Record<ApplicationSort, string> = { newest: 'Newest first', oldest: 'Oldest first', name: 'Name (A–Z)', status: 'By status' }
const applicationBadge = (status: ApplicationStatus) =>
  `inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
    {
      new: 'bg-sky-50 text-sky-800 ring-sky-200',
      contacted: 'bg-amber-50 text-amber-900 ring-amber-200',
      accepted: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
      rejected: 'bg-slate-100 text-slate-700 ring-slate-300',
    }[status]
  }`

type ApplicantsEditing = { kind: 'delete-application'; id: string; name: string }

function Applicants() {
  const applications = useApplications()
  const deleteApplication = useDeleteApplication()
  const setStatus = useSetApplicationStatus()
  const [editing, setEditing] = useState<ApplicantsEditing | null>(null)
  const [message, setMessage] = useState('')
  const [params, setParams] = useUrlParams()
  const setFilter = (patch: Record<string, string | null>) => setParams((c) => mergeSearchParams(c, patch), { replace: true })
  const status = pick(params.get('app_status'), STATUS_LABELS)
  const sort = pick(params.get('app_sort'), APPLICATION_SORT_LABELS) ?? 'newest'
  const all = applications.data ?? []
  const shown = orderApplications(status ? all.filter((a) => a.status === status) : all, sort)
  const open = (next: ApplicantsEditing) => {
    setMessage('')
    setEditing(next)
  }
  const done = (text: string) => {
    setEditing(null)
    setMessage(text)
  }

  return (
    <div className="space-y-8">
      <p role="status" className="min-h-5 text-sm text-emerald-800">{message}</p>

      <section aria-labelledby="applications-title">
        <div className="border-b border-slate-200 pb-1.5">
          <h2 id="applications-title" className="text-base font-semibold text-slate-900">
            Applications {applications.data && <span className="font-normal text-slate-600">({applications.data.length})</span>}
          </h2>
        </div>
        {all.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <ChipFilter
              label="Status"
              value={status}
              onChange={(v) => setFilter({ app_status: v })}
              options={[
                { id: null, label: 'All', count: all.length },
                ...APPLICATION_STATUSES.map((s) => ({ id: s, label: STATUS_LABELS[s], count: all.filter((a) => a.status === s).length })),
              ]}
            />
            <SortSelect value={sort} labels={APPLICATION_SORT_LABELS} onChange={(v) => setFilter({ app_sort: v === 'newest' ? null : v })} />
          </div>
        )}
        {applications.error ? (
          <ErrorState title="Could not load the applications" error={applications.error} onRetry={() => void applications.refetch()} />
        ) : applications.isPending ? (
          <LoadingState label="Loading applications…" />
        ) : all.length === 0 ? (
          <p className="py-3 text-sm text-slate-600">Nobody has applied yet.</p>
        ) : shown.length === 0 ? (
          <NoMatch what="applications" onClear={() => setFilter({ app_status: null })} />
        ) : (
          <ul className="mt-2 space-y-2">
            {shown.map((a) => (
              <li key={a.id} className={card}>
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring">
                    <span className={applicationBadge(a.status)}>{STATUS_LABELS[a.status]}</span>
                    <span className="font-medium text-slate-900">{a.full_name}</span>
                    <span className="text-sm text-slate-600">
                      {a.email}
                      {a.phone && ` · ${a.phone}`} · {formatInstant(a.created_at)}
                    </span>
                  </summary>
                  <label className="mt-3 flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
                    Status
                    <select
                      value={a.status}
                      disabled={setStatus.isPending}
                      onChange={(e) => {
                        setMessage('')
                        setStatus.mutate({ id: a.id, status: e.target.value as ApplicationStatus })
                      }}
                      className={`${input} mt-0 w-auto`}
                    >
                      {APPLICATION_STATUSES.map((s) => (
                        <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                      ))}
                    </select>
                  </label>
                  {a.notes && <p className="mt-2 text-sm whitespace-pre-line text-slate-700">{a.notes}</p>}
                  <dl className="mt-3 space-y-2 text-sm">
                    {a.answers.map((x, i) => (
                      <div key={i}>
                        <dt className="font-medium text-slate-900">{x.question}</dt>
                        <dd className="whitespace-pre-line text-slate-700">{x.answer ?? '—'}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    <a href={`mailto:${a.email}`} className={buttonSecondary}>Email {a.full_name}</a>
                    <button type="button" className={buttonSecondary} onClick={() => open({ kind: 'delete-application', id: a.id, name: a.full_name })}>Delete</button>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
        <ActionError error={setStatus.error} className="mt-3" />
      </section>

      <Dialog open={editing?.kind === 'delete-application'} onClose={() => setEditing(null)} labelledBy="delete-dialog-title">
        {editing?.kind === 'delete-application' && (
          <ConfirmDelete
            what={`${editing.name}’s application`}
            detail="Their answers are removed for good. This cannot be undone."
            remove={deleteApplication}
            id={editing.id}
            onCancel={() => setEditing(null)}
            onDeleted={() => done('Application deleted.')}
          />
        )}
      </Dialog>
    </div>
  )
}

// ------------------------------------------------------------------------ blog

type BlogEditing = { kind: 'post'; post: BlogPost | null } | { kind: 'delete'; post: BlogPost }

// A native checkbox announced as a switch, drawn as one. The words beside it say what each position means.
function PublishSwitch({
  checked,
  onChange,
  disabled,
  label,
  states = ['Published', 'Draft'],
}: {
  checked: boolean
  onChange: (on: boolean) => void
  disabled?: boolean
  label: string
  states?: [on: string, off: string]
}) {
  return (
    <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-slate-900 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 sm:min-h-8">
      <input type="checkbox" role="switch" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span
        aria-hidden="true"
        className="relative h-5 w-9 shrink-0 rounded-full bg-slate-300 transition-colors peer-checked:bg-emerald-600 peer-focus-visible:ring-2 peer-focus-visible:ring-accent-ring after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-surface after:transition-transform peer-checked:after:translate-x-4 motion-reduce:transition-none motion-reduce:after:transition-none"
      />
      <span>{checked ? states[0] : states[1]}</span>
    </label>
  )
}

const CATEGORY_LABELS: Record<BlogCategory, string> = { news: 'News', ride: 'Ride', track: 'Track', tech: 'Tech' }
const POST_SORT_LABELS: Record<PostSort, string> = { drafts: 'Drafts first', newest: 'Newest first', oldest: 'Oldest first', title: 'Title (A–Z)', category: 'By category' }
const POST_SHOW_LABELS = { draft: 'Drafts', published: 'Published', featured: 'Featured' } as const
type PostShow = keyof typeof POST_SHOW_LABELS

const statusBadge = (published: boolean) =>
  `inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
    published ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-slate-100 text-slate-700 ring-slate-300'
  }`

function Blog() {
  const posts = useBlogPosts()
  const remove = useDeleteBlogPost()
  const toggle = useSaveBlogPost()
  const [toggling, setToggling] = useState<string | null>(null)
  const setPublished = async (post: BlogPost, published: boolean) => {
    setMessage('')
    setToggling(post.id)
    try {
      await toggle.mutateAsync({ id: post.id, status: published ? 'published' : 'draft' })
      setMessage(published ? `“${post.title}” is on the public website now.` : `“${post.title}” is a draft again: the website no longer shows it.`)
    } catch {
      // Shown below the list.
    } finally {
      setToggling(null)
    }
  }
  const [editing, setEditing] = useState<BlogEditing | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [params, setParams] = useUrlParams()
  const setFilter = (patch: Record<string, string | null>) => setParams((c) => mergeSearchParams(c, patch), { replace: true })
  const category = pick(params.get('post_category'), CATEGORY_LABELS)
  const show = pick(params.get('post_show'), POST_SHOW_LABELS)
  const sort = pick(params.get('post_sort'), POST_SORT_LABELS) ?? 'drafts'
  const all = posts.data ?? []
  // Each group's counts follow the other group's choice, so a number always says how many posts that chip would show.
  const inCategory = (p: BlogPost, c = category) => c === null || p.category === c
  const isShown = (p: BlogPost, s: PostShow | null = show) => s === null || (s === 'featured' ? p.is_featured : p.status === s)
  const shown = orderPosts(all.filter((p) => inCategory(p) && isShown(p)), sort)
  const open = (next: BlogEditing) => {
    setMessage('')
    setEditing(next)
  }
  const done = (text: string) => {
    setEditing(null)
    setMessage(text)
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-slate-200 pb-1.5">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Blog posts</h2>
          <p className="text-sm text-slate-600">A draft is seen only here. Switch it to Published and it is on the public website at once.</p>
        </div>
        <button type="button" className={buttonPrimary} onClick={() => open({ kind: 'post', post: null })}>New post</button>
      </div>
      {all.length > 0 && (
        <div className="mt-2 flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1.5">
            <ChipFilter
              label="Category"
              value={category}
              onChange={(v) => setFilter({ post_category: v })}
              options={[
                { id: null, label: 'All', count: all.filter((p) => isShown(p)).length },
                ...BLOG_CATEGORIES.map((c) => ({ id: c, label: CATEGORY_LABELS[c], count: all.filter((p) => isShown(p) && inCategory(p, c)).length })),
              ]}
            />
            <ChipFilter
              label="Show"
              value={show}
              onChange={(v) => setFilter({ post_show: v })}
              options={[
                { id: null, label: 'All', count: all.filter((p) => inCategory(p)).length },
                ...(Object.keys(POST_SHOW_LABELS) as PostShow[]).map((s) => ({
                  id: s,
                  label: POST_SHOW_LABELS[s],
                  count: all.filter((p) => inCategory(p) && isShown(p, s)).length,
                })),
              ]}
            />
          </div>
          <SortSelect value={sort} labels={POST_SORT_LABELS} onChange={(v) => setFilter({ post_sort: v === 'drafts' ? null : v })} />
        </div>
      )}
      <p role="status" className="my-2 min-h-5 text-sm text-emerald-800">{message}</p>
      {posts.error ? (
        <ErrorState title="Could not load the posts" error={posts.error} onRetry={() => void posts.refetch()} />
      ) : posts.isPending ? (
        <LoadingState label="Loading posts…" />
      ) : all.length === 0 ? (
        <EmptyState title="No posts yet">Start with “New post”. Save it as a draft, or switch it to Published to put it on the website.</EmptyState>
      ) : shown.length === 0 ? (
        <NoMatch what="posts" onClear={() => setFilter({ post_category: null, post_show: null })} />
      ) : (
        <ul className="space-y-2">
          {shown.map((post) => (
            <li key={post.id} className={card}>
              <details>
                <summary className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring">
                  <span className={statusBadge(post.status === 'published')}>{post.status === 'published' ? 'Published' : 'Draft'}</span>{' '}
                  {post.is_featured && <span className={statusBadge(false)}>Featured</span>}{' '}
                  <span className="font-medium text-slate-900">{post.title}</span>
                  <span className="text-sm text-slate-600">
                    {' '}· {CATEGORY_LABELS[post.category]} · {post.author_name || 'Unknown'} ·{' '}
                    {post.published_at ? formatInstant(post.published_at) : `edited ${formatInstant(post.updated_at)}`}
                  </span>
                  {post.excerpt && <span className="mt-0.5 block text-sm text-slate-700">{post.excerpt}</span>}
                </summary>
                <div className="mt-3 border-t border-slate-200 pt-3">
                  <p className="mb-2 text-xs text-slate-500">/{post.slug}</p>
                  <MeetingText text={post.content} />
                </div>
              </details>
              <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                <span className="mr-auto">
                  <PublishSwitch
                    checked={post.status === 'published'}
                    disabled={toggling !== null}
                    label={`${post.title}: published on the public website`}
                    onChange={(on) => void setPublished(post, on)}
                  />
                </span>
                <button type="button" aria-label={`Edit ${post.title}`} className={buttonSecondary} onClick={() => open({ kind: 'post', post })}>Edit</button>
                <button type="button" aria-label={`Delete ${post.title}`} className={buttonSecondary} onClick={() => open({ kind: 'delete', post })}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ActionError error={toggle.error} className="mt-3" />

      <Dialog open={editing?.kind === 'post'} onClose={() => setEditing(null)} labelledBy="post-dialog-title" size="wide" dismissible={!busy}>
        {editing?.kind === 'post' && <PostForm post={editing.post} onBusy={setBusy} onCancel={() => setEditing(null)} onSaved={done} />}
      </Dialog>
      <Dialog open={editing?.kind === 'delete'} onClose={() => setEditing(null)} labelledBy="delete-dialog-title">
        {editing?.kind === 'delete' && (
          <ConfirmDelete
            what={`“${editing.post.title}”`}
            detail="It is taken off the public website at once. This cannot be undone."
            remove={remove}
            id={editing.post.id}
            onCancel={() => setEditing(null)}
            onDeleted={() => done('Post deleted.')}
          />
        )}
      </Dialog>
    </div>
  )
}

function PostForm({
  post,
  onBusy,
  onCancel,
  onSaved,
}: {
  post: BlogPost | null
  onBusy: (busy: boolean) => void
  onCancel: () => void
  onSaved: (message: string) => void
}) {
  const save = useSaveBlogPost()
  const id = useId()
  const [body, setBody] = useState(post?.content ?? '')
  const [title, setTitle] = useState(post?.title ?? '')
  // The address follows the title until someone types their own; an existing post keeps its address.
  const [slug, setSlug] = useState(post?.slug ?? '')
  const [slugEdited, setSlugEdited] = useState(post !== null)
  const shownSlug = slugEdited ? slug : slugify(title)
  // A new post starts as a draft, so nothing reaches the website by accident.
  const wasPublished = post?.status === 'published'
  const [published, setPublished] = useState(wasPublished)
  const [missingBody, setMissingBody] = useState(false)
  const [cover, setCover] = useState<File | null>(null)
  const [coverError, setCoverError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const busy = save.isPending || uploading
  const preview = useMemo(() => (cover ? URL.createObjectURL(cover) : (post?.cover_image_url ?? null)), [cover, post])
  useEffect(() => () => {
    if (preview?.startsWith('blob:')) URL.revokeObjectURL(preview)
  }, [preview])
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    if (body.trim() === '') {
      setMissingBody(true)
      return
    }
    setMissingBody(false)
    if (!cover && !post?.cover_image_url) {
      setCoverError('Upload a cover image for the post.')
      return
    }
    setCoverError(null)
    onBusy(true)
    try {
      let coverUrl = post?.cover_image_url ?? null
      if (cover) {
        setUploading(true)
        try {
          coverUrl = await uploadBlogCover(cover)
        } catch (error) {
          setCoverError(error instanceof Error ? error.message : 'Could not upload the cover image.')
          return
        } finally {
          setUploading(false)
        }
      }
      await save.mutateAsync({
        id: post?.id,
        title: title.trim(),
        slug: slugify(shownSlug),
        excerpt: blankToNull(form.get('excerpt')),
        content: body,
        category: String(form.get('category')) as BlogCategory,
        cover_image_url: coverUrl,
        cover_image_alt: blankToNull(form.get('cover_image_alt')),
        is_featured: form.get('is_featured') === 'on',
        status: published ? 'published' : 'draft',
      })
      onSaved(
        !published
          ? wasPublished
            ? 'Saved as a draft. The website no longer shows it.'
            : 'Draft saved. Only the app shows it.'
          : wasPublished
            ? 'Post saved. The website shows the new version.'
            : 'Post published on the website.',
      )
    } catch {
      // Shown below.
    } finally {
      onBusy(false)
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)}>
      <h2 id="post-dialog-title" className="text-base font-semibold text-slate-900">{post ? 'Edit post' : 'New post'}</h2>
      <fieldset disabled={busy} className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={`${id}-title`} className={label}>Title</label>
          <input id={`${id}-title`} name="title" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} aria-describedby={`${id}-title-hint`} className={input} />
          <p id={`${id}-title-hint`} className="mt-1 text-xs text-slate-600">Short and specific, under about 70 characters, e.g. “First track day of the season at the Hungaroring”.</p>
        </div>
        <div>
          <label htmlFor={`${id}-slug`} className={label}>Web address</label>
          <input
            id={`${id}-slug`}
            name="slug"
            required
            maxLength={80}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            title="Lower-case letters, numbers and dashes"
            value={shownSlug}
            onChange={(e) => {
              setSlugEdited(true)
              setSlug(e.target.value)
            }}
            aria-describedby={`${id}-slug-hint`}
            className={input}
          />
          <p id={`${id}-slug-hint`} className="mt-1 text-xs text-slate-600">Filled in from the title. Avoid changing it once published: old links would stop working.</p>
        </div>
        <div>
          <label htmlFor={`${id}-category`} className={label}>Category</label>
          <select id={`${id}-category`} name="category" defaultValue={post?.category ?? 'news'} className={input}>
            {BLOG_CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={`${id}-excerpt`} className={label}>Excerpt <span className="font-normal text-slate-500">(optional, shown in the list of posts)</span></label>
          <input id={`${id}-excerpt`} name="excerpt" maxLength={500} defaultValue={post?.excerpt ?? ''} aria-describedby={`${id}-excerpt-hint`} className={input} />
          <p id={`${id}-excerpt-hint`} className="mt-1 text-xs text-slate-600">One or two sentences that make people want to read on.</p>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={`${id}-cover`} className={label}>
            Cover image <span className="font-normal text-slate-500">(JPEG, PNG, WebP, AVIF or GIF, up to 10 MB)</span>
          </label>
          {preview && <img src={preview} alt="" className="mt-1 max-h-48 rounded border border-slate-200 object-cover" />}
          <input
            id={`${id}-cover`}
            type="file"
            accept={COVER_TYPES.join(',')}
            aria-describedby={coverError ? `${id}-cover-hint ${id}-cover-error` : `${id}-cover-hint`}
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null
              const problem = file && coverProblem(file)
              setCoverError(problem)
              setCover(problem ? null : file)
              if (problem) e.target.value = ''
            }}
            className="mt-1 block w-full text-sm text-slate-900 file:mr-3 file:min-h-9 file:rounded file:border file:border-slate-300 file:bg-surface file:px-3 file:text-sm"
          />
          <p id={`${id}-cover-hint`} className="mt-1 text-xs text-slate-600">
            Landscape works best: 1600 × 900 px (16:9) or larger. Keep the subject near the centre, since smaller previews crop the edges. Under 1 MB loads fastest.
          </p>
          {coverError && <p id={`${id}-cover-error`} role="alert" className="mt-1 text-sm text-red-800">{coverError}</p>}
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={`${id}-alt`} className={label}>Cover image description <span className="font-normal text-slate-500">(for screen readers)</span></label>
          <input id={`${id}-alt`} name="cover_image_alt" required maxLength={300} defaultValue={post?.cover_image_alt ?? ''} aria-describedby={`${id}-alt-hint`} className={input} />
          <p id={`${id}-alt-hint`} className="mt-1 text-xs text-slate-600">Say what the picture shows, e.g. “The team pushing the car out of the pit garage”. Skip “image of”.</p>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm text-slate-900 sm:col-span-2 sm:min-h-0">
          <input type="checkbox" name="is_featured" defaultChecked={post?.is_featured ?? false} className="size-4" />
          <span>
            Featured on the website <span className="text-xs text-slate-600">(highlighted above the other posts; use it for big news)</span>
          </span>
        </label>
        <div className="sm:col-span-2">
        <RichTextField id={`${id}-body`} label="Post" value={body} onChange={setBody} disabled={busy} placeholder="Write the post…"
          note="Open with the news, then the details. Use headings to split longer posts. Readers see about one minute per 200 words." />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:col-span-2">
          <PublishSwitch checked={published} onChange={setPublished} disabled={busy} label="Published on the public website" />
          <p className="text-sm text-slate-600">{published ? 'Saving puts it on the public website.' : 'Only people in the app see it.'}</p>
        </div>
      </fieldset>
      {missingBody && (
        <p role="alert" className="mt-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">Write something in the post before publishing it.</p>
      )}
      <ActionError error={save.error} className="mt-3" />
      <FormButtons busy={busy} onCancel={onCancel} submit={published ? (wasPublished ? 'Save post' : 'Publish post') : 'Save draft'} />
    </form>
  )
}

// ---------------------------------------------------------------------- shared

// ---------------------------------------------------------------------- events

// The website's own words for each type (SMC_public src/blog-data.js), so both sites say the same thing.
const EVENT_TYPE_LABELS: Record<EventType, string> = { ride: 'Group ride', track: 'Track day', meeting: 'Club meeting', workshop: 'Workshop', social: 'Social' }
const EVENT_SORT_LABELS: Record<EventSort, string> = { soonest: 'Soonest first', latest: 'Latest first', title: 'Title (A–Z)' }
const EVENT_WHEN_LABELS = { upcoming: 'Upcoming', past: 'Past', all: 'All' } as const
type EventWhen = keyof typeof EVENT_WHEN_LABELS
const SHOWN_STATES: [string, string] = ['Shown', 'Hidden']

type EventsEditing = { kind: 'event'; event: ClubEvent | null } | { kind: 'delete'; event: ClubEvent }

function Events() {
  const events = useEvents()
  const remove = useDeleteEvent()
  const toggle = useSaveEvent()
  const [toggling, setToggling] = useState<string | null>(null)
  const [editing, setEditing] = useState<EventsEditing | null>(null)
  const [message, setMessage] = useState('')
  const [params, setParams] = useUrlParams()
  const setFilter = (patch: Record<string, string | null>) => setParams((c) => mergeSearchParams(c, patch), { replace: true })
  const when = pick(params.get('event_when'), EVENT_WHEN_LABELS) ?? 'upcoming'
  const type = pick(params.get('event_type'), EVENT_TYPE_LABELS)
  const sort = pick(params.get('event_sort'), EVENT_SORT_LABELS) ?? 'soonest'
  const all = events.data ?? []
  // As with the blog, each group's counts follow the other group's choice.
  const inWhen = (e: ClubEvent, w: EventWhen = when) => w === 'all' || isUpcoming(e) === (w === 'upcoming')
  const ofType = (e: ClubEvent, t: EventType | null = type) => t === null || e.type === t
  const shown = orderEvents(all.filter((e) => inWhen(e) && ofType(e)), sort)
  const open = (next: EventsEditing) => {
    setMessage('')
    setEditing(next)
  }
  const done = (text: string) => {
    setEditing(null)
    setMessage(text)
  }
  const setShown = async (event: ClubEvent, on: boolean) => {
    setMessage('')
    setToggling(event.id)
    try {
      await toggle.mutateAsync({ id: event.id, is_published: on })
      setMessage(on ? `“${event.title}” is on the public website now.` : `“${event.title}” is hidden: the website no longer shows it.`)
    } catch {
      // Shown below the list.
    } finally {
      setToggling(null)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-slate-200 pb-1.5">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Events</h2>
          <p className="text-sm text-slate-600">The website’s blog page lists the next four shown events. An event drops off by itself the day after it happens.</p>
        </div>
        <button type="button" className={buttonPrimary} onClick={() => open({ kind: 'event', event: null })}>New event</button>
      </div>
      {all.length > 0 && (
        <div className="mt-2 flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1.5">
            <ChipFilter
              label="When"
              value={when}
              onChange={(v) => setFilter({ event_when: v === 'upcoming' ? null : v })}
              options={(Object.keys(EVENT_WHEN_LABELS) as EventWhen[]).map((w) => ({
                id: w,
                label: EVENT_WHEN_LABELS[w],
                count: all.filter((e) => ofType(e) && inWhen(e, w)).length,
              }))}
            />
            <ChipFilter
              label="Type"
              value={type}
              onChange={(v) => setFilter({ event_type: v })}
              options={[
                { id: null, label: 'All', count: all.filter((e) => inWhen(e)).length },
                ...EVENT_TYPES.map((t) => ({ id: t, label: EVENT_TYPE_LABELS[t], count: all.filter((e) => inWhen(e) && ofType(e, t)).length })),
              ]}
            />
          </div>
          <SortSelect value={sort} labels={EVENT_SORT_LABELS} onChange={(v) => setFilter({ event_sort: v === 'soonest' ? null : v })} />
        </div>
      )}
      <p role="status" className="my-2 min-h-5 text-sm text-emerald-800">{message}</p>
      {events.error ? (
        <ErrorState title="Could not load the events" error={events.error} onRetry={() => void events.refetch()} />
      ) : events.isPending ? (
        <LoadingState label="Loading events…" />
      ) : all.length === 0 ? (
        <EmptyState title="No events yet">Add one with “New event”. It shows on the website as soon as you save it, unless you hide it.</EmptyState>
      ) : shown.length === 0 ? (
        <NoMatch what="events" onClear={() => setFilter({ event_when: 'all', event_type: null })} />
      ) : (
        <ul className="space-y-2">
          {shown.map((event) => (
            <li key={event.id} className={card}>
              <p>
                <span className={statusBadge(event.is_published)}>{event.is_published ? 'Shown' : 'Hidden'}</span>{' '}
                <span className={statusBadge(false)}>{EVENT_TYPE_LABELS[event.type]}</span>{' '}
                <span className="font-medium text-slate-900">{event.title}</span>
              </p>
              <p className="mt-0.5 text-sm text-slate-600">
                {formatInstant(event.starts_at)}
                {event.location && ` · ${event.location}`}
                {!isUpcoming(event) && ' · past'}
              </p>
              {event.signup_url && (
                <a href={event.signup_url} target="_blank" rel="noopener noreferrer" className="mt-0.5 block truncate text-sm text-slate-700 underline">
                  {event.signup_url}
                </a>
              )}
              <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                <span className="mr-auto">
                  <PublishSwitch
                    checked={event.is_published}
                    disabled={toggling !== null}
                    label={`${event.title}: shown on the public website`}
                    states={SHOWN_STATES}
                    onChange={(on) => void setShown(event, on)}
                  />
                </span>
                <button type="button" aria-label={`Edit ${event.title}`} className={buttonSecondary} onClick={() => open({ kind: 'event', event })}>Edit</button>
                <button type="button" aria-label={`Delete ${event.title}`} className={buttonSecondary} onClick={() => open({ kind: 'delete', event })}>Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ActionError error={toggle.error} className="mt-3" />

      <Dialog open={editing?.kind === 'event'} onClose={() => setEditing(null)} labelledBy="event-dialog-title">
        {editing?.kind === 'event' && <EventForm event={editing.event} onCancel={() => setEditing(null)} onSaved={done} />}
      </Dialog>
      <Dialog open={editing?.kind === 'delete'} onClose={() => setEditing(null)} labelledBy="delete-dialog-title">
        {editing?.kind === 'delete' && (
          <ConfirmDelete
            what={`“${editing.event.title}”`}
            detail="It is taken off the public website at once. To keep it but take it off the website, hide it instead."
            remove={remove}
            id={editing.event.id}
            onCancel={() => setEditing(null)}
            onDeleted={() => done('Event deleted.')}
          />
        )}
      </Dialog>
    </div>
  )
}

function EventForm({ event, onCancel, onSaved }: { event: ClubEvent | null; onCancel: () => void; onSaved: (message: string) => void }) {
  const save = useSaveEvent()
  const id = useId()
  const [shown, setShown] = useState(event?.is_published ?? true)
  const hint = 'mt-1 text-xs text-slate-600'
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    try {
      await save.mutateAsync({
        id: event?.id,
        title: String(form.get('title')).trim(),
        type: String(form.get('type')) as EventType,
        // datetime-local is the reader's local time; new Date() reads it the same way.
        starts_at: new Date(String(form.get('starts_at'))).toISOString(),
        location: blankToNull(form.get('location')),
        signup_url: blankToNull(form.get('signup_url')),
        is_published: shown,
      })
      onSaved(shown ? (event ? 'Event saved. The website shows the new version.' : 'Event added. The website shows it now.') : 'Event saved as hidden. Only the app shows it.')
    } catch {
      // Shown below.
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)}>
      <h2 id="event-dialog-title" className="text-base font-semibold text-slate-900">{event ? 'Edit event' : 'New event'}</h2>
      <fieldset disabled={save.isPending} className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={`${id}-title`} className={label}>Name</label>
          <input id={`${id}-title`} name="title" required maxLength={200} defaultValue={event?.title ?? ''} aria-describedby={`${id}-title-hint`} className={input} />
          <p id={`${id}-title-hint`} className={hint}>What people will recognise, e.g. “Sunday ride to the coast” or “Spring track day”.</p>
        </div>
        <div>
          <label htmlFor={`${id}-type`} className={label}>Type</label>
          <select id={`${id}-type`} name="type" defaultValue={event?.type ?? 'meeting'} className={input}>
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>{EVENT_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-start`} className={label}>Starts</label>
          <input
            id={`${id}-start`}
            name="starts_at"
            type="datetime-local"
            required
            defaultValue={event ? toDateTimeInput(event.starts_at) : ''}
            aria-describedby={`${id}-start-hint`}
            className={input}
          />
          <p id={`${id}-start-hint`} className={hint}>Your own time zone. The website shows the day, weekday and start time in Danish time.</p>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={`${id}-location`} className={label}>Where <span className="font-normal text-slate-500">(optional)</span></label>
          <input id={`${id}-location`} name="location" maxLength={200} defaultValue={event?.location ?? ''} aria-describedby={`${id}-location-hint`} className={input} />
          <p id={`${id}-location-hint`} className={hint}>The place, or for a ride where it starts.</p>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={`${id}-signup`} className={label}>Sign-up link <span className="font-normal text-slate-500">(optional)</span></label>
          <input
            id={`${id}-signup`}
            name="signup_url"
            type="url"
            maxLength={500}
            pattern="https?://.+"
            title="A web address starting with https://"
            placeholder="https://…"
            defaultValue={event?.signup_url ?? ''}
            aria-describedby={`${id}-signup-hint`}
            className={input}
          />
          <p id={`${id}-signup-hint`} className={hint}>A form or Facebook event. With a link, the event’s name on the website becomes clickable.</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:col-span-2">
          <PublishSwitch checked={shown} onChange={setShown} disabled={save.isPending} label="Shown on the public website" states={SHOWN_STATES} />
          <p className="text-sm text-slate-600">{shown ? 'Saving puts it on the public website.' : 'Only people in the app see it.'}</p>
        </div>
      </fieldset>
      <ActionError error={save.error} className="mt-3" />
      <FormButtons busy={save.isPending} onCancel={onCancel} submit={event ? 'Save event' : 'Add event'} />
    </form>
  )
}

function ConfirmDelete({
  what,
  detail,
  remove,
  id,
  onCancel,
  onDeleted,
}: {
  what: string
  detail: string
  remove: { mutateAsync: (id: string) => Promise<void>; isPending: boolean; error: Error | null }
  id: string
  onCancel: () => void
  onDeleted: () => void
}) {
  async function confirm() {
    try {
      await remove.mutateAsync(id)
      onDeleted()
    } catch {
      // Shown below.
    }
  }
  return (
    <div>
      <h2 id="delete-dialog-title" className="text-base font-semibold text-balance text-slate-900">Delete {what}?</h2>
      <p className="mt-2 text-sm text-slate-700">{detail}</p>
      <ActionError error={remove.error} className="mt-3" />
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button type="button" className={buttonSecondary} disabled={remove.isPending} onClick={onCancel}>Cancel</button>
        <button type="button" className={buttonDanger} disabled={remove.isPending} onClick={() => void confirm()}>
          {remove.isPending ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </div>
  )
}

function FormButtons({ busy, onCancel, submit }: { busy: boolean; onCancel: () => void; submit: string }) {
  return (
    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
      <button type="button" className={buttonSecondary} disabled={busy} onClick={onCancel}>Cancel</button>
      <button type="submit" className={buttonPrimary} disabled={busy}>{busy ? 'Saving…' : submit}</button>
    </div>
  )
}
