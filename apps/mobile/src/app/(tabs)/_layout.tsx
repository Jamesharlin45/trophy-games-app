import { StyleSheet, View } from 'react-native';
import { Tabs } from 'expo-router';
import { Home, DollarSign, Crown, CheckCircle, Store } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import { readableAccent } from '../../components/neon/tokens';
import i18n from '../../locales';

export default function TabLayout() {
    const { themeColors, isDark } = useTheme();
    const insets = useSafeAreaInsets();
    const accentInk = readableAccent(themeColors, isDark);

    const tabs = [
        { name: 'index', Icon: Home, key: 'home' },
        { name: 'paid', Icon: DollarSign, key: 'paid' },
        { name: 'vip', Icon: Crown, key: 'vip' },
        { name: 'wins', Icon: CheckCircle, key: 'analysis' },
        { name: 'market', Icon: Store, key: 'market' },
    ];

    return (
        <Tabs
            screenOptions={{
                headerShown: false,
                tabBarActiveTintColor: accentInk,
                tabBarInactiveTintColor: themeColors.mutedText,
                tabBarLabelStyle: {
                    fontSize: 10,
                    fontWeight: '600',
                    marginBottom: 5,
                },
                tabBarStyle: {
                    backgroundColor: themeColors.background,
                    borderTopColor: themeColors.border,
                    height: 60 + insets.bottom,
                    paddingTop: 5,
                    paddingBottom: insets.bottom,
                },
            }}
        >
            {tabs.map(({ name, Icon, key }) => (
                <Tabs.Screen
                    key={name}
                    name={name}
                    options={{
                        title: i18n.t(`tabs.${key}`),
                        tabBarIcon: ({ color, focused }) => (
                            <View style={styles.iconWrap}>
                                <Icon color={color} size={22} strokeWidth={focused ? 2.2 : 1.8} />
                                {focused ? <View style={[styles.dot, { backgroundColor: themeColors.accent }]} /> : null}
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
        height: 28,
        alignItems: 'center',
        justifyContent: 'center',
    },
    dot: {
        position: 'absolute',
        bottom: 0,
        width: 4,
        height: 4,
        borderRadius: 2,
    },
});
