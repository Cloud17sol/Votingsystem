import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AppTopbar } from '../components/AppTopbar'
import { MemberNotificationsPanel } from '../components/MemberNotificationsPanel'
import { downloadElectionResultsHtml } from '../lib/exportElectionResultsHtml'
import { supabase } from '../lib/supabase'

type Election = {
  id: string
  title: string
  status: 'draft' | 'open' | 'closed'
  starts_at: string | null
  ends_at: string
  created_at?: string
  logo_url?: string | null
}

type Position = {
  id: string
  election_id: string
  name: string
  sort_order: number
}

type Candidate = {
  id: string
  position_id: string
  full_name: string
}

type NominationPosition = {
  id: string
  name: string
  sort_order: number
  created_at?: string
}

type NominationEntry = {
  id: string
  nomination_position_id: string
  nominee_full_name: string
  created_at: string
}

type AppNotification = {
  id: string
  title: string
  body: string
  audience: 'public' | 'member'
  sort_order: number
  created_at: string
}

type Member = {
  id: string
  auth_user_id?: string | null
  email: string
  full_name: string
  is_eligible: boolean
  is_admin: boolean
}

type RegistrationRequest = {
  id: string
  full_name: string
  email: string
  note: string | null
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
  reviewed_at: string | null
  reviewer_email: string | null
}

type VoteItem = {
  candidate_id: string
}

type AdminTab =
  | 'election'
  | 'positionsCandidates'
  | 'members'
  | 'registrations'
  | 'nominations'
  | 'notifications'
  | 'results'

type NominationsSubTab = 'positions' | 'received'

type PositionsCandidatesSubTab = 'positions' | 'candidates'

type RegistrationsFilter = 'pending' | 'approved' | 'rejected' | 'all'

function toInputDateTime(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  const tzOffsetMs = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - tzOffsetMs).toISOString().slice(0, 16)
}

function getFriendlyErrorMessage(message: string): string {
  const normalized = message.toLowerCase()
  const isFkDeleteError =
    normalized.includes('violates foreign key constraint') ||
    normalized.includes('is still referenced from table')
  if (isFkDeleteError) {
    if (normalized.includes('vote_items_position_id_election_id_fkey')) {
      return 'Cannot delete this position while vote records reference it.'
    }
    if (normalized.includes('positions_election_id_fkey')) {
      return 'Cannot delete this election yet. Delete its positions first.'
    }
    if (normalized.includes('candidates_position_id_fkey')) {
      return 'Cannot delete this position yet. Delete its candidates first.'
    }
    if (
      normalized.includes('vote_items_candidate_id_position_id_fkey') ||
      normalized.includes('vote_items_candidate_id_fkey')
    ) {
      return 'Cannot delete this candidate while vote records reference them. Remove ballot lines first, or use delete again after clearing votes.'
    }
    if (
      normalized.includes('table "candidates"') &&
      normalized.includes('vote_items')
    ) {
      return 'Cannot delete this candidate while votes still list them. Remove those ballot lines first.'
    }
    if (normalized.includes('votes_member_id_fkey')) {
      return 'Cannot delete this member while votes are linked to them.'
    }
    if (normalized.includes('table "votes"') || normalized.includes('votes_election_id_fkey')) {
      return 'Cannot delete this election while votes exist for it.'
    }
    return 'Delete dependent records first, then try again.'
  }

  if (normalized.includes('duplicate key value') || normalized.includes('unique constraint')) {
    return 'A record with these details already exists.'
  }
  if (normalized.includes('invalid input syntax for type uuid')) {
    return 'Auth User ID must be a valid UUID, or leave it empty.'
  }
  if (normalized.includes('row-level security') || normalized.includes('permission denied')) {
    return 'You do not have permission to perform this action.'
  }
  return 'Something went wrong. Please try again.'
}

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

const ELECTION_LOGO_MAX_BYTES = 2 * 1024 * 1024
const ELECTION_LOGO_BUCKET = 'election-logos'
const ELECTION_LOGO_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'

function storagePathFromPublicLogoUrl(url: string): string | null {
  if (!url) return null
  const marker = `/${ELECTION_LOGO_BUCKET}/`
  const idx = url.indexOf(marker)
  if (idx === -1) return null
  return decodeURIComponent(url.slice(idx + marker.length))
}

function MemberActionIconButtons({
  member,
  disabled,
  onView,
  onEdit,
  onDelete,
}: {
  member: Member
  disabled: boolean
  onView: (m: Member) => void
  onEdit: (m: Member) => void
  onDelete: (m: Member) => void | Promise<void>
}) {
  const base =
    'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border bg-white shadow-sm transition-colors active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50'
  return (
    <div
      className="flex items-center justify-end gap-0.5"
      role="group"
      aria-label={`Actions for ${member.full_name}`}
    >
      <button
        type="button"
        className={`${base} border-zinc-200 text-zinc-700 hover:bg-zinc-50`}
        disabled={disabled}
        aria-label={`View ${member.full_name}`}
        title="View details"
        onClick={() => onView(member)}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
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
      </button>
      <button
        type="button"
        className={`${base} border-zinc-200 text-zinc-700 hover:bg-zinc-50`}
        disabled={disabled}
        aria-label={`Edit ${member.full_name}`}
        title="Edit member"
        onClick={() => onEdit(member)}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 9.5-9.5z" />
        </svg>
      </button>
      <button
        type="button"
        className={`${base} border-red-200 text-red-700 hover:bg-red-50`}
        disabled={disabled}
        aria-label={`Delete ${member.full_name}`}
        title="Delete member"
        onClick={() => void onDelete(member)}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M3 6h18" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <path d="M10 11v6M14 11v6" />
        </svg>
      </button>
    </div>
  )
}

export function AdminDashboardPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [election, setElection] = useState<Election | null>(null)
  const [elections, setElections] = useState<Election[]>([])
  const [positions, setPositions] = useState<Position[]>([])
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [registrationRequests, setRegistrationRequests] = useState<RegistrationRequest[]>([])
  const [registrationActionId, setRegistrationActionId] = useState<string | null>(null)
  const [votesCount, setVotesCount] = useState(0)
  const [eligibleMembersCount, setEligibleMembersCount] = useState(0)

  const [electionTitle, setElectionTitle] = useState('')
  const [electionStatus, setElectionStatus] = useState<'draft' | 'open' | 'closed'>('draft')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [electionLogoUploading, setElectionLogoUploading] = useState(false)

  const [positionName, setPositionName] = useState('')
  const [positionOrder, setPositionOrder] = useState(0)

  const [candidateName, setCandidateName] = useState('')
  const [candidatePositionId, setCandidatePositionId] = useState('')

  const [nominationPositions, setNominationPositions] = useState<NominationPosition[]>([])
  const [nominations, setNominations] = useState<NominationEntry[]>([])
  const [nominationPositionName, setNominationPositionName] = useState('')
  const [nominationPositionOrder, setNominationPositionOrder] = useState(0)
  const [nominationSubmissionsOpen, setNominationSubmissionsOpen] = useState(true)
  const [nominationsSubTab, setNominationsSubTab] = useState<NominationsSubTab>('positions')
  const [positionsCandidatesSubTab, setPositionsCandidatesSubTab] =
    useState<PositionsCandidatesSubTab>('positions')
  const [registrationsFilter, setRegistrationsFilter] = useState<RegistrationsFilter>('pending')

  const [memberAuthUserId, setMemberAuthUserId] = useState('')
  const [memberEmail, setMemberEmail] = useState('')
  const [memberName, setMemberName] = useState('')
  const [memberEligible, setMemberEligible] = useState(true)
  const [memberAdmin, setMemberAdmin] = useState(false)
  const [csvImportMessage, setCsvImportMessage] = useState('')
  const [csvImporting, setCsvImporting] = useState(false)

  const [voteItems, setVoteItems] = useState<VoteItem[]>([])
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [notificationTitle, setNotificationTitle] = useState('')
  const [notificationBody, setNotificationBody] = useState('')
  const [notificationAudience, setNotificationAudience] = useState<'public' | 'member'>('public')
  const [notificationSortOrder, setNotificationSortOrder] = useState(0)
  const [activeTab, setActiveTab] = useState<AdminTab>('election')

  const [memberModal, setMemberModal] = useState<
    | { mode: 'view'; member: Member }
    | { mode: 'edit'; member: Member }
    | null
  >(null)
  const [editEmail, setEditEmail] = useState('')
  const [editFullName, setEditFullName] = useState('')
  const [editAuthUserId, setEditAuthUserId] = useState('')
  const [editEligible, setEditEligible] = useState(true)
  const [editAdmin, setEditAdmin] = useState(false)
  const [memberActionLoading, setMemberActionLoading] = useState(false)
  const [adminActionLoading, setAdminActionLoading] = useState(false)
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([])
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([])
  const [selectedPositionIds, setSelectedPositionIds] = useState<string[]>([])

  const adminMembers = useMemo(() => {
    return [...members.filter((m) => m.is_admin)].sort((a, b) =>
      a.full_name.localeCompare(b.full_name, undefined, { sensitivity: 'base' }),
    )
  }, [members])

  const regularMembers = useMemo(() => {
    return [...members.filter((m) => !m.is_admin)].sort((a, b) =>
      a.full_name.localeCompare(b.full_name, undefined, { sensitivity: 'base' }),
    )
  }, [members])

  const allAdminsSelected = useMemo(
    () => adminMembers.length > 0 && adminMembers.every((m) => selectedMemberIds.includes(m.id)),
    [adminMembers, selectedMemberIds],
  )

  const allRegularsSelected = useMemo(
    () => regularMembers.length > 0 && regularMembers.every((m) => selectedMemberIds.includes(m.id)),
    [regularMembers, selectedMemberIds],
  )

  const allCandidatesSelected = useMemo(
    () => candidates.length > 0 && selectedCandidateIds.length === candidates.length,
    [candidates.length, selectedCandidateIds.length],
  )

  const allPositionsSelected = useMemo(
    () => positions.length > 0 && selectedPositionIds.length === positions.length,
    [positions.length, selectedPositionIds.length],
  )

  const pendingRegistrationCount = useMemo(
    () => registrationRequests.filter((r) => r.status === 'pending').length,
    [registrationRequests],
  )

  const filteredRegistrationRequests = useMemo(() => {
    if (registrationsFilter === 'all') return registrationRequests
    return registrationRequests.filter((r) => r.status === registrationsFilter)
  }, [registrationRequests, registrationsFilter])

  async function loadAll() {
    setLoading(true)
    setError('')

    const { data: electionRows, error: electionError } = await supabase
      .from('elections')
      .select('id,title,status,starts_at,ends_at,created_at,logo_url')
      .order('created_at', { ascending: false })

    if (electionError) {
      setError(electionError.message)
      setLoading(false)
      return
    }

    const loadedElections = (electionRows as Election[] | null) ?? []
    setElections(loadedElections)
    const firstElection = loadedElections[0] ?? null
    setElection(firstElection)

    if (firstElection) {
      setElectionTitle(firstElection.title)
      setElectionStatus(firstElection.status)
      setStartsAt(toInputDateTime(firstElection.starts_at))
      setEndsAt(toInputDateTime(firstElection.ends_at))

      const { data: positionRows } = await supabase
        .from('positions')
        .select('id,election_id,name,sort_order')
        .order('sort_order', { ascending: true })

      const electionOrder = new Map(loadedElections.map((e, index) => [e.id, index]))
      const loadedPositions = [...((positionRows as Position[] | null) ?? [])].sort((a, b) => {
        const orderA = electionOrder.get(a.election_id) ?? 999
        const orderB = electionOrder.get(b.election_id) ?? 999
        if (orderA !== orderB) return orderA - orderB
        return a.sort_order - b.sort_order
      })
      setPositions(loadedPositions)
      const positionsForActiveElection = loadedPositions.filter((p) => p.election_id === firstElection.id)
      setCandidatePositionId(
        positionsForActiveElection[0]?.id ?? loadedPositions[0]?.id ?? '',
      )

      const positionIds = loadedPositions.map((item) => item.id)
      if (positionIds.length > 0) {
        const { data: candidateRows } = await supabase
          .from('candidates')
          .select('id,position_id,full_name')
          .in('position_id', positionIds)
          .order('full_name', { ascending: true })
        setCandidates((candidateRows as Candidate[] | null) ?? [])
      } else {
        setCandidates([])
      }

      const { count } = await supabase
        .from('votes')
        .select('id', { count: 'exact', head: true })
        .eq('election_id', firstElection.id)
      setVotesCount(count ?? 0)

      const { data: voteItemRows } = await supabase
        .from('vote_items')
        .select('candidate_id')
        .eq('election_id', firstElection.id)
      setVoteItems((voteItemRows as VoteItem[] | null) ?? [])
    } else {
      setPositions([])
      setCandidates([])
      setVotesCount(0)
      setVoteItems([])
      setElectionTitle('')
      setStartsAt('')
      setEndsAt('')
      setElectionStatus('draft')
    }

    const { data: memberRows } = await supabase
      .from('members')
      .select('id,auth_user_id,email,full_name,is_eligible,is_admin')
      .order('created_at', { ascending: false })
      .limit(50)
    setMembers((memberRows as Member[] | null) ?? [])

    const { data: requestRows } = await supabase
      .from('member_registration_requests')
      .select('id,full_name,email,note,status,created_at,reviewed_at,reviewer_email')
      .order('created_at', { ascending: false })
      .limit(150)
    setRegistrationRequests((requestRows as RegistrationRequest[] | null) ?? [])

    const { count: eligibleCount } = await supabase
      .from('members')
      .select('id', { count: 'exact', head: true })
      .eq('is_eligible', true)
      .eq('is_admin', false)
    setEligibleMembersCount(eligibleCount ?? 0)

    const nomPosRes = await supabase
      .from('nomination_positions')
      .select('id,name,sort_order,created_at')
      .order('sort_order', { ascending: true })
    if (nomPosRes.error) {
      setNominationPositions([])
    } else {
      setNominationPositions((nomPosRes.data as NominationPosition[] | null) ?? [])
    }

    const nomRes = await supabase
      .from('nominations')
      .select('id,nomination_position_id,nominee_full_name,created_at')
      .order('created_at', { ascending: false })
      .limit(500)
    if (nomRes.error) {
      setNominations([])
    } else {
      setNominations((nomRes.data as NominationEntry[] | null) ?? [])
    }

    const cfgRes = await supabase
      .from('nomination_config')
      .select('submissions_open')
      .eq('id', 1)
      .maybeSingle()
    if (!cfgRes.error && cfgRes.data && typeof cfgRes.data.submissions_open === 'boolean') {
      setNominationSubmissionsOpen(cfgRes.data.submissions_open)
    }

    const notifRes = await supabase
      .from('notifications')
      .select('id,title,body,audience,sort_order,created_at')
      .order('audience', { ascending: true })
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false })
    if (notifRes.error) {
      setNotifications([])
    } else {
      setNotifications((notifRes.data as AppNotification[] | null) ?? [])
    }

    setLoading(false)
  }

  async function handleAddNotification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const title = notificationTitle.trim()
    const body = notificationBody.trim()
    if (!title || !body) return

    setError('')
    setAdminActionLoading(true)
    const { error: insertError } = await supabase.from('notifications').insert({
      title,
      body,
      audience: notificationAudience,
      sort_order: notificationSortOrder,
    })
    setAdminActionLoading(false)
    if (insertError) {
      setError(insertError.message)
      return
    }
    setNotificationTitle('')
    setNotificationBody('')
    setNotificationAudience('public')
    setNotificationSortOrder(0)
    await loadAll()
  }

  async function handleDeleteNotification(row: AppNotification) {
    const ok = window.confirm(`Delete notification "${row.title}"?`)
    if (!ok) return
    setError('')
    setAdminActionLoading(true)
    const { error: deleteError } = await supabase.from('notifications').delete().eq('id', row.id)
    setAdminActionLoading(false)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    await loadAll()
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadAll()
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [])

  useEffect(() => {
    setSelectedMemberIds((prev) => prev.filter((id) => members.some((member) => member.id === id)))
  }, [members])

  useEffect(() => {
    setSelectedCandidateIds((prev) => prev.filter((id) => candidates.some((c) => c.id === id)))
  }, [candidates])

  useEffect(() => {
    setSelectedPositionIds((prev) => prev.filter((id) => positions.some((p) => p.id === id)))
  }, [positions])

  async function handleSaveElection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedTitle = electionTitle.trim()
    if (!trimmedTitle || !endsAt) return

    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) return

    const userEmail = session.user.email?.trim().toLowerCase() ?? ''
    const { data: adminMember, error: memberLookupError } = await supabase
      .from('members')
      .select('id')
      .ilike('email', userEmail)
      .maybeSingle()

    if (memberLookupError) {
      setError(memberLookupError.message)
      return
    }
    if (!adminMember?.id) {
      setError(
        'No member row found for your email. Add yourself in Members first, then create the election.',
      )
      return
    }

    const electionPayload = {
      title: trimmedTitle,
      status: electionStatus,
      starts_at: startsAt ? new Date(startsAt).toISOString() : null,
      ends_at: new Date(endsAt).toISOString(),
    }

    if (election && election.status !== 'closed') {
      const { error: updateError } = await supabase
        .from('elections')
        .update(electionPayload)
        .eq('id', election.id)
      if (updateError) {
        setError(updateError.message)
        return
      }
    } else {
      const { error: insertError } = await supabase.from('elections').insert({
        ...electionPayload,
        created_by: adminMember.id,
      })
      if (insertError) {
        setError(insertError.message)
        return
      }
    }

    await loadAll()
  }

  function handleResetElectionForm() {
    setElectionTitle('')
    setElectionStatus('draft')
    setStartsAt('')
    setEndsAt('')
  }

  async function handleElectionLogoFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !election) return
    if (!ELECTION_LOGO_ACCEPT.split(',').includes(file.type)) {
      setError('Please choose a PNG, JPEG, WebP, or GIF image.')
      return
    }
    if (file.size > ELECTION_LOGO_MAX_BYTES) {
      setError('Logo must be 2 MB or smaller.')
      return
    }
    setError('')
    setElectionLogoUploading(true)

    const oldPath = election.logo_url ? storagePathFromPublicLogoUrl(election.logo_url) : null
    if (oldPath) {
      await supabase.storage.from(ELECTION_LOGO_BUCKET).remove([oldPath])
    }

    const safeSegment = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `${election.id}/${Date.now()}-${safeSegment}`
    const { error: uploadError } = await supabase.storage
      .from(ELECTION_LOGO_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false })

    if (uploadError) {
      setElectionLogoUploading(false)
      setError(uploadError.message)
      return
    }

    const { data: publicData } = supabase.storage.from(ELECTION_LOGO_BUCKET).getPublicUrl(path)
    const logoUrl = publicData.publicUrl

    const { error: updateError } = await supabase
      .from('elections')
      .update({ logo_url: logoUrl })
      .eq('id', election.id)

    setElectionLogoUploading(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    await loadAll()
  }

  async function handleRemoveElectionLogo() {
    if (!election?.logo_url) return
    const ok = window.confirm('Remove this election logo?')
    if (!ok) return
    setError('')
    setElectionLogoUploading(true)
    const oldPath = storagePathFromPublicLogoUrl(election.logo_url)
    if (oldPath) {
      await supabase.storage.from(ELECTION_LOGO_BUCKET).remove([oldPath])
    }
    const { error: updateError } = await supabase
      .from('elections')
      .update({ logo_url: null })
      .eq('id', election.id)
    setElectionLogoUploading(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    await loadAll()
  }

  async function handleAddPosition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!election || !positionName.trim()) return

    const { error: insertError } = await supabase.from('positions').insert({
      election_id: election.id,
      name: positionName.trim(),
      sort_order: positionOrder,
    })
    if (insertError) {
      setError(insertError.message)
      return
    }

    setPositionName('')
    setPositionOrder(0)
    await loadAll()
  }

  async function handleAddCandidate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!candidatePositionId || !candidateName.trim()) return

    const { error: insertError } = await supabase.from('candidates').insert({
      position_id: candidatePositionId,
      full_name: candidateName.trim(),
    })
    if (insertError) {
      setError(insertError.message)
      return
    }

    setCandidateName('')
    await loadAll()
  }

  async function handleDeleteElection(item: Election) {
    const ok = window.confirm(
      `Delete election "${item.title}"? Related records may prevent deletion.`,
    )
    if (!ok) return
    setError('')
    setAdminActionLoading(true)
    const { error: deleteError } = await supabase.from('elections').delete().eq('id', item.id)
    setAdminActionLoading(false)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    await loadAll()
  }

  async function handleDeletePosition(position: Position) {
    const ok = window.confirm(
      `Delete position "${position.name}"? Related candidates may prevent deletion.`,
    )
    if (!ok) return
    setError('')
    setAdminActionLoading(true)
    const { error: deleteError } = await supabase.from('positions').delete().eq('id', position.id)
    setAdminActionLoading(false)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    await loadAll()
  }

  function handleTogglePositionSelected(positionId: string) {
    setSelectedPositionIds((prev) =>
      prev.includes(positionId) ? prev.filter((id) => id !== positionId) : [...prev, positionId],
    )
  }

  function handleToggleSelectAllPositions() {
    setSelectedPositionIds((prev) =>
      prev.length === positions.length ? [] : positions.map((p) => p.id),
    )
  }

  async function handleDeleteSelectedPositions() {
    if (selectedPositionIds.length === 0) return
    const ok = window.confirm(
      `Delete ${selectedPositionIds.length} selected position(s)? Related candidates or ballot lines may prevent deletion.`,
    )
    if (!ok) return
    setError('')
    setAdminActionLoading(true)
    const ids = [...selectedPositionIds]
    const { error: deleteError } = await supabase.from('positions').delete().in('id', ids)
    setAdminActionLoading(false)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    setSelectedPositionIds([])
    await loadAll()
  }

  async function handleDeleteCandidate(candidate: Candidate) {
    const ok = window.confirm(
      `Delete candidate "${candidate.full_name}"? Any ballots that chose this candidate for this position will be updated first (those vote lines are removed).`,
    )
    if (!ok) return
    setError('')
    setAdminActionLoading(true)
    const { error: voteItemsError } = await supabase
      .from('vote_items')
      .delete()
      .eq('candidate_id', candidate.id)
      .eq('position_id', candidate.position_id)
    if (voteItemsError) {
      setAdminActionLoading(false)
      setError(voteItemsError.message)
      return
    }
    const { error: deleteError } = await supabase.from('candidates').delete().eq('id', candidate.id)
    setAdminActionLoading(false)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    await loadAll()
  }

  function handleToggleCandidateSelected(candidateId: string) {
    setSelectedCandidateIds((prev) =>
      prev.includes(candidateId) ? prev.filter((id) => id !== candidateId) : [...prev, candidateId],
    )
  }

  function handleToggleSelectAllCandidates() {
    setSelectedCandidateIds((prev) =>
      prev.length === candidates.length ? [] : candidates.map((c) => c.id),
    )
  }

  async function handleDeleteSelectedCandidates() {
    if (selectedCandidateIds.length === 0) return
    const ok = window.confirm(
      `Delete ${selectedCandidateIds.length} selected candidate(s)? Any ballot lines that reference them will be removed first. This cannot be undone.`,
    )
    if (!ok) return
    setError('')
    setAdminActionLoading(true)
    const ids = [...selectedCandidateIds]
    const { error: voteItemsError } = await supabase.from('vote_items').delete().in('candidate_id', ids)
    if (voteItemsError) {
      setAdminActionLoading(false)
      setError(voteItemsError.message)
      return
    }
    const { error: deleteError } = await supabase.from('candidates').delete().in('id', ids)
    setAdminActionLoading(false)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    setSelectedCandidateIds([])
    await loadAll()
  }

  async function handleAddNominationPosition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = nominationPositionName.trim()
    if (!name) return
    setError('')
    setAdminActionLoading(true)
    const { error: insertError } = await supabase.from('nomination_positions').insert({
      name,
      sort_order: nominationPositionOrder,
    })
    setAdminActionLoading(false)
    if (insertError) {
      setError(insertError.message)
      return
    }
    setNominationPositionName('')
    setNominationPositionOrder(0)
    await loadAll()
  }

  async function handleDeleteNominationPosition(row: NominationPosition) {
    const ok = window.confirm(
      `Delete nomination position "${row.name}"? You cannot delete it while nominations still reference it.`,
    )
    if (!ok) return
    setError('')
    setAdminActionLoading(true)
    const { error: deleteError } = await supabase.from('nomination_positions').delete().eq('id', row.id)
    setAdminActionLoading(false)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    await loadAll()
  }

  async function handleDeleteNominationEntry(entry: NominationEntry) {
    const ok = window.confirm(`Remove nomination for "${entry.nominee_full_name}"?`)
    if (!ok) return
    setError('')
    setAdminActionLoading(true)
    const { error: deleteError } = await supabase.from('nominations').delete().eq('id', entry.id)
    setAdminActionLoading(false)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    await loadAll()
  }

  async function handleToggleNominationSubmissions() {
    setError('')
    setAdminActionLoading(true)
    const next = !nominationSubmissionsOpen
    const { error: updateError } = await supabase
      .from('nomination_config')
      .update({ submissions_open: next })
      .eq('id', 1)
    setAdminActionLoading(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    setNominationSubmissionsOpen(next)
  }

  async function handleAddMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!memberEmail.trim() || !memberName.trim()) return

    const { error: insertError } = await supabase.from('members').insert({
      auth_user_id: memberAuthUserId.trim() || null,
      email: memberEmail.trim().toLowerCase(),
      full_name: memberName.trim(),
      is_eligible: memberEligible,
      is_admin: memberAdmin,
    })
    if (insertError) {
      setError(insertError.message)
      return
    }

    setMemberAuthUserId('')
    setMemberEmail('')
    setMemberName('')
    setMemberEligible(true)
    setMemberAdmin(false)
    await loadAll()
  }

  async function handleApproveRegistration(request: RegistrationRequest) {
    const ok = window.confirm(
      `Approve registration for "${request.full_name}" (${request.email})? They will become an eligible member.`,
    )
    if (!ok) return
    setError('')
    setRegistrationActionId(request.id)
    const { data, error: rpcError } = await supabase.rpc('approve_member_registration_request', {
      p_request_id: request.id,
    })
    setRegistrationActionId(null)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    const result = data as { ok?: boolean; error?: string } | null
    if (!result?.ok) {
      setError(result?.error || 'Unable to approve request.')
      return
    }
    await loadAll()
  }

  async function handleRejectRegistration(request: RegistrationRequest) {
    const ok = window.confirm(
      `Reject registration for "${request.full_name}" (${request.email})?`,
    )
    if (!ok) return
    setError('')
    setRegistrationActionId(request.id)
    const { data, error: rpcError } = await supabase.rpc('reject_member_registration_request', {
      p_request_id: request.id,
    })
    setRegistrationActionId(null)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    const result = data as { ok?: boolean; error?: string } | null
    if (!result?.ok) {
      setError(result?.error || 'Unable to reject request.')
      return
    }
    await loadAll()
  }

  async function handleDeleteRegistration(request: RegistrationRequest) {
    const ok = window.confirm(
      `Delete registration request for "${request.full_name}" (${request.email})? This cannot be undone.`,
    )
    if (!ok) return
    setError('')
    setRegistrationActionId(request.id)
    const { error: deleteError } = await supabase
      .from('member_registration_requests')
      .delete()
      .eq('id', request.id)
    setRegistrationActionId(null)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    await loadAll()
  }

  async function handleDeleteAllRegistrationRequests() {
    if (registrationRequests.length === 0) return
    const ok = window.confirm(
      `Delete ALL registration requests (pending, approved, and rejected)? This removes every request in the database and cannot be undone.`,
    )
    if (!ok) return
    setError('')
    setRegistrationActionId('__all__')
    // PostgREST requires a filter; this matches every row.
    const { error: deleteError } = await supabase
      .from('member_registration_requests')
      .delete()
      .gte('created_at', '1970-01-01T00:00:00.000Z')
    setRegistrationActionId(null)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    setRegistrationRequests([])
    await loadAll()
  }

  function openMemberView(member: Member) {
    setError('')
    setMemberModal({ mode: 'view', member })
  }

  function openMemberEdit(member: Member) {
    setError('')
    setEditEmail(member.email)
    setEditFullName(member.full_name)
    setEditAuthUserId(member.auth_user_id ?? '')
    setEditEligible(member.is_eligible)
    setEditAdmin(member.is_admin)
    setMemberModal({ mode: 'edit', member })
  }

  function closeMemberModal() {
    setMemberModal(null)
  }

  async function handleMemberDelete(member: Member) {
    const ok = window.confirm(
      `Remove member "${member.full_name}" (${member.email})? This cannot be undone.`,
    )
    if (!ok) return
    setError('')
    setMemberActionLoading(true)
    const { error: deleteError } = await supabase.from('members').delete().eq('id', member.id)
    setMemberActionLoading(false)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    setMembers((prev) => prev.filter((m) => m.id !== member.id))
    setSelectedMemberIds((prev) => prev.filter((id) => id !== member.id))
    setMemberModal((current) =>
      current?.member.id === member.id ? null : current,
    )
  }

  async function handleDeleteSelectedMembers() {
    if (selectedMemberIds.length === 0) return
    const ok = window.confirm(
      `Remove ${selectedMemberIds.length} selected member(s)? This cannot be undone.`,
    )
    if (!ok) return
    setError('')
    setMemberActionLoading(true)
    const { error: deleteError } = await supabase
      .from('members')
      .delete()
      .in('id', selectedMemberIds)
    setMemberActionLoading(false)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    setMembers((prev) => prev.filter((m) => !selectedMemberIds.includes(m.id)))
    setSelectedMemberIds([])
    setMemberModal((current) => {
      if (!current) return null
      return selectedMemberIds.includes(current.member.id) ? null : current
    })
  }

  function handleToggleMemberSelected(memberId: string) {
    setSelectedMemberIds((prev) =>
      prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId],
    )
  }

  function handleToggleSelectAllInSubset(subset: Member[]) {
    const ids = subset.map((m) => m.id)
    if (ids.length === 0) return
    const allSelected = ids.every((id) => selectedMemberIds.includes(id))
    setSelectedMemberIds((prev) => {
      if (allSelected) {
        return prev.filter((id) => !ids.includes(id))
      }
      return [...new Set([...prev, ...ids])]
    })
  }

  async function handleMemberSave() {
    if (!memberModal || memberModal.mode !== 'edit') return
    const { member } = memberModal
    const email = editEmail.trim().toLowerCase()
    const fullName = editFullName.trim()
    if (!email || !fullName) {
      setError('Email and full name are required.')
      return
    }
    const authId = editAuthUserId.trim()
    setError('')
    setMemberActionLoading(true)
    const { data, error: updateError } = await supabase
      .from('members')
      .update({
        email,
        full_name: fullName,
        auth_user_id: authId ? authId : null,
        is_eligible: editEligible,
        is_admin: editAdmin,
      })
      .eq('id', member.id)
      .select()
      .maybeSingle()
    setMemberActionLoading(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    if (data) {
      const updated = data as Member
      setMembers((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))
      setMemberModal({ mode: 'view', member: updated })
    }
  }

  function parseBooleanCell(value: string | undefined, fallback: boolean): boolean {
    if (!value) return fallback
    const normalized = value.trim().toLowerCase()
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true
    if (['false', '0', 'no', 'n'].includes(normalized)) return false
    return fallback
  }

  async function handleImportMembersCsv(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setCsvImportMessage('')
    setError('')

    const form = event.currentTarget
    const input = form.elements.namedItem('membersCsv') as HTMLInputElement | null
    const file = input?.files?.[0]

    if (!file) {
      setCsvImportMessage('Choose a CSV file first.')
      return
    }

    setCsvImporting(true)
    const csvText = await file.text()
    const lines = csvText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)

    if (lines.length < 2) {
      setCsvImporting(false)
      setCsvImportMessage('CSV must include a header row and at least one data row.')
      return
    }

    const headers = lines[0].split(',').map((cell) => cell.trim().toLowerCase())
    const emailIdx = headers.indexOf('email')
    const nameIdx = headers.indexOf('full_name')
    const authUserIdx = headers.indexOf('auth_user_id')
    const eligibleIdx = headers.indexOf('is_eligible')
    const adminIdx = headers.indexOf('is_admin')

    if (emailIdx === -1 || nameIdx === -1) {
      setCsvImporting(false)
      setCsvImportMessage('CSV header must include email and full_name.')
      return
    }

    type MemberInsert = {
      email: string
      full_name: string
      auth_user_id?: string | null
      is_eligible: boolean
      is_admin: boolean
    }

    const rowsToInsert: MemberInsert[] = []
    let skippedRows = 0

    for (const line of lines.slice(1)) {
      const cells = line.split(',').map((cell) => cell.trim())
      const emailValue = (cells[emailIdx] ?? '').toLowerCase()
      const nameValue = cells[nameIdx] ?? ''

      if (!emailValue || !nameValue) {
        skippedRows += 1
        continue
      }

      rowsToInsert.push({
        email: emailValue,
        full_name: nameValue,
        auth_user_id: authUserIdx >= 0 ? (cells[authUserIdx] || null) : null,
        is_eligible: eligibleIdx >= 0 ? parseBooleanCell(cells[eligibleIdx], true) : true,
        is_admin: adminIdx >= 0 ? parseBooleanCell(cells[adminIdx], false) : false,
      })
    }

    if (rowsToInsert.length === 0) {
      setCsvImporting(false)
      setCsvImportMessage('No valid rows found to import.')
      return
    }

    const { error: insertError } = await supabase.from('members').insert(rowsToInsert)
    setCsvImporting(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    setCsvImportMessage(
      `Imported ${rowsToInsert.length} member(s) successfully${skippedRows > 0 ? `, skipped ${skippedRows} invalid row(s).` : '.'}`,
    )
    form.reset()
    await loadAll()
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/login', { replace: true })
  }

  async function handleSetElectionStatus(status: Election['status']) {
    if (!election) return

    const { error: updateError } = await supabase
      .from('elections')
      .update({ status })
      .eq('id', election.id)

    if (updateError) {
      setError(updateError.message)
      return
    }

    setElectionStatus(status)
    await loadAll()
  }

  const turnoutPercent =
    eligibleMembersCount > 0 ? Math.round((votesCount / eligibleMembersCount) * 1000) / 10 : 0

  const candidateVoteCount = useMemo(() => {
    const map: Record<string, number> = {}
    for (const item of voteItems) {
      map[item.candidate_id] = (map[item.candidate_id] ?? 0) + 1
    }
    return map
  }, [voteItems])

  const candidatesByPosition = useMemo(() => {
    const grouped: Record<string, Candidate[]> = {}
    for (const candidate of candidates) {
      if (!grouped[candidate.position_id]) {
        grouped[candidate.position_id] = []
      }
      grouped[candidate.position_id].push(candidate)
    }
    return grouped
  }, [candidates])

  /** Admin Candidates tab: same order as Positions list, plus orphan rows. */
  const candidatesListGroups = useMemo(() => {
    const grouped: Record<string, Candidate[]> = {}
    for (const c of candidates) {
      if (!grouped[c.position_id]) grouped[c.position_id] = []
      grouped[c.position_id].push(c)
    }
    for (const id of Object.keys(grouped)) {
      grouped[id].sort((a, b) =>
        a.full_name.localeCompare(b.full_name, undefined, { sensitivity: 'base' }),
      )
    }
    const groups = positions.map((position) => ({
      position,
      list: grouped[position.id] ?? [],
    }))
    const known = new Set(positions.map((p) => p.id))
    const orphans = candidates
      .filter((c) => !known.has(c.position_id))
      .sort((a, b) =>
        a.full_name.localeCompare(b.full_name, undefined, { sensitivity: 'base' }),
      )
    return { groups, orphans }
  }, [candidates, positions])

  const electionTitleById = useMemo(() => {
    const map: Record<string, string> = {}
    for (const item of elections) map[item.id] = item.title
    return map
  }, [elections])

  const electionTitleByPositionId = useMemo(() => {
    const map: Record<string, string> = {}
    for (const position of positions) {
      map[position.id] = electionTitleById[position.election_id] ?? '—'
    }
    return map
  }, [positions, electionTitleById])

  const nominationsGroupedByPosition = useMemo(() => {
    const byPos: Record<string, NominationEntry[]> = {}
    for (const n of nominations) {
      if (!byPos[n.nomination_position_id]) byPos[n.nomination_position_id] = []
      byPos[n.nomination_position_id].push(n)
    }
    for (const id of Object.keys(byPos)) {
      byPos[id].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    }
    const ordered = [...nominationPositions].sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
      return a.name.localeCompare(b.name)
    })
    return ordered.map((position) => ({
      position,
      entries: byPos[position.id] ?? [],
    }))
  }, [nominations, nominationPositions])

  const orphanNominationsByPositionId = useMemo(() => {
    const known = new Set(nominationPositions.map((p) => p.id))
    const orphans = nominations.filter((n) => !known.has(n.nomination_position_id))
    return [...orphans].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
  }, [nominations, nominationPositions])

  const resultsPositions = useMemo(
    () => (election ? positions.filter((p) => p.election_id === election.id) : []),
    [election, positions],
  )

  const friendlyError = useMemo(() => (error ? getFriendlyErrorMessage(error) : ''), [error])

  function handleExportResults() {
    if (!election || resultsPositions.length === 0) return

    const turnoutLine = `Turnout: ${votesCount} / ${eligibleMembersCount} eligible voters (${turnoutPercent}%)`
    const generatedAtLabel = `Generated ${new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`

    const sections = resultsPositions.map((position) => {
      const groupedCandidates = [...(candidatesByPosition[position.id] ?? [])].sort(
        (a, b) =>
          (candidateVoteCount[b.id] ?? 0) - (candidateVoteCount[a.id] ?? 0) ||
          a.full_name.localeCompare(b.full_name),
      )

      const maxVotes =
        groupedCandidates.length === 0
          ? 0
          : Math.max(...groupedCandidates.map((c) => candidateVoteCount[c.id] ?? 0))

      const leaders = groupedCandidates.filter(
        (c) => (candidateVoteCount[c.id] ?? 0) === maxVotes,
      )
      const voteWord = maxVotes === 1 ? 'vote' : 'votes'

      let leaderSummary: string | null = null
      if (groupedCandidates.length > 0) {
        if (maxVotes === 0) {
          leaderSummary = 'No votes recorded yet for this position.'
        } else if (leaders.length === 1) {
          leaderSummary = `Currently leading: ${leaders[0].full_name} (${maxVotes} ${voteWord})`
        } else {
          leaderSummary = `Tie for the lead: ${leaders.map((c) => c.full_name).join(', ')} (${maxVotes} ${voteWord} each)`
        }
      }

      return {
        positionName: position.name,
        leaderSummary,
        candidates: groupedCandidates.map((c) => ({
          fullName: c.full_name,
          votes: candidateVoteCount[c.id] ?? 0,
        })),
      }
    })

    const slug =
      election.title
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase() || 'election'
    const dateStamp = new Date().toISOString().slice(0, 10)

    downloadElectionResultsHtml(`election-results-${slug}-${dateStamp}`, {
      electionTitle: election.title,
      logoUrl: election.logo_url,
      turnoutLine,
      generatedAtLabel,
      sections,
    })
  }

  function handleExportNominationsCsv() {
    if (nominations.length === 0) return
    const lines: string[] = ['Position,Nominee,Submitted (UTC)']
    for (const { position, entries } of nominationsGroupedByPosition) {
      for (const row of entries) {
        const ts = row.created_at ? new Date(row.created_at).toISOString() : ''
        lines.push([position.name, row.nominee_full_name, ts].map(escapeCsvCell).join(','))
      }
    }
    for (const row of orphanNominationsByPositionId) {
      const ts = row.created_at ? new Date(row.created_at).toISOString() : ''
      lines.push(
        ['Unknown / deleted position', row.nominee_full_name, ts].map(escapeCsvCell).join(','),
      )
    }
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `nominations-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleExportRegistrationRequestsCsv() {
    if (registrationRequests.length === 0) return
    const lines: string[] = [
      'Full name,Email,Note,Status,Submitted (UTC),Reviewed (UTC),Reviewer email',
    ]
    for (const row of registrationRequests) {
      const submitted = row.created_at ? new Date(row.created_at).toISOString() : ''
      const reviewed = row.reviewed_at ? new Date(row.reviewed_at).toISOString() : ''
      lines.push(
        [
          row.full_name,
          row.email,
          row.note ?? '',
          row.status,
          submitted,
          reviewed,
          row.reviewer_email ?? '',
        ]
          .map(escapeCsvCell)
          .join(','),
      )
    }
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `registration-requests-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col bg-page">
        <AppTopbar title="Admin Dashboard" />
        <div className="flex flex-1 items-center justify-center px-4">
          <p className="text-sm font-medium text-zinc-500">Loading admin dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen min-w-0 flex-col overflow-x-hidden bg-page">
      <AppTopbar
        title="Admin Dashboard"
        right={
          <button type="button" className="btn-topbar" onClick={handleSignOut}>
            Sign out
          </button>
        }
      />
      <div className="mx-auto w-full min-w-0 max-w-5xl space-y-4 px-3 py-5 sm:px-4 sm:py-6">
        {error ? <p className="text-sm font-medium text-red-700">{friendlyError}</p> : null}
        <MemberNotificationsPanel variant="wide" />

        <div className="card-app flex flex-wrap gap-2 p-2">
          <button
            type="button"
            className={`nav-tab ${activeTab === 'election' ? 'nav-tab-active' : 'nav-tab-inactive'}`}
            onClick={() => setActiveTab('election')}
          >
            Election
          </button>
          <button
            type="button"
            className={`nav-tab ${activeTab === 'positionsCandidates' ? 'nav-tab-active' : 'nav-tab-inactive'}`}
            onClick={() => setActiveTab('positionsCandidates')}
          >
            Positions & Candidates
          </button>
          <button
            type="button"
            className={`nav-tab ${activeTab === 'members' ? 'nav-tab-active' : 'nav-tab-inactive'}`}
            onClick={() => setActiveTab('members')}
          >
            Members
          </button>
          <button
            type="button"
            className={`nav-tab ${activeTab === 'registrations' ? 'nav-tab-active' : 'nav-tab-inactive'}`}
            onClick={() => setActiveTab('registrations')}
          >
            Registrations
            {pendingRegistrationCount > 0 ? ` (${pendingRegistrationCount})` : ''}
          </button>
          <button
            type="button"
            className={`nav-tab ${activeTab === 'nominations' ? 'nav-tab-active' : 'nav-tab-inactive'}`}
            onClick={() => setActiveTab('nominations')}
          >
            Nominations
          </button>
          <button
            type="button"
            className={`nav-tab ${activeTab === 'notifications' ? 'nav-tab-active' : 'nav-tab-inactive'}`}
            onClick={() => setActiveTab('notifications')}
          >
            Notifications
          </button>
          <button
            type="button"
            className={`nav-tab ${activeTab === 'results' ? 'nav-tab-active' : 'nav-tab-inactive'}`}
            onClick={() => setActiveTab('results')}
          >
            Turnout and Results
          </button>
        </div>

        {activeTab === 'election' ? (
          <section className="card-app p-4 space-y-3">
            <h2 className="text-lg font-bold text-zinc-900">Election</h2>
            <div className="space-y-2 rounded-2xl border border-zinc-200/90 bg-zinc-50/50 p-4">
              <p className="text-sm font-medium text-zinc-800">Election logo</p>
              {election ? (
                <>
                  {election.logo_url ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <img
                        src={election.logo_url}
                        alt=""
                        className="h-16 max-w-[220px] rounded-xl border border-zinc-200 bg-white object-contain"
                      />
                      <button
                        type="button"
                        className="btn-secondary text-sm disabled:opacity-50"
                        disabled={electionLogoUploading}
                        onClick={() => void handleRemoveElectionLogo()}
                      >
                        Remove logo
                      </button>
                    </div>
                  ) : null}
                  <input
                    type="file"
                    accept={ELECTION_LOGO_ACCEPT}
                    disabled={electionLogoUploading}
                    className="text-sm text-zinc-800 file:mr-3 file:rounded-xl file:border file:border-zinc-200 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium"
                    onChange={(e) => void handleElectionLogoFile(e)}
                  />
                  <p className="text-xs text-zinc-500">
                    PNG, JPEG, WebP, or GIF, up to 2 MB. Shown on the voter ballot for this election (
                    {election.title}).
                  </p>
                </>
              ) : (
                <p className="text-sm text-zinc-600">
                  Save the election below first, then you can upload a logo.
                </p>
              )}
            </div>
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={handleSaveElection}>
              <input
                className="input-app"
                placeholder="Election title"
                value={electionTitle}
                onChange={(event) => setElectionTitle(event.target.value)}
                required
              />
              <select
                className="input-app"
                value={electionStatus}
                onChange={(event) => setElectionStatus(event.target.value as Election['status'])}
              >
                <option value="draft">draft</option>
                <option value="open">open</option>
                <option value="closed">closed</option>
              </select>
              <input
                type="datetime-local"
                className="input-app"
                value={startsAt}
                onChange={(event) => setStartsAt(event.target.value)}
                aria-label="Start Date"
              />
              <input
                type="datetime-local"
                className="input-app"
                value={endsAt}
                onChange={(event) => setEndsAt(event.target.value)}
                required
                aria-label="End Date"
              />
              <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
                <button className="btn-primary-sm w-auto justify-self-start bg-mint-700 px-3 py-1.5 text-xs hover:bg-mint-800">
                  {election && election.status !== 'closed' ? 'Update Election' : 'Create Election'}
                </button>
                <button
                  type="button"
                  className="btn-secondary px-3 py-1.5 text-xs"
                  onClick={handleResetElectionForm}
                >
                  Reset form
                </button>
              </div>
            </form>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-sm text-zinc-600">Start Date</label>
                <p className="text-sm font-medium text-zinc-900">{startsAt || '-'}</p>
              </div>
              <div className="space-y-1">
                <label className="text-sm text-zinc-600">End Date</label>
                <p className="text-sm font-medium text-zinc-900">{endsAt || '-'}</p>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                className="rounded-full bg-mint-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-mint-800 disabled:opacity-60"
                disabled={!election || electionStatus === 'open'}
                onClick={() => handleSetElectionStatus('open')}
              >
                Start Voting
              </button>
              <button
                type="button"
                className="rounded-full bg-red-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-red-800 disabled:opacity-60"
                disabled={!election || electionStatus === 'closed'}
                onClick={() => handleSetElectionStatus('closed')}
              >
                Stop Voting
              </button>
            </div>
            <div className="space-y-2">
              <h3 className="text-base font-bold text-zinc-900">Elections created ({elections.length})</h3>
              {elections.length === 0 ? (
                <p className="text-sm text-zinc-600">No elections created yet.</p>
              ) : (
                <div className="table-scroll">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-100">
                    <tr>
                      <th className="text-left p-2 w-16">Logo</th>
                      <th className="text-left p-2">Title</th>
                      <th className="text-left p-2">Status</th>
                      <th className="text-left p-2">Start</th>
                      <th className="text-left p-2">End</th>
                      <th className="text-left p-2">Created</th>
                      <th className="text-left p-2 w-[1%] whitespace-nowrap">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {elections.map((item) => (
                      <tr key={item.id} className="border-t border-zinc-200">
                        <td className="p-2 align-middle">
                          {item.logo_url ? (
                            <img
                              src={item.logo_url}
                              alt=""
                              className="h-10 w-10 rounded-lg border border-zinc-200 bg-white object-contain"
                            />
                          ) : (
                            <span className="text-zinc-400">—</span>
                          )}
                        </td>
                        <td className="p-2">{item.title}</td>
                        <td className="p-2">{item.status}</td>
                        <td className="p-2">
                          {item.starts_at ? new Date(item.starts_at).toLocaleString() : '-'}
                        </td>
                        <td className="p-2">{new Date(item.ends_at).toLocaleString()}</td>
                        <td className="p-2">
                          {item.created_at ? new Date(item.created_at).toLocaleString() : '-'}
                        </td>
                        <td className="p-2">
                          <button
                            type="button"
                            className="rounded-full border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 shadow-sm hover:bg-red-50 disabled:opacity-50"
                            disabled={adminActionLoading}
                            onClick={() => void handleDeleteElection(item)}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
            </div>
          </section>
        ) : null}

        {activeTab === 'positionsCandidates' ? (
          <section className="card-app overflow-hidden p-0">
            <div className="flex flex-wrap gap-2 border-b border-zinc-200/90 bg-zinc-50/80 p-2 sm:px-4">
              <button
                type="button"
                className={`nav-tab ${positionsCandidatesSubTab === 'positions' ? 'nav-tab-active' : 'nav-tab-inactive'}`}
                onClick={() => setPositionsCandidatesSubTab('positions')}
              >
                Positions
              </button>
              <button
                type="button"
                className={`nav-tab ${positionsCandidatesSubTab === 'candidates' ? 'nav-tab-active' : 'nav-tab-inactive'}`}
                onClick={() => setPositionsCandidatesSubTab('candidates')}
              >
                Candidates
              </button>
            </div>

            <div className="space-y-3 p-4">
              {positionsCandidatesSubTab === 'positions' ? (
                <>
                  <h2 className="text-lg font-bold text-zinc-900">Positions</h2>
                  <p className="text-sm text-zinc-600">
                    All positions across elections are listed below. New positions are added to the
                    current election (the most recently created one on the Election tab). Use the
                    Candidates tab to add names for each position.
                  </p>
                  <form className="grid gap-3 sm:grid-cols-3" onSubmit={handleAddPosition}>
                <input
                  className="input-app sm:col-span-2"
                  placeholder="Position name"
                  value={positionName}
                  onChange={(event) => setPositionName(event.target.value)}
                  required
                  disabled={!election}
                />
                <input
                  type="number"
                  className="input-app"
                  placeholder="Sort order"
                  value={positionOrder}
                  onChange={(event) => setPositionOrder(Number(event.target.value))}
                  disabled={!election}
                />
                <button
                  className="btn-primary-sm sm:col-span-3 w-auto justify-self-start bg-mint-700 px-3 py-1.5 text-xs hover:bg-mint-800 disabled:opacity-60"
                  disabled={!election}
                >
                  Add Position
                </button>
              </form>
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <p className="text-sm text-zinc-600">
                  <span className="block sm:inline">
                    {positions.length} position{positions.length === 1 ? '' : 's'}
                  </span>
                  <span className="hidden sm:inline"> · </span>
                  <span className="block sm:inline">{selectedPositionIds.length} selected</span>
                </p>
                <button
                  type="button"
                  className="btn-danger-outline w-full disabled:opacity-50 sm:w-auto"
                  disabled={adminActionLoading || selectedPositionIds.length === 0}
                  onClick={() => void handleDeleteSelectedPositions()}
                >
                  <span className="sm:hidden">Delete selected ({selectedPositionIds.length})</span>
                  <span className="hidden sm:inline">Delete selected</span>
                </button>
              </div>
              <div className="table-scroll">
                <table className="w-full text-sm">
                <thead className="bg-zinc-100">
                  <tr>
                    <th className="w-[1%] p-2 text-left">
                      <input
                        type="checkbox"
                        aria-label="Select all positions"
                        checked={allPositionsSelected}
                        onChange={handleToggleSelectAllPositions}
                        disabled={adminActionLoading || positions.length === 0}
                      />
                    </th>
                    <th className="text-left p-2">Election</th>
                    <th className="text-left p-2">Name</th>
                    <th className="text-left p-2">Order</th>
                    <th className="w-[1%] whitespace-nowrap p-2 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.length === 0 ? (
                    <tr className="border-t border-zinc-200">
                      <td className="p-2 text-zinc-600" colSpan={5}>
                        No positions yet. Add one above.
                      </td>
                    </tr>
                  ) : (
                    positions.map((position) => (
                      <tr key={position.id} className="border-t border-zinc-200">
                        <td className="p-2">
                          <input
                            type="checkbox"
                            aria-label={`Select ${position.name}`}
                            checked={selectedPositionIds.includes(position.id)}
                            onChange={() => handleTogglePositionSelected(position.id)}
                            disabled={adminActionLoading}
                          />
                        </td>
                        <td className="p-2">{electionTitleById[position.election_id] ?? '—'}</td>
                        <td className="p-2">{position.name}</td>
                        <td className="p-2">{position.sort_order}</td>
                        <td className="p-2">
                          <button
                            type="button"
                            className="rounded-full border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 shadow-sm hover:bg-red-50 disabled:opacity-50"
                            disabled={adminActionLoading}
                            onClick={() => void handleDeletePosition(position)}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              </div>
                </>
              ) : (
                <>
                  <h2 className="text-lg font-bold text-zinc-900">Candidates</h2>
                  <p className="text-sm text-zinc-600">
                    Add people running for each ballot position. Positions are managed on the
                    Positions tab.
                  </p>
                  <form className="grid gap-3 sm:grid-cols-3" onSubmit={handleAddCandidate}>
                <select
                  className="input-app"
                  value={candidatePositionId}
                  onChange={(event) => setCandidatePositionId(event.target.value)}
                  required
                  disabled={positions.length === 0}
                >
                  <option value="">Select position</option>
                  {positions.map((position) => (
                    <option key={position.id} value={position.id}>
                      {(electionTitleById[position.election_id] ?? 'Election') + ' — ' + position.name}
                    </option>
                  ))}
                </select>
                <input
                  className="input-app sm:col-span-2"
                  placeholder="Candidate full name"
                  value={candidateName}
                  onChange={(event) => setCandidateName(event.target.value)}
                  required
                  disabled={positions.length === 0}
                />
                <button
                  className="btn-primary-sm sm:col-span-3 disabled:opacity-60"
                  disabled={positions.length === 0}
                >
                  Add Candidate
                </button>
              </form>
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
                  <p className="text-sm text-zinc-600">
                    <span className="block sm:inline">
                      {candidates.length} candidate{candidates.length === 1 ? '' : 's'}
                    </span>
                    <span className="hidden sm:inline"> · </span>
                    <span className="block sm:inline">{selectedCandidateIds.length} selected</span>
                  </p>
                  {candidates.length > 0 ? (
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700">
                      <input
                        type="checkbox"
                        aria-label="Select all candidates"
                        checked={allCandidatesSelected}
                        onChange={handleToggleSelectAllCandidates}
                        disabled={adminActionLoading}
                      />
                      Select all
                    </label>
                  ) : null}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                  <button
                    type="button"
                    className="btn-danger-outline w-full disabled:opacity-50 sm:w-auto"
                    disabled={adminActionLoading || selectedCandidateIds.length === 0}
                    onClick={() => void handleDeleteSelectedCandidates()}
                  >
                    <span className="sm:hidden">Delete selected ({selectedCandidateIds.length})</span>
                    <span className="hidden sm:inline">Delete selected</span>
                  </button>
                </div>
              </div>
              {positions.length === 0 ? (
                <p className="text-sm text-zinc-600">
                  No positions yet. Add positions on the Positions tab before adding candidates.
                </p>
              ) : (
                <div className="space-y-4">
                  {candidatesListGroups.groups.map(({ position, list }) => (
                    <div
                      key={position.id}
                      className="overflow-hidden rounded-xl border border-zinc-200 bg-white"
                    >
                      <div className="border-b border-zinc-200 bg-zinc-50 px-3 py-2">
                        <h3 className="text-sm font-bold text-zinc-900">{position.name}</h3>
                        <p className="text-xs text-zinc-500">
                          {electionTitleById[position.election_id] ?? '—'} · {list.length}{' '}
                          candidate{list.length === 1 ? '' : 's'}
                        </p>
                      </div>
                      {list.length === 0 ? (
                        <p className="p-3 text-sm text-zinc-500">
                          No candidates for this position yet.
                        </p>
                      ) : (
                        <div className="table-scroll">
                <table className="w-full text-sm">
                          <thead className="bg-zinc-100">
                            <tr>
                              <th className="w-[1%] p-2 text-left">
                                <span className="sr-only">Select</span>
                              </th>
                              <th className="p-2 text-left">Candidate</th>
                              <th className="w-[1%] whitespace-nowrap p-2 text-left">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {list.map((candidate) => (
                              <tr key={candidate.id} className="border-t border-zinc-200">
                                <td className="p-2">
                                  <input
                                    type="checkbox"
                                    aria-label={`Select ${candidate.full_name}`}
                                    checked={selectedCandidateIds.includes(candidate.id)}
                                    onChange={() => handleToggleCandidateSelected(candidate.id)}
                                    disabled={adminActionLoading}
                                  />
                                </td>
                                <td className="p-2">{candidate.full_name}</td>
                                <td className="p-2">
                                  <button
                                    type="button"
                                    className="rounded-full border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 shadow-sm hover:bg-red-50 disabled:opacity-50"
                                    disabled={adminActionLoading}
                                    onClick={() => void handleDeleteCandidate(candidate)}
                                  >
                                    Delete
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        </div>
                      )}
                    </div>
                  ))}
                  {candidatesListGroups.orphans.length > 0 ? (
                    <div className="overflow-hidden rounded-xl border border-amber-200 bg-white">
                      <div className="border-b border-amber-100 bg-amber-50 px-3 py-2">
                        <h3 className="text-sm font-bold text-zinc-900">
                          Unknown / deleted position
                        </h3>
                        <p className="text-xs text-zinc-600">
                          These candidates reference a position that is no longer on the list.
                        </p>
                      </div>
                      <div className="table-scroll">
                <table className="w-full text-sm">
                        <thead className="bg-zinc-100">
                          <tr>
                            <th className="w-[1%] p-2 text-left">
                              <span className="sr-only">Select</span>
                            </th>
                            <th className="p-2 text-left">Candidate</th>
                            <th className="p-2 text-left">Election</th>
                            <th className="w-[1%] whitespace-nowrap p-2 text-left">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {candidatesListGroups.orphans.map((candidate) => (
                            <tr key={candidate.id} className="border-t border-zinc-200">
                              <td className="p-2">
                                <input
                                  type="checkbox"
                                  aria-label={`Select ${candidate.full_name}`}
                                  checked={selectedCandidateIds.includes(candidate.id)}
                                  onChange={() => handleToggleCandidateSelected(candidate.id)}
                                  disabled={adminActionLoading}
                                />
                              </td>
                              <td className="p-2">{candidate.full_name}</td>
                              <td className="p-2">
                                {electionTitleByPositionId[candidate.position_id] ?? '—'}
                              </td>
                              <td className="p-2">
                                <button
                                  type="button"
                                  className="rounded-full border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 shadow-sm hover:bg-red-50 disabled:opacity-50"
                                  disabled={adminActionLoading}
                                  onClick={() => void handleDeleteCandidate(candidate)}
                                >
                                  Delete
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
                </>
              )}
            </div>
          </section>
        ) : null}

        {activeTab === 'members' ? (
          <section className="card-app p-4 space-y-3">
            <h2 className="text-lg font-bold text-zinc-900">Members</h2>
            <p className="text-sm text-zinc-600">Add eligible alumni by email. Auth User ID is optional.</p>

            <form className="grid gap-3 sm:grid-cols-2" onSubmit={handleAddMember}>
              <input
                className="input-app sm:col-span-2"
                placeholder="Auth user ID (optional UUID)"
                value={memberAuthUserId}
                onChange={(event) => setMemberAuthUserId(event.target.value)}
              />
              <input
                type="email"
                className="input-app"
                placeholder="Email"
                value={memberEmail}
                onChange={(event) => setMemberEmail(event.target.value)}
                required
              />
              <input
                className="input-app"
                placeholder="Full name"
                value={memberName}
                onChange={(event) => setMemberName(event.target.value)}
                required
              />
              <label className="flex items-center gap-2 text-sm text-zinc-700">
                <input
                  type="checkbox"
                  checked={memberEligible}
                  onChange={(event) => setMemberEligible(event.target.checked)}
                />
                Can vote
              </label>
              <label className="flex items-center gap-2 text-sm text-zinc-700">
                <input
                  type="checkbox"
                  checked={memberAdmin}
                  onChange={(event) => setMemberAdmin(event.target.checked)}
                />
                Is admin
              </label>
              <button
                type="submit"
                className="btn-primary-sm sm:col-span-2 w-auto justify-self-start bg-mint-700 px-3 py-1.5 text-xs hover:bg-mint-800"
              >
                <span className="sm:hidden">Add member</span>
                <span className="hidden sm:inline">Add Member</span>
              </button>
            </form>
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={handleImportMembersCsv}>
              <input
                name="membersCsv"
                type="file"
                accept=".csv"
                className="input-app sm:col-span-2 file:mr-3 file:rounded-xl file:border file:border-zinc-200 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium"
              />
              <button
                type="submit"
                disabled={csvImporting}
                className="btn-secondary sm:col-span-2 disabled:opacity-60"
              >
                {csvImporting ? (
                  'Importing…'
                ) : (
                  <>
                    <span className="sm:hidden">Import CSV</span>
                    <span className="hidden sm:inline">Import Members from CSV</span>
                  </>
                )}
              </button>
            </form>
            {csvImportMessage ? <p className="text-sm text-zinc-700">{csvImportMessage}</p> : null}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <p className="text-sm text-zinc-600">
                <span className="block sm:inline">
                  {adminMembers.length} administrator{adminMembers.length === 1 ? '' : 's'}
                </span>
                <span className="hidden sm:inline"> · </span>
                <span className="block sm:inline">
                  {regularMembers.length} member{regularMembers.length === 1 ? '' : 's'}
                </span>
                <span className="hidden sm:inline"> · </span>
                <span className="block sm:inline">{selectedMemberIds.length} selected</span>
              </p>
              <button
                type="button"
                className="btn-danger-outline w-full shrink-0 disabled:opacity-50 sm:w-auto"
                disabled={memberActionLoading || selectedMemberIds.length === 0}
                onClick={() => void handleDeleteSelectedMembers()}
              >
                <span className="sm:hidden">Delete selected ({selectedMemberIds.length})</span>
                <span className="hidden sm:inline">Delete selected</span>
              </button>
            </div>

            <div className="md:hidden space-y-8">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-base font-bold text-zinc-900">Administrators</h3>
                  <span className="rounded-full bg-forest-900/10 px-2.5 py-0.5 text-xs font-semibold text-forest-900">
                    {adminMembers.length}
                  </span>
                </div>
                <p className="text-xs text-zinc-500">Dashboard access. Listed separately so you can verify who is an admin.</p>
                {adminMembers.length === 0 ? (
                  <p className="text-sm text-zinc-500">No administrators yet.</p>
                ) : (
                  <>
                    <div className="flex items-center gap-2 rounded-2xl border border-zinc-200 bg-zinc-50/80 px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label="Select all administrators"
                        checked={allAdminsSelected}
                        onChange={() => handleToggleSelectAllInSubset(adminMembers)}
                        disabled={memberActionLoading}
                      />
                      <span className="text-xs font-medium text-zinc-600">Select all in this list</span>
                    </div>
                    {adminMembers.map((member) => (
                      <div
                        key={member.id}
                        className="rounded-2xl border border-forest-900/15 bg-white p-3 shadow-sm ring-1 ring-forest-900/10"
                      >
                        <div className="flex gap-3">
                          <div className="pt-0.5">
                            <input
                              type="checkbox"
                              aria-label={`Select ${member.full_name}`}
                              checked={selectedMemberIds.includes(member.id)}
                              onChange={() => handleToggleMemberSelected(member.id)}
                              disabled={memberActionLoading}
                            />
                          </div>
                          <div className="min-w-0 flex-1 space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="font-semibold text-zinc-900">{member.full_name}</p>
                                <p className="break-all text-xs text-zinc-500">{member.email}</p>
                              </div>
                              <MemberActionIconButtons
                                member={member}
                                disabled={memberActionLoading}
                                onView={openMemberView}
                                onEdit={openMemberEdit}
                                onDelete={handleMemberDelete}
                              />
                            </div>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-600">
                              <span className="pill-leader py-0.5 text-xs">Administrator</span>
                              <span>Auth: {member.auth_user_id ? 'Yes' : 'No'}</span>
                              <span>Can vote: {member.is_eligible ? 'Yes' : 'No'}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>

              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-base font-bold text-zinc-900">Members</h3>
                  <span className="rounded-full bg-zinc-200/80 px-2.5 py-0.5 text-xs font-semibold text-zinc-700">
                    {regularMembers.length}
                  </span>
                </div>
                <p className="text-xs text-zinc-500">Everyone who is not an administrator.</p>
                {regularMembers.length === 0 ? (
                  <p className="text-sm text-zinc-500">No members in this list.</p>
                ) : (
                  <>
                    <div className="flex items-center gap-2 rounded-2xl border border-zinc-200 bg-zinc-50/80 px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label="Select all members in this list"
                        checked={allRegularsSelected}
                        onChange={() => handleToggleSelectAllInSubset(regularMembers)}
                        disabled={memberActionLoading}
                      />
                      <span className="text-xs font-medium text-zinc-600">Select all in this list</span>
                    </div>
                    {regularMembers.map((member) => (
                      <div
                        key={member.id}
                        className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm"
                      >
                        <div className="flex gap-3">
                          <div className="pt-0.5">
                            <input
                              type="checkbox"
                              aria-label={`Select ${member.full_name}`}
                              checked={selectedMemberIds.includes(member.id)}
                              onChange={() => handleToggleMemberSelected(member.id)}
                              disabled={memberActionLoading}
                            />
                          </div>
                          <div className="min-w-0 flex-1 space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="font-semibold text-zinc-900">{member.full_name}</p>
                                <p className="break-all text-xs text-zinc-500">{member.email}</p>
                              </div>
                              <MemberActionIconButtons
                                member={member}
                                disabled={memberActionLoading}
                                onView={openMemberView}
                                onEdit={openMemberEdit}
                                onDelete={handleMemberDelete}
                              />
                            </div>
                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-600">
                              <span>Auth: {member.auth_user_id ? 'Yes' : 'No'}</span>
                              <span>Can vote: {member.is_eligible ? 'Yes' : 'No'}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>

            <div className="hidden md:block space-y-8">
              <div className="space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-base font-bold text-zinc-900">Administrators</h3>
                  <span className="text-xs font-medium text-zinc-500">
                    {adminMembers.length} total · dashboard access
                  </span>
                </div>
                {adminMembers.length === 0 ? (
                  <p className="text-sm text-zinc-500">No administrators yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <div className="table-scroll">
                    <table className="w-full min-w-[560px] text-sm">
                      <thead className="bg-zinc-100">
                        <tr>
                          <th className="w-[1%] p-2 text-left">
                            <input
                              type="checkbox"
                              aria-label="Select all administrators"
                              checked={allAdminsSelected}
                              onChange={() => handleToggleSelectAllInSubset(adminMembers)}
                              disabled={memberActionLoading}
                            />
                          </th>
                          <th className="p-2 text-left">Name</th>
                          <th className="p-2 text-left">Email</th>
                          <th className="p-2 text-left">Linked auth</th>
                          <th className="p-2 text-left">Can vote</th>
                          <th className="w-[1%] whitespace-nowrap p-2 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {adminMembers.map((member) => (
                          <tr
                            key={member.id}
                            className="border-t border-zinc-200 bg-mint-50/25"
                          >
                            <td className="p-2">
                              <input
                                type="checkbox"
                                aria-label={`Select ${member.full_name}`}
                                checked={selectedMemberIds.includes(member.id)}
                                onChange={() => handleToggleMemberSelected(member.id)}
                                disabled={memberActionLoading}
                              />
                            </td>
                            <td className="p-2">
                              <span className="font-medium">{member.full_name}</span>
                              <span className="ml-2 inline-block align-middle">
                                <span className="pill-leader py-0.5 text-[0.65rem]">Admin</span>
                              </span>
                            </td>
                            <td className="break-all p-2">{member.email}</td>
                            <td className="p-2">{member.auth_user_id ? 'Yes' : 'No'}</td>
                            <td className="p-2">{member.is_eligible ? 'Yes' : 'No'}</td>
                            <td className="p-2">
                              <MemberActionIconButtons
                                member={member}
                                disabled={memberActionLoading}
                                onView={openMemberView}
                                onEdit={openMemberEdit}
                                onDelete={handleMemberDelete}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-base font-bold text-zinc-900">Members</h3>
                  <span className="text-xs font-medium text-zinc-500">
                    {regularMembers.length} total · not administrators
                  </span>
                </div>
                {regularMembers.length === 0 ? (
                  <p className="text-sm text-zinc-500">No members in this list.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <div className="table-scroll">
                    <table className="w-full min-w-[560px] text-sm">
                      <thead className="bg-zinc-100">
                        <tr>
                          <th className="w-[1%] p-2 text-left">
                            <input
                              type="checkbox"
                              aria-label="Select all members in this list"
                              checked={allRegularsSelected}
                              onChange={() => handleToggleSelectAllInSubset(regularMembers)}
                              disabled={memberActionLoading}
                            />
                          </th>
                          <th className="p-2 text-left">Name</th>
                          <th className="p-2 text-left">Email</th>
                          <th className="p-2 text-left">Linked auth</th>
                          <th className="p-2 text-left">Can vote</th>
                          <th className="w-[1%] whitespace-nowrap p-2 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {regularMembers.map((member) => (
                          <tr key={member.id} className="border-t border-zinc-200">
                            <td className="p-2">
                              <input
                                type="checkbox"
                                aria-label={`Select ${member.full_name}`}
                                checked={selectedMemberIds.includes(member.id)}
                                onChange={() => handleToggleMemberSelected(member.id)}
                                disabled={memberActionLoading}
                              />
                            </td>
                            <td className="p-2">{member.full_name}</td>
                            <td className="break-all p-2">{member.email}</td>
                            <td className="p-2">{member.auth_user_id ? 'Yes' : 'No'}</td>
                            <td className="p-2">{member.is_eligible ? 'Yes' : 'No'}</td>
                            <td className="p-2">
                              <MemberActionIconButtons
                                member={member}
                                disabled={memberActionLoading}
                                onView={openMemberView}
                                onEdit={openMemberEdit}
                                onDelete={handleMemberDelete}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {memberModal ? (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                role="presentation"
                onClick={(e) => {
                  if (e.target === e.currentTarget) closeMemberModal()
                }}
              >
                <div
                  className="card-app max-h-[min(90vh,100%)] w-full max-w-md overflow-y-auto p-5 sm:p-6"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="member-modal-title"
                  onClick={(e) => e.stopPropagation()}
                >
                  {memberModal.mode === 'view' ? (
                    <>
                      <h3 id="member-modal-title" className="text-lg font-bold text-zinc-900">
                        Member details
                      </h3>
                      <dl className="mt-3 space-y-2 text-sm">
                        <div>
                          <dt className="text-zinc-500">Member ID</dt>
                          <dd className="break-all font-mono text-xs text-zinc-800">{memberModal.member.id}</dd>
                        </div>
                        <div>
                          <dt className="text-zinc-500">Email</dt>
                          <dd className="text-zinc-800">{memberModal.member.email}</dd>
                        </div>
                        <div>
                          <dt className="text-zinc-500">Full name</dt>
                          <dd className="text-zinc-800">{memberModal.member.full_name}</dd>
                        </div>
                        <div>
                          <dt className="text-zinc-500">Auth user ID</dt>
                          <dd className="break-all font-mono text-xs text-zinc-800">
                            {memberModal.member.auth_user_id ?? '—'}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-zinc-500">Can vote</dt>
                          <dd className="text-zinc-800">{memberModal.member.is_eligible ? 'Yes' : 'No'}</dd>
                        </div>
                        <div>
                          <dt className="text-zinc-500">Admin</dt>
                          <dd className="text-zinc-800">{memberModal.member.is_admin ? 'Yes' : 'No'}</dd>
                        </div>
                      </dl>
                      <div className="mt-4 flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={closeMemberModal}
                        >
                          Close
                        </button>
                        <button
                          type="button"
                          className="btn-danger-outline disabled:opacity-50"
                          disabled={memberActionLoading}
                          onClick={() => void handleMemberDelete(memberModal.member)}
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          className="btn-primary-sm px-4"
                          onClick={() => openMemberEdit(memberModal.member)}
                        >
                          Edit
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <h3 id="member-modal-title" className="text-lg font-bold text-zinc-900">
                        Edit member
                      </h3>
                      <p className="mt-1 text-xs text-zinc-500">Member ID: {memberModal.member.id}</p>
                      <div className="mt-3 space-y-3">
                        <input
                          className="input-app"
                          placeholder="Auth user ID (optional UUID)"
                          value={editAuthUserId}
                          onChange={(e) => setEditAuthUserId(e.target.value)}
                          disabled={memberActionLoading}
                        />
                        <input
                          type="email"
                          className="input-app"
                          placeholder="Email"
                          value={editEmail}
                          onChange={(e) => setEditEmail(e.target.value)}
                          required
                          disabled={memberActionLoading}
                        />
                        <input
                          className="input-app"
                          placeholder="Full name"
                          value={editFullName}
                          onChange={(e) => setEditFullName(e.target.value)}
                          required
                          disabled={memberActionLoading}
                        />
                        <label className="flex items-center gap-2 text-sm text-zinc-700">
                          <input
                            type="checkbox"
                            checked={editEligible}
                            onChange={(e) => setEditEligible(e.target.checked)}
                            disabled={memberActionLoading}
                          />
                          Can vote
                        </label>
                        <label className="flex items-center gap-2 text-sm text-zinc-700">
                          <input
                            type="checkbox"
                            checked={editAdmin}
                            onChange={(e) => setEditAdmin(e.target.checked)}
                            disabled={memberActionLoading}
                          />
                          Is admin
                        </label>
                      </div>
                      <div className="mt-4 flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          className="btn-secondary disabled:opacity-50"
                          disabled={memberActionLoading}
                          onClick={closeMemberModal}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="btn-primary-sm px-4 disabled:opacity-50"
                          disabled={memberActionLoading}
                          onClick={() => void handleMemberSave()}
                        >
                          {memberActionLoading ? 'Saving…' : 'Save changes'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        {activeTab === 'registrations' ? (
          <section className="card-app space-y-4 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="space-y-1">
                <h2 className="text-lg font-bold text-zinc-900">Registration approvals</h2>
                <p className="text-sm text-zinc-600">
                  Review requests from the public Register form. Approving adds an eligible member.
                </p>
              </div>
              <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
                <button
                  type="button"
                  className="btn-primary-sm inline-flex gap-2 disabled:cursor-not-allowed"
                  disabled={registrationRequests.length === 0 || registrationActionId !== null}
                  onClick={handleExportRegistrationRequestsCsv}
                >
                  Export CSV
                </button>
                <button
                  type="button"
                  className="btn-danger-outline px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={registrationRequests.length === 0 || registrationActionId !== null}
                  onClick={() => void handleDeleteAllRegistrationRequests()}
                >
                  {registrationActionId === '__all__' ? 'Deleting…' : 'Delete all'}
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 border-b border-zinc-200 pb-3">
              {(
                [
                  ['pending', 'Pending'],
                  ['approved', 'Approved'],
                  ['rejected', 'Rejected'],
                  ['all', 'All'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`nav-tab ${registrationsFilter === value ? 'nav-tab-active' : 'nav-tab-inactive'}`}
                  onClick={() => setRegistrationsFilter(value)}
                >
                  {label}
                  {value === 'pending' && pendingRegistrationCount > 0
                    ? ` (${pendingRegistrationCount})`
                    : ''}
                </button>
              ))}
            </div>

            {filteredRegistrationRequests.length === 0 ? (
              <p className="text-sm text-zinc-500">
                {registrationsFilter === 'pending'
                  ? 'No pending requests.'
                  : 'No requests in this view.'}
              </p>
            ) : (
              <ul className="space-y-3">
                {filteredRegistrationRequests.map((request) => (
                  <li
                    key={request.id}
                    className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-zinc-900">{request.full_name}</p>
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                              request.status === 'pending'
                                ? 'bg-amber-50 text-amber-900 ring-1 ring-amber-200'
                                : request.status === 'approved'
                                  ? 'bg-mint-100 text-mint-800 ring-1 ring-mint-700/15'
                                  : 'bg-zinc-100 text-zinc-700 ring-1 ring-zinc-200'
                            }`}
                          >
                            {request.status}
                          </span>
                        </div>
                        <p className="text-sm text-zinc-600 break-all">{request.email}</p>
                        {request.note ? (
                          <p className="text-sm text-zinc-500 whitespace-pre-wrap">{request.note}</p>
                        ) : null}
                        <p className="text-xs text-zinc-400">
                          Submitted{' '}
                          {new Date(request.created_at).toLocaleString(undefined, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}
                          {request.reviewed_at
                            ? ` · Reviewed ${new Date(request.reviewed_at).toLocaleString(undefined, {
                                dateStyle: 'medium',
                                timeStyle: 'short',
                              })}`
                            : ''}
                          {request.reviewer_email ? ` · ${request.reviewer_email}` : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        {request.status === 'pending' ? (
                          <>
                            <button
                              type="button"
                              className="btn-primary-sm bg-mint-700 hover:bg-mint-800"
                              disabled={registrationActionId !== null}
                              onClick={() => void handleApproveRegistration(request)}
                            >
                              {registrationActionId === request.id ? '…' : 'Approve'}
                            </button>
                            <button
                              type="button"
                              className="btn-danger-outline px-3 py-1.5 text-xs"
                              disabled={registrationActionId !== null}
                              onClick={() => void handleRejectRegistration(request)}
                            >
                              Reject
                            </button>
                          </>
                        ) : null}
                        <button
                          type="button"
                          className="btn-danger-outline px-3 py-1.5 text-xs"
                          disabled={registrationActionId !== null}
                          onClick={() => void handleDeleteRegistration(request)}
                        >
                          {registrationActionId === request.id ? '…' : 'Delete'}
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {activeTab === 'nominations' ? (
          <>
            <section className="card-app space-y-3 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <div className="min-w-0 space-y-1">
                  <h2 className="text-lg font-bold text-zinc-900">Public nomination submissions</h2>
                  <p className="text-sm text-zinc-600">
                    When stopped, the public Nominations page stops accepting new entries. Existing
                    submissions stay under the Received nominations tab.
                  </p>
                  <p className="text-sm font-medium text-zinc-800">
                    Status:{' '}
                    <span
                      className={
                        nominationSubmissionsOpen ? 'text-emerald-700' : 'text-amber-800'
                      }
                    >
                      {nominationSubmissionsOpen ? 'Accepting submissions' : 'Submissions closed'}
                    </span>
                  </p>
                </div>
                <button
                  type="button"
                  className={
                    nominationSubmissionsOpen
                      ? 'btn-secondary inline-flex shrink-0 disabled:opacity-50'
                      : 'btn-primary-sm inline-flex shrink-0 disabled:opacity-50'
                  }
                  disabled={adminActionLoading}
                  onClick={() => void handleToggleNominationSubmissions()}
                >
                  {nominationSubmissionsOpen
                    ? 'Stop accepting nominations'
                    : 'Start accepting nominations'}
                </button>
              </div>
            </section>

            <section className="card-app overflow-hidden p-0">
              <div className="flex flex-wrap gap-2 border-b border-zinc-200/90 bg-zinc-50/80 p-2 sm:px-4">
                <button
                  type="button"
                  className={`nav-tab ${nominationsSubTab === 'positions' ? 'nav-tab-active' : 'nav-tab-inactive'}`}
                  onClick={() => setNominationsSubTab('positions')}
                >
                  Form positions
                </button>
                <button
                  type="button"
                  className={`nav-tab ${nominationsSubTab === 'received' ? 'nav-tab-active' : 'nav-tab-inactive'}`}
                  onClick={() => setNominationsSubTab('received')}
                >
                  Received nominations
                </button>
              </div>

              <div className="space-y-3 p-4">
                {nominationsSubTab === 'positions' ? (
                  <>
                    <div className="space-y-1">
                      <h2 className="text-lg font-bold text-zinc-900">Nomination form positions</h2>
                      <p className="text-sm text-zinc-600">
                        These roles appear on the public{' '}
                        <Link to="/nominations" className="font-medium text-sky-text hover:underline">
                          Nominations
                        </Link>{' '}
                        page. They are separate from ballot positions under Positions &amp;
                        Candidates.
                      </p>
                    </div>
                    <form
                      className="grid gap-3 sm:grid-cols-3"
                      onSubmit={(e) => void handleAddNominationPosition(e)}
                    >
                      <input
                        className="input-app sm:col-span-2"
                        placeholder="Position name (e.g. President)"
                        value={nominationPositionName}
                        onChange={(event) => setNominationPositionName(event.target.value)}
                        required
                        disabled={adminActionLoading}
                      />
                      <input
                        type="number"
                        className="input-app"
                        placeholder="Sort order"
                        value={nominationPositionOrder}
                        onChange={(event) => setNominationPositionOrder(Number(event.target.value))}
                        disabled={adminActionLoading}
                      />
                      <button
                        type="submit"
                        className="btn-primary-sm sm:col-span-3 w-auto justify-self-start bg-mint-700 px-3 py-1.5 text-xs hover:bg-mint-800 disabled:opacity-60"
                        disabled={adminActionLoading}
                      >
                        Add nomination position
                      </button>
                    </form>
                    <div className="table-scroll">
                <table className="w-full text-sm">
                      <thead className="bg-zinc-100">
                        <tr>
                          <th className="p-2 text-left">Name</th>
                          <th className="p-2 text-left">Order</th>
                          <th className="w-[1%] whitespace-nowrap p-2 text-left">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {nominationPositions.length === 0 ? (
                          <tr className="border-t border-zinc-200">
                            <td className="p-2 text-zinc-600" colSpan={3}>
                              No positions yet. Add one above.
                            </td>
                          </tr>
                        ) : (
                          nominationPositions.map((row) => (
                            <tr key={row.id} className="border-t border-zinc-200">
                              <td className="p-2">{row.name}</td>
                              <td className="p-2">{row.sort_order}</td>
                              <td className="p-2">
                                <button
                                  type="button"
                                  className="rounded-full border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 shadow-sm hover:bg-red-50 disabled:opacity-50"
                                  disabled={adminActionLoading}
                                  onClick={() => void handleDeleteNominationPosition(row)}
                                >
                                  Delete
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                      <div className="min-w-0 space-y-1">
                        <h2 className="text-lg font-bold text-zinc-900">Received nominations</h2>
                        <p className="text-sm text-zinc-600">
                          Latest 500 submissions, grouped by nomination position (same order as on
                          the Form positions tab).
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn-primary-sm inline-flex shrink-0 gap-2 disabled:cursor-not-allowed"
                        disabled={nominations.length === 0}
                        onClick={handleExportNominationsCsv}
                      >
                        Export CSV
                      </button>
                    </div>
                    {nominationPositions.length === 0 ? (
                      <p className="text-sm text-zinc-600">
                        Add nomination positions on the Form positions tab before the public form
                        can receive entries.
                      </p>
                    ) : nominations.length === 0 ? (
                      <p className="text-sm text-zinc-600">No nominations yet.</p>
                    ) : (
                      <div className="space-y-4">
                        {nominationsGroupedByPosition
                          .filter(({ entries }) => entries.length > 0)
                          .map(({ position, entries }) => (
                            <div
                              key={position.id}
                              className="overflow-hidden rounded-xl border border-zinc-200 bg-white"
                            >
                              <div className="border-b border-zinc-200 bg-zinc-50 px-3 py-2">
                                <h3 className="text-sm font-bold text-zinc-900">{position.name}</h3>
                                <p className="text-xs text-zinc-500">
                                  {entries.length} submission{entries.length === 1 ? '' : 's'}
                                </p>
                              </div>
                              <div className="table-scroll">
                <table className="w-full text-sm">
                                <thead className="bg-zinc-100">
                                  <tr>
                                    <th className="p-2 text-left">Nominee</th>
                                    <th className="p-2 text-left">Submitted</th>
                                    <th className="w-[1%] whitespace-nowrap p-2 text-right">
                                      Actions
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {entries.map((row) => (
                                    <tr key={row.id} className="border-t border-zinc-200">
                                      <td className="p-2">{row.nominee_full_name}</td>
                                      <td className="p-2">
                                        {row.created_at
                                          ? new Date(row.created_at).toLocaleString()
                                          : '—'}
                                      </td>
                                      <td className="p-2 text-right">
                                        <button
                                          type="button"
                                          className="rounded-full border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 shadow-sm hover:bg-red-50 disabled:opacity-50"
                                          disabled={adminActionLoading}
                                          onClick={() => void handleDeleteNominationEntry(row)}
                                        >
                                          Delete
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            </div>
                          ))}
                        {orphanNominationsByPositionId.length > 0 ? (
                          <div className="overflow-hidden rounded-xl border border-amber-200 bg-white">
                            <div className="border-b border-amber-100 bg-amber-50 px-3 py-2">
                              <h3 className="text-sm font-bold text-zinc-900">
                                Unknown / deleted position
                              </h3>
                              <p className="text-xs text-zinc-600">
                                These rows reference a position that is no longer on the list.
                              </p>
                            </div>
                            <div className="table-scroll">
                <table className="w-full text-sm">
                              <thead className="bg-zinc-100">
                                <tr>
                                  <th className="p-2 text-left">Nominee</th>
                                  <th className="p-2 text-left">Submitted</th>
                                  <th className="w-[1%] whitespace-nowrap p-2 text-right">
                                    Actions
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {orphanNominationsByPositionId.map((row) => (
                                  <tr key={row.id} className="border-t border-zinc-200">
                                    <td className="p-2">{row.nominee_full_name}</td>
                                    <td className="p-2">
                                      {row.created_at
                                        ? new Date(row.created_at).toLocaleString()
                                        : '—'}
                                    </td>
                                    <td className="p-2 text-right">
                                      <button
                                        type="button"
                                        className="rounded-full border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 shadow-sm hover:bg-red-50 disabled:opacity-50"
                                        disabled={adminActionLoading}
                                        onClick={() => void handleDeleteNominationEntry(row)}
                                      >
                                        Delete
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </>
                )}
              </div>
            </section>
          </>
        ) : null}

        {activeTab === 'notifications' ? (
          <section className="card-app space-y-4 p-4">
            <div className="space-y-1">
              <h2 className="text-lg font-bold text-zinc-900">Notifications</h2>
              <p className="text-sm text-zinc-600">
                Public items appear on the sign-in page for everyone. Member-only items appear after
                login for people listed in Members.
              </p>
            </div>

            <form className="space-y-3 rounded-2xl border border-zinc-200/90 bg-zinc-50/50 p-4" onSubmit={(e) => void handleAddNotification(e)}>
              <p className="text-sm font-semibold text-zinc-800">Add notification</p>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-500" htmlFor="notif-title">
                  Title
                </label>
                <input
                  id="notif-title"
                  className="input-app"
                  value={notificationTitle}
                  onChange={(e) => setNotificationTitle(e.target.value)}
                  disabled={adminActionLoading}
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-500" htmlFor="notif-body">
                  Message
                </label>
                <textarea
                  id="notif-body"
                  className="input-app min-h-[100px] resize-y"
                  value={notificationBody}
                  onChange={(e) => setNotificationBody(e.target.value)}
                  disabled={adminActionLoading}
                  required
                />
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                <div className="min-w-[10rem] flex-1">
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-500" htmlFor="notif-audience">
                    Audience
                  </label>
                  <select
                    id="notif-audience"
                    className="input-app"
                    value={notificationAudience}
                    onChange={(e) =>
                      setNotificationAudience(e.target.value === 'member' ? 'member' : 'public')
                    }
                    disabled={adminActionLoading}
                  >
                    <option value="public">Public (login page)</option>
                    <option value="member">Members only (after login)</option>
                  </select>
                </div>
                <div className="w-full min-w-[6rem] sm:w-32">
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-500" htmlFor="notif-order">
                    Sort order
                  </label>
                  <input
                    id="notif-order"
                    type="number"
                    min={0}
                    className="input-app"
                    value={notificationSortOrder}
                    onChange={(e) => setNotificationSortOrder(Number(e.target.value) || 0)}
                    disabled={adminActionLoading}
                  />
                </div>
                <button type="submit" className="btn-primary-sm w-full sm:w-auto" disabled={adminActionLoading}>
                  Add notification
                </button>
              </div>
            </form>

            <div className="table-scroll">
              <table className="w-full text-sm">
                <thead className="bg-zinc-100">
                  <tr>
                    <th className="p-2 text-left">Audience</th>
                    <th className="p-2 text-left">Sort</th>
                    <th className="p-2 text-left">Title</th>
                    <th className="p-2 text-left">Message</th>
                    <th className="p-2 text-left">Created</th>
                    <th className="w-[1%] whitespace-nowrap p-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {notifications.length === 0 ? (
                    <tr className="border-t border-zinc-200">
                      <td className="p-2 text-zinc-600" colSpan={6}>
                        No notifications yet.
                      </td>
                    </tr>
                  ) : (
                    notifications.map((row) => (
                      <tr key={row.id} className="border-t border-zinc-200">
                        <td className="p-2">
                          {row.audience === 'public' ? (
                            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-900">
                              Public
                            </span>
                          ) : (
                            <span className="rounded-full bg-mint-100 px-2 py-0.5 text-xs font-medium text-mint-900">
                              Member
                            </span>
                          )}
                        </td>
                        <td className="p-2 tabular-nums">{row.sort_order}</td>
                        <td className="p-2 font-medium text-zinc-900">{row.title}</td>
                        <td className="max-w-[min(24rem,40vw)] p-2 text-zinc-700">
                          <span className="line-clamp-3 whitespace-pre-wrap">{row.body}</span>
                        </td>
                        <td className="p-2 text-zinc-600">
                          {row.created_at ? new Date(row.created_at).toLocaleString() : '—'}
                        </td>
                        <td className="p-2 text-right">
                          <button
                            type="button"
                            className="rounded-full border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 shadow-sm hover:bg-red-50 disabled:opacity-50"
                            disabled={adminActionLoading}
                            onClick={() => void handleDeleteNotification(row)}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {activeTab === 'results' ? (
          <section className="card-app p-4 space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="space-y-1 min-w-0">
                <h2 className="text-lg font-bold text-zinc-900">Turnout and Results</h2>
                <p className="text-sm text-zinc-600">
                  Export downloads a styled HTML summary—open it to print or save as PDF for voters.
                </p>
              </div>
              <button
                type="button"
                className="btn-primary-sm inline-flex shrink-0 gap-2 disabled:cursor-not-allowed"
                disabled={!election || resultsPositions.length === 0}
                onClick={handleExportResults}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Export results
              </button>
            </div>
            <p className="text-sm font-medium text-zinc-800">
              Turnout: {votesCount} / {eligibleMembersCount} eligible voters ({turnoutPercent}%)
            </p>
            {resultsPositions.length === 0 ? (
              <p className="text-sm text-zinc-600">No positions available for this election.</p>
            ) : (
              resultsPositions.map((position) => {
                const groupedCandidates = [...(candidatesByPosition[position.id] ?? [])].sort(
                  (a, b) =>
                    (candidateVoteCount[b.id] ?? 0) - (candidateVoteCount[a.id] ?? 0) ||
                    a.full_name.localeCompare(b.full_name),
                )

                const maxVotes =
                  groupedCandidates.length === 0
                    ? 0
                    : Math.max(
                        ...groupedCandidates.map((c) => candidateVoteCount[c.id] ?? 0),
                      )
                const leaders = groupedCandidates.filter(
                  (c) => (candidateVoteCount[c.id] ?? 0) === maxVotes,
                )
                const voteWord = maxVotes === 1 ? 'vote' : 'votes'

                return (
                  <div
                    key={position.id}
                    className="space-y-2 rounded-2xl border border-zinc-200/90 bg-zinc-50/40 p-4"
                  >
                    <h3 className="text-base font-bold text-zinc-900">{position.name}</h3>
                    {groupedCandidates.length > 0 ? (
                      maxVotes === 0 ? (
                        <p className="text-sm text-zinc-600">
                          No votes recorded yet for this position.
                        </p>
                      ) : leaders.length === 1 ? (
                        <p className="text-sm text-zinc-700">
                          Currently leading:{' '}
                          <span className="pill-leader">{leaders[0].full_name}</span>{' '}
                          <span className="text-zinc-600">
                            ({maxVotes} {voteWord})
                          </span>
                        </p>
                      ) : (
                        <p className="text-sm text-zinc-700">
                          Tie for the lead:{' '}
                          {leaders.map((c, i) => (
                            <span key={c.id}>
                              {i > 0 ? ', ' : null}
                              <span className="pill-leader">{c.full_name}</span>
                            </span>
                          ))}{' '}
                          <span className="text-zinc-600">
                            ({maxVotes} {voteWord} each)
                          </span>
                        </p>
                      )
                    ) : null}
                    <div className="table-scroll">
                <table className="w-full text-sm">
                      <thead className="bg-zinc-100">
                        <tr>
                          <th className="text-left p-2">Candidate</th>
                          <th className="text-left p-2">Votes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groupedCandidates.length === 0 ? (
                          <tr className="border-t border-zinc-200">
                            <td className="p-2" colSpan={2}>
                              No candidates for this position.
                            </td>
                          </tr>
                        ) : (
                          groupedCandidates.map((candidate) => (
                            <tr key={candidate.id} className="border-t border-zinc-200">
                              <td className="p-2">{candidate.full_name}</td>
                              <td className="p-2">{candidateVoteCount[candidate.id] ?? 0}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  </div>
                )
              })
            )}
          </section>
        ) : null}
      </div>
    </div>
  )
}
