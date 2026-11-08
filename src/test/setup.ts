import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

// The Supabase client reads these at import time and throws without them.
// Tests never reach the network — the client module is mocked per test file.
vi.stubEnv('VITE_SUPABASE_URL', 'http://localhost:54321')
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key')

// waitFor / findBy* give up after 1s by default, which a slow file (settings.test.tsx takes ~25s) can exceed on a loaded
// machine or under coverage. A longer ceiling costs nothing when the UI is ready; it only stops the suite flaking.
if (typeof window !== 'undefined') {
  const { configure } = await import('@testing-library/react')
  configure({ asyncUtilTimeout: 4000 })
}

// jsdom has <dialog> but not its modal methods. Enough of them for the app's
// Dialog component; real browsers add the rest (inertness, focus return).
// (Node-environment tests, such as scripts/book, have no window at all.)
const dialogProto = typeof window === 'undefined' ? undefined : window.HTMLDialogElement?.prototype
if (dialogProto && typeof dialogProto.showModal !== 'function') {
  if (!Object.getOwnPropertyDescriptor(dialogProto, 'open')) {
    Object.defineProperty(dialogProto, 'open', {
      configurable: true,
      get(this: HTMLDialogElement) {
        return this.hasAttribute('open')
      },
      set(this: HTMLDialogElement, value: boolean) {
        if (value) this.setAttribute('open', '')
        else this.removeAttribute('open')
      },
    })
  }
  dialogProto.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  dialogProto.show = dialogProto.showModal
  dialogProto.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
}
