import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'

type EligibilityFailureReason =
  | 'Email is not in the eligible members list.'
  | 'This account is not allowed to vote.'
  | 'There is no active election right now.'
  | 'You have already voted in this election.'
  | 'Unable to verify eligibility right now.'

type EligibilityResult =
  | { eligible: true; electionId: string }
  | { eligible: false; reason: EligibilityFailureReason }

type MemberRow = {
  eligible: boolean
  reason: EligibilityFailureReason | null
  election_id: string | null
  already_voted: boolean
}

export async function checkVoterEligibility(user: User): Promise<EligibilityResult> {
  try {
    if (!user.email?.trim()) {
      return { eligible: false, reason: 'Unable to verify eligibility right now.' }
    }

    const { data, error } = await supabase.rpc('get_my_voter_status')
    if (error) {
      return { eligible: false, reason: 'Unable to verify eligibility right now.' }
    }

    const status = (data as MemberRow[] | null)?.[0]
    if (!status) {
      return { eligible: false, reason: 'Unable to verify eligibility right now.' }
    }

    if (!status.eligible) {
      return { eligible: false, reason: status.reason ?? 'Unable to verify eligibility right now.' }
    }

    if (!status.election_id) {
      return { eligible: false, reason: 'Unable to verify eligibility right now.' }
    }

    return { eligible: true, electionId: status.election_id }
  } catch {
    return { eligible: false, reason: 'Unable to verify eligibility right now.' }
  }
}

/** Display name from `members.full_name` for the signed-in user (email match). */
export async function fetchMyMemberFullName(): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const email = session?.user?.email?.trim().toLowerCase()
  if (!email) return null

  const { data } = await supabase
    .from('members')
    .select('full_name')
    .ilike('email', email)
    .maybeSingle()

  const name = data?.full_name?.trim()
  return name || null
}
