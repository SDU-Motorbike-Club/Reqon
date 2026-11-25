import { useState, type InputHTMLAttributes } from 'react'

// A password field with an eye button on its right edge: open eye = "show it", slashed eye = "hide it".
// Pass the same className as for a plain <input>; its block margins collapse out of the wrapper, so the
// button always lines up with the field itself. The field must be display:block (`block` in className).
export function PasswordInput({ className = '', ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [shown, setShown] = useState(false)
  return (
    <div className="relative">
      <input {...props} type={shown ? 'text' : 'password'} className={`${className} pr-10`} />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        disabled={props.disabled}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r text-slate-500 transition-[color,transform] duration-150 hover:text-slate-800 active:scale-90 motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring disabled:opacity-50"
      >
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
          {/* The slash draws itself across the eye; pathLength=1 keeps the dash maths unit-free. */}
          <path
            d="m3 3 18 18"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={shown ? 0 : 1}
            className="transition-[stroke-dashoffset] duration-200 ease-out motion-reduce:transition-none"
          />
        </svg>
      </button>
    </div>
  )
}
