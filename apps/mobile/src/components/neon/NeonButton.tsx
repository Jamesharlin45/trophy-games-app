/**
 * NeonButton — legacy name for the design-system `AppButton`.
 * New code should import `AppButton` from `components/design/AppButton`
 * directly. This wrapper keeps older call sites compiling.
 */

import { AppButton, type AppButtonProps } from '../design/AppButton';

export type NeonButtonProps = AppButtonProps;

export function NeonButton(props: NeonButtonProps) {
    return <AppButton {...props} />;
}
