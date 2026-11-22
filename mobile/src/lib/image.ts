import { Platform } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.8;

export interface PreparedImage {
  uri: string;
  width: number;
  height: number;
}

/**
 * Compress a captured photo for upload: resize so the longest edge is at most
 * 1600px and re-encode as JPEG at 0.8 quality. Returns the original URI
 * unchanged when manipulation is unavailable (e.g. in tests).
 */
export async function prepareImageForUpload(
  uri: string,
  width?: number,
  height?: number,
): Promise<PreparedImage> {
  try {
    const actions: ImageManipulator.Action[] = [];
    if (width && height) {
      if (width >= height && width > MAX_EDGE) {
        actions.push({ resize: { width: MAX_EDGE } });
      } else if (height > width && height > MAX_EDGE) {
        actions.push({ resize: { height: MAX_EDGE } });
      }
    } else {
      // Unknown dimensions; cap the width, aspect is preserved.
      actions.push({ resize: { width: MAX_EDGE } });
    }

    const result = await ImageManipulator.manipulateAsync(uri, actions, {
      compress: JPEG_QUALITY,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    return { uri: result.uri, width: result.width, height: result.height };
  } catch {
    // Never block the reporting flow because compression failed; the server
    // enforces its own size limits.
    return { uri, width: width ?? 0, height: height ?? 0 };
  }
}

/** Build multipart form data for an image upload. */
export function imageFormData(uri: string, fieldName = 'file'): FormData {
  const form = new FormData();
  const filename = uri.split('/').pop() ?? 'photo.jpg';
  // React Native's FormData accepts {uri, name, type} objects for files.
  form.append(fieldName, {
    uri: Platform.OS === 'android' ? uri : uri.replace('file://', ''),
    name: filename,
    type: 'image/jpeg',
  } as unknown as Blob);
  return form;
}
