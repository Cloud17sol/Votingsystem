import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AppCreditFooter } from '../components/AppCreditFooter'
import { AppTopbar } from '../components/AppTopbar'
import { GridBackground } from '../components/GridBackground'
import { PublicNotificationsPanel } from '../components/PublicNotificationsPanel'
import { RedactedEmailDisplay, type MaskedEmailParts } from '../components/RedactedEmailDisplay'
import { completeAuthenticatedMemberRouting } from '../lib/completeAuthenticatedMemberRouting'
import { supabase } from '../lib/supabase'

type Step = 'email' | 'otp' | 'password' | 'recoverPassword'

type NameSearchRow = { full_name: string } & MaskedEmailParts

type MemberLoginAuthState = {
  registered: boolean
  password_set: boolean
}

/** Survives mobile browser tab reload when user switches to the mail app for OTP. */
const LOGIN_FLOW_STORAGE_KEY = 'alumni_voting_login_flow_v1'
const LOGIN_FLOW_TTL_MS = 45 * 60 * 1000

type StoredLoginFlow = { v: 1; step: 'otp' | 'password'; email: string; savedAt: number }

function loadLoginFlowFromStorage(): { step: 'otp' | 'password'; email: string } | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(LOGIN_FLOW_STORAGE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as StoredLoginFlow
    if (p.v !== 1 || !p.email || typeof p.savedAt !== 'number') {
      sessionStorage.removeItem(LOGIN_FLOW_STORAGE_KEY)
      return null
    }
    if (Date.now() - p.savedAt > LOGIN_FLOW_TTL_MS) {
      sessionStorage.removeItem(LOGIN_FLOW_STORAGE_KEY)
      return null
    }
    if (p.step !== 'otp' && p.step !== 'password') return null
    return { step: p.step, email: p.email }
  } catch {
    return null
  }
}

function persistLoginFlow(step: 'otp' | 'password', normalizedEmail: string) {
  try {
    const payload: StoredLoginFlow = {
      v: 1,
      step,
      email: normalizedEmail,
      savedAt: Date.now(),
    }
    sessionStorage.setItem(LOGIN_FLOW_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // ignore quota / private mode
  }
}

function clearLoginFlowFromStorage() {
  try {
    sessionStorage.removeItem(LOGIN_FLOW_STORAGE_KEY)
  } catch {
    // ignore
  }
}

export function LoginPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>(() => {
    const b = loadLoginFlowFromStorage()
    if (!b) return 'email'
    return b.step
  })
  const [email, setEmail] = useState(() => loadLoginFlowFromStorage()?.email ?? '')
  const [loginPassword, setLoginPassword] = useState('')
  const [showLoginPassword, setShowLoginPassword] = useState(false)
  const [recoverPassword, setRecoverPassword] = useState('')
  const [recoverConfirmPassword, setRecoverConfirmPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [resendCountdown, setResendCountdown] = useState(0)
  const [error, setError] = useState('')

  const [nameSearch, setNameSearch] = useState('')
  const [nameSearchResults, setNameSearchResults] = useState<NameSearchRow[]>([])
  const [nameSearchLoading, setNameSearchLoading] = useState(false)
  const [nameSearchError, setNameSearchError] = useState('')

  const [message, setMessage] = useState(() =>
    loadLoginFlowFromStorage()?.step === 'otp'
      ? 'Enter your one-time code. If this page reloaded while you checked your email, you can continue here.'
      : '',
  )

  useEffect(() => {
    if (step === 'otp' || step === 'password') {
      const normalized = email.trim().toLowerCase()
      if (normalized) persistLoginFlow(step, normalized)
    } else {
      clearLoginFlowFromStorage()
    }
  }, [step, email])

  useEffect(() => {
    if (resendCountdown <= 0) return

    const timerId = window.setInterval(() => {
      setResendCountdown((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)

    return () => window.clearInterval(timerId)
  }, [resendCountdown])

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        clearLoginFlowFromStorage()
        setError('')
        setMessage('')
        setStep('recoverPassword')
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  function mapOtpErrorMessage(rawMessage: string): string {
    if (rawMessage.toLowerCase().includes('rate limit')) {
      return 'Too many OTP requests. Please wait a few minutes before trying again.'
    }
    return rawMessage
  }

  async function fetchMemberLoginAuthState(
    normalizedEmail: string,
  ): Promise<MemberLoginAuthState | null> {
    const { data, error: rpcError } = await supabase.rpc('get_member_login_auth_state', {
      p_email: normalizedEmail,
    })
    if (rpcError) {
      setError('Unable to verify voter registration at the moment.')
      return null
    }
    const row = data as { registered?: boolean; password_set?: boolean } | null
    if (!row || typeof row.registered !== 'boolean') {
      setError('Unable to verify voter registration at the moment.')
      return null
    }
    return { registered: row.registered, password_set: Boolean(row.password_set) }
  }

  async function handleSearchByName() {
    const q = nameSearch.trim()
    setNameSearchError('')
    setNameSearchResults([])
    if (q.length < 3) {
      setNameSearchError('Enter at least 3 letters to search.')
      return
    }

    setNameSearchLoading(true)
    const { data, error: rpcError } = await supabase.rpc('search_members_by_name_for_login', {
      p_query: q,
    })
    setNameSearchLoading(false)

    if (rpcError) {
      setNameSearchError('Search is unavailable right now. Try again later.')
      return
    }

    const rows = (data ?? []) as NameSearchRow[]
    setNameSearchResults(
      rows.map((row) => ({
        full_name: row.full_name,
        email_local_visible: String(row.email_local_visible ?? ''),
        email_local_blur_len: Number(row.email_local_blur_len ?? 0),
        email_domain_visible: String(row.email_domain_visible ?? ''),
        email_domain_blur_len: Number(row.email_domain_blur_len ?? 0),
        email_suffix: String(row.email_suffix ?? ''),
      })),
    )
    if (rows.length === 0) {
      setNameSearchError('No matches. Check spelling or contact your administrator.')
    }
  }

  async function handleEmailContinue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)

    const normalizedEmail = email.trim().toLowerCase()
    const authState = await fetchMemberLoginAuthState(normalizedEmail)
    if (!authState) {
      setLoading(false)
      return
    }

    if (!authState.registered) {
      setLoading(false)
      setError('This email is not registered for voting.')
      return
    }

    if (authState.password_set) {
      setEmail(normalizedEmail)
      setStep('password')
      setLoginPassword('')
      setLoading(false)
      persistLoginFlow('password', normalizedEmail)
      return
    }

    const { error: authError } = await supabase.auth.signInWithOtp({
      email: normalizedEmail,
    })

    setLoading(false)

    if (authError) {
      setError(mapOtpErrorMessage(authError.message))
      return
    }

    setEmail(normalizedEmail)
    setStep('otp')
    setMessage('OTP sent. Enter the code from your email.')
    setResendCountdown(30)
    persistLoginFlow('otp', normalizedEmail)
  }

  const handleResendOtp = async () => {
    if (!email.trim()) {
      setError('Enter your email first.')
      return
    }
    if (resendCountdown > 0) {
      return
    }

    setError('')
    setMessage('')
    setSending(true)

    const normalizedEmail = email.trim().toLowerCase()
    const authState = await fetchMemberLoginAuthState(normalizedEmail)
    if (!authState) {
      setSending(false)
      return
    }

    if (!authState.registered) {
      setSending(false)
      setError('This email is not registered for voting.')
      return
    }

    if (authState.password_set) {
      setSending(false)
      setError('This account uses a password. Go back and sign in with your password.')
      return
    }

    const { error: resendError } = await supabase.auth.signInWithOtp({
      email: normalizedEmail,
    })

    setSending(false)

    if (resendError) {
      setError(mapOtpErrorMessage(resendError.message))
      return
    }

    setEmail(normalizedEmail)
    setMessage('A new code has been sent to your email.')
    setResendCountdown(30)
    persistLoginFlow('otp', normalizedEmail)
  }

  async function handleVerifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)

    const { error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: otp.trim(),
      type: 'email',
    })

    if (verifyError) {
      setLoading(false)
      setError(verifyError.message)
      return
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      setLoading(false)
      setError('Authentication succeeded but user session was not found.')
      return
    }

    const normalizedUserEmail = user.email?.trim().toLowerCase()
    const { data: member, error: memberError } = await supabase
      .from('members')
      .select('password_set')
      .ilike('email', normalizedUserEmail ?? '')
      .maybeSingle()

    if (memberError) {
      setLoading(false)
      setError('Unable to verify account access.')
      return
    }

    if (!member) {
      setLoading(false)
      await supabase.auth.signOut()
      setError('This email is not registered for voting.')
      setStep('email')
      return
    }

    setLoading(false)

    if (member.password_set) {
      clearLoginFlowFromStorage()
      const result = await completeAuthenticatedMemberRouting(navigate)
      if (result.errorMessage) {
        setError(result.errorMessage)
      }
      return
    }

    clearLoginFlowFromStorage()
    navigate('/set-password', { replace: true })
  }

  async function handlePasswordSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)

    const normalizedEmail = email.trim().toLowerCase()
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password: loginPassword,
    })

    if (signInError) {
      setLoading(false)
      setError(signInError.message)
      return
    }

    clearLoginFlowFromStorage()
    const result = await completeAuthenticatedMemberRouting(navigate)
    setLoading(false)
    if (result.errorMessage) {
      setError(result.errorMessage)
    }
  }

  async function handleForgotPassword() {
    setError('')
    setMessage('')
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail) {
      setError('Enter your email above, then click Forgot password again.')
      return
    }

    const authState = await fetchMemberLoginAuthState(normalizedEmail)
    if (!authState?.registered) {
      setError('This email is not registered for voting.')
      return
    }

    setLoading(true)
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: `${window.location.origin}/login`,
    })
    setLoading(false)

    if (resetError) {
      setError(resetError.message)
      return
    }

    setMessage('Check your email for a reset link. Open it on this device to choose a new password.')
  }

  async function handleRecoverySetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')

    if (recoverPassword.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    if (recoverPassword !== recoverConfirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    const { error: updateError } = await supabase.auth.updateUser({ password: recoverPassword })
    if (updateError) {
      setLoading(false)
      setError(updateError.message)
      return
    }

    clearLoginFlowFromStorage()
    const result = await completeAuthenticatedMemberRouting(navigate)
    setLoading(false)
    if (result.errorMessage) {
      setError(result.errorMessage)
    }
  }

  function goBackToEmailStep() {
    clearLoginFlowFromStorage()
    setStep('email')
    setOtp('')
    setLoginPassword('')
    setShowLoginPassword(false)
    setRecoverPassword('')
    setRecoverConfirmPassword('')
    setError('')
    setMessage('')
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-page">
      <GridBackground />
      <div className="relative z-10 flex min-h-screen flex-col">
        <AppTopbar />
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-10">
          <PublicNotificationsPanel />
          <div className="card-app w-full max-w-md space-y-5 p-8">
            <div className="flex flex-wrap gap-2 border-b border-zinc-200 pb-4">
              <span className="nav-tab nav-tab-active">Sign in</span>
              <Link to="/register" className="nav-tab nav-tab-inactive no-underline">
                Register
              </Link>
              <Link to="/nominations" className="nav-tab nav-tab-inactive no-underline">
                Nominations
              </Link>
            </div>
            <div className="space-y-1">
              <h2 className="text-xl font-bold tracking-tight text-zinc-900">Welcome back</h2>
              <p className="text-sm text-zinc-500">
                {step === 'password'
                  ? 'Sign in with your email and password.'
                  : step === 'recoverPassword'
                    ? 'Choose a new password for your account.'
                    : step === 'otp'
                      ? 'Enter the one-time code we sent to your email.'
                      : 'Enter your registered email. First-time sign-in uses a one-time code; after that, use your password.'}
              </p>
            </div>

          {step === 'recoverPassword' ? (
            <form className="space-y-4" onSubmit={(e) => void handleRecoverySetPassword(e)}>
              <div>
                <label
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-zinc-500"
                  htmlFor="recovery-password"
                >
                  New password
                </label>
                <input
                  id="recovery-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={recoverPassword}
                  onChange={(e) => setRecoverPassword(e.target.value)}
                  className="input-app"
                  disabled={loading}
                />
              </div>
              <div>
                <label
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-zinc-500"
                  htmlFor="recovery-confirm"
                >
                  Confirm new password
                </label>
                <input
                  id="recovery-confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={recoverConfirmPassword}
                  onChange={(e) => setRecoverConfirmPassword(e.target.value)}
                  className="input-app"
                  disabled={loading}
                />
              </div>
              <button type="submit" disabled={loading} className="btn-primary w-full">
                {loading ? 'Saving…' : 'Update password and continue'}
              </button>
            </form>
          ) : null}

          {step === 'email' || step === 'otp' || step === 'password' ? (
            <>
              {step === 'email' ? (
                <>
                  <div className="space-y-3 rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4">
                    <div>
                      <label
                        className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-zinc-500"
                        htmlFor="name-search"
                      >
                        Find your registration
                      </label>
                      <p className="mb-2 text-xs text-zinc-500">
                        Search by your name
                      </p>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                        <input
                          id="name-search"
                          type="search"
                          value={nameSearch}
                          onChange={(event) => setNameSearch(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              void handleSearchByName()
                            }
                          }}
                          className="input-app flex-1"
                          placeholder="e.g. Jane Doe"
                          autoComplete="name"
                        />
                        <button
                          type="button"
                          disabled={nameSearchLoading}
                          className="btn-secondary shrink-0 whitespace-nowrap sm:w-auto"
                          onClick={() => void handleSearchByName()}
                        >
                          {nameSearchLoading ? 'Searching…' : 'Search'}
                        </button>
                      </div>
                    </div>
                    {nameSearchError ? (
                      <p className="text-sm font-medium text-red-700">{nameSearchError}</p>
                    ) : null}
                    {nameSearchResults.length > 0 ? (
                      <ul className="max-h-48 space-y-2 overflow-y-auto rounded-xl border border-zinc-200/80 bg-white p-2">
                        {nameSearchResults.map((row, idx) => (
                          <li
                            key={`${row.full_name}-${idx}`}
                            className="rounded-lg border border-zinc-100 px-3 py-2"
                          >
                            <p className="font-medium text-zinc-900">{row.full_name}</p>
                            <RedactedEmailDisplay
                              email_local_visible={row.email_local_visible}
                              email_local_blur_len={row.email_local_blur_len}
                              email_domain_visible={row.email_domain_visible}
                              email_domain_blur_len={row.email_domain_blur_len}
                              email_suffix={row.email_suffix}
                              className="mt-0.5"
                            />
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>

                  <form className="space-y-4" onSubmit={(e) => void handleEmailContinue(e)}>
                    <div>
                      <label
                        className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-zinc-500"
                        htmlFor="email"
                      >
                        Sign in with email
                      </label>
                      <input
                        id="email"
                        type="email"
                        required
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        className="input-app"
                        placeholder="name@example.com"
                      />
                    </div>
                    <button type="submit" disabled={loading} className="btn-primary w-full">
                      {loading ? 'Continuing…' : 'Continue'}
                    </button>
                  </form>
                </>
              ) : null}

              {step === 'otp' ? (
                <form className="space-y-4" onSubmit={(e) => void handleVerifyOtp(e)}>
                  <div>
                    <label
                      className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-zinc-500"
                      htmlFor="otp"
                    >
                      One-time code
                    </label>
                    <input
                      id="otp"
                      type="text"
                      required
                      value={otp}
                      onChange={(event) => setOtp(event.target.value)}
                      className="input-app"
                      placeholder="Enter code from email"
                    />
                  </div>
                  <div className="text-right text-sm">
                    <button
                      type="button"
                      onClick={() => void handleResendOtp()}
                      disabled={sending || resendCountdown > 0}
                      className="font-medium text-sky-text hover:underline disabled:opacity-50"
                    >
                      {sending
                        ? 'Sending...'
                        : resendCountdown > 0
                          ? `Resend code in ${resendCountdown}s`
                          : 'Resend code'}
                    </button>
                  </div>
                  <button type="button" className="btn-secondary w-full" onClick={goBackToEmailStep}>
                    Use a different email
                  </button>
                  <button type="submit" disabled={loading} className="btn-primary w-full">
                    {loading ? 'Verifying...' : 'Verify & continue'}
                  </button>
                </form>
              ) : null}

              {step === 'password' ? (
                <form className="space-y-4" onSubmit={(e) => void handlePasswordSignIn(e)}>
                  <div>
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">Email</p>
                    <p className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800">
                      {email}
                    </p>
                  </div>
                  <div>
                    <label
                      className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-zinc-500"
                      htmlFor="login-password"
                    >
                      Password
                    </label>
                    <div className="relative">
                      <input
                        id="login-password"
                        type={showLoginPassword ? 'text' : 'password'}
                        autoComplete="current-password"
                        required
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        className="input-app pr-11"
                        disabled={loading}
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-50"
                        onClick={() => setShowLoginPassword((visible) => !visible)}
                        disabled={loading}
                        aria-label={showLoginPassword ? 'Hide password' : 'Show password'}
                        aria-pressed={showLoginPassword}
                      >
                        {showLoginPassword ? (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden
                          >
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                            <path d="M1 1l22 22" />
                            <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                          </svg>
                        ) : (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden
                          >
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <button
                      type="button"
                      className="text-left text-sm font-medium text-sky-text hover:underline"
                      onClick={() => void handleForgotPassword()}
                      disabled={loading}
                    >
                      Forgot password?
                    </button>
                    <button
                      type="button"
                      className="text-left text-sm font-medium text-zinc-600 hover:underline sm:text-right"
                      onClick={goBackToEmailStep}
                    >
                      Change email
                    </button>
                  </div>
                  <button type="submit" disabled={loading} className="btn-primary w-full">
                    {loading ? 'Signing in…' : 'Sign in'}
                  </button>
                </form>
              ) : null}
            </>
          ) : null}

          {message ? <p className="text-sm font-medium text-mint-800">{message}</p> : null}
          {error ? <p className="text-sm font-medium text-red-700">{error}</p> : null}
        </div>
        <AppCreditFooter className="mt-8 w-full max-w-md" />
      </div>
      </div>
    </div>
  )
}
