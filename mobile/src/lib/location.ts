import * as Location from 'expo-location';

export interface CurrentPosition {
  lat: number;
  lng: number;
  accuracy?: number;
}

/**
 * Request foreground permission and return the current position.
 * Throws with a user-readable message on denial or failure.
 */
export async function getCurrentPosition(): Promise<CurrentPosition> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    throw new Error(
      'Location permission was denied. You can still drag the pin to the right place.',
    );
  }
  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });
  return {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracy: position.coords.accuracy ?? undefined,
  };
}
