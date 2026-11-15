import { useMutation, useQuery, useQueryClient, type QueryKey, type UseQueryResult } from '@tanstack/react-query'
import type { PostgrestError } from '@supabase/supabase-js'
import { DataError } from '../core/errors.ts'
import type { Database, Json } from '../lib/database.types.ts'
import { supabase } from '../lib/supabase.ts'
import { unwrap } from './errors.ts'
import { queryKeys } from './queryKeys.ts'

// The public website reads these same tables with the anon key (20260162000100): a saved question, or a post
// switched to published, is live there at once. Drafts never leave the app.

type Public = Database['public']
export type ApplicationQuestion = Public['Tables']['application_questions']['Row']
export type BlogPost = Public['Tables']['blog_posts']['Row']
export type BlogCategory = Public['Enums']['blog_category']
export type ApplicationStatus = Public['Enums']['membership_application_status']
export type ApplicationAnswer = { question: string; answer: string | null }
export type Application = Omit<Public['Tables']['membership_applications']['Row'], 'answers'> & { answers: ApplicationAnswer[] }

export type QuestionInput = Pick<ApplicationQuestion, 'prompt' | 'help' | 'kind' | 'required' | 'position'>
export type BlogPostInput = Pick<
  BlogPost,
  'title' | 'slug' | 'excerpt' | 'content' | 'category' | 'cover_image_url' | 'cover_image_alt' | 'is_featured' | 'reading_minutes' | 'status'
>

export const BLOG_CATEGORIES: readonly BlogCategory[] = ['news', 'ride', 'track', 'tech']
export const APPLICATION_STATUSES: readonly ApplicationStatus[] = ['new', 'contacted', 'accepted', 'rejected']

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

// About 200 words a minute, never less than one.
export function readingMinutes(markdown: string): number {
  const words = markdown.split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.round(words / 200))
}

export function useApplicationQuestions(): UseQueryResult<ApplicationQuestion[], Error> {
  return useQuery({
    queryKey: queryKeys.applicationQuestions,
    queryFn: async () =>
      unwrap('load the application questions', await supabase.from('application_questions').select('*').order('position').order('created_at')),
  })
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

export function useSaveQuestion() {
  return useWrite<QuestionInput & { id?: string }>('save that question', queryKeys.applicationQuestions, ({ id, ...row }) =>
    id
      ? supabase.from('application_questions').update(row).eq('id', id).select('id')
      : supabase.from('application_questions').insert(row).select('id'),
  )
}

export function useDeleteQuestion() {
  return useWrite<string>('delete that question', queryKeys.applicationQuestions, (id) =>
    supabase.from('application_questions').delete().eq('id', id).select('id'),
  )
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

// A full post to create or replace, or just { id, status } to publish or unpublish one.
export function useSaveBlogPost() {
  return useWrite<(BlogPostInput & { id?: string }) | { id: string; status: BlogPost['status'] }>('save that post', queryKeys.blogPosts, ({ id, ...row }) =>
    id ? supabase.from('blog_posts').update(row).eq('id', id).select('id') : supabase.from('blog_posts').insert(row as BlogPostInput).select('id'),
  )
}

export function useDeleteBlogPost() {
  return useWrite<string>('delete that post', queryKeys.blogPosts, (id) => supabase.from('blog_posts').delete().eq('id', id).select('id'))
}
