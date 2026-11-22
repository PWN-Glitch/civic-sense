import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Camera } from 'lucide-react-native';
import { absoluteMediaUrl, api } from '../api/client';
import { imageFormData, prepareImageForUpload } from '../lib/image';
import { useTheme } from '../lib/theme';
import { font, spacing, type ThemeColors } from '../theme';
import type { MediaResponse, PhotoKind, ReportPhoto } from '../types';

/**
 * Before/after photo documentation.
 *
 * Shows the report's photos side by side (before = the original report
 * photo; progress/after = follow-ups). On the reporter's own reports an
 * "Add progress photo" affordance attaches a new photo via
 * POST /reports/{id}/photos?kind=.
 */

interface Props {
  reportId: string;
  photos: ReportPhoto[];
  /** True when the signed-in user owns this report; only they can add. */
  isOwnReport: boolean;
  onPhotoAdded: (photo: ReportPhoto) => void;
  onError?: (message: string) => void;
}

function firstOfKind(
  photos: ReportPhoto[],
  kinds: PhotoKind[],
): ReportPhoto | undefined {
  return kinds.map((k) => photos.find((p) => p.kind === k)).find(Boolean);
}

export default function BeforeAfter({
  reportId,
  photos,
  isOwnReport,
  onPhotoAdded,
  onError,
}: Props) {
  const [uploading, setUploading] = useState(false);
  const { colors, typography } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const before = firstOfKind(photos, ['before']);
  const after = firstOfKind(photos, ['after', 'progress']);

  const addPhoto = async () => {
    if (uploading) return;
    setUploading(true);
    try {
      const capture = await ImagePicker.launchCameraAsync({
        quality: 0.8,
        allowsEditing: false,
      });
      const asset = capture.assets?.[0];
      if (capture.canceled || !asset) return;

      const prepared = await prepareImageForUpload(asset.uri);
      // First follow-up photo is a progress update; once a progress photo
      // exists, the next one documents the fix ("after").
      const kind: PhotoKind = photos.some((p) => p.kind !== 'before')
        ? 'after'
        : 'progress';
      // The attach route takes an uploaded photo's id, not a file.
      const { data: media } = await api.post<MediaResponse>(
        '/media',
        imageFormData(prepared.uri),
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      const { data } = await api.post<ReportPhoto>(
        `/reports/${reportId}/photos`,
        null,
        { params: { photo_id: media.photo_id, kind } },
      );
      onPhotoAdded(data);
    } catch {
      onError?.("We couldn't add that photo. Check your connection and try again.");
    } finally {
      setUploading(false);
    }
  };

  if (!before && !after && !isOwnReport) return null;

  return (
    <View style={styles.container}>
      <Text style={typography.eyebrow} accessibilityRole="header">
        Photo record
      </Text>

      <View style={styles.row}>
        <View style={styles.photoCell}>
          <Text style={[typography.caption, styles.photoLabel]}>Before</Text>
          {before ? (
            <Image
              source={{ uri: absoluteMediaUrl(before.url) }}
              style={styles.photo}
              accessibilityLabel="Photo when the issue was reported"
              resizeMode="cover"
            />
          ) : (
            <View style={[styles.photo, styles.photoEmpty]}>
              <Text style={typography.caption}>No photo</Text>
            </View>
          )}
        </View>

        <View style={styles.gap} />

        <View style={styles.photoCell}>
          <Text style={[typography.caption, styles.photoLabel]}>
            {after?.kind === 'after' ? 'After' : 'Progress'}
          </Text>
          {after ? (
            <Image
              source={{ uri: absoluteMediaUrl(after.url) }}
              style={styles.photo}
              accessibilityLabel={
                after.kind === 'after'
                  ? 'Photo after the fix'
                  : 'Progress photo'
              }
              resizeMode="cover"
            />
          ) : (
            <View style={[styles.photo, styles.photoEmpty]}>
              <Text style={typography.caption}>Not yet</Text>
            </View>
          )}
        </View>
      </View>

      {isOwnReport ? (
        <Pressable
          style={[styles.addButton, uploading && { opacity: 0.6 }]}
          onPress={() => void addPhoto()}
          disabled={uploading}
          accessibilityLabel={
            after
              ? 'Add an after photo showing the fix'
              : 'Add a progress photo'
          }
          accessibilityRole="button"
          accessibilityHint="Opens the camera"
        >
          {uploading ? (
            <ActivityIndicator color={colors.primary} size="small" />
          ) : (
            <View style={styles.addButtonInner}>
              <Camera
                size={16}
                color={colors.primary}
                strokeWidth={2.2}
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
              <Text style={styles.addButtonText}>
                {after ? '+ Add after photo' : '+ Add progress photo'}
              </Text>
            </View>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: {
      marginTop: spacing(6),
      backgroundColor: c.surface,
      borderRadius: 3,
      padding: spacing(4),
    },
    row: {
      flexDirection: 'row',
      marginTop: spacing(3),
    },
    gap: {
      width: spacing(3),
    },
    photoCell: {
      flex: 1,
    },
    photoLabel: {
      marginBottom: spacing(1.5),
      fontFamily: font.bold,
      letterSpacing: 0.2,
    },
    photo: {
      width: '100%',
      aspectRatio: 4 / 3,
      borderRadius: 3,
      backgroundColor: c.surfaceAlt,
    },
    photoEmpty: {
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1.5,
      borderColor: c.border,
      borderStyle: 'dashed',
    },
    addButton: {
      marginTop: spacing(3),
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1.5,
      borderColor: c.primary,
      borderRadius: 3,
      paddingVertical: spacing(3),
      minHeight: 48,
    },
    addButtonInner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing(2),
    },
    addButtonText: {
      color: c.primary,
      fontSize: 15,
      fontFamily: font.bold,
    },
  });
