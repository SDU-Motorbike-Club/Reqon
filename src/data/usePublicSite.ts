import { useMutation, useQuery, useQueryClient, type QueryKey, type UseQueryResult } from '@tanstack/react-query'
import type { PostgrestError } from '@supabase/supabase-js'
import { DataError } from '../core/errors.ts'
import type { Database, Json } from '../lib/database.types.ts'
import { supabase } from '../lib/supabase.ts'
import { unwrap } from './errors.ts'
import { queryKeys } from './queryKeys.ts'

// The public website reads these same tables with the anon key (20260162000100, 20260163000200): a post switched
// to published, or a shown event, is live there at once. Drafts and hidden events never leave the app.

type Public = Database['public']
export type BlogPost = Public['Tables']['blog_posts']['Row']
export type BlogCategory = Public['Enums']['blog_category']
export type ApplicationStatus = Public['Enums']['membership_application_status']
export type ClubEvent = Public['Tables']['events']['Row']
export type EventType = Public['Enums']['club_event_type']
export type EventInput = Pick<ClubEvent, 'title' | 'type' | 'starts_at' | 'location' | 'signup_url' | 'is_published'>
export type ApplicationAnswer = { question: string; answer: string | null }
export type Application = Omit<Public['Tables']['membership_applications']['Row'], 'answers'> & { answers: ApplicationAnswer[] }

export type BlogPostInput = Pick<
  BlogPost,
  'title' | 'slug' | 'excerpt' | 'content' | 'category' | 'cover_image_url' | 'cover_image_alt' | 'is_featured' | 'status'
>

export const BLOG_CATEGORIES: readonly BlogCategory[] = ['news', 'ride', 'track', 'tech']
export const APPLICATION_STATUSES: readonly ApplicationStatus[] = ['new', 'contacted', 'accepted', 'rejected']
export const EVENT_TYPES: readonly EventType[] = ['ride', 'track', 'meeting', 'workshop', 'social']

// submit_application() stores [{question, answer}]; an application sent another way may hold a plain
// {question: answer} object. Both read the same here.
export function readAnswers(answers: Json): ApplicationAnswer[] {
  if (Array.isArray(answers)) {
    return answers.flatMap((a) =>
      a && typeof a === 'object' && !Array.isArray(a) && typeof a.question === 'string'
        ? [{ question: a.question, answer: a.answer == null ? null : String(a.answer) }]
        : [],
    )
  }
  if (answers && typeof answers === 'object') {
    return Object.entries(answers).map(([question, answer]) => ({
      question,
      answer: answer == null ? null : typeof answer === 'string' ? answer : JSON.stringify(answer),
    }))
  }
  return []
}

// "Our first track day!" -> "our-first-track-day": the post's address on the website.
export function slugify(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

// Listing orders on the Public page. Ties fall back to newest first.
export type ApplicationSort = 'newest' | 'oldest' | 'name' | 'status'
export type PostSort = 'drafts' | 'newest' | 'oldest' | 'title' | 'category'
export type EventSort = 'soonest' | 'latest' | 'title'
const newestFirst = (a: string, b: string) => b.localeCompare(a)

export function orderApplications(list: readonly Application[], sort: ApplicationSort): Application[] {
  const rank = (a: Application) => APPLICATION_STATUSES.indexOf(a.status)
  return [...list].sort(
    (a, b) =>
      (sort === 'oldest'
        ? a.created_at.localeCompare(b.created_at)
        : sort === 'name'
          ? a.full_name.localeCompare(b.full_name)
          : sort === 'status'
            ? rank(a) - rank(b)
            : 0) || newestFirst(a.created_at, b.created_at),
  )
}

// A post's date is when it went out, or for a draft when it was last edited.
const postDate = (p: BlogPost) => p.published_at ?? p.updated_at

export function orderPosts(list: readonly BlogPost[], sort: PostSort): BlogPost[] {
  const rank = (p: BlogPost) => BLOG_CATEGORIES.indexOf(p.category)
  return [...list].sort(
    (a, b) =>
      (sort === 'drafts'
        ? Number(a.status === 'published') - Number(b.status === 'published')
        : sort === 'oldest'
          ? postDate(a).localeCompare(postDate(b))
          : sort === 'title'
            ? a.title.localeCompare(b.title)
            : sort === 'category'
              ? rank(a) - rank(b)
              : 0) || newestFirst(postDate(a), postDate(b)),
  )
}

export function orderEvents(list: readonly ClubEvent[], sort: EventSort): ClubEvent[] {
  return [...list].sort(
    (a, b) =>
      (sort === 'title' ? a.title.localeCompare(b.title) : 0) ||
      (sort === 'latest' ? b.starts_at.localeCompare(a.starts_at) : a.starts_at.localeCompare(b.starts_at)),
  )
}

// The website lists an event from the start of the day it is on (fetchUpcomingEvents), so "upcoming" here does too.
export function isUpcoming(event: ClubEvent, now = new Date()): boolean {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  return new Date(event.starts_at) >= today
}

// Recruitment or a Developer (reqon_applications_read); anyone else gets an empty list.
export function useApplications(): UseQueryResult<Application[], Error> {
  return useQuery({
    queryKey: queryKeys.applications,
    queryFn: async () => {
      const rows = unwrap('load the applications', await supabase.from('membership_applications').select('*').order('created_at', { ascending: false }))
      return rows.map((row) => ({ ...row, answers: readAnswers(row.answers) }))
    },
  })
}

export function useBlogPosts(): UseQueryResult<BlogPost[], Error> {
  return useQuery({
    queryKey: queryKeys.blogPosts,
    // Drafts first (published_at is null), then the newest published.
    queryFn: async () =>
      unwrap(
        'load the blog posts',
        await supabase.from('blog_posts').select('*').order('published_at', { ascending: false, nullsFirst: true }).order('updated_at', { ascending: false }),
      ),
  })
}

// A write RLS refuses as an UPDATE or DELETE matches no row instead of failing, so "nothing changed" is reported
// rather than shown as success (same as useContacts).
function useWrite<T>(what: string, key: QueryKey, write: (input: T) => PromiseLike<{ data: unknown[] | null; error: PostgrestError | null }>) {
  const queryClient = useQueryClient()
  return useMutation<void, Error, T>({
    mutationFn: async (input) => {
      const { data, error } = await write(input)
      if (error?.code === '23505') throw new DataError('Another post already uses that web address. Change the address and save again.', null)
      if (error?.code === '23514') throw new DataError('Something in the form is too long or empty. Check it and try again.', null)
      if (error || !data || data.length === 0) throw new DataError(what, error, error ? {} : { permission: true })
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })
}

export function useSetApplicationStatus() {
  return useWrite<{ id: string; status: ApplicationStatus }>('change that application', queryKeys.applications, ({ id, status }) =>
    supabase.from('membership_applications').update({ status }).eq('id', id).select('id'),
  )
}

export function useDeleteApplication() {
  return useWrite<string>('delete that application', queryKeys.applications, (id) =>
    supabase.from('membership_applications').delete().eq('id', id).select('id'),
  )
}

// Cover images live in the website's public `blog-images` bucket (20260163000100); the post keeps the public URL.
export const COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'] as const
export const COVER_MAX_BYTES = 10 * 1024 * 1024

export function coverProblem(file: File): string | null {
  if (!(COVER_TYPES as readonly string[]).includes(file.type)) return 'The cover must be a JPEG, PNG, WebP, AVIF or GIF image.'
  if (file.size > COVER_MAX_BYTES) return 'The cover image is larger than 10 MB. Pick a smaller one.'
  return null
}

export async function uploadBlogCover(file: File): Promise<string> {
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase().replace(/[^a-z0-9]/g, '') : ''
  const path = `covers/${crypto.randomUUID()}${ext ? `.${ext}` : ''}`
  const bucket = supabase.storage.from('blog-images')
  const { error } = await bucket.upload(path, file, { contentType: file.type, cacheControl: '31536000' })
  if (error) throw new DataError(`Could not upload the cover image: ${error.message}`, null)
  return bucket.getPublicUrl(path).data.publicUrl
}

// A full post to create or replace, or just { id, status } to publish or unpublish one.
export function useSaveBlogPost() {
  return useWrite<(BlogPostInput & { id?: string }) | { id: string; status: BlogPost['status'] }>('save that post', queryKeys.blogPosts, ({ id, ...row }) =>
    id ? supabase.from('blog_posts').update(row).eq('id', id).select('id') : supabase.from('blog_posts').insert(row as BlogPostInput).select('id'),
  )
}

// Blog or a Developer sees hidden events too (reqon_events_write); anyone else only the shown ones.
export function useEvents(): UseQueryResult<ClubEvent[], Error> {
  return useQuery({
    queryKey: queryKeys.events,
    queryFn: async () => unwrap('load the events', await supabase.from('events').select('*').order('starts_at')),
  })
}

// A full event to create or replace, or just { id, is_published } to show or hide one.
export function useSaveEvent() {
  return useWrite<(EventInput & { id?: string }) | { id: string; is_published: boolean }>('save that event', queryKeys.events, ({ id, ...row }) =>
    id ? supabase.from('events').update(row).eq('id', id).select('id') : supabase.from('events').insert(row as EventInput).select('id'),
  )
}

export function useDeleteEvent() {
  return useWrite<string>('delete that event', queryKeys.events, (id) => supabase.from('events').delete().eq('id', id).select('id'))
}

export function useDeleteBlogPost() {
  return useWrite<string>('delete that post', queryKeys.blogPosts, (id) => supabase.from('blog_posts').delete().eq('id', id).select('id'))
}
