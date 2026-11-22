import React, { useMemo, useRef, useState } from 'react';
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
import * as Crypto from 'expo-crypto';
import { CloudOff, MapPin } from 'lucide-react-native';
import { api } from '../api/client';
import DuplicateSheet from '../components/DuplicateSheet';
import { CategoryIcon } from '../components/Icon';
import { imageFormData } from '../lib/image';
import { isOfflineError, isCurrentlyOffline, queueDraft } from '../lib/offline';
import { useTheme } from '../lib/theme';
import { spacing, type ThemeColors } from '../theme';
import type { MediaResponse, Report as ReportType, ReportCreateBody } from '../types';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Report'>;

function formatCategory(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

export default function ReportScreen({ route, navigation }: Props) {
  const params = route.params;
  const { colors, typography, shared } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Category only. The severity is the model's guess and the letter already
  // carries it on its own "Estimated severity" line — baking it into the
  // description made the composed letter state the same guess twice, which
  // reads like a template filling itself in.
  const initialDescription = useMemo(
    () => `${formatCategory(params.category)} observed.`,
    [params.category],
  );

  const [description, setDescription] = useState(initialDescription);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedOffline, setSavedOffline] = useState<'report' | 'evidence' | null>(null);
  // One key per report: a retry or offline replay of a create whose response
  // was lost gets the same report back instead of a second one.
  const [clientRef] = useState(() => Crypto.randomUUID());
  // What a retry must not redo: the uploaded photo and the filed report.
  const photoIdRef = useRef<string | undefined>(params.photoId);
  const reportIdRef = useRef<string | undefined>(undefined);
  // Nearby duplicates drive the sheet. The probe runs before
  // POST /reports so nothing is filed until the user decides.
  const [duplicates, setDuplicates] = useState<ReportType[]>([]);
  const [showDuplicates, setShowDuplicates] = useState(false);

  const goToRoute = (reportId: string | undefined, photoCount: number) => {
    // When a channel was picked on Route, hand the new report id
    // to ReportReview for composing. Without a channel (deep-link entry)
    // we route to Track.
    if (params.channel && reportId) {
      navigation.replace('ReportReview', {
        reportId,
        channel: params.channel,
        jurisdiction: params.jurisdiction ?? '',
        department: params.department ?? '',
        photoCount,
        universalReport: params.universalReport,
      });
    } else if (reportId) {
      navigation.replace('Route', { ...params, reportId });
    }
  };

  /** The uploaded photo's id, uploading the original file if Preview couldn't. */
  const ensurePhotoId = async (): Promise<string | undefined> => {
    if (!photoIdRef.current && params.photoUri) {
      const { data } = await api.post<MediaResponse>(
        '/media',
        imageFormData(params.photoUri),
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      if (!data?.photo_id) throw new Error('photo upload returned no id');
      photoIdRef.current = data.photo_id;
    }
    return photoIdRef.current;
  };

  const attachPhoto = (reportId: string, photoId: string) =>
    api.post(`/reports/${reportId}/photos`, null, {
      params: { photo_id: photoId, kind: 'before' },
    });

  /**
   * Files the report and attaches its photo, then hands off to Route/Review.
   * Throws at the first failed step; a retry reuses the uploaded photo and,
   * via client_ref, the filed report, so it finishes instead of repeating.
   */
  const createReport = async () => {
    const photoId = await ensurePhotoId();
    if (!reportIdRef.current) {
      reportIdRef.current = await fileReport();
    }
    if (photoId) await attachPhoto(reportIdRef.current, photoId);
    goToRoute(reportIdRef.current, photoId ? 1 : 0);
  };

  const fileReport = async (): Promise<string> => {
    const body: ReportCreateBody = {
      category: params.category,
      description,
      lat: params.lat,
      lng: params.lng,
      location_accuracy: params.locationAccuracy,
      severity: params.severity.level,
      client_ref: clientRef,
    };
    const { data } = await api.post<
      ReportType | { report: ReportType; possible_duplicates?: ReportType[] }
    >('/reports', body);
    // The API returns `{ report, possible_duplicates }`; older mocks and
    // any flat-shaped caller return the report directly. Normalise both so
    // `report.id` is never undefined on the real wire shape.
    const report: ReportType =
      'report' in data && data.report ? data.report : (data as ReportType);
    return report.id;
  };

  /**
   * Network down (axios never got a response, or NetInfo says we're offline):
   * keep the report as a local draft, carrying whatever already succeeded,
   * so the sync finishes the job without a second upload or report.
   * `evidenceFor` is the existing report the photo was meant for.
   */
  const handleSubmitFailure = async (err: unknown, evidenceFor?: string) => {
    if (isOfflineError(err) || (await isCurrentlyOffline())) {
      try {
        await queueDraft({
          photoUri: params.photoUri,
          category: params.category,
          description,
          lat: params.lat,
          lng: params.lng,
          accuracy: params.locationAccuracy ?? null,
          severity: params.severity.level,
          clientRef,
          photoId: photoIdRef.current,
          reportId: evidenceFor ?? reportIdRef.current,
        });
        setSavedOffline(evidenceFor ? 'evidence' : 'report');
      } catch {
        setError(
          "We couldn't submit your report, and saving it locally failed too. Don't close the app; try again.",
        );
      }
    } else if (evidenceFor) {
      setError(
        "We couldn't add your photo to that report. Try again, or file your own report.",
      );
    } else if (reportIdRef.current) {
      setError(
        "Your report was filed, but the photo didn't attach. Tap Submit report to try again.",
      );
    } else {
      setError(
        "We couldn't submit your report. Check your connection and try again. Nothing was sent.",
      );
    }
    setSubmitting(false);
  };

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      if (reportIdRef.current) {
        // Already filed; the probe would only find this report itself.
        await createReport();
        return;
      }
      // Pre-flight duplicate check: ask before filing so the "possible
      // existing report" sheet never appears on top of a report that has
      // already been created. Fails open — a probe that can't run must never
      // stop someone from filing.
      let nearby: ReportType[] = [];
      try {
        const { data } = await api.get<ReportType[]>('/reports/duplicates', {
          params: { category: params.category, lat: params.lat, lng: params.lng },
        });
        nearby = Array.isArray(data) ? data : [];
      } catch {
        nearby = [];
      }
      if (nearby.length > 0) {
        setDuplicates(nearby);
        setShowDuplicates(true);
        setSubmitting(false);
        return;
      }
      await createReport();
    } catch (err) {
      await handleSubmitFailure(err);
    }
  };

  /** "Create new" on the duplicate sheet: file a separate report. */
  const fileSeparateReport = async () => {
    setShowDuplicates(false);
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await createReport();
    } catch (err) {
      await handleSubmitFailure(err);
    }
  };

  /** "Add photo": attach this photo to the report that already exists. */
  const addEvidenceToExisting = async (existing: ReportType) => {
    setShowDuplicates(false);
    setSubmitting(true);
    setError(null);
    try {
      const photoId = await ensurePhotoId();
      if (!photoId) throw new Error('no photo to add');
      await attachPhoto(existing.id, photoId);
      setSubmitting(false);
      navigation.replace('IssueDetails', { reportId: existing.id });
    } catch (err) {
      await handleSubmitFailure(err, existing.id);
    }
  };

  return (
    <ScrollView
      style={shared.screen}
      contentContainerStyle={shared.container}
      keyboardShouldPersistTaps="handled"
    >
      <DuplicateSheet
        visible={showDuplicates}
        duplicates={duplicates}
        onViewExisting={(existing) => {
          setShowDuplicates(false);
          navigation.replace('IssueDetails', { reportId: existing.id });
        }}
        onAddEvidence={(existing) => {
          void addEvidenceToExisting(existing);
        }}
        onCreateNew={() => {
          void fileSeparateReport();
        }}
      />
      {savedOffline ? (
        <View>
          <View style={styles.savedBox} accessibilityLiveRegion="polite">
            <View style={styles.savedTitleRow}>
              <CloudOff
                size={17}
                color={colors.warning}
                strokeWidth={2.2}
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
              <Text style={[typography.heading, styles.savedTitle]}>
                Saved as a draft
              </Text>
            </View>
            <Text style={typography.body}>
              {savedOffline === 'evidence'
                ? "You appear to be offline. Your photo is stored on this device and will be added to that report automatically when you're back online."
                : "You appear to be offline. Your report is stored on this device and will be submitted automatically when you're back online."}
            </Text>
          </View>
          <Pressable
            style={({ pressed }) => [
              shared.primaryButton,
              styles.submit,
              pressed && styles.pressed,
            ]}
            onPress={() =>
              navigation.navigate('Tabs', { screen: 'MyReportsTab' })
            }
            accessibilityLabel="View drafts in My Reports"
            accessibilityRole="button"
          >
            <Text style={shared.primaryButtonText}>View my drafts</Text>
          </Pressable>
        </View>
      ) : (
        <>
      <Text style={typography.heading} accessibilityRole="header">
        Describe the issue
      </Text>

      <View style={styles.summary}>
        <View
          style={styles.summaryIconBadge}
          importantForAccessibility="no"
        >
          <CategoryIcon
            category={params.category}
            size={20}
            color={colors.primary}
          />
        </View>
        <View style={styles.summaryText}>
          <Text style={typography.label}>
            {formatCategory(params.category)}
          </Text>
          <View style={styles.summaryMetaRow}>
            <MapPin
              size={12}
              color={colors.muted}
              strokeWidth={2.2}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
            <Text style={[typography.caption, styles.coords]}>
              {params.lat.toFixed(5)}, {params.lng.toFixed(5)}
              {params.locationAccuracy !== undefined
                ? ` · ±${Math.round(params.locationAccuracy)} m`
                : ''}
            </Text>
          </View>
        </View>
      </View>

      <TextInput
        style={styles.input}
        multiline
        value={description}
        onChangeText={setDescription}
        editable={!submitting}
        accessibilityLabel="Report description"
        placeholder="Describe what you see…"
        placeholderTextColor={colors.muted}
        textAlignVertical="top"
      />
      {/* The disclaimer belongs beside the field, not inside the text the
          resident is about to send: a parenthetical instruction baked into
          the body is one more thing they have to delete. */}
      <Text style={[typography.caption, styles.helper]}>
        Started from what you photographed. Edit it to say what you actually
        see.
      </Text>

      {error ? (
        <View style={shared.errorBox} accessibilityLiveRegion="polite">
          <Text style={shared.errorText}>{error}</Text>
        </View>
      ) : null}

      <Pressable
        style={({ pressed }) => [
          shared.primaryButton,
          styles.submit,
          submitting && { opacity: 0.6 },
          pressed && !submitting && styles.pressed,
        ]}
        onPress={() => void submit()}
        disabled={submitting || description.trim().length === 0}
        accessibilityLabel={submitting ? 'Submitting report' : 'Submit report'}
        accessibilityRole="button"
        accessibilityHint="Sends the report to the responsible department"
        accessibilityState={{ busy: submitting, disabled: submitting || description.trim().length === 0 }}
      >
        {submitting ? (
          <ActivityIndicator color={colors.onPrimary} />
        ) : (
          <Text style={shared.primaryButtonText}>Submit report</Text>
        )}
      </Pressable>

      <Text style={[typography.caption, styles.note]}>
        Your report goes to the department responsible for this category in
        your jurisdiction. Track its status from My Reports.
      </Text>
        </>
      )}
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    summary: {
      marginTop: spacing(2),
      marginBottom: spacing(4),
      backgroundColor: c.surface,
      borderRadius: 3,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.hairline,
      padding: spacing(3.5),
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing(3),
    },
    coords: {
      fontVariant: ['tabular-nums'],
    },
    summaryIconBadge: {
      width: 40,
      height: 40,
      borderRadius: 3,
      backgroundColor: c.primarySurface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    summaryText: {
      flex: 1,
      gap: 2,
    },
    summaryMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing(1),
    },
    savedBox: {
      backgroundColor: c.warningSurface,
      borderRadius: 3,
      padding: spacing(5),
      marginTop: spacing(4),
    },
    savedTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing(2),
      marginBottom: spacing(2),
    },
    savedTitle: {
      fontSize: 17,
    },
    input: {
      borderWidth: 1,
      borderColor: c.borderStrong,
      borderRadius: 3,
      padding: spacing(4),
      minHeight: 160,
      fontSize: 16,
      lineHeight: 24,
      color: c.ink,
      backgroundColor: c.surface,
    },
    submit: {
      marginTop: spacing(5),
    },
    pressed: {
      opacity: 0.85,
      transform: [{ scale: 0.99 }],
    },
    helper: {
      marginTop: spacing(2),
      color: c.muted,
    },
    note: {
      marginTop: spacing(4),
    },
  });
