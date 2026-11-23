/**
 * OverviewTabs — legacy name for the design-system `AppTabs` (match-page
 * overview tab bar). New code should import `AppTabs` from
 * `components/design/AppTabs` directly.
 */

import { AppTabs, type AppTabsProps } from './design/AppTabs';

export type TabDef = AppTabsProps['tabs'][number];
export type OverviewTabsProps = AppTabsProps;

export function OverviewTabs(props: OverviewTabsProps) {
    return <AppTabs {...props} />;
}
