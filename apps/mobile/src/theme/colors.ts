export const colors = {
    dark: {
        background: '#090A0C', // Deep stealth dark blue-gray
        cardBg: '#121418', // Slightly elevated card
        cardBgSecondary: '#1A1D24', // More elevated elements
        primary: '#00C805', // Vibrant Robinhood green
        primaryMuted: 'rgba(0, 200, 5, 0.15)',
        secondary: '#1A1D24',
        text: '#FFFFFF',
        textMuted: '#8B949E',
        border: 'rgba(255,255,255,0.06)',
        gray5: '#21262D',
        orange9: '#F97316',
        blue2: '#1E3A5F',
        blue10: '#60A5FA',
        success: '#00C805',
        warning: '#EAB308',
        error: '#EF4444',
        vip: '#00C805',
        glass: 'rgba(255, 255, 255, 0.04)',
    },
    light: {
        background: '#F4F6F8', // Light page background
        cardBg: '#FFFFFF', // Primary card / surface
        cardBgSecondary: '#F1F5F9', // Elevated secondary surfaces
        primary: '#00C805', // Vibrant RobinHood green
        primaryMuted: 'rgba(0, 200, 5, 0.15)',
        secondary: '#F1F5F9',
        text: '#111827',
        textMuted: '#64748B',
        border: 'rgba(0,0,0,0.07)',
        gray5: '#D1D5DB',
        orange9: '#F97316',
        blue2: '#1E3A5F',
        blue10: '#3B82F6',
        success: '#16A34A',
        warning: '#D97706',
        error: '#EF4444',
        vip: '#00C805',
        glass: 'rgba(0, 0, 0, 0.04)',
    },
};

export type ThemeColors = typeof colors.dark;
