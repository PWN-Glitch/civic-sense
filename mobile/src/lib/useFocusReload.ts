import { useEffect } from 'react';

/** The slice of a navigator this hook needs; tests pass a stub. */
type FocusAwareNavigation = {
  addListener?: (event: 'focus', callback: () => void) => (() => void) | void;
};

/**
 * Run `reload` every time the screen comes into focus, including the first.
 *
 * Tab screens stay mounted for the life of the app, so a report filed on the
 * Report stack never re-mounts the docket or the map — both would keep showing
 * whatever they loaded at launch. Reloading on focus is what makes "file a
 * report, go look at it" work.
 *
 * `addListener` is guarded because several screens are rendered outside a
 * navigator in tests, where there is nothing to subscribe to.
 */
export function useFocusReload(navigation: unknown, reload: () => void): void {
  useEffect(() => {
    const nav = navigation as FocusAwareNavigation | undefined;
    if (typeof nav?.addListener !== 'function') return;
    const unsubscribe = nav.addListener('focus', reload);
    return typeof unsubscribe === 'function' ? unsubscribe : undefined;
  }, [navigation, reload]);
}
