import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}))
vi.mock('../data/edgeFunctions.ts', () => ({ invokeEdgeFunction: mocks.invoke }))
vi.mock('../lib/supabase.ts', () => ({ supabase: { auth: { signInWithPassword: mocks.signIn, signOut: mocks.signOut } } }))

const { changeLogin } = await import('./changeLogin.ts')
const args = { currentPassword: 'secret123', newEmail: ' New@club.test ' }

beforeEach(() => {
  mocks.invoke.mockReset().mockResolvedValue({ ok: true })
  mocks.signIn.mockReset().mockResolvedValue({ error: null })
  mocks.signOut.mockReset().mockResolvedValue({ error: null })
})

describe('changeLogin', () => {
  it('asks the function to change it, signs back in with the new address, and ends the other devices', async () => {
    await changeLogin(args)
    expect(mocks.invoke).toHaveBeenCalledWith('change-own-login', { email: ' New@club.test ', password: 'secret123' }, 'change your login')
    expect(mocks.signIn).toHaveBeenCalledWith({ email: 'New@club.test', password: 'secret123' })
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'others' })
  })

  it('passes the function’s refusal on and does not sign in again', async () => {
    mocks.invoke.mockRejectedValue(new Error('That isn’t your current password.'))
    await expect(changeLogin(args)).rejects.toThrow('That isn’t your current password.')
    expect(mocks.signIn).not.toHaveBeenCalled()
  })

  it('tells you which address to sign in with if the automatic sign-in fails', async () => {
    mocks.signIn.mockResolvedValue({ error: { message: 'x' } })
    await expect(changeLogin(args)).rejects.toThrow('Your login is changed. Sign in again with New@club.test.')
  })
})
