import { beforeEach, describe, expect, it, vi } from 'vitest'

// Importers: none (a test). Supabase is replaced; nothing is written anywhere.
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), log: [] as string[], release: null as null | (() => void) }))
vi.mock('../lib/supabase.ts', () => ({ supabase: { rpc: mocks.rpc } }))

const { endPresence, resumePresence, touchPresence } = await import('./usePresence.ts')

beforeEach(() => {
  mocks.log = []
  mocks.release = null
  resumePresence()
  mocks.rpc.mockReset()
  mocks.rpc.mockImplementation(async (name: string) => {
    mocks.log.push(`${name}:start`)
    if (name === 'touch_presence' && mocks.release === null) {
      // A slow ping, finished only when the test says so.
      await new Promise<void>((resolve) => {
        mocks.release = resolve
      })
    }
    mocks.log.push(`${name}:done`)
    return { data: null, error: null }
  })
})

describe('touchPresence and endPresence', () => {
  it('waits for a ping still on its way before ending, so the ping cannot land after the sign-out', async () => {
    void touchPresence()
    await vi.waitFor(() => expect(mocks.log).toEqual(['touch_presence:start']))
    const ending = endPresence()
    // end_presence has not been sent while the ping is unfinished.
    await Promise.resolve()
    expect(mocks.log).toEqual(['touch_presence:start'])
    mocks.release?.()
    await ending
    expect(mocks.log).toEqual(['touch_presence:start', 'touch_presence:done', 'end_presence:start', 'end_presence:done'])
  })

  it('sends no more pings once ended, until presence resumes', async () => {
    await endPresence()
    mocks.rpc.mockClear()
    await touchPresence()
    expect(mocks.rpc).not.toHaveBeenCalled()
    resumePresence()
    mocks.release = () => {}
    await touchPresence()
    expect(mocks.rpc).toHaveBeenCalledWith('touch_presence')
  })

  it('swallows a ping that fails or throws at once: presence never shows an error', async () => {
    mocks.rpc.mockImplementation(() => {
      throw new Error('no client')
    })
    await expect(touchPresence()).resolves.toBeUndefined()
    mocks.rpc.mockImplementation(async () => Promise.reject(new Error('offline')))
    await expect(touchPresence()).resolves.toBeUndefined()
  })
})
