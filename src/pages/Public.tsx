import { useId, useState, type FormEvent } from 'react'
import { usePermissions } from '../auth/usePermissions.ts'
import {
  APPLICATION_STATUSES,
  BLOG_CATEGORIES,
  readingMinutes,
  slugify,
  useApplicationQuestions,
  useApplications,
  useBlogPosts,
  useDeleteApplication,
  useDeleteBlogPost,
  useDeleteQuestion,
  useSaveBlogPost,
  useSaveQuestion,
  useSetApplicationStatus,
  type ApplicationQuestion,
  type ApplicationStatus,
  type BlogCategory,
  type BlogPost,
} from '../data/usePublicSite.ts'
import { formatInstant } from '../lib/dates.ts'
import { mergeSearchParams } from '../lib/searchParams.ts'
import { useUrlParams } from '../lib/useUrlParams.ts'
import { MeetingText } from '../meetings/MeetingText.tsx'
import { RichTextField } from '../meetings/RichTextField.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { PageHeader } from '../ui/PageHeader.tsx'
import { buttonDanger, buttonPrimary, buttonSecondary } from '../ui/buttons.ts'
import { pageMain } from '../ui/layout.ts'
import { ActionError, EmptyState, ErrorState, LoadingState } from '../ui/states.tsx'

// The club's public website, run from here: the application form's questions and the applications people send
// (Recruitment, can_manage_applicants()), and the blog (Blog, can_post_blog()). The website reads the same rows,
// so a saved question or post is live there at once. The database checks every write (20260162000100).

const input =
  'mt-1 block min-h-11 w-full rounded border border-slate-300 bg-surface px-2.5 text-base text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring sm:min-h-9 sm:text-sm'
const label = 'block text-sm font-medium text-slate-900'
const chip = (active: boolean) =>
  `inline-flex min-h-11 items-center gap-1 rounded-full border px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring sm:min-h-8 ${
    active ? 'border-slate-400 bg-slate-200 text-slate-950' : 'border-slate-300 bg-surface text-slate-700 hover:bg-slate-100'
  }`
const card = 'rounded-lg border border-slate-200 bg-surface p-3'
const blankToNull = (value: FormDataEntryValue | null) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null)

type Section = 'applicants' | 'blog'

export default function Public() {
  const can = usePermissions()
  const [params, setParams] = useUrlParams()
  const sections: { id: Section; label: string }[] = [
    ...(can.canManageApplicants ? [{ id: 'applicants' as const, label: 'Applicants' }] : []),
    ...(can.canPostBlog ? [{ id: 'blog' as const, label: 'Blog' }] : []),
  ]
  const current = sections.find((s) => s.id === params.get('section'))?.id ?? sections[0]?.id

  return (
    <main id="main-content" tabIndex={-1} className={pageMain('wide')}>
      <PageHeader title="Public" tutorialId="public-overview" description="What the club’s public website shows: the application form, the people who applied, and the blog." />
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
          {current === 'applicants' ? <Applicants /> : <Blog />}
        </>
      )}
    </main>
  )
}

// ------------------------------------------------------------------ applicants

const STATUS_LABELS: Record<ApplicationStatus, string> = { new: 'New', contacted: 'Contacted', accepted: 'Accepted', rejected: 'Rejected' }
const applicationBadge = (status: ApplicationStatus) =>
  `inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
    {
      new: 'bg-sky-50 text-sky-800 ring-sky-200',
      contacted: 'bg-amber-50 text-amber-900 ring-amber-200',
      accepted: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
      rejected: 'bg-slate-100 text-slate-700 ring-slate-300',
    }[status]
  }`

type ApplicantsEditing =
  | { kind: 'question'; question: ApplicationQuestion | null }
  | { kind: 'delete-question'; question: ApplicationQuestion }
  | { kind: 'delete-application'; id: string; name: string }

function Applicants() {
  const questions = useApplicationQuestions()
  const applications = useApplications()
  const deleteQuestion = useDeleteQuestion()
  const deleteApplication = useDeleteApplication()
  const setStatus = useSetApplicationStatus()
  const [editing, setEditing] = useState<ApplicantsEditing | null>(null)
  const [message, setMessage] = useState('')
  const open = (next: ApplicantsEditing) => {
    setMessage('')
    setEditing(next)
  }
  const done = (text: string) => {
    setEditing(null)
    setMessage(text)
  }
  const list = questions.data ?? []

  return (
    <div className="space-y-8">
      <p role="status" className="min-h-5 text-sm text-emerald-800">{message}</p>

      <section aria-labelledby="questions-title">
        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-slate-200 pb-1.5">
          <div>
            <h2 id="questions-title" className="text-base font-semibold text-slate-900">Application form</h2>
            <p className="text-sm text-slate-600">Everyone who applies gives their name, email and (optionally) phone, then answers these, in this order.</p>
          </div>
          <button type="button" className={buttonPrimary} onClick={() => open({ kind: 'question', question: null })}>New question</button>
        </div>
        {questions.error ? (
          <ErrorState title="Could not load the questions" error={questions.error} onRetry={() => void questions.refetch()} />
        ) : questions.isPending ? (
          <LoadingState label="Loading questions…" />
        ) : list.length === 0 ? (
          <p className="py-3 text-sm text-slate-600">No questions yet: the form asks only for a name and an email.</p>
        ) : (
          <ol className="mt-2 space-y-2">
            {list.map((q) => (
              <li key={q.id} className={`${card} flex flex-wrap items-start justify-between gap-2`}>
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">
                    {q.prompt}
                    {q.required && <span className="font-normal text-slate-600"> · required</span>}
                  </p>
                  <p className="text-sm text-slate-600">
                    {q.kind === 'long' ? 'Paragraph' : 'One line'}
                    {q.help && ` · ${q.help}`}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button type="button" aria-label={`Edit ${q.prompt}`} className={buttonSecondary} onClick={() => open({ kind: 'question', question: q })}>Edit</button>
                  <button type="button" aria-label={`Delete ${q.prompt}`} className={buttonSecondary} onClick={() => open({ kind: 'delete-question', question: q })}>Delete</button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="applications-title">
        <div className="border-b border-slate-200 pb-1.5">
          <h2 id="applications-title" className="text-base font-semibold text-slate-900">
            Applications {applications.data && <span className="font-normal text-slate-600">({applications.data.length})</span>}
          </h2>
          <p className="text-sm text-slate-600">Newest first. Each shows the questions as they were worded when the person applied.</p>
        </div>
        {applications.error ? (
          <ErrorState title="Could not load the applications" error={applications.error} onRetry={() => void applications.refetch()} />
        ) : applications.isPending ? (
          <LoadingState label="Loading applications…" />
        ) : applications.data.length === 0 ? (
          <p className="py-3 text-sm text-slate-600">Nobody has applied yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {applications.data.map((a) => (
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

      <Dialog open={editing?.kind === 'question'} onClose={() => setEditing(null)} labelledBy="question-dialog-title">
        {editing?.kind === 'question' && (
          <QuestionForm question={editing.question} nextPosition={list.length === 0 ? 1 : Math.max(...list.map((q) => q.position)) + 1} onCancel={() => setEditing(null)} onSaved={done} />
        )}
      </Dialog>
      <Dialog open={editing?.kind === 'delete-question' || editing?.kind === 'delete-application'} onClose={() => setEditing(null)} labelledBy="delete-dialog-title">
        {editing?.kind === 'delete-question' && (
          <ConfirmDelete
            what={`the question “${editing.question.prompt}”`}
            detail="The website stops asking it. Applications already sent keep their answer to it."
            remove={deleteQuestion}
            id={editing.question.id}
            onCancel={() => setEditing(null)}
            onDeleted={() => done('Question deleted.')}
          />
        )}
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

function QuestionForm({
  question,
  nextPosition,
  onCancel,
  onSaved,
}: {
  question: ApplicationQuestion | null
  nextPosition: number
  onCancel: () => void
  onSaved: (message: string) => void
}) {
  const save = useSaveQuestion()
  const id = useId()
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    try {
      await save.mutateAsync({
        id: question?.id,
        prompt: blankToNull(form.get('prompt')) ?? '',
        help: blankToNull(form.get('help')),
        kind: form.get('kind') === 'long' ? 'long' : 'short',
        required: form.get('required') === 'on',
        position: Number(form.get('position')) || 0,
      })
      onSaved(question ? 'Question saved. The website shows it now.' : 'Question added. The website asks it now.')
    } catch {
      // Shown below.
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)}>
      <h2 id="question-dialog-title" className="text-base font-semibold text-slate-900">{question ? 'Edit question' : 'New question'}</h2>
      <fieldset disabled={save.isPending} className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={`${id}-prompt`} className={label}>Question</label>
          <input id={`${id}-prompt`} name="prompt" required maxLength={300} defaultValue={question?.prompt ?? ''} placeholder="Why do you want to join?" className={input} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={`${id}-help`} className={label}>Hint <span className="font-normal text-slate-500">(optional)</span></label>
          <input id={`${id}-help`} name="help" maxLength={500} defaultValue={question?.help ?? ''} placeholder="A few sentences is enough" className={input} />
        </div>
        <div>
          <label htmlFor={`${id}-kind`} className={label}>Answer</label>
          <select id={`${id}-kind`} name="kind" defaultValue={question?.kind ?? 'short'} className={input}>
            <option value="short">One line</option>
            <option value="long">Paragraph</option>
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-position`} className={label}>Order</label>
          <input id={`${id}-position`} name="position" type="number" step={1} defaultValue={question?.position ?? nextPosition} className={input} />
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm text-slate-900 sm:col-span-2 sm:min-h-0">
          <input type="checkbox" name="required" defaultChecked={question?.required ?? false} className="size-4" />
          Required
        </label>
      </fieldset>
      <ActionError error={save.error} className="mt-3" />
      <FormButtons busy={save.isPending} onCancel={onCancel} submit={question ? 'Save question' : 'Add question'} />
    </form>
  )
}

// ------------------------------------------------------------------------ blog

type BlogEditing = { kind: 'post'; post: BlogPost | null } | { kind: 'delete'; post: BlogPost }

// A native checkbox announced as a switch, drawn as one. The words beside it say what each position means.
function PublishSwitch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (on: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-slate-900 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 sm:min-h-8">
      <input type="checkbox" role="switch" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span
        aria-hidden="true"
        className="relative h-5 w-9 shrink-0 rounded-full bg-slate-300 transition-colors peer-checked:bg-emerald-600 peer-focus-visible:ring-2 peer-focus-visible:ring-accent-ring after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-surface after:transition-transform peer-checked:after:translate-x-4 motion-reduce:transition-none motion-reduce:after:transition-none"
      />
      <span>{checked ? 'Published' : 'Draft'}</span>
    </label>
  )
}

const CATEGORY_LABELS: Record<BlogCategory, string> = { news: 'News', ride: 'Ride', track: 'Track', tech: 'Tech' }

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
      <p role="status" className="my-2 min-h-5 text-sm text-emerald-800">{message}</p>
      {posts.error ? (
        <ErrorState title="Could not load the posts" error={posts.error} onRetry={() => void posts.refetch()} />
      ) : posts.isPending ? (
        <LoadingState label="Loading posts…" />
      ) : posts.data.length === 0 ? (
        <EmptyState title="No posts yet">Start with “New post”. Save it as a draft, or switch it to Published to put it on the website.</EmptyState>
      ) : (
        <ul className="space-y-2">
          {posts.data.map((post) => (
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
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    if (body.trim() === '') {
      setMissingBody(true)
      return
    }
    setMissingBody(false)
    onBusy(true)
    try {
      await save.mutateAsync({
        id: post?.id,
        title: title.trim(),
        slug: slugify(shownSlug),
        excerpt: blankToNull(form.get('excerpt')),
        content: body,
        category: String(form.get('category')) as BlogCategory,
        cover_image_url: blankToNull(form.get('cover_image_url')),
        cover_image_alt: blankToNull(form.get('cover_image_alt')),
        is_featured: form.get('is_featured') === 'on',
        reading_minutes: readingMinutes(body),
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
      <fieldset disabled={save.isPending} className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={`${id}-title`} className={label}>Title</label>
          <input id={`${id}-title`} name="title" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} className={input} />
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
            className={input}
          />
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
          <input id={`${id}-excerpt`} name="excerpt" maxLength={500} defaultValue={post?.excerpt ?? ''} className={input} />
        </div>
        <div>
          <label htmlFor={`${id}-cover`} className={label}>Cover image link <span className="font-normal text-slate-500">(optional)</span></label>
          <input id={`${id}-cover`} name="cover_image_url" type="url" maxLength={500} defaultValue={post?.cover_image_url ?? ''} placeholder="https://…" className={input} />
        </div>
        <div>
          <label htmlFor={`${id}-alt`} className={label}>Cover image description <span className="font-normal text-slate-500">(for screen readers)</span></label>
          <input id={`${id}-alt`} name="cover_image_alt" maxLength={300} defaultValue={post?.cover_image_alt ?? ''} className={input} />
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm text-slate-900 sm:col-span-2 sm:min-h-0">
          <input type="checkbox" name="is_featured" defaultChecked={post?.is_featured ?? false} className="size-4" />
          Featured on the website
        </label>
        <div className="sm:col-span-2">
        <RichTextField id={`${id}-body`} label="Post" value={body} onChange={setBody} disabled={save.isPending} placeholder="Write the post…" />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:col-span-2">
          <PublishSwitch checked={published} onChange={setPublished} disabled={save.isPending} label="Published on the public website" />
          <p className="text-sm text-slate-600">{published ? 'Saving puts it on the public website.' : 'Only people in the app see it.'}</p>
        </div>
      </fieldset>
      {missingBody && (
        <p role="alert" className="mt-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">Write something in the post before publishing it.</p>
      )}
      <ActionError error={save.error} className="mt-3" />
      <FormButtons busy={save.isPending} onCancel={onCancel} submit={published ? (wasPublished ? 'Save post' : 'Publish post') : 'Save draft'} />
    </form>
  )
}

// ---------------------------------------------------------------------- shared

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
