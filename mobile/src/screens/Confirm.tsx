import React, { useMemo, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import CategoryChip from '../components/CategoryChip';
import { useTheme } from '../lib/theme';
import { spacing, type ThemeColors } from '../theme';
import { CATEGORIES, type Category } from '../types';
import type { RootStackParamList } from '../navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Confirm'>;

function formatCategory(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

export default function ConfirmScreen({ route, navigation }: Props) {
  const params = route.params;
  const { colors, typography, shared } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [selected, setSelected] = useState<Category | undefined>(
    params.preselected,
  );

  const aiPick = params.preselected;
  const userCorrected = selected !== undefined && selected !== aiPick;

  const proceed = () => {
    if (!selected) return;
    navigation.navigate('Location', { ...params, category: selected });
  };

  return (
    <ScrollView style={shared.screen} contentContainerStyle={shared.container}>
      <Image
        source={{ uri: params.photoUri }}
        style={styles.thumbnail}
        accessibilityLabel="Your photo"
        resizeMode="cover"
      />
      <Text style={[typography.eyebrow, styles.eyebrow]}>Field entry</Text>
      <Text style={[typography.heading, styles.title]} accessibilityRole="header">
        What best describes the issue?
      </Text>
      {aiPick && !userCorrected ? (
        <Text style={typography.caption}>
          The AI suggestion is preselected. Change it if it&apos;s wrong.
        </Text>
      ) : null}
      {userCorrected ? (
        <Text style={typography.caption}>
          Corrections like yours improve the model.
        </Text>
      ) : null}

      <View style={styles.chipsRule} />
      <View style={styles.chips}>
        {CATEGORIES.map((category) => (
          <CategoryChip
            key={category}
            label={formatCategory(category)}
            category={category}
            selected={selected === category}
            onPress={() => setSelected(category)}
          />
        ))}
      </View>

      <Pressable
        style={({ pressed }) => [
          shared.primaryButton,
          styles.nextButton,
          !selected && { opacity: 0.5 },
          pressed && selected !== undefined && styles.pressed,
        ]}
        onPress={proceed}
        disabled={!selected}
        accessibilityLabel="Continue to location"
        accessibilityRole="button"
        accessibilityHint={
          selected
            ? 'Continues to choosing the issue location'
            : 'Select a category first'
        }
        accessibilityState={{ disabled: !selected }}
      >
        <Text style={shared.primaryButtonText}>Continue</Text>
      </Pressable>
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    thumbnail: {
      width: '100%',
      height: 180,
      borderRadius: 3,
    },
    eyebrow: {
      marginTop: spacing(4),
      color: c.primary,
    },
    title: {
      marginTop: spacing(1),
      marginBottom: spacing(2),
    },
    // Hairline rule between the question and the answer grid — form language.
    chipsRule: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.hairline,
      marginTop: spacing(4),
    },
    chips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginTop: spacing(4),
      marginHorizontal: -spacing(1),
    },
    nextButton: {
      marginTop: spacing(6),
    },
    pressed: {
      opacity: 0.85,
      transform: [{ scale: 0.99 }],
    },
  });
