import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { api } from '../api/client';
import { classifyPhoto, MANUAL_PICKER_SEVERITY } from '../lib/classify';
import { prepareImageForUpload, imageFormData } from '../lib/image';
import { useTheme } from '../lib/theme';
import { radius, spacing, type ThemeColors } from '../theme';
import type { MediaResponse } from '../types';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Preview'>;

export default function PreviewScreen({ route, navigation }: Props) {
  const { photoUri } = route.params;
  const { colors, typography, shared } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usePhoto = async () => {
    setWorking(true);
    setError(null);
    try {
      const prepared = await prepareImageForUpload(photoUri);

      let photoId: string | undefined;
      try {
        const mediaRes = await api.post<MediaResponse>(
          '/media',
          imageFormData(prepared.uri),
          { headers: { 'Content-Type': 'multipart/form-data' } },
        );
        photoId = mediaRes.data.photo_id;
      } catch {
        // Classification needn't wait on the upload: the Report screen
        // uploads photoUri itself when no photoId arrives, and won't file
        // without it.
        photoId = undefined;
      }

      const outcome = await classifyPhoto(
        imageFormData(prepared.uri),
        prepared.uri,
      );

      if (outcome.kind === 'ok') {
        navigation.navigate('Analysis', {
          photoUri: prepared.uri,
          photoId,
          predictions: outcome.predictions,
          band: outcome.band,
          severity: outcome.severity,
          disclaimer: outcome.disclaimer,
          classificationSource: outcome.source,
        });
      } else {
        // Classifier unavailable everywhere (503); hand off to the manual
        // category picker.
        navigation.navigate('Analysis', {
          photoUri: prepared.uri,
          photoId,
          predictions: [],
          band: 'low',
          severity: MANUAL_PICKER_SEVERITY,
          disclaimer: '',
        });
      }
    } catch {
      // Network or unexpected failure reaching the analysis service.
      setError(
        "We couldn't analyze this photo. Check your connection and try again, or you'll be able to choose a category manually on the next try.",
      );
    } finally {
      setWorking(false);
    }
  };

  const retake = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate('Camera');
    }
  };

  return (
    <View style={shared.screen}>
      <Image
        source={{ uri: photoUri }}
        style={styles.image}
        accessibilityLabel="Photo preview of the issue"
        resizeMode="contain"
      />
      <View style={styles.controls}>
        {error ? (
          <View style={shared.errorBox} accessibilityLiveRegion="polite">
            <Text style={shared.errorText}>{error}</Text>
          </View>
        ) : null}
        {working ? (
          <View
            style={styles.workingRow}
            accessibilityLiveRegion="polite"
            accessibilityLabel="Analyzing photo"
          >
            <ActivityIndicator
              color={colors.primary}
              importantForAccessibility="no"
            />
            <Text style={[typography.body, styles.workingText]}>
              Analyzing photo…
            </Text>
          </View>
        ) : (
          <View style={styles.buttonRow}>
            <Pressable
              style={[shared.secondaryButton, styles.flexButton]}
              onPress={retake}
              accessibilityLabel="Retake photo"
              accessibilityRole="button"
              accessibilityHint="Returns to the camera to take another photo"
            >
              <Text style={shared.secondaryButtonText}>Retake</Text>
            </Pressable>
            <View style={styles.gap} />
            <Pressable
              style={[shared.primaryButton, styles.flexButton]}
              onPress={() => void usePhoto()}
              accessibilityLabel="Use this photo"
              accessibilityRole="button"
              accessibilityHint="Analyzes the photo and suggests a category"
            >
              <Text style={shared.primaryButtonText}>Use photo</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    image: {
      flex: 1,
      backgroundColor: '#000000',
    },
    controls: {
      padding: spacing(5),
      backgroundColor: c.surfaceRaised,
      borderTopLeftRadius: radius.sheet,
      borderTopRightRadius: radius.sheet,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.hairline,
    },
    workingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing(3),
    },
    workingText: {
      marginLeft: spacing(3),
    },
    buttonRow: {
      flexDirection: 'row',
    },
    flexButton: {
      flex: 1,
    },
    gap: {
      width: spacing(3),
    },
  });
