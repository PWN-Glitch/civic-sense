import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Check, ShieldCheck, TriangleAlert } from 'lucide-react-native';
import { api } from '../api/client';
import ErrorState from '../components/ErrorState';
import Loading from '../components/Loading';
import {
  buildMailtoUrl,
  buildTelUrl,
  copyToClipboard,
  isUserDrivenChannel,
  openChannelUrl,
} from '../lib/channelActions';
import { CHANNEL_LABELS } from './Route';
import { useTheme } from '../lib/theme';
import { font, radius, spacing, type ThemeColors } from '../theme';
import type {
  ReportDraft,
  SubmissionAction,
  SubmissionResponse,
  SubmissionState,
} from '../types';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'ReportReview'>;

interface ComposeResponse {
  draft: ReportDraft;
  /** Stable field identifiers used for readiness checks. */
  missing_field_keys?: string[];
}

interface ReadinessItem {
  ok: boolean;
  label: string;
  /** How the gap reads when it fails. "Subject written" cannot carry a ⚠. */
  problem: string;
}

/**
 * The backend sends `requires` as an object; the seeded contacts use the
 * shape `{ fields: string[] }`. Normalize to a flat list of field names so a
 * `{fields:[...]}` blob doesn't render a spurious "fields" row. We only ever
 * display field names; we never invent values for them.
 */
export function requiredFieldNames(requires: unknown): string[] {
  if (!requires || typeof requires !== 'object') return [];
  const obj = requires as Record<string, unknown>;
  const raw = Array.isArray(obj.fields)
    ? obj.fields.filter((f): f is string => typeof f === 'string')
    : Object.keys(obj);
  // Channel `requires` blobs mix casing ("Description" and "description"), and
  // listing both reads like a bug to the person reading it.
  const seen = new Set<string>();
  return raw.filter((field) => {
    const key = field.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Informational readiness check derived from data we actually have.
 *
 * When the composer reports missing fields, that answer wins: it checks the
 * actual report fields rather than substring matching.
 */
export function computeReadiness(
  draft: ReportDraft,
  requires: unknown,
  missingFields?: string[],
): ReadinessItem[] {
  const missing = missingFields
    ? new Set(missingFields.map((f) => f.toLowerCase()))
    : null;
  // When the composer has an opinion about a field, it wins over our own
  // "is it non-empty" check — otherwise the list can show "Description
  // written ✓" and "Missing: description ⚠" side by side.
  const gap = (...names: string[]) =>
    missing !== null && names.some((n) => missing.has(n));

  const items: ReadinessItem[] = [
    {
      ok: draft.subject.trim().length > 0 && !gap('subject'),
      label: 'Subject written',
      problem: 'Add a subject line',
    },
    {
      ok: draft.body.trim().length > 0 && !gap('description', 'body'),
      label: 'Description written',
      problem: 'Add a description',
    },
    {
      ok: draft.recipient.trim().length > 0 && !gap('recipient', 'contact'),
      label: 'Recipient set',
      problem: 'Add a channel address',
    },
  ];
  // The three rows above already answer these; repeating them as
  // "Includes: description" counted one fact twice.
  const covered = new Set([
    'subject',
    'description',
    'body',
    'recipient',
    'contact',
  ]);
  for (const field of requiredFieldNames(requires)) {
    const key = field.toLowerCase();
    if (covered.has(key)) continue;
    const present = missing
      ? !missing.has(key)
      : draft.body.toLowerCase().includes(key);
    items.push({
      ok: present,
      label: present ? `Includes: ${field}` : `Missing: ${field}`,
      problem: `Missing: ${field}`,
    });
  }
  return items;
}

const STATE_LABELS: Record<SubmissionState, string> = {
  draft: 'Draft',
  prepared: 'Prepared',
  user_approved: 'Approved by you',
  submission_attempted: 'Attempted',
  submitted: 'Submitted',
  status_unknown: 'Status unknown',
};

export default function ReportReviewScreen({ route, navigation }: Props) {
  const { reportId, channel, jurisdiction, department } = route.params;
  const { colors, typography, shared } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [draft, setDraft] = useState<ReportDraft | null>(null);
  const [missingFieldKeys, setMissingFieldKeys] = useState<string[] | undefined>();
  // Ref mirror so blur/submit handlers always read the latest draft, even
  // when they fire in the same tick as the changeText setState.
  const draftRef = useRef<ReportDraft | null>(null);
  const updateDraft = (next: ReportDraft | null) => {
    draftRef.current = next;
    setDraft(next);
  };
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [submissionState, setSubmissionState] =
    useState<SubmissionState>('draft');
  const [awaitingOutcome, setAwaitingOutcome] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Compose creates a fresh draft server-side; GET /draft returns the
      // latest. We use the returned draft as the working copy.
      const { data } = await api.post<ComposeResponse>(
        `/reports/${reportId}/compose`,
        {},
      );
      updateDraft(data.draft);
      setMissingFieldKeys(data.missing_field_keys);
    } catch {
      setError("We couldn't prepare the report text. Try again.");
    } finally {
      setLoading(false);
    }
  }, [reportId]);

  useEffect(() => {
    void load();
  }, [load]);

  const readiness = useMemo(
    () => (draft ? computeReadiness(draft, channel.requires, missingFieldKeys) : []),
    [draft, channel.requires, missingFieldKeys],
  );
  // Only the gaps are worth screen space: "Subject written ✓" is not an
  // achievement, and five green ticks turn a form into a score.
  const gaps = useMemo(() => readiness.filter((item) => !item.ok), [readiness]);

  // Rows for the "enter these fields on the form" checklist. Built as one
  // deduped list so a channel that requires "Description" cannot render next
  // to the Subject/Description rows we always show, and so `location` and
  // `photo` carry a real value (coordinates / the attached photo) instead of
  // copying the whole body.
  const formFieldRows = useMemo(() => {
    const rows: { key: string; label: string; value: string }[] = [
      { key: 'subject', label: 'Subject', value: draft?.subject ?? '' },
      { key: 'description', label: 'Description', value: draft?.body ?? '' },
    ];
    const seen = new Set(rows.map((row) => row.key));
    const location = route.params.universalReport?.location;
    const photoCount = route.params.photoCount ?? 0;
    for (const field of requiredFieldNames(channel.requires)) {
      const key = field.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if (key === 'location') {
        rows.push({
          key,
          label: 'Location',
          value: location
            ? `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`
            : '',
        });
      } else if (key === 'photo') {
        rows.push({
          key,
          label:
            photoCount > 0
              ? 'Photo — upload the one attached to this report'
              : 'Photo',
          value: '',
        });
      } else {
        rows.push({
          key,
          label: key.charAt(0).toUpperCase() + key.slice(1),
          value: '',
        });
      }
    }
    return rows;
  }, [
    channel.requires,
    draft,
    route.params.photoCount,
    route.params.universalReport,
  ]);

  const record = useCallback(
    async (action: SubmissionAction) => {
      try {
        const { data } = await api.post<SubmissionResponse>(
          `/reports/${reportId}/submission`,
          { channel_type: channel.type, action },
        );
        setSubmissionState(data.submission_state);
      } catch {
        // Recording is best-effort; the user-facing action already happened.
        setActionError(
          "We couldn't save that step. Your report text is safe — you can keep going.",
        );
      }
    },
    [reportId, channel.type],
  );

  const saveEdits = useCallback(async () => {
    const current = draftRef.current;
    if (!current || !current.user_edited) return;
    try {
      const { data } = await api.patch<ComposeResponse>(
        `/reports/${reportId}/draft`,
        {
          subject: current.subject,
          body: current.body,
          recipient: current.recipient,
        },
      );
      updateDraft(data.draft);
    } catch {
      setActionError("We couldn't save your edits. They're still on screen.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId]);

  const regenerate = useCallback(
    async (instruction: 'make_shorter' | 'make_more_detailed') => {
      if (regenerating) return;
      setRegenerating(instruction);
      setActionError(null);
      try {
        const { data } = await api.post<ReportDraft | ComposeResponse>(
          `/reports/${reportId}/compose/regenerate`,
          { instruction },
        );
        const nextDraft = (data && 'draft' in data ? data.draft : data) as ReportDraft | null;
        if (nextDraft && nextDraft.body) {
          updateDraft(nextDraft);
        }
      } catch {
        setActionError("We couldn't rewrite the text. Your version is unchanged.");
      } finally {
        setRegenerating(null);
      }
    },
    [reportId, regenerating],
  );

  const flashCopied = (what: string) => {
    setCopied(what);
    setTimeout(() => setCopied(null), 2000);
  };

  const markEdited = (patch: Partial<ReportDraft>) => {
    const current = draftRef.current;
    if (!current) return;
    updateDraft({ ...current, ...patch, user_edited: true });
  };

  // ── Channel actions ────────────────────────────────────────────────────
  const openMail = async () => {
    if (!draft) return;
    await record('approved');
    try {
      await openChannelUrl(
        buildMailtoUrl(draft.recipient, draft.subject, draft.body),
      );
      await record('attempted');
      setAwaitingOutcome(true);
    } catch {
      setActionError(
        'No mail app opened. Use "Copy email" and paste it into your mail app.',
      );
    }
  };

  const openPhone = async () => {
    await record('approved');
    try {
      await openChannelUrl(buildTelUrl(channel.destination));
      await record('attempted');
      setAwaitingOutcome(true);
    } catch {
      setActionError('This device could not start a call.');
    }
  };

  const openForm = async () => {
    await record('approved');
    try {
      await openChannelUrl(channel.destination);
      await record('attempted');
      setAwaitingOutcome(true);
    } catch {
      setActionError("The official form didn't open. Copy the fields below.");
    }
  };

  const finish = (sent: boolean) => {
    const advanceStatus = async () => {
      await record(sent ? 'sent' : 'attempted');
      if (sent) {
        // Advance report lifecycle to Submitted upon resident send confirmation
        try {
          await api.patch(`/reports/${reportId}`, { status: 'Submitted' });
        } catch {
          // If status transition was already Submitted or beyond, ignore
        }
      }
    };

    void advanceStatus().finally(() => {
      navigation.replace('Track', { reportId });
    });
  };

  if (loading) {
    return <Loading message="Preparing your report…" />;
  }

  if (error || !draft) {
    return (
      <View style={[shared.screen, shared.container, styles.center]}>
        <ErrorState
          message={error ?? 'Nothing to review.'}
          onRetry={() => void load()}
        />
      </View>
    );
  }

  const userDriven = isUserDrivenChannel(channel);

  return (
    <ScrollView
      style={shared.screen}
      contentContainerStyle={shared.container}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={typography.heading} accessibilityRole="header">
        Review your report
      </Text>
      <Text style={[typography.caption, styles.subtitle]}>
        To {department} · {jurisdiction} via{' '}
        {CHANNEL_LABELS[channel.type] ?? channel.type}. You wrote this — edit
        anything before it leaves the app.
      </Text>

      {/* Readiness indicator — shows missing items or confirmation that fields are ready. */}
      <View
        style={styles.readinessBox}
        accessibilityLabel="Report readiness"
        accessibilityLiveRegion="polite"
      >
        {gaps.length === 0 ? (
          <View style={styles.readinessRow}>
            <Check
              size={14}
              color={colors.success}
              strokeWidth={2.6}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
            <Text
              style={[
                typography.caption,
                styles.readinessItem,
                { color: colors.success },
              ]}
            >
              Ready to send
            </Text>
          </View>
        ) : (
          <>
            <Text style={[typography.eyebrow, styles.readinessTitle]}>
              Before you send
            </Text>
            {gaps.map((item, i) => (
              <View
                key={item.label}
                style={[
                  styles.readinessRow,
                  i > 0 && styles.readinessRowSeparated,
                ]}
              >
                <TriangleAlert
                  size={14}
                  color={colors.warning}
                  strokeWidth={2.2}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
                <Text
                  style={[
                    typography.caption,
                    styles.readinessItem,
                    { color: colors.warning },
                  ]}
                >
                  {item.problem}
                </Text>
              </View>
            ))}
          </>
        )}
      </View>

      {/* Privacy summary — exact parameters sent to destination. */}
      <View style={styles.privacyBox} accessibilityLabel="Privacy summary">
        <View style={styles.privacyTitleRow}>
          <ShieldCheck
            size={14}
            color={colors.primary}
            strokeWidth={2.2}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
          <Text style={[typography.eyebrow, styles.privacyTitle]}>
            What gets sent
          </Text>
        </View>
        <Text style={[typography.caption, styles.privacyBody]}>
          • The report text below, exactly as shown.
        </Text>
        <Text style={[typography.caption, styles.privacyBody]}>
          • Approximate location (
          <Text style={styles.coords}>
            {route.params.universalReport?.location.lat.toFixed(4) ?? '—'},{' '}
            {route.params.universalReport?.location.lng.toFixed(4) ?? '—'}
          </Text>
          ).
        </Text>
        <Text style={[typography.caption, styles.privacyBody]}>
          • Photos you attached: {route.params.photoCount ?? 0}. Faces are
          blurred before upload.
        </Text>
        <Text style={[typography.caption, styles.privacyBody]}>
          • No name, email, or account details are included unless you type
          them into the report yourself.
        </Text>
      </View>

      {/* Editable draft. Labelled by what it holds — a URL or an email — so it
          stops disagreeing with the department named in words above. */}
      <Text style={[typography.label, styles.fieldLabel]}>
        Channel address
      </Text>
      <TextInput
        style={styles.inputSingle}
        value={draft.recipient}
        onChangeText={(recipient) => markEdited({ recipient })}
        onBlur={() => void saveEdits()}
        accessibilityLabel="Channel address"
        placeholder="Who this goes to"
        placeholderTextColor={colors.muted}
      />
      <Text style={[typography.caption, styles.fieldHint]}>
        The email address or web form for the channel above.
      </Text>

      <Text style={[typography.label, styles.fieldLabel]}>Subject</Text>
      <TextInput
        style={styles.inputSingle}
        value={draft.subject}
        onChangeText={(subject) => markEdited({ subject })}
        onBlur={() => void saveEdits()}
        accessibilityLabel="Report subject"
        placeholder="Subject line"
        placeholderTextColor={colors.muted}
      />

      <Text style={[typography.label, styles.fieldLabel]}>Body</Text>
      <TextInput
        style={styles.inputMulti}
        value={draft.body}
        onChangeText={(body) => markEdited({ body })}
        onBlur={() => void saveEdits()}
        accessibilityLabel="Report body"
        multiline
        textAlignVertical="top"
        placeholder="Report body"
        placeholderTextColor={colors.muted}
      />

      {draft.user_edited ? (
        <Pressable
          style={[shared.secondaryButton, styles.saveButton]}
          onPress={() => void saveEdits()}
          accessibilityLabel="Save edits"
          accessibilityRole="button"
          accessibilityHint="Stores your changes to the draft"
        >
          <Text style={shared.secondaryButtonText}>Save edits</Text>
        </Pressable>
      ) : null}

      <View style={styles.regenRow}>
        <Pressable
          style={[shared.secondaryButton, styles.regenButton]}
          onPress={() => void regenerate('make_shorter')}
          disabled={regenerating !== null}
          accessibilityLabel="Shorter version"
          accessibilityRole="button"
          accessibilityHint="Drops the greeting and sign-off, keeping the facts"
          accessibilityState={{ busy: regenerating === 'make_shorter' }}
        >
          {regenerating === 'make_shorter' ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Text style={shared.secondaryButtonText}>Shorter version</Text>
          )}
        </Pressable>
        <Pressable
          style={[shared.secondaryButton, styles.regenButton]}
          onPress={() => void regenerate('make_more_detailed')}
          disabled={regenerating !== null}
          accessibilityLabel="Full version"
          accessibilityRole="button"
          accessibilityHint="Restores the greeting, every fact and the sign-off"
          accessibilityState={{ busy: regenerating === 'make_more_detailed' }}
        >
          {regenerating === 'make_more_detailed' ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Text style={shared.secondaryButtonText}>Full version</Text>
          )}
        </Pressable>
      </View>

      {actionError ? (
        <View style={shared.errorBox} accessibilityLiveRegion="polite">
          <Text style={shared.errorText}>{actionError}</Text>
        </View>
      ) : null}
      {copied ? (
        <Text
          style={[typography.caption, styles.copiedNote]}
          accessibilityLiveRegion="polite"
        >
          Copied {copied} to clipboard.
        </Text>
      ) : null}

      {/* Channel-specific actions. */}
      {!awaitingOutcome ? (
        <View style={styles.actions}>
          {channel.type === 'EMAIL' ? (
            <>
              <Pressable
                style={[shared.primaryButton, styles.actionButton]}
                onPress={() => void openMail()}
                accessibilityLabel="Open in Mail"
                accessibilityRole="button"
                accessibilityHint="Opens your mail app with this report filled in"
              >
                <Text style={shared.primaryButtonText}>Open in Mail</Text>
              </Pressable>
              <Pressable
                style={[shared.secondaryButton, styles.actionButton]}
                onPress={() => {
                  copyToClipboard(
                    `To: ${draft.recipient}\nSubject: ${draft.subject}\n\n${draft.body}`,
                  );
                  flashCopied('email');
                }}
                accessibilityLabel="Copy email"
                accessibilityRole="button"
              >
                <Text style={shared.secondaryButtonText}>Copy email</Text>
              </Pressable>
            </>
          ) : null}

          {channel.type === 'PHONE' ? (
            <>
              <Pressable
                style={[shared.primaryButton, styles.actionButton]}
                onPress={() => void openPhone()}
                accessibilityLabel={`Call ${channel.destination}`}
                accessibilityRole="button"
                accessibilityHint="Starts a phone call to this department"
              >
                <Text style={shared.primaryButtonText}>
                  Call {channel.destination}
                </Text>
              </Pressable>
              <Text style={[typography.label, styles.scriptLabel]}>
                Call script (edit before you dial)
              </Text>
              <Pressable
                style={[shared.secondaryButton, styles.actionButton]}
                onPress={() => {
                  copyToClipboard(draft.body);
                  flashCopied('call script');
                }}
                accessibilityLabel="Copy call script"
                accessibilityRole="button"
              >
                <Text style={shared.secondaryButtonText}>Copy script</Text>
              </Pressable>
            </>
          ) : null}

          {channel.type === 'WEB_FORM' ||
          channel.type === 'GOVERNMENT_PORTAL' ? (
            <>
              <Pressable
                style={[shared.primaryButton, styles.actionButton]}
                onPress={() => void openForm()}
                accessibilityLabel="Open official form"
                accessibilityRole="button"
                accessibilityHint="Opens the official reporting page in your browser"
              >
                <Text style={shared.primaryButtonText}>
                  Open official form
                </Text>
              </Pressable>
              <Text style={[typography.label, styles.scriptLabel]}>
                Enter these fields on the form
              </Text>
              {formFieldRows.map(({ key, label, value }) => (
                <View key={key} style={styles.fieldRow}>
                  <Text style={[typography.body, styles.fieldName]}>
                    {label}
                  </Text>
                  {value ? (
                    <Pressable
                      style={styles.copyChip}
                      onPress={() => {
                        copyToClipboard(value);
                        flashCopied(label);
                      }}
                      accessibilityLabel={`Copy ${label}`}
                      accessibilityRole="button"
                    >
                      <Text style={styles.copyChipText}>Copy</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </>
          ) : null}

          {!userDriven ? (
            <Pressable
              style={[shared.primaryButton, styles.actionButton]}
              onPress={() => finish(true)}
              accessibilityLabel="Submit report"
              accessibilityRole="button"
              accessibilityHint="Sends the report through the official API"
            >
              <Text style={shared.primaryButtonText}>Submit report</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        /* Outcome confirmation for user-driven channels. */
        <View style={styles.outcomeBox} accessibilityLiveRegion="polite">
          <Text style={[typography.label, styles.outcomeTitle]}>
            Did you send it?
          </Text>
          <Text style={[typography.caption, styles.outcomeBody]}>
            We can't see what happens in your mail app, phone, or browser —
            tell us so your records stay accurate. "Sent" here means sent by
            you; the city's response status stays unknown until they reply.
          </Text>
          <Pressable
            style={[shared.primaryButton, styles.actionButton]}
            onPress={() => finish(true)}
            accessibilityLabel="Yes, I sent it"
            accessibilityRole="button"
          >
            <Text style={shared.primaryButtonText}>Yes, I sent it</Text>
          </Pressable>
          <Pressable
            style={[shared.secondaryButton, styles.actionButton]}
            onPress={() => finish(false)}
            accessibilityLabel="Not yet"
            accessibilityRole="button"
          >
            <Text style={shared.secondaryButtonText}>Not yet</Text>
          </Pressable>
        </View>
      )}

      <Text style={[typography.caption, styles.stateLine]}>
        Submission state: {STATE_LABELS[submissionState]}
      </Text>
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    center: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    subtitle: {
      marginTop: spacing(2),
      marginBottom: spacing(4),
    },
    readinessBox: {
      backgroundColor: c.surface,
      borderRadius: 3,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.hairline,
      padding: spacing(4),
      marginBottom: spacing(3),
    },
    readinessTitle: {
      marginBottom: spacing(2),
    },
    readinessRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing(2),
      paddingVertical: spacing(1.5),
    },
    readinessRowSeparated: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.hairline,
    },
    readinessItem: {
      fontFamily: font.semibold,
    },
    privacyBox: {
      backgroundColor: c.primarySurface,
      borderRadius: 3,
      padding: spacing(4),
      marginBottom: spacing(4),
    },
    coords: {
      fontVariant: ['tabular-nums'],
    },
    privacyTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing(1.5),
      marginBottom: spacing(2),
    },
    privacyTitle: {
      color: c.primary,
    },
    // Secondary text on the tinted panel takes the panel's hue family
    // (body), never the flat gray muted — keeps AA on the blue surface.
    privacyBody: {
      color: c.body,
    },
    fieldLabel: {
      marginBottom: spacing(1),
      marginTop: spacing(1),
    },
    fieldHint: {
      marginTop: spacing(1.5),
      marginBottom: spacing(1),
    },
    inputSingle: {
      borderWidth: 1,
      borderColor: c.borderStrong,
      borderRadius: 3,
      padding: spacing(3.5),
      fontSize: 16,
      color: c.ink,
      backgroundColor: c.surface,
      marginBottom: spacing(3),
      minHeight: 52,
    },
    inputMulti: {
      borderWidth: 1,
      borderColor: c.borderStrong,
      borderRadius: 3,
      padding: spacing(3.5),
      fontSize: 16,
      lineHeight: 24,
      color: c.ink,
      backgroundColor: c.surface,
      minHeight: 200,
    },
    regenRow: {
      flexDirection: 'row',
      gap: spacing(3),
      marginTop: spacing(3),
    },
    saveButton: {
      marginTop: spacing(3),
    },
    regenButton: {
      flex: 1,
    },
    copiedNote: {
      color: c.success,
      marginTop: spacing(2),
    },
    actions: {
      marginTop: spacing(4),
    },
    actionButton: {
      marginTop: spacing(3),
    },
    scriptLabel: {
      marginTop: spacing(4),
    },
    fieldRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing(2),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.hairline,
    },
    fieldName: {
      flex: 1,
    },
    copyChip: {
      borderWidth: 1.5,
      borderColor: c.primary,
      borderRadius: radius.control,
      paddingHorizontal: spacing(3),
      minHeight: 44,
      justifyContent: 'center',
    },
    copyChipText: {
      color: c.primary,
      fontFamily: font.bold,
    },
    outcomeBox: {
      marginTop: spacing(4),
      backgroundColor: c.warningSurface,
      borderRadius: 3,
      padding: spacing(5),
    },
    outcomeTitle: {
      color: c.warning,
    },
    outcomeBody: {
      marginTop: spacing(2),
      color: c.body,
    },
    stateLine: {
      marginTop: spacing(4),
      textAlign: 'center',
    },
  });
