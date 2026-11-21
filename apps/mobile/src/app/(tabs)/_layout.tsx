import { Tabs } from 'expo-router';
import { Home, DollarSign, Crown, CheckCircle, Store } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import i18n from '../../locales';

export default function TabLayout() {
    const { themeColors } = useTheme();
    const insets = useSafeAreaInsets();

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
                tabBarActiveTintColor: themeColors.accent,
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
                            <Icon color={color} size={22} fill={focused ? color : 'none'} />
                        ),
                    }}
                />
            ))}
        </Tabs>
    );
}
