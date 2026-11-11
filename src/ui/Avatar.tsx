import { useIsOnline } from '../presence/context.ts'
import { initialsOf } from './initials.ts'

// A person's picture, or their initials when they have none. Decorative on its own: the name always sits beside
// it, so a screen reader hears the name once, not "image" and then the name. With the member's id it also shows a
// small green ball while that member is online (presence/PresenceProvider); the ball is announced as “Online”.
const SIZE = {
  xs: 'size-5 text-[9px]',
  sm: 'size-7 text-[11px]',
  md: 'size-10 text-sm',
  lg: 'size-24 text-3xl',
} as const

// The ball sits on the bottom-right edge; on the big picture it moves to the top-right, where the camera button is not.
const DOT = {
  xs: 'size-1.5 right-0 bottom-0',
  sm: 'size-2 right-0 bottom-0',
  md: 'size-2.5 right-0 bottom-0',
  lg: 'size-4 right-1 top-1',
} as const

export function Avatar({
  name,
  image,
  size = 'md',
  memberId,
}: {
  name: string
  image?: string | null
  size?: keyof typeof SIZE
  memberId?: string | null
}) {
  const online = useIsOnline(memberId)
  const box = `${SIZE[size]} inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full`
  const picture = image ? (
    <img src={image} alt="" aria-hidden="true" decoding="async" className={`${box} object-cover`} data-testid="avatar-image" />
  ) : (
    <span aria-hidden="true" className={`${box} bg-slate-200 font-semibold text-slate-700`} data-testid="avatar-initials">
      {initialsOf(name)}
    </span>
  )
  if (!online) return picture
  return (
    <span className="relative inline-flex shrink-0">
      {picture}
      <span title="Online" className={`absolute ${DOT[size]} rounded-full bg-emerald-500 ring-2 ring-surface`} data-testid="online-dot" />
      <span className="sr-only">Online</span>
    </span>
  )
}
