import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type EligibilityFailureReason =
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

export type MyVoterStatus = {
  eligible: boolean
  reason: EligibilityFailureReason | null
  electionId: string | null
  alreadyVoted: boolean
}

/** Raw voter status from `get_my_voter_status` (includes already-voted). */
export async function fetchMyVoterStatus(): Promise<MyVoterStatus | null> {
  try {
    const { data, error } = await supabase.rpc('get_my_voter_status')
    if (error) return null

    const status = (data as MemberRow[] | null)?.[0]
    if (!status) return null

    return {
      eligible: status.eligible,
      reason: status.reason,
      electionId: status.election_id,
      alreadyVoted: status.already_voted,
    }
  } catch {
    return null
  }
}

export async function checkVoterEligibility(user: User): Promise<EligibilityResult> {
  try {
    if (!user.email?.trim()) {
      return { eligible: false, reason: 'Unable to verify eligibility right now.' }
    }

    const status = await fetchMyVoterStatus()
    if (!status) {
      return { eligible: false, reason: 'Unable to verify eligibility right now.' }
    }

    if (!status.eligible) {
      return {
        eligible: false,
        reason: status.reason ?? 'Unable to verify eligibility right now.',
      }
    }

    if (!status.electionId) {
      return { eligible: false, reason: 'Unable to verify eligibility right now.' }
    }

    return { eligible: true, electionId: status.electionId }
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
