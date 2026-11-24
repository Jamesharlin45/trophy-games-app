/**
 * Small module-level flag that says a Google Play purchase (or the recording
 * of one) is currently running. Global dialogs such as the launch-time
 * subscription offer must never appear in the middle of a purchase, and screen
 * state cannot be read from outside React — so the flag lives here.
 */

let busy = false;

export const purchaseFlow = {
    isBusy: (): boolean => busy,
    setBusy: (value: boolean): void => {
        busy = value;
    },
};

export default purchaseFlow;
