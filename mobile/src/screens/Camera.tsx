import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Camera as CameraIcon, Images, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Loading from '../components/Loading';
import { useTheme } from '../lib/theme';
import { font, radius, spacing, type ThemeColors } from '../theme';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Camera'>;

export default function CameraScreen({ navigation }: Props) {
  const cameraRef = useRef<CameraView>(null);
  const { colors, typography, shared } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [permission, requestPermission]);

  const takePhoto = async () => {
    if (!cameraRef.current || capturing) return;
    setCapturing(true);
    setError(null);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9 });
      if (photo?.uri) {
        navigation.navigate('Preview', { photoUri: photo.uri });
      } else {
        setError("The photo didn't save. Please try again.");
      }
    } catch {
      setError("We couldn't take the photo. Please try again.");
    } finally {
      setCapturing(false);
    }
  };

  // Photo library selection serves as fallback when camera hardware or
  // permission is unavailable.
  const pickFromLibrary = async () => {
    if (picking) return;
    setPicking(true);
    setError(null);
    try {
      const selection = await ImagePicker.launchImageLibraryAsync({
        quality: 0.9,
        allowsEditing: false,
      });
      const asset = selection.assets?.[0];
      if (!selection.canceled && asset?.uri) {
        navigation.navigate('Preview', { photoUri: asset.uri });
      }
    } catch {
      setError("We couldn't open your photo library. Please try again.");
    } finally {
      setPicking(false);
    }
  };

  if (!permission) {
    return <Loading message="Checking camera permission…" />;
  }

  if (!permission.granted) {
    return (
      <View style={[shared.screen, shared.container, styles.center]}>
        <View style={styles.permissionBadge} importantForAccessibility="no">
          <CameraIcon size={30} color={colors.primary} strokeWidth={1.8} />
        </View>
        <Text
          style={[typography.heading, styles.centerText]}
          accessibilityRole="header"
        >
          Camera access needed
        </Text>
        <Text style={[typography.body, styles.centerText]}>
          Civic Sense uses the camera only to photograph the issue you want to
          report. Nothing is recorded or uploaded until you choose to.
        </Text>
        {permission.canAskAgain ? (
          <Pressable
            style={[shared.primaryButton, styles.permissionButton]}
            onPress={() => void requestPermission()}
            accessibilityLabel="Allow camera access"
            accessibilityRole="button"
          >
            <Text style={shared.primaryButtonText}>Allow camera access</Text>
          </Pressable>
        ) : (
          <Pressable
            style={[shared.primaryButton, styles.permissionButton]}
            onPress={() => void Linking.openSettings()}
            accessibilityLabel="Open Settings"
            accessibilityRole="button"
            accessibilityHint="Opens your device settings so you can allow camera access for Civic Sense"
          >
            <Text style={shared.primaryButtonText}>Open Settings</Text>
          </Pressable>
        )}
        <Pressable
          style={[shared.secondaryButton, styles.libraryButton]}
          onPress={() => void pickFromLibrary()}
          disabled={picking}
          accessibilityLabel="Choose a photo from your library instead"
          accessibilityRole="button"
        >
          {picking ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Text style={shared.secondaryButtonText}>
              Choose from photo library
            </Text>
          )}
        </Pressable>
      </View>
    );
  }

  return (
    <View style={shared.screen}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing="back"
        accessibilityLabel="Camera viewfinder"
      />
      {/*
        The stack header is hidden so the viewfinder runs edge to edge, which
        leaves the camera with no visible way out — the system back gesture is
        not discoverable. This is the screen's only exit control.
      */}
      <Pressable
        style={[styles.close, { top: insets.top + spacing(2) }]}
        onPress={() => navigation.goBack()}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Close camera"
        accessibilityHint="Returns to the map"
        testID="camera-close"
      >
        <X size={22} color={SCRIM_FOREGROUND} strokeWidth={2.4} />
      </Pressable>
      <View style={styles.controls}>
        {error ? (
          <View style={shared.errorBox} accessibilityLiveRegion="polite">
            <Text style={shared.errorText}>{error}</Text>
          </View>
        ) : null}
        <Text style={styles.hint}>FRAME THE PROBLEM</Text>
        <Pressable
          style={({ pressed }) => [
            styles.shutter,
            pressed && styles.shutterPressed,
          ]}
          onPress={() => void takePhoto()}
          disabled={capturing}
          accessibilityLabel={capturing ? 'Capturing photo' : 'Take photo'}
          accessibilityRole="button"
          accessibilityHint="Captures a photo of the issue"
        >
          {capturing ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <View style={styles.shutterInner} />
          )}
        </Pressable>
        <Pressable
          style={styles.libraryLink}
          onPress={() => void pickFromLibrary()}
          disabled={picking}
          accessibilityLabel="Choose a photo from your library instead"
          accessibilityRole="button"
        >
          <Images
            size={15}
            color={colors.primary}
            strokeWidth={2.2}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
          <Text style={[typography.caption, styles.libraryLinkText]}>
            Or choose from library
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * The close control floats over live camera output, where the theme's ink
 * tokens are unreadable (a dark glyph on a dark street at night). It pairs a
 * fixed scrim with a fixed white glyph instead — the same fixed pair the
 * shutter already relies on.
 */
const SCRIM_FOREGROUND = '#FFFFFF';
const SCRIM_BACKDROP = 'rgba(0, 0, 0, 0.45)';

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    close: {
      position: 'absolute',
      left: spacing(4),
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: SCRIM_BACKDROP,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 2,
    },
    center: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    centerText: {
      textAlign: 'center',
      marginBottom: spacing(3),
    },
    permissionBadge: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: c.primarySurface,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing(4),
      shadowColor: c.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 8,
      elevation: 1,
    },
    permissionButton: {
      alignSelf: 'stretch',
      marginTop: spacing(3),
    },
    libraryButton: {
      alignSelf: 'stretch',
      marginTop: spacing(3),
    },
    camera: {
      flex: 1,
    },
    controls: {
      padding: spacing(6),
      backgroundColor: c.surfaceRaised,
      borderTopLeftRadius: radius.sheet,
      borderTopRightRadius: radius.sheet,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.hairline,
      alignItems: 'center',
      shadowColor: c.shadow,
      shadowOffset: { width: 0, height: -4 },
      shadowOpacity: 0.12,
      shadowRadius: 16,
      elevation: 8,
    },
    shutter: {
      width: 80,
      height: 80,
      borderRadius: 40,
      borderWidth: 5,
      borderColor: c.primary,
      backgroundColor: c.surface,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: c.shadow,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.16,
      shadowRadius: 12,
      elevation: 6,
    },
    shutterInner: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: c.primary,
    },
    libraryLink: {
      marginTop: spacing(4),
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing(2),
      paddingHorizontal: spacing(4),
    },
    hint: {
      fontFamily: font.monoBold,
      fontSize: 10,
      lineHeight: 14,
      letterSpacing: 1.8,
      color: SCRIM_FOREGROUND,
      textAlign: 'center',
      marginBottom: spacing(3),
      textShadowColor: 'rgba(0, 0, 0, 0.65)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 3,
    },
    libraryLinkText: {
      color: c.primary,
      fontFamily: font.bold,
    },
    shutterPressed: {
      opacity: 0.85,
      transform: [{ scale: 0.96 }],
    },
  });
