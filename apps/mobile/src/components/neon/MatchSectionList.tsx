/**
 * MatchSectionList — groups matches by league and renders sticky neon league
 * headers followed by one MatchRow per match. Used by Home, Premium, VIP and
 * Analysis so all match lists share the same grouping and layout.
 */

import { RefreshControl, SectionList } from 'react-native';
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { useMemo } from 'react';
import type { ApiMatch } from '../../api/client';
import { LeagueHeader } from './LeagueHeader';
import { MatchRow } from './MatchRow';

export interface LeagueSection {
    league: string;
    country?: string;
    logo?: string;
    data: ApiMatch[];
}

export interface MatchSectionListProps {
    matches: ApiMatch[];
    access: { paid: boolean; vip: boolean };
    renderFooter?: (match: ApiMatch, index: number) => ReactNode;
    refreshControl?: ReactElement<ComponentProps<typeof RefreshControl>>;
    contentContainerStyle?: StyleProp<ViewStyle>;
    style?: StyleProp<ViewStyle>;
    ListHeaderComponent?: React.ComponentType | ReactElement;
}

/** Group matches by league, preserving the incoming match order. */
export function groupMatchesByLeague(matches: ApiMatch[]): LeagueSection[] {
    const sections: LeagueSection[] = [];
    const byLeague = new Map<string, LeagueSection>();

    for (const match of matches) {
        const league = match.league || '';
        let section = byLeague.get(league);
        if (!section) {
            section = {
                league,
                country: match.country,
                logo: match.leagueLogo,
                data: [],
            };
            byLeague.set(league, section);
            sections.push(section);
        }
        section.data.push(match);
    }

    return sections;
}

export function MatchSectionList({
    matches,
    access,
    renderFooter,
    refreshControl,
    contentContainerStyle,
    style,
    ListHeaderComponent,
}: MatchSectionListProps) {
    const sections = useMemo(() => groupMatchesByLeague(matches), [matches]);

    return (
        <SectionList<ApiMatch, LeagueSection>
            sections={sections}
            keyExtractor={(item) => item.id}
            stickySectionHeadersEnabled
            showsVerticalScrollIndicator={false}
            style={style}
            contentContainerStyle={contentContainerStyle}
            refreshControl={refreshControl}
            ListHeaderComponent={ListHeaderComponent}
            renderSectionHeader={({ section }) => (
                <LeagueHeader
                    league={section.league}
                    country={section.country}
                    logo={section.logo}
                    count={section.data.length}
                />
            )}
            renderItem={({ item, index }) => (
                <MatchRow match={item} access={access} footer={renderFooter?.(item, index)} />
            )}
        />
    );
}
