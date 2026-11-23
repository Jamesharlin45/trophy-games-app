/**
 * NeonCard — legacy name for the design-system `Card` (opaque, 1px theme
 * border, glow in Dark). New code should import `Card` from
 * `components/design/Card` directly.
 */

import { Card, type CardProps } from '../design/Card';

export type NeonCardProps = CardProps;

export function NeonCard(props: NeonCardProps) {
    return <Card {...props} />;
}
