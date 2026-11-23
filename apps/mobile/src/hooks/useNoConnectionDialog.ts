/**
 * Turns a failed API request into the shared "can't connect" dialog.
 *
 * The dialog is raised once per outage: closing it does not re-open it on every
 * poll, but a successful request (`error` back to null) or a manual refresh
 * (`arm()`) re-arms it.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { ApiError } from '../api/client';
import { useDialog } from '../context/DialogContext';

export interface ConnectionDialogHandle {
    /** Call before a pull-to-refresh so a failure can raise the dialog again. */
    arm: () => void;
}

function isConnectivityFailure(error: ApiError): boolean {
    if (error.code === 'network' || error.code === 'timeout' || error.code === 'parse') return true;
    // A 5xx means the API itself could not be reached; 4xx is a real answer.
    return error.code === 'http' && (error.status ?? 0) >= 500;
}

export function useNoConnectionDialog(
    error: ApiError | null,
    retry: () => Promise<boolean>,
): ConnectionDialogHandle {
    const { showNoConnection } = useDialog();
    const reportedRef = useRef(false);
    const retryRef = useRef(retry);
    retryRef.current = retry;
    const showRef = useRef(showNoConnection);
    showRef.current = showNoConnection;

    useEffect(() => {
        if (!error) {
            reportedRef.current = false;
            return;
        }
        if (reportedRef.current || !isConnectivityFailure(error)) return;
        reportedRef.current = true;
        showRef.current(() => retryRef.current());
    }, [error]);

    const arm = useCallback(() => {
        reportedRef.current = false;
    }, []);

    return { arm };
}

export default useNoConnectionDialog;
