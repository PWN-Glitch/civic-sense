import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// SecureStore is unavailable on web and inside the Jest environment; fall back
// to AsyncStorage there so the API client works everywhere.
let secureStore: {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
} | null = null;

try {
  if (Platform.OS !== 'web') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    secureStore = require('expo-secure-store');
  }
} catch {
  secureStore = null;
}

export const tokenStorage = {
  async get(key: string): Promise<string | null> {
    if (secureStore) return secureStore.getItemAsync(key);
    return AsyncStorage.getItem(key);
  },
  async set(key: string, value: string): Promise<void> {
    if (secureStore) return secureStore.setItemAsync(key, value);
    return AsyncStorage.setItem(key, value);
  },
  async remove(key: string): Promise<void> {
    if (secureStore) return secureStore.deleteItemAsync(key);
    return AsyncStorage.removeItem(key);
  },
};
