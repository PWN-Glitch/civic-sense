// Shared API contract types: must match the FastAPI backend exactly.

export const CATEGORIES = [
  'pothole',
  'streetlight',
  'trash',
  'graffiti',
  'sidewalk damage',
  'other',
] as const;

export type Category = (typeof CATEGORIES)[number];

export type ConfidenceBand = 'high' | 'medium' | 'low';

export type ReportStatus =
  | 'Draft'
  | 'Confirmed'
  | 'Submitted'
  | 'Acknowledged'
  | 'InProgress'
  | 'Resolved';

export interface User {
  id: string;
  display_name: string;
  /** Present on email/password auth responses; older sessions may lack it. */
  email?: string;
}

export interface AuthResponse {
  jwt: string;
  user: User;
}

export interface Prediction {
  category: Category;
  confidence: number;
}

export interface Severity {
  level: 'low' | 'moderate' | 'high';
  reason: string;
}

export interface ClassifyResponse {
  predictions: Prediction[];
  band: ConfidenceBand;
  severity: Severity;
  disclaimer: string;
}

export interface MediaResponse {
  photo_id: string;
  url: string;
  exif_stripped: boolean;
  blurred: boolean;
  faces_blurred?: number;
  plates_blurred?: number;
}

export type PhotoKind = 'before' | 'progress' | 'after';

export interface ReportPhoto {
  photo_id: string;
  kind: PhotoKind;
  url: string;
  blurred: boolean;
}

export type VerificationResponse =
  | 'still_present'
  | 'appears_fixed'
  | 'not_sure';

export interface VerificationCounts {
  still_present: number;
  appears_fixed: number;
  not_sure: number;
}

export interface VerificationsResponse {
  counts: VerificationCounts;
  user_vote: VerificationResponse | null;
}

export interface VerifyResponse {
  verification_id: string;
  counts: VerificationCounts;
}

export interface ModelMetadata {
  version: string;
  labels: Category[];
  input: {
    shape: [number, number, number, number]; // e.g. [1, 3, 224, 224]
    dtype: 'uint8' | 'float32';
    normalization: 'imagenet' | 'none';
  };
}

/** Where a classification result came from; shown subtly in the UI. */
export type ClassificationSource = 'on-device' | 'cloud';

export interface StatusHistoryEntry {
  status: ReportStatus;
  source?: string;
  created_at: string;
}

export interface Report {
  id: string;
  category: Category;
  description: string;
  lat: number;
  lng: number;
  location_accuracy?: number;
  severity?: string;
  status: ReportStatus;
  created_at: string;
  updated_at?: string;
  reporter_id?: string;
  possible_duplicates?: Report[];
  status_history?: StatusHistoryEntry[];
  /** Our own hand-off state — distinct from the city's lifecycle `status`. */
  submission_state?: SubmissionState;
  photos?: ReportPhoto[];
  verifications?: VerificationCounts;
  community_suggests_resolved?: boolean;
}

export interface ReportCreateBody {
  category: Category;
  description: string;
  lat: number;
  lng: number;
  location_accuracy?: number;
  severity?: string;
  ai_prediction_id?: string;
  /** Idempotency key: resending it returns the report it already created. */
  client_ref?: string;
}

export interface MapIssue {
  id: string;
  category: Category;
  status: ReportStatus;
  lat: number;
  lng: number;
}

export interface RoutingResult {
  jurisdiction: string;
  department: string;
  method: 'api' | 'deeplink';
  url?: string;
  disclaimer: string;
}

// ── Contact resolver & report composer ─────────────────────────────
// Verification_status is shown as-is; submission_state is separate from official status.

export type ChannelType =
  | 'OPEN311'
  | 'API'
  | 'EMAIL'
  | 'PHONE'
  | 'WEB_FORM'
  | 'GOVERNMENT_PORTAL'
  | 'MOBILE_APP'
  | 'IN_PERSON'
  | 'MANUAL';

export type VerificationStatus =
  | 'verified'
  | 'likely'
  | 'unverified'
  | 'unknown';

export interface SubmissionChannel {
  type: ChannelType;
  destination: string;
  confidence: number;
  reasons: string[];
  source_url?: string;
  verification_status: VerificationStatus;
  requires?: Record<string, string>;
}

export interface UniversalReport {
  issue: {
    category: Category | string;
    subcategory?: string;
    description: string;
    severity?: string;
  };
  location: {
    lat: number;
    lng: number;
    address?: string;
    jurisdiction?: string;
  };
  evidence: string[];
  responsibility: {
    organization: string;
    department: string;
    confidence: number;
    reasons: string[];
  };
  submission: {
    method: string;
    destination: string;
    source?: string;
  };
  report: { subject: string; body: string };
  verification: { user_approved: boolean };
}

export interface ContactResolveResponse {
  jurisdiction: string;
  department: string;
  options: SubmissionChannel[];
  universal_report: UniversalReport;
}

export type DraftKind = 'email' | 'webform' | 'phone' | 'open311' | 'manual';

export interface ReportDraft {
  id: string;
  kind: DraftKind;
  subject: string;
  body: string;
  recipient: string;
  user_edited: boolean;
}

export type SubmissionAction = 'prepared' | 'approved' | 'attempted' | 'sent';

export type SubmissionState =
  | 'draft'
  | 'prepared'
  | 'user_approved'
  | 'submission_attempted'
  | 'submitted'
  | 'status_unknown';

export interface SubmissionResponse {
  submission_state: SubmissionState;
  event: ReportEvent;
}

export interface ReportEvent {
  event_type: string;
  detail?: Record<string, unknown>;
  created_at: string;
}

// Route params shared across screens in the reporting flow.
export interface AnalysisParams {
  photoUri: string;
  photoId?: string;
  predictions: Prediction[];
  band: ConfidenceBand;
  severity: Severity;
  disclaimer: string;
  /** Which engine produced these predictions (on-device or server). */
  classificationSource?: ClassificationSource;
}

export interface ConfirmParams extends AnalysisParams {
  preselected?: Category;
}

export interface LocationParams extends ConfirmParams {
  category: Category;
}

export interface ReportParams extends LocationParams {
  lat: number;
  lng: number;
  locationAccuracy?: number;
}

export interface TrackParams {
  reportId: string;
}

export interface IssueDetailsParams {
  reportId: string;
}

/** Route screen: pick which official contact should receive the report. */
export interface ReportParams extends LocationParams {
  lat: number;
  lng: number;
  locationAccuracy?: number;
  /** Chosen contact channel, set when the user arrived via Route. */
  channel?: SubmissionChannel;
  jurisdiction?: string;
  department?: string;
  universalReport?: UniversalReport;
  /** Pre-created report id (offline-sync replay / duplicate "create new"). */
  reportId?: string;
}

/** Route screen: pick which official contact should receive the report. */
export type RouteParams = ReportParams;

/** ReportReview: edit the composed draft and act on the chosen channel. */
export interface ReportReviewParams {
  reportId: string;
  channel: SubmissionChannel;
  jurisdiction: string;
  department: string;
  /**
   * Photos attached to this report. The disclosure line must match what the
   * user actually attached — `universalReport.evidence` arrives empty from
   * /contacts/resolve, which made the review claim "0 photos" while the
   * readiness list said a photo was included.
   */
  photoCount?: number;
  /** Optional pre-composed draft when the caller already has one. */
  universalReport?: UniversalReport;
}


/** GET /stats/impact — city-wide tallies, all counted from real reports. */
export interface CategoryTally {
  category: Category;
  total: number;
  resolved: number;
}

export interface ImpactStats {
  total_reports: number;
  resolved_reports: number;
  /** 0..1 */
  resolution_rate: number;
  avg_days_to_resolve: number | null;
  reports_last_30_days: number;
  by_status: Record<string, number>;
  by_category: CategoryTally[];
}
