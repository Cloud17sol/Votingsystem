import type { NavigateFunction } from 'react-router-dom'
import { supabase } from './supabase'
import { fetchMyVoterStatus } from './voterEligibility'

/**
 * After a successful session (OTP, password, or recovery), route admins to /admin,
 * eligible (or already-voted) voters to /dashboard, or send registered members who cannot
 * vote to /not-eligible (session kept so they can read member-only notifications).
 * Unregistered emails are signed out.
 */
export async function completeAuthenticatedMemberRouting(
  navigate: NavigateFunction,
): Promise<{ errorMessage?: string }> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user?.email?.trim()) {
    return { errorMessage: 'Authentication succeeded but user session was not found.' }
  }

  const normalizedUserEmail = user.email.trim().toLowerCase()
  const { data: member, error: memberError } = await supabase
    .from('members')
    .select('is_admin')
    .ilike('email', normalizedUserEmail)
    .maybeSingle()

  if (memberError) {
    return { errorMessage: 'Unable to verify account access.' }
  }

  if (!member) {
    await supabase.auth.signOut()
    return { errorMessage: 'This email is not registered for voting.' }
  }

  if (member.is_admin) {
    navigate('/admin', { replace: true })
    return {}
  }

  const status = await fetchMyVoterStatus()
  if (!status) {
    return { errorMessage: 'Unable to verify account access.' }
  }

  if (
    status.eligible ||
    status.alreadyVoted ||
    status.reason === 'There is no active election right now.'
  ) {
    navigate('/dashboard', { replace: true })
    return {}
  }

  navigate('/not-eligible', {
    replace: true,
    state: { reason: status.reason ?? 'You are not eligible to vote in this election.' },
  })
  return {}
}
