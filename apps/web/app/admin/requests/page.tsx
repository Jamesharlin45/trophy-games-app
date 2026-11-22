'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
    CheckCircle2,
    XCircle,
    RefreshCw,
    Crown,
    DollarSign,
    Clock,
    Copy,
    Ban,
    Hourglass,
    Mail,
    Trash2,
    AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn, daysLeftLabel } from '@/lib/utils';
import { getDeviceDisplayCode, isLegacyDeviceId } from '@/lib/device-id';

type EmailState = 'none' | 'sent' | 'queued' | 'failed';

interface MembershipRequest {
    _id: string;
    deviceId: string;
    username?: string;
    /** Address supplied by the user when requesting the token manually. */
    email?: string;
    type: 'vip' | 'paid';
    status: 'pending' | 'approved' | 'rejected';
    requestedAt: string;
    resolvedAt?: string;
    issuedToken?: string;
    revokedAt?: string;
    tokenExpiresAt?: string;
    tokenRevokedAt?: string;
    emailStatus?: EmailState;
    emailError?: string;
}

interface TokenSummary {
    token: string;
    expiresAt?: string;
    revokedAt?: string;
    isActive?: boolean;
    isClaimed?: boolean;
}

interface ApprovalResult {
    requestId: string;
    token: string;
    username?: string;
    deviceId?: string;
    type: 'vip' | 'paid';
    email: string;
    /** Full address is kept only for the Resend API call, never displayed. */
    fullEmail: string;
    emailStatus: EmailState;
    emailError?: string;
}

export default function AdminRequestsPage() {
    const [requests, setRequests] = useState<MembershipRequest[]>([]);
    const [tokens, setTokens] = useState<TokenSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [copiedToken, setCopiedToken] = useState<string | null>(null);
    const [tab, setTab] = useState<'pending' | 'all'>('pending');
    const [approvalResult, setApprovalResult] = useState<ApprovalResult | null>(null);
    const [emailPromptId, setEmailPromptId] = useState<string | null>(null);
    const [emailDraft, setEmailDraft] = useState('');

    const loadRequests = useCallback(async () => {
        try {
            const res = await fetch('/api/admin/requests');
            const data = await res.json();
            if (!res.ok || !Array.isArray(data)) {
                if (data?.error) toast.error(String(data.error));
                return;
            }
            setRequests(data as MembershipRequest[]);
        } catch (e) {
            console.error(e);
            toast.error('Failed to load requests');
        } finally {
            setLoading(false);
        }
    }, []);

    const loadTokens = useCallback(async () => {
        try {
            const res = await fetch('/api/admin/tokens');
            const data = await res.json();
            setTokens(
                Array.isArray(data)
                    ? (data as TokenSummary[]).map((t) => ({
                          token: t.token,
                          expiresAt: t.expiresAt,
                          revokedAt: t.revokedAt,
                          isActive: t.isActive,
                          isClaimed: t.isClaimed,
                      }))
                    : [],
            );
        } catch (e) {
            console.error(e);
        }
    }, []);

    useEffect(() => {
        async function initialize() {
            await Promise.all([loadRequests(), loadTokens()]);
        }
        void initialize();
    }, [loadRequests, loadTokens]);

    const reload = useCallback(async () => {
        await Promise.all([loadRequests(), loadTokens()]);
    }, [loadRequests, loadTokens]);

    /** after() finishes once the response is flushed — refresh so the card
     * shows the real SMTP outcome (sent / queued / failed) and its error. */
    const refreshApprovalResult = useCallback(async (requestId: string) => {
        try {
            const res = await fetch('/api/admin/requests');
            const data = await res.json();
            if (!res.ok || !Array.isArray(data)) return;
            const rows = data as MembershipRequest[];
            setRequests(rows);
            const row = rows.find((item) => item._id === requestId);
            if (!row) return;
            setApprovalResult((previous) => {
                if (!previous || previous.requestId !== requestId) return previous;
                const state: EmailState =
                    row.emailStatus === 'sent' || row.emailStatus === 'failed'
                        ? row.emailStatus
                        : row.emailStatus === 'none'
                            ? row.emailError
                                ? 'failed'
                                : 'none'
                            : 'queued';
                return { ...previous, emailStatus: state, emailError: row.emailError };
            });
        } catch {
            // The original approve result stays visible; no secret is logged.
        }
    }, []);

    const tokenByString = new Map(tokens.map((t) => [t.token, t]));
    const issuedAccess = (req: MembershipRequest): TokenSummary | undefined =>
        req.issuedToken ? tokenByString.get(req.issuedToken) : undefined;
    const isRequestRevoked = (req: MembershipRequest): boolean =>
        Boolean(req.revokedAt) || Boolean(issuedAccess(req)?.revokedAt);

    /** 'approved' is real only while a live, unclaimed token still exists. */
    const hasLiveApprovalToken = (req: MembershipRequest): boolean => {
        const token = issuedAccess(req);
        if (!token || token.isActive === false || token.revokedAt || token.isClaimed !== false) return false;
        return !token.expiresAt || new Date(token.expiresAt) > new Date();
    };

    const handleRemoveAccess = async (req: MembershipRequest) => {
        if (!window.confirm(`Remove access for ${req.username || 'this user'} (${req.type})? The user will lose access on their next app refresh.`)) return;
        setProcessingId(req._id);
        try {
            const res = await fetch('/api/admin/requests', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ requestId: req._id, action: 'revoke' }),
            });
            const data = await res.json();
            if (!res.ok || data.error) throw new Error(data.error || 'Failed');
            await reload();
            toast.success('Access removed');
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Failed to remove access');
        } finally {
            setProcessingId(null);
        }
    };

    const handleExtend = async (req: MembershipRequest, days: 7 | 30) => {
        setProcessingId(req._id);
        try {
            const res = await fetch('/api/admin/requests', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ requestId: req._id, action: 'extend', days }),
            });
            const data = await res.json();
            if (!res.ok || data.error) throw new Error(data.error || 'Failed');
            await reload();
            toast.success(`Extended to ${new Date(data.expiresAt).toLocaleDateString()}`);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Failed to extend access');
        } finally {
            setProcessingId(null);
        }
    };

    const handleDelete = async (req: MembershipRequest) => {
        const message =
            `Permanently delete this ${req.type.toUpperCase()} request from ${req.username || 'this user'}? ` +
            'This also deletes the token issued for it and all pending token emails. ' +
            'Any related purchase payment record is kept but revoked. This cannot be undone.';
        if (!window.confirm(message)) return;
        setProcessingId(req._id);
        try {
            const res = await fetch('/api/admin/requests', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ requestId: req._id }),
            });
            const data = await res.json().catch(() => null) as { error?: string } | null;
            if (!res.ok || data?.error) throw new Error(data?.error || 'Failed to delete request');
            setApprovalResult((previous) => (previous?.requestId === req._id ? null : previous));
            await reload();
            toast.success('Request, token and pending emails deleted');
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Failed to delete request');
        } finally {
            setProcessingId(null);
        }
    };

    const handleResend = async (result: ApprovalResult) => {
        setProcessingId(result.requestId);
        try {
            const res = await fetch('/api/admin/tokens/email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: result.token, email: result.fullEmail }),
            });
            const data = await res.json().catch(() => null) as {
                error?: string;
                emailStatus?: EmailState;
                emailError?: string;
                email?: string;
            } | null;
            if (!res.ok || data?.error) {
                throw new Error(data?.emailError || data?.error || 'Failed to resend email');
            }
            setApprovalResult((previous) =>
                previous && previous.requestId === result.requestId
                    ? { ...previous, emailStatus: data?.emailStatus ?? 'queued', emailError: data?.emailError }
                    : previous,
            );
            toast.success(`Email queued for ${data?.email ?? result.email}`);
            setTimeout(() => void refreshApprovalResult(result.requestId), 1500);
            setTimeout(() => void refreshApprovalResult(result.requestId), 4000);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Failed to resend email');
        } finally {
            setProcessingId(null);
        }
    };

    const handleAction = async (requestId: string, action: 'approve' | 'reject', typedEmail?: string) => {
        setProcessingId(requestId);
        try {
            const res = await fetch('/api/admin/requests', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ requestId, action, ...(typedEmail ? { email: typedEmail } : {}) }),
            });
            const data = await res.json().catch(() => null) as {
                error?: string;
                needsEmail?: boolean;
                token?: string;
                email?: string;
                emailStatus?: EmailState;
                emailError?: string;
                username?: string;
                deviceId?: string;
                type?: 'vip' | 'paid';
            } | null;

            if (action === 'approve') {
                if (data?.needsEmail) {
                    setEmailPromptId(requestId);
                    setEmailDraft('');
                    toast.error(data.error || 'No email on this request');
                } else if (data?.token) {
                    const request = requests.find((row) => row._id === requestId);
                    const fullEmail = request?.email?.trim().toLowerCase() ?? typedEmail?.trim().toLowerCase() ?? '';
                    setEmailPromptId(null);
                    setApprovalResult({
                        requestId,
                        token: data.token,
                        username: data.username,
                        deviceId: data.deviceId,
                        type: data.type ?? 'vip',
                        email: data.email ?? '',
                        fullEmail,
                        emailStatus: data.emailStatus ?? 'queued',
                        emailError: data.emailError,
                    });
                    navigator.clipboard.writeText(data.token).catch(() => { });
                    setCopiedToken(data.token);
                    setTimeout(() => setCopiedToken(null), 4000);
                    setTimeout(() => void refreshApprovalResult(requestId), 1500);
                    setTimeout(() => void refreshApprovalResult(requestId), 4000);
                    toast.success(`Request approved — email ${data.emailStatus ?? 'queued'}${data.email ? ` to ${data.email}` : ''}`);
                } else {
                    throw new Error(data?.error || 'Failed to approve request');
                }
            } else if (action === 'reject') {
                toast.success('Request rejected successfully.');
            }

            await reload();
        } catch (e) {
            console.error(e);
            toast.error(e instanceof Error ? e.message : `Failed to ${action} request`);
        } finally {
            setProcessingId(null);
        }
    };

    const filtered = tab === 'pending' ? requests.filter((r) => r.status === 'pending') : requests;
    const pendingCount = requests.filter((r) => r.status === 'pending').length;

    return (
        <div className="p-4 md:p-6 lg:p-8 space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-zinc-900 dark:text-zinc-50 tracking-tight">Membership Requests</h1>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Review and approve VIP/Paid access requests from users.</p>
                </div>
                <button onClick={() => { setLoading(true); void loadRequests(); }} className="flex items-center gap-2 px-3 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-medium rounded-xl transition-colors text-sm">
                    <RefreshCw size={14} />Refresh
                </button>
            </div>

            {copiedToken && (
                <div className="flex items-center gap-3 p-4 bg-brand-green/10 dark:bg-brand-green/10 border border-brand-green/20 dark:border-brand-green/30 rounded-xl">
                    <CheckCircle2 size={18} className="text-brand-green shrink-0" />
                    <div>
                        <p className="text-sm font-semibold text-brand-green dark:text-brand-green/80">Token generated and copied!</p>
                        <p className="font-mono text-sm text-brand-green dark:text-brand-green/80 mt-1">{copiedToken}</p>
                        <p className="text-xs text-brand-green dark:text-brand-green/80 mt-0.5">The token is also bound to the exact device id and username on the request.</p>
                    </div>
                </div>
            )}

            {approvalResult && (
                <div className={cn(
                    'rounded-xl border p-4 space-y-2',
                    approvalResult.emailStatus === 'failed'
                        ? 'border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30'
                        : 'border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30',
                )}>
                    <div className="flex items-center gap-2 font-semibold text-sm text-zinc-900 dark:text-zinc-50">
                        {approvalResult.emailStatus === 'failed' ? <AlertTriangle size={16} className="text-red-500" /> : <Mail size={16} className="text-blue-500" />}
                        Email {approvalResult.emailStatus === 'none' ? 'not sent' : approvalResult.emailStatus} for this approval
                    </div>
                    <p className="text-xs text-zinc-600 dark:text-zinc-300">
                        Recipient: <span className="font-mono">{approvalResult.email || 'unknown'}</span>
                        {' '}· {approvalResult.type.toUpperCase()} · {approvalResult.username || approvalResult.deviceId || 'user'}
                    </p>
                    {approvalResult.emailError && (
                        <p className="text-xs text-red-600 dark:text-red-400 break-words">Error: {approvalResult.emailError}</p>
                    )}
                    <button
                        onClick={() => void handleResend(approvalResult)}
                        disabled={processingId === approvalResult.requestId}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                    >
                        <Mail size={12} />Resend email
                    </button>
                </div>
            )}

            <div className="flex gap-2 border-b border-zinc-200 dark:border-zinc-800">
                <button onClick={() => setTab('pending')} className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${tab === 'pending' ? 'border-blue-600 text-blue-600' : 'border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50'}`}>
                    Pending
                    {pendingCount > 0 && <span className="inline-flex items-center justify-center w-5 h-5 bg-blue-600 text-white text-xs font-bold rounded-full">{pendingCount}</span>}
                </button>
                <button onClick={() => setTab('all')} className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${tab === 'all' ? 'border-blue-600 text-blue-600' : 'border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50'}`}>
                    All Requests
                </button>
            </div>

            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 overflow-hidden">
                {loading ? (
                    <div className="p-12 text-center text-zinc-400">Loading requests...</div>
                ) : filtered.length === 0 ? (
                    <div className="p-12 text-center text-zinc-400">
                        {tab === 'pending' ? 'No pending requests.' : 'No requests yet.'}
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-zinc-50 dark:bg-zinc-800/60 text-xs text-zinc-500 dark:text-zinc-400 font-medium">
                                <tr>
                                    <th className="px-4 py-3">User/Device</th>
                                    <th className="px-4 py-3">Email</th>
                                    <th className="px-4 py-3 text-center">Type</th>
                                    <th className="px-4 py-3 text-center">Status</th>
                                    <th className="px-4 py-3">Requested</th>
                                    <th className="px-4 py-3">Token</th>
                                    <th className="px-4 py-3">Expires / Email</th>
                                    <th className="px-4 py-3 text-center">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                {filtered.map((req) => {
                                    const access = issuedAccess(req);
                                    const revoked = isRequestRevoked(req);
                                    const liveApproval = req.status === 'approved' && hasLiveApprovalToken(req) && !revoked;
                                    return (
                                    <tr key={req._id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors">
                                        <td className="px-4 py-3 max-w-40 truncate">
                                            <div className="font-medium text-zinc-900 dark:text-zinc-100">{req.username || 'Anonymous'}</div>
                                            <button
                                                onClick={() => navigator.clipboard.writeText(req.deviceId).catch(() => { })}
                                                title="Copy full device id"
                                                className="font-mono text-xs text-zinc-500 dark:text-zinc-500 mt-0.5 hover:text-blue-600"
                                            >
                                                {getDeviceDisplayCode(req.deviceId)}
                                            </button>
                                            {isLegacyDeviceId(req.deviceId) && (
                                                <span className="ml-2 rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">LEGACY</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-xs text-zinc-500 break-all max-w-48">
                                            {req.email || <span className="text-zinc-300 dark:text-zinc-600">—</span>}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${req.type === 'vip' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'}`}>
                                                {req.type === 'vip' ? <Crown size={10} /> : <DollarSign size={10} />}
                                                {req.type.toUpperCase()}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            {revoked ? <span className="inline-flex items-center gap-1 text-xs font-medium text-red-500"><Ban size={12} />Revoked</span> :
                                            req.status === 'pending' && <span className="inline-flex items-center gap-1 text-xs font-medium text-orange-500"><Clock size={12} />Pending</span>}
                                            {!revoked && req.status === 'approved' && (liveApproval
                                                ? <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-green"><CheckCircle2 size={12} />Approved</span>
                                                : <span className="inline-flex items-center gap-1 text-xs font-medium text-zinc-400"><XCircle size={12} />No access</span>)}
                                            {!revoked && req.status === 'rejected' && <span className="inline-flex items-center gap-1 text-xs font-medium text-red-500"><XCircle size={12} />Rejected</span>}
                                        </td>
                                        <td className="px-4 py-3 text-xs text-zinc-500 whitespace-nowrap">
                                            {new Date(req.requestedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}
                                        </td>
                                        <td className="px-4 py-3">
                                            {req.issuedToken ? (
                                                <button
                                                    onClick={() => { navigator.clipboard.writeText(req.issuedToken!).catch(() => { }); }}
                                                    className="font-mono text-xs bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors flex items-center gap-1"
                                                    title="Copy token"
                                                >
                                                    <Copy size={10} />{req.issuedToken}
                                                </button>
                                            ) : <span className="text-zinc-300 dark:text-zinc-600 text-xs">—</span>}
                                        </td>
                                        <td className="px-4 py-3 text-xs text-zinc-500 whitespace-nowrap">
                                            {access && access.expiresAt ? (
                                                <span>
                                                    {new Date(access.expiresAt).toLocaleDateString()} <span className={cn(daysLeftLabel(access.expiresAt).startsWith('0') ? 'text-red-500' : '')}>({daysLeftLabel(access.expiresAt)})</span>
                                                </span>
                                            ) : <span>{access ? 'Never' : '—'}</span>}
                                            {req.emailStatus === 'sent' && <div className="text-brand-green">Email sent</div>}
                                            {req.emailStatus === 'queued' && <div className="text-orange-500">Email queued</div>}
                                            {req.emailStatus === 'failed' && <div className="text-red-500" title={req.emailError}>Email failed{req.emailError ? ` — ${req.emailError}` : ''}</div>}
                                        </td>
                                        <td className="px-4 py-3 text-center flex justify-center gap-2 flex-wrap">
                                            {req.status === 'pending' && (
                                                <div className="flex items-center justify-center gap-2">
                                                    <button
                                                        onClick={() => handleAction(req._id, 'approve')}
                                                        disabled={processingId === req._id}
                                                        className="flex items-center gap-1 px-3 py-1.5 bg-brand-green hover:bg-brand-green/80 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
                                                    >
                                                        <CheckCircle2 size={12} />Approve &amp; send token
                                                    </button>
                                                    <button
                                                        onClick={() => handleAction(req._id, 'reject')}
                                                        disabled={processingId === req._id}
                                                        className="flex items-center gap-1 px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
                                                    >
                                                        <XCircle size={12} />Reject
                                                    </button>
                                                </div>
                                            )}
                                            {emailPromptId === req._id && (
                                                <div className="w-full max-w-xs space-y-1 text-left">
                                                    <p className="text-xs font-medium text-red-500">No email on this request — enter one before approving</p>
                                                    <input
                                                        type="email"
                                                        value={emailDraft}
                                                        onChange={(event) => setEmailDraft(event.target.value)}
                                                        placeholder="user@example.com"
                                                        className="w-full px-2 py-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs text-zinc-900 dark:text-zinc-50"
                                                    />
                                                    <button
                                                        onClick={() => handleAction(req._id, 'approve', emailDraft)}
                                                        disabled={processingId === req._id || !emailDraft.trim()}
                                                        className="rounded-lg bg-blue-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50"
                                                    >
                                                        Save email &amp; approve
                                                    </button>
                                                </div>
                                            )}
                                            {!revoked && req.status === 'approved' && (
                                                <div className="flex items-center gap-2 flex-wrap justify-center">
                                                    <button
                                                        onClick={() => handleRemoveAccess(req)}
                                                        disabled={processingId === req._id}
                                                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                                                        title="Remove access"
                                                    >
                                                        <Ban size={12} />Remove access
                                                    </button>
                                                    {access?.expiresAt && (
                                                        <>
                                                            <button
                                                                onClick={() => handleExtend(req, 7)}
                                                                disabled={processingId === req._id}
                                                                className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
                                                                title="Extend +7 days"
                                                            >
                                                                <Hourglass size={12} />Extend +7d
                                                            </button>
                                                            <button
                                                                onClick={() => handleExtend(req, 30)}
                                                                disabled={processingId === req._id}
                                                                className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
                                                                title="Extend +30 days"
                                                            >
                                                                <Hourglass size={12} />Extend +30d
                                                            </button>
                                                        </>
                                                    )}
                                                    {req.issuedToken && (
                                                        <button
                                                            onClick={() => void handleResend({
                                                                requestId: req._id,
                                                                token: req.issuedToken!,
                                                                username: req.username,
                                                                deviceId: req.deviceId,
                                                                type: req.type,
                                                                email: req.email ? `${req.email.slice(0, 1)}***@${req.email.split('@')[1] ?? ''}` : '—',
                                                                fullEmail: req.email ?? '',
                                                                emailStatus: req.emailStatus ?? 'none',
                                                                emailError: req.emailError,
                                                            })}
                                                            disabled={processingId === req._id || !req.email}
                                                            className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 disabled:opacity-50"
                                                            title={req.email ? `Resend token email to ${req.email}` : 'No email on this request'}
                                                        >
                                                            <Mail size={12} />Resend email
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                            <button
                                                onClick={() => void handleDelete(req)}
                                                disabled={processingId === req._id}
                                                className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                                                title="Delete request, issued token and pending emails"
                                            >
                                                <Trash2 size={12} />Delete
                                            </button>
                                        </td>
                                    </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
