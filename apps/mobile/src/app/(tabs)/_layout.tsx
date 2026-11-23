import { StyleSheet, View } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { IonName } from '../../components/design/AppTabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import i18n from '../../locales';

export default function TabLayout() {
    const { themeColors } = useTheme();
    const insets = useSafeAreaInsets();

    const tabs: { name: string; icon: IonName; key: string }[] = [
        { name: 'index', icon: 'home-outline', key: 'home' },
        { name: 'paid', icon: 'cash-outline', key: 'paid' },
        { name: 'vip', icon: 'medal-outline', key: 'vip' },
        { name: 'wins', icon: 'checkmark-circle-outline', key: 'analysis' },
        { name: 'market', icon: 'storefront-outline', key: 'market' },
    ];

    return (
        <Tabs
            screenOptions={{
                headerShown: false,
                tabBarStyle: {
                    backgroundColor: themeColors.background,
                    borderTopColor: themeColors.border,
                    height: 60 + insets.bottom,
                    paddingTop: 4,
                    paddingBottom: insets.bottom,
                },
            }}
        >
            {tabs.map(({ name, icon, key }) => (
                <Tabs.Screen
                    key={name}
                    name={name}
                    options={{
                        title: i18n.t(`tabs.${key}`),
                        tabBarIcon: ({ focused }) => (
                            <View style={styles.iconWrap}>
                                <Ionicons
                                    name={icon}
                                    size={22}
                                    color={focused ? themeColors.accent : themeColors.textSecondary}
                                />
                                {focused ? (
                                    <View style={[styles.activeBar, { backgroundColor: themeColors.accent }]} />
                                ) : null}
                            </View>
                        ),
                    }}
                />
            ))}
        </Tabs>
    );
}

const styles = StyleSheet.create({
    iconWrap: {
        width: 44,
        height: 30,
        alignItems: 'center',
        justifyContent: 'flex-start',
    },
    activeBar: {
        height: 3,
        width: 16,
        borderRadius: 1.5,
        marginTop: 3,
    },
});
