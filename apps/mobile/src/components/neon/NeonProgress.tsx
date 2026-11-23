/**
 * NeonProgress — legacy name for the design-system `ProgressBar`.
 * New code should import `ProgressBar` from `components/design/ProgressBar`.
 */

import { ProgressBar, type ProgressBarProps } from '../design/ProgressBar';

export type NeonProgressProps = ProgressBarProps;

export function NeonProgress(props: NeonProgressProps) {
    return <ProgressBar {...props} />;
}
