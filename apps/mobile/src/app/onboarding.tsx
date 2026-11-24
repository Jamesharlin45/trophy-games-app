import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { User } from 'lucide-react-native';
import { useTheme } from '../context/ThemeContext';
import { api } from '../api/client';
import { getDeviceId } from '../utils/deviceId';

type ThemeColors = ReturnType<typeof useTheme>['themeColors'];

export default function OnboardingScreen() {
  const { themeColors } = useTheme();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);

  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [availability, setAvailability] = useState<{ available: boolean } | undefined>(undefined);

  // Debounced username availability lookup (was a live Convex query).
  useEffect(() => {
    const trimmed = username.trim();
    if (trimmed.length < 3) {
      setAvailability(undefined);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      api.users
        .checkUsername(trimmed)
        .then((result) => {
          if (!cancelled) setAvailability(result);
        })
        .catch(() => {
          if (!cancelled) setAvailability(undefined);
        });
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [username]);

  const handleContinue = async () => {
    const trimmed = username.trim();
    if (trimmed.length < 3) {
      setError('Username must be at least 3 characters');
      return;
    }

    if (availability?.available === false) {
      setError('Username is already taken');
      return;
    }

    try {
      setLoading(true);
      setError('');

      const deviceId = await getDeviceId();
      const result = await api.users.register(trimmed, deviceId);

      if (result.success) {
        await AsyncStorage.setItem('@trophy_games_username', trimmed);
        router.replace('/(tabs)');
      } else {
        setError(result.reason || 'Failed to register username');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <User size={48} color={themeColors.primary} />
        </View>

        <Text style={styles.title}>Welcome to Trophy Games</Text>
        <Text style={styles.subtitle}>Choose a unique username to secure your account and manage your VIP access tokens.</Text>

        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            placeholder="Choose a username..."
            placeholderTextColor={themeColors.textMuted}
            value={username}
            onChangeText={(t) => { setUsername(t); setError(''); }}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={20}
          />
          {username.length >= 3 && availability !== undefined && (
            <Text style={[styles.availability, { color: availability.available ? themeColors.primary : themeColors.error }]}>
              {availability.available ? '✓ Available' : '✗ Taken'}
            </Text>
          )}
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <TouchableOpacity
          style={[
            styles.button,
            (username.trim().length < 3 || availability?.available === false) && styles.buttonDisabled
          ]}
          onPress={handleContinue}
          disabled={loading || username.trim().length < 3 || availability?.available === false}
        >
          {loading ? (
            <ActivityIndicator color={themeColors.background} />
          ) : (
            <Text style={styles.buttonText}>Continue</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: themeColors.background,
    },
    content: {
      flex: 1,
      justifyContent: 'center',
      padding: 24,
    },
    iconContainer: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: themeColors.cardBgSecondary,
      justifyContent: 'center',
      alignItems: 'center',
      alignSelf: 'center',
      marginBottom: 32,
      borderWidth: 1,
      borderColor: themeColors.border,
    },
    title: {
      fontSize: 28,
      fontWeight: '700',
      color: themeColors.text,
      textAlign: 'center',
      marginBottom: 12,
    },
    subtitle: {
      fontSize: 15,
      color: themeColors.textMuted,
      textAlign: 'center',
      marginBottom: 48,
      lineHeight: 22,
    },
    inputContainer: {
      marginBottom: 24,
    },
    input: {
      backgroundColor: themeColors.cardBg,
      borderWidth: 1,
      borderColor: themeColors.border,
      borderRadius: 16,
      padding: 16,
      fontSize: 16,
      color: themeColors.text,
    },
    availability: {
      position: 'absolute',
      right: 16,
      top: 18,
      fontSize: 12,
      fontWeight: '600',
    },
    errorText: {
      color: themeColors.error,
      textAlign: 'center',
      marginBottom: 16,
      fontSize: 14,
    },
    button: {
      backgroundColor: themeColors.primary,
      padding: 16,
      borderRadius: 16,
      alignItems: 'center',
      shadowColor: themeColors.primary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 12,
      elevation: 4,
    },
    buttonDisabled: {
      backgroundColor: themeColors.cardBgSecondary,
      shadowOpacity: 0,
      elevation: 0,
    },
    buttonText: {
      color: themeColors.background,
      fontSize: 16,
      fontWeight: '700',
      letterSpacing: 0.5,
    },
  });
}
