/**
 * DialogContext — the app-wide dialog queue.
 *
 * Exactly one dialog can be open at a time. The launch / onboarding
 * subscription offer is refused while membership status is still loading, while
 * a VIP or Paid member, while a purchase is running, after it has already been
 * shown once this session, or while another dialog is open.
 *
 * Everything is rendered through `AppDialog`, so dialogs are real native
 * modals: they never leave an invisible layer behind that could swallow taps.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Linking } from 'react-native';
import * as Application from 'expo-application';
import { usePathname } from 'expo-router';
import { api } from '../api/client';
import { useApiQuery } from '../hooks/useLiveQuery';
import { useRestorePurchases } from '../hooks/useRestorePurchases';
import { purchaseFlow } from '../utils/purchaseFlow';
import { planTitleFor } from '../utils/planTitle';
import i18n from '../locales';
import { useUser } from './UserContext';
import {
    NoConnectionDialog,
    PurchaseFailedDialog,
    PurchaseSuccessDialog,
    SignOutConfirmDialog,
    TelegramErrorDialog,
} from '../components/dialogs/Dialogs';
import { SubscriptionDialog } from '../components/dialogs/SubscriptionDialog';
import { EmailRequestDialog } from '../components/EmailRequestDialog';
import type { EmailSubmitResult } from '../components/EmailRequestDialog';

/** Public Telegram invite, opened from Settings and the Store tab. */
export const TELEGRAM_URL = 'https://t.me/venture34000';

export interface PurchaseSuccessRequest {
    tier: 'vip' | 'paid';
    planTitle: string;
    expiresAt?: string;
    /** Shown as soon as the success dialog is dismissed (restore flow). */
    followUpEmail?: EmailRequestSpec;
}

export interface EmailRequestSpec {
    title: string;
    subtitle?: string;
    note: string;
    submitLabel?: string;
    onSubmit: (email: string) => Promise<EmailSubmitResult>;
    onSubmitted?: () => void;
}

export interface PurchaseFailedRequest {
    message: string;
    onRetry?: () => void;
}

export type DialogRequest =
    | { kind: 'subscription'; greeting?: string }
    | { kind: 'signOut'; onConfirm: () => void }
    | ({ kind: 'purchaseSuccess' } & PurchaseSuccessRequest)
    | ({ kind: 'purchaseFailed' } & PurchaseFailedRequest)
    | ({ kind: 'emailRequest' } & EmailRequestSpec)
    | { kind: 'noConnection'; onRetry: () => Promise<boolean> }
    | { kind: 'telegramError' };

interface DialogContextValue {
    /** Currently open dialog, or null. */
    active: DialogRequest | null;
    /** Ask for the subscription offer; ignored once it has been shown. */
    requestSubscription: (greeting?: string) => void;
    showSignOutConfirm: (onConfirm: () => void) => void;
    showPurchaseSuccess: (request: PurchaseSuccessRequest) => void;
    showPurchaseFailed: (request: PurchaseFailedRequest) => void;
    /** Ask for an email address in the shared dialog (manual requests). */
    showEmailRequest: (request: EmailRequestSpec) => void;
    showNoConnection: (onRetry: () => Promise<boolean>) => void;
    showTelegramError: () => void;
    /** Opens the Telegram invite; shows a friendly dialog if it fails. */
    joinTelegram: () => Promise<void>;
    closeDialog: () => void;
}

const DialogContext = createContext<DialogContextValue | undefined>(undefined);

export function DialogProvider({ children }: { children: ReactNode }) {
    const [active, setActive] = useState<DialogRequest | null>(null);
    const [pendingSubscription, setPendingSubscription] = useState<{ greeting?: string } | null>(null);
    const subscriptionShownRef = useRef(false);
    const launchCheckedRef = useRef(false);
    const pathname = usePathname();
    const onOnboarding = pathname === '/onboarding';

    const deviceId = useMemo(
        () => `${Application.applicationId}_${Application.nativeApplicationVersion || 'v1'}`,
        [],
    );

    // Membership must be known before the subscription offer may appear.
    const { username } = useUser();
    const { data: vipStatus, loaded: vipLoaded } = useApiQuery(
        () => api.tokens.getMembershipStatus(deviceId, 'vip', username || undefined),
        [deviceId, username],
        { enabled: deviceId.length > 0 },
    );
    const { data: paidStatus, loaded: paidLoaded } = useApiQuery(
        () => api.tokens.getMembershipStatus(deviceId, 'paid', username || undefined),
        [deviceId, username],
        { enabled: deviceId.length > 0 },
    );
    const { data: activeSubscription, loaded: subscriptionLoaded } = useApiQuery(
        () => api.purchases.getActiveSubscription(deviceId),
        [deviceId],
        { enabled: deviceId.length > 0 },
    );

    const hasVip = vipStatus?.status === 'active' || activeSubscription?.tier === 'vip';
    const hasPaid = paidStatus?.status === 'active' || activeSubscription?.tier === 'paid';
    const hasAccess = hasVip || hasPaid;
    const membershipLoading = !vipLoaded || !paidLoaded || !subscriptionLoaded;

    const closeDialog = useCallback(() => {
        // A restored purchase offers its email backup right after the success
        // confirmation. Still one dialog at a time — the next one is queued.
        setActive((current) =>
            current?.kind === 'purchaseSuccess' && current.followUpEmail
                ? { kind: 'emailRequest', ...current.followUpEmail }
                : null,
        );
    }, []);

    const requestSubscription = useCallback((greeting?: string) => {
        if (subscriptionShownRef.current) return;
        setPendingSubscription((previous) => previous ?? { greeting });
    }, []);

    // One launch-time check per app session, once the username and the
    // membership status are both known.
    useEffect(() => {
        if (launchCheckedRef.current) return;
        if (onOnboarding || !username || membershipLoading) return;
        launchCheckedRef.current = true;
        if (hasAccess || subscriptionShownRef.current) return;
        setPendingSubscription((previous) => previous ?? {});
    }, [username, membershipLoading, hasAccess, onOnboarding]);

    // Show the offer when every gate is open; never while another dialog is
    // up or a purchase is running.
    useEffect(() => {
        if (!pendingSubscription) return;
        if (onOnboarding || membershipLoading) return;
        if (hasAccess || purchaseFlow.isBusy()) {
            subscriptionShownRef.current = true;
            setPendingSubscription(null);
            return;
        }
        if (active !== null) return;
        subscriptionShownRef.current = true;
        const { greeting } = pendingSubscription;
        setActive({ kind: 'subscription', greeting });
        setPendingSubscription(null);
    }, [pendingSubscription, membershipLoading, hasAccess, active, onOnboarding]);

    const showSignOutConfirm = useCallback((onConfirm: () => void) => {
        setActive({ kind: 'signOut', onConfirm });
    }, []);

    const showPurchaseSuccess = useCallback((request: PurchaseSuccessRequest) => {
        setActive({ kind: 'purchaseSuccess', ...request });
    }, []);

    const showPurchaseFailed = useCallback((request: PurchaseFailedRequest) => {
        setActive({ kind: 'purchaseFailed', ...request });
    }, []);

    const showEmailRequest = useCallback((request: EmailRequestSpec) => {
        setActive({ kind: 'emailRequest', ...request });
    }, []);

    const showNoConnection = useCallback((onRetry: () => Promise<boolean>) => {
        setActive({ kind: 'noConnection', onRetry });
    }, []);

    const showTelegramError = useCallback(() => {
        setActive({ kind: 'telegramError' });
    }, []);

    const joinTelegram = useCallback(async () => {
        try {
            await Linking.openURL(TELEGRAM_URL);
        } catch {
            setActive({ kind: 'telegramError' });
        }
    }, []);

    // A purchase restored on another device / after a reinstall is confirmed
    // with the same dialog as a fresh purchase.
    useRestorePurchases({
        onRestored: (restored) => {
            // Only a restore that actually created a token needs the backup
            // email. An already-recorded purchase has no new token to send.
            const followUpEmail: EmailRequestSpec | undefined = restored.createdToken
                ? {
                      title: i18n.t('market.emailModalTitle'),
                      subtitle: i18n.t('emailRequest.restoredBody'),
                      note: i18n.t('emailRequest.purchaseNote'),
                      onSubmit: async (email: string): Promise<EmailSubmitResult> => {
                          try {
                              const result = await api.purchases.setEmail({
                                  deviceId,
                                  purchaseToken: restored.purchaseToken,
                                  email,
                              });
                              return result.success
                                  ? { ok: true }
                                  : { ok: false, error: result.reason };
                          } catch {
                              return { ok: false, error: i18n.t('emailRequest.failed') };
                          }
                      },
                  }
                : undefined;
            showPurchaseSuccess({
                tier: restored.tier,
                planTitle: planTitleFor(restored.productId),
                expiresAt: restored.expiresAt,
                followUpEmail,
            });
        },
    });

    const value = useMemo<DialogContextValue>(
        () => ({
            active,
            requestSubscription,
            showSignOutConfirm,
            showPurchaseSuccess,
            showPurchaseFailed,
            showEmailRequest,
            showNoConnection,
            showTelegramError,
            joinTelegram,
            closeDialog,
        }),
        [
            active,
            requestSubscription,
            showSignOutConfirm,
            showPurchaseSuccess,
            showPurchaseFailed,
            showEmailRequest,
            showNoConnection,
            showTelegramError,
            joinTelegram,
            closeDialog,
        ],
    );

    let dialog: ReactNode = null;
    if (active !== null) {
        switch (active.kind) {
            case 'subscription':
                dialog = <SubscriptionDialog greeting={active.greeting} onClose={closeDialog} />;
                break;
            case 'signOut': {
                const request = active;
                dialog = (
                    <SignOutConfirmDialog
                        onClose={closeDialog}
                        onConfirm={() => {
                            closeDialog();
                            request.onConfirm();
                        }}
                    />
                );
                break;
            }
            case 'purchaseSuccess': {
                const request = active;
                dialog = (
                    <PurchaseSuccessDialog
                        tier={request.tier}
                        planTitle={request.planTitle}
                        expiresAt={request.expiresAt}
                        onClose={closeDialog}
                    />
                );
                break;
            }
            case 'purchaseFailed': {
                const request = active;
                dialog = (
                    <PurchaseFailedDialog
                        message={request.message}
                        onRetry={request.onRetry}
                        onClose={closeDialog}
                    />
                );
                break;
            }
            case 'emailRequest': {
                const request = active;
                dialog = (
                    <EmailRequestDialog
                        visible
                        title={request.title}
                        subtitle={request.subtitle}
                        note={request.note}
                        submitLabel={request.submitLabel}
                        onSubmit={request.onSubmit}
                        onSubmitted={request.onSubmitted}
                        onClose={closeDialog}
                    />
                );
                break;
            }
            case 'noConnection': {
                const request = active;
                dialog = <NoConnectionDialog onRetry={request.onRetry} onClose={closeDialog} />;
                break;
            }
            case 'telegramError':
                dialog = <TelegramErrorDialog onClose={closeDialog} />;
                break;
            default:
                dialog = null;
        }
    }

    return (
        <DialogContext.Provider value={value}>
            {children}
            {dialog}
        </DialogContext.Provider>
    );
}

export function useDialog(): DialogContextValue {
    const context = useContext(DialogContext);
    if (context === undefined) {
        throw new Error('useDialog must be used within a DialogProvider');
    }
    return context;
}

export default DialogContext;
