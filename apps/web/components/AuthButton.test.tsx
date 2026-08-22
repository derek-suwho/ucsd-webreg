import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ session: null as null | { user: { name: string | null; email: string } } }))

vi.mock('@/lib/auth', () => ({
  auth: () => Promise.resolve(mocks.session),
  signIn: vi.fn(),
  signOut: vi.fn()
}))
vi.mock('./AccountDataActions', () => ({ default: () => null }))

import AuthButton from './AuthButton'

type TestProps = { children?: ReactNode } & Record<string, unknown>
type TestElement = ReactElement<TestProps>

function childElements(element: TestElement): TestElement[] {
  return Children.toArray(element.props.children)
    .filter((child): child is TestElement => isValidElement<TestProps>(child))
}

describe('AuthButton account integration', () => {
  beforeEach(() => { mocks.session = null })

  it('keeps account data actions authenticated-only and gives sign-in a touch target', async () => {
    const guest = await AuthButton() as TestElement

    expect(guest.type).toBe('form')
    expect(childElements(guest)[0].props.className).toContain('min-h-11')
    expect(childElements(guest).some(child => child.props['data-account-actions'])).toBe(false)
  })

  it('renders data actions beside, never inside, the sign-out form', async () => {
    mocks.session = { user: { name: 'Student', email: 'student@example.test' } }
    const account = await AuthButton() as TestElement
    const children = childElements(account)
    const actions = children.find(child => child.props['data-account-actions'])!
    const signOutForm = children.find(child => child.type === 'form')!

    expect(account.type).toBe('div')
    expect(actions).toBeTruthy()
    expect(childElements(signOutForm).some(child => child.props['data-account-actions'])).toBe(false)
    expect(childElements(signOutForm)[0].props.className).toContain('min-h-11')
    expect(account.props.className).toContain('flex-wrap')
  })
})
