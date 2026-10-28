import { initialsOf } from './initials.ts'

// A person's picture, or their initials when they have none. Decorative on its own: the name always sits beside
// it, so a screen reader hears the name once, not "image" and then the name.
const SIZE = {
  sm: 'size-7 text-[11px]',
  md: 'size-10 text-sm',
  lg: 'size-24 text-3xl',
} as const

export function Avatar({ name, image, size = 'md' }: { name: string; image?: string | null; size?: keyof typeof SIZE }) {
  const box = `${SIZE[size]} inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full`
  if (image) {
    return <img src={image} alt="" aria-hidden="true" decoding="async" className={`${box} object-cover`} data-testid="avatar-image" />
  }
  return (
    <span aria-hidden="true" className={`${box} bg-slate-200 font-semibold text-slate-700`} data-testid="avatar-initials">
      {initialsOf(name)}
    </span>
  )
}
