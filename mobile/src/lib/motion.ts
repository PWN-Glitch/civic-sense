import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated } from 'react-native';

/**
 * One restrained mount transition for screen content: a short fade with a
 * gentle rise (12px). Used once per screen, on the outermost content view,
 * so navigation into a screen feels intentional rather than popping.
 *
 * Reduced-motion: when the OS "reduce motion" / "remove animations" setting
 * is on, the transition is skipped entirely and content renders at rest.
 *
 * Usage:
 *   const enter = useEnterTransition();
 *   return <Animated.View style={[styles.root, enter]}>…</Animated.View>;
 */
export function useEnterTransition() {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let mounted = true;
    // In some environments (older RN mocks) the promise can be undefined;
    // treat that as "no preference" and run the animation normally.
    const query = AccessibilityInfo.isReduceMotionEnabled?.();
    void Promise.resolve(query)
      .then((reduce) => {
        if (!mounted) return;
        if (reduce) {
          progress.setValue(1);
          return;
        }
        Animated.timing(progress, {
          toValue: 1,
          duration: 280,
          // ease-out cubic: fast start, gentle settle
          easing: (t) => 1 - Math.pow(1 - t, 3),
          useNativeDriver: true,
        }).start();
      })
      .catch(() => {
        // AccessibilityInfo unavailable; animate normally.
      });
    return () => {
      mounted = false;
    };
  }, [progress]);

  return {
    opacity: progress,
    transform: [
      {
        translateY: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [12, 0],
        }),
      },
    ],
  };
}
