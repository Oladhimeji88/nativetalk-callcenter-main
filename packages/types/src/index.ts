// ─────────────────────────────────────────────────────────────────────────────
// @nativetalk/types
// Single source of truth for types shared between apps/api and apps/web.
// Import from here, never duplicate these shapes across apps.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Auth ────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role: string;
  permissions: Record<string, unknown>;
  tenantId: string;
  superAdmin: boolean;
}

export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

// ─── Agent ───────────────────────────────────────────────────────────────────

/** Lifecycle states an agent moves through during a shift. */
export type AgentStatus =
  | 'available'
  | 'ringing'
  | 'connected'
  | 'on-hold'
  | 'wrap-up'
  | 'break'
  | 'offline';

export interface AgentSnapshot {
  id: string;
  name: string;
  extension: string;
  status: AgentStatus;
  /** UUID of the current FreeSWITCH channel, if on a call. */
  callUuid?: string;
  /** ISO timestamp of when the agent entered the current status. */
  statusSince: string;
  /** Campaign the agent is currently assigned to, if any. */
  campaignId?: string;
}

// ─── Calls ───────────────────────────────────────────────────────────────────

export type CallDirection = 'inbound' | 'outbound' | 'internal';

export interface ActiveCall {
  uuid: string;
  direction: CallDirection;
  /** The external party's number. */
  number: string;
  agentId?: string;
  agentName?: string;
  agentExtension?: string;
  queueName?: string;
  campaignId?: string;
  /** ISO timestamp when the channel was created. */
  startedAt: string;
  /** Seconds elapsed since startedAt (updated by the server every tick). */
  durationSec: number;
  /** Whether this call is currently being recorded. */
  recording: boolean;
}

/** Actions a supervisor can take on a live call. */
export type SupervisorAction = 'listen' | 'whisper' | 'barge' | 'transfer' | 'end';

// ─── Queues ──────────────────────────────────────────────────────────────────

export type QueueStrategy = 'ring-all' | 'round-robin' | 'longest-idle' | 'sequential';

export interface QueueStat {
  name: string;
  number: string;
  /** Callers currently waiting in queue. */
  waiting: number;
  /** Agents currently logged into this queue. */
  agentsAvailable: number;
  /** Average wait time in seconds over the last 30 minutes. */
  avgWaitSec: number;
  /** Calls abandoned in the last 30 minutes. */
  abandoned: number;
}

// ─── Campaigns ───────────────────────────────────────────────────────────────

export type CampaignType = 'inbound' | 'outbound' | 'blended';

export type DialMethod = 'Manual' | 'Preview' | 'Progressive' | 'Power' | 'VoiceBroadcast';

export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed' | 'archived';

export interface CampaignProgress {
  campaignId: string;
  name: string;
  status: CampaignStatus;
  totalLeads: number;
  dialed: number;
  connected: number;
  pending: number;
  /** Agents currently working this campaign. */
  activeAgents: number;
  /** Contact rate: connected / dialed * 100 */
  contactRate: number;
}

// ─── Contacts / Leads ────────────────────────────────────────────────────────

export type LeadStatus = 'new' | 'dialed' | 'answered' | 'done' | 'dnc';

export type ContactStatus =
  | 'pending'
  | 'dialed'
  | 'connected'
  | 'callback'
  | 'exhausted'
  | 'dnc';

// ─── Dispositions ────────────────────────────────────────────────────────────

export type DispositionCategory =
  | 'Success'
  | 'Failure'
  | 'Callback'
  | 'Retry'
  | 'DNC'
  | 'Neutral';

// ─── Cloud PBX ───────────────────────────────────────────────────────────────

export type InboundDestinationType =
  | 'extension'
  | 'ring-group'
  | 'ivr'
  | 'queue'
  | 'voicemail'
  | 'hangup';

export type RingStrategy = 'simultaneous' | 'sequential';

export interface IvrOption {
  type: InboundDestinationType;
  destination: string;
}

// ─── Realtime (Socket.io) ────────────────────────────────────────────────────

/**
 * The full live-dashboard snapshot emitted by the server on the `snapshot`
 * Socket.io event. Both the supervisor dashboard and the agent status bar
 * consume this. The server emits it on connect and whenever state changes.
 */
export interface RealtimeSnapshot {
  agents: AgentSnapshot[];
  activeCalls: ActiveCall[];
  queues: QueueStat[];
  campaigns: CampaignProgress[];
  /** ISO timestamp of when this snapshot was generated. */
  generatedAt: string;
}

/** Emitted when a single agent's status changes (lighter than a full snapshot). */
export interface AgentStatusEvent {
  agentId: string;
  status: AgentStatus;
  callUuid?: string;
  statusSince: string;
}

/** Emitted when a new inbound call arrives for an agent / extension. */
export interface IncomingCallEvent {
  uuid: string;
  from: string;
  to: string;
  direction: CallDirection;
  campaignId?: string;
  queueName?: string;
}

/** Emitted when a call ends. */
export interface CallEndedEvent {
  uuid: string;
  cause: string;
  durationSec: number;
  disposition?: string;
}

/** All Socket.io event names emitted by the server. */
export type ServerEvent =
  | 'snapshot'
  | 'agent:status'
  | 'call:incoming'
  | 'call:ended'
  | 'call:updated'
  | 'queue:updated'
  | 'campaign:updated';

// ─── Analytics ───────────────────────────────────────────────────────────────

export interface CampaignAnalytics {
  campaignId: string;
  dialAttempts: number;
  connections: number;
  contactRate: number;
  conversionRate: number;
  callbackRate: number;
  avgTalkTimeSec: number;
}

export interface AgentAnalytics {
  agentId: string;
  agentName: string;
  callsHandled: number;
  avgTalkTimeSec: number;
  avgHandleTimeSec: number;
  /** Talk + hold time / logged-in time, as a percentage. */
  occupancy: number;
}

export interface QueueAnalytics {
  queueName: string;
  volume: number;
  avgWaitTimeSec: number;
  abandonmentRate: number;
  serviceLevel: number;
}

// ─── Pagination ──────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

// ─── Common API shapes ───────────────────────────────────────────────────────

export interface ApiError {
  statusCode: number;
  message: string | string[];
  error?: string;
}
