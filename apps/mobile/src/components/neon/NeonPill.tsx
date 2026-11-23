/**
 * NeonPill — legacy name for the design-system `Pill` (opaque tones,
 * readable text, neutral outline). New code should import `Pill` from
 * `components/design/Pill` directly.
 */

import { Pill, type PillProps, type PillTone } from '../design/Pill';

export type NeonTone = PillTone;
export type NeonPillProps = PillProps;

export function NeonPill(props: NeonPillProps) {
    return <Pill {...props} />;
}
