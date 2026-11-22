'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Key, Plus, RotateCcw, RefreshCw, CheckCircle2, XCircle, Crown, DollarSign, Ban, Hourglass, Mail, Send, AlertTriangle, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn, daysLeftLabel } from '@/lib/utils';
import { getDeviceDisplayCode, isLegacyDeviceId } from '@/lib/device-id';

interface TokenEmailStatus {
    status: 'pending' | 'sent' | 'failed' | 'none';
    lastError?: string;
}

interface Token {
    _id: string;
    token: string;
    deviceId: string;
    username?: string;
    type: 'vip' | 'paid';
    matchId?: string;
    createdAt: string;
    expiresAt?: string;
    isActive: boolean;
    /** Set when the access was removed via "Remove access" (or by the cron
     * when it marked the grant expired). */
    revokedAt?: string;
    /** Prefilled from the originating purchase or manual request. */
    email?: string;
    emailMasked?: string;
    emailStatus: TokenEmailStatus;
}

interface EmailStatusData {
    pending: number;
    sent: number;
    failed: number;
    lastErrors: string[];
    config: Record<'SMTP_HOST' | 'SMTP_PORT' | 'SMTP_USER' | 'SMTP_PASS' | 'MAIL_FROM', boolean>;
}

interface LegacyStats {
    tokens: number;
    purchases: number;
    requests: number;
    users: number;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AdminTokensPage() {
    const [tokens, setTokens] = useState<Token[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [form, setForm] = useState({ deviceId: '', username: '', type: 'vip' as 'vip' | 'paid', matchId: '', expiresAt: '' });
    const [showForm, setShowForm] = useState(false);
    const [copiedToken, setCopiedToken] = useState<string | null>(null);
    const [busyToken, setBusyToken] = useState<string | null>(null);
    const [emailStatus, setEmailStatus] = useState<EmailStatusData | null>(null);
    const [testEmail, setTestEmail] = useState('');
    const [sendingTest, setSendingTest] = useState(false);
    const [emailTarget, setEmailTarget] = useState<Token | null>(null);
    const [emailDraft, setEmailDraft] = useState('');
    const [sendingEmail, setSendingEmail] = useState(false);
    const [legacyStats, setLegacyStats] = useState<LegacyStats | null>(null);
    const [deletingToken, setDeletingToken] = useState<string | null>(null);

    const loadEmailStatus = useCallback(async () => {
        try {
            const res = await fetch('/api/admin/email-status');
            if (res.ok) setEmailStatus((await res.json()) as EmailStatusData);
        } catch {
            // The card simply shows its previous state; tokens still load.
        }
    }, []);

    const loadTokens = useCallback(async () => {
        try {
            const res = await fetch('/api/admin/tokens');
            if (!res.ok) {
                const data = (await res.json().catch(() => null)) as { error?: string } | null;
                toast.error(data?.error || 'Failed to load tokens');
                return;
            }
            const data = await res.json();
            setTokens(Array.isArray(data) ? data : []);
        } catch (e) {
            console.error(e);
            toast.error('Failed to load tokens');
        } finally {
            setLoading(false);
        }
    }, []);

    const loadLegacyStats = useCallback(async () => {
        try {
            const res = await fetch('/api/admin/legacy-stats');
            if (res.ok) setLegacyStats((await res.json()) as LegacyStats);
        } catch {
            // The counters are informational; token management still works.
        }
    }, []);

    useEffect(() => {
        async function initialize() {
            await Promise.all([loadTokens(), loadEmailStatus(), loadLegacyStats()]);
        }
        void initialize();
    }, [loadTokens, loadEmailStatus, loadLegacyStats]);

    const createToken = async () => {
        if (!form.deviceId) return;
        setCreating(true);
        try {
            const res = await fetch('/api/admin/tokens', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    deviceId: form.deviceId,
                    username: form.username || undefined,
                    type: form.type,
                    matchId: form.matchId || undefined,
                    expiresAt: form.expiresAt || undefined,
                }),
            });
            const data = await res.json();
            if (data.token) {
                toast.success('Token generated successfully!');
                copyToClipboard(data.token);
                await loadTokens();
                setShowForm(false);
                setForm({ deviceId: '', username: '', type: 'vip', matchId: '', expiresAt: '' });
            } else {
                toast.error(data.error || 'Failed to generate token');
            }
        } catch (e) {
            console.error(e);
            toast.error('Failed to generate token');
        }
        setCreating(false);
    };

    // "Remove access": deactivate the token (with confirmation) so the user
    // loses VIP/Paid on their next app refresh. The list is reloaded from the
    // server after the call so the real status is shown — never a local guess.
    const removeAccess = async (token: Token) => {
        if (!window.confirm(`Remove access for ${token.deviceId} (${token.type})? The user will lose access on their next app refresh.`)) return;
        setBusyToken(token.token);
        try {
            const res = await fetch('/api/admin/tokens', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: token.token }),
            });
            const data = (await res.json().catch(() => null)) as { error?: string } | null;
            if (!res.ok || data?.error) throw new Error(data?.error || 'Failed to remove access');
            await loadTokens();
            toast.success('Access removed');
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Failed to remove access');
        } finally {
            setBusyToken(null);
        }
    };

    // Hard delete: the token row and its pending emails are removed from the
    // database. A purchase-backed token revokes (but keeps) the payment row so
    // app restore cannot re-grant access. The list is reloaded from the server.
    const deleteToken = async (token: Token) => {
        const message =
            `Permanently delete the ${token.type.toUpperCase()} token for ${token.username || 'this user'}? ` +
            'This deletes the token and its pending token emails. ' +
            'If it came from a purchase, the payment record is kept but marked revoked. This cannot be undone.';
        if (!window.confirm(message)) return;
        setDeletingToken(token.token);
        try {
            const res = await fetch('/api/admin/tokens', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: token.token, hard: true }),
            });
            const data = (await res.json().catch(() => null)) as {
                error?: string;
                deletedOutbox?: number;
                revokedPurchases?: number;
            } | null;
            if (!res.ok || data?.error) throw new Error(data?.error || 'Failed to delete token');
            await Promise.all([loadTokens(), loadLegacyStats()]);
            toast.success(
                `Token deleted (${data?.deletedOutbox ?? 0} pending emails removed${data?.revokedPurchases ? `, ${data.revokedPurchases} purchase revoked` : ''})`,
            );
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Failed to delete token');
        } finally {
            setDeletingToken(null);
        }
    };

    const reactivateToken = async (token: string) => {
        setBusyToken(token);
        try {
            const res = await fetch('/api/admin/tokens', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token }),
            });
            const data = (await res.json().catch(() => null)) as { error?: string } | null;
            if (!res.ok || data?.error) throw new Error(data?.error || 'Failed to reactivate token');
            await loadTokens();
            toast.success('Token reactivated successfully');
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Failed to reactivate token');
        } finally {
            setBusyToken(null);
        }
    };

    // "Extend": +7 or +30 days from now on the token's expiry. The list is
    // reloaded from the server after the call so the real expiry shows.
    const extendTokenDays = async (token: Token, days: 7 | 30) => {
        setBusyToken(token.token);
        try {
            const res = await fetch('/api/admin/tokens/extend', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: token.token, days }),
            });
            const data = (await res.json().catch(() => null)) as { error?: string; success?: boolean; expiresAt?: string } | null;
            if (!res.ok || !data?.success || !data.expiresAt) throw new Error(data?.error || 'Failed to extend');
            await loadTokens();
            toast.success(`Extended to ${new Date(data.expiresAt).toLocaleDateString()}`);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Failed to extend token');
        } finally {
            setBusyToken(null);
        }
    };

    const openEmailDialog = (token: Token) => {
        setEmailTarget(token);
        setEmailDraft(token.email ?? '');
    };

    const submitTokenEmail = async () => {
        if (!emailTarget) return;
        if (!EMAIL_PATTERN.test(emailDraft.trim())) {
            toast.error('Enter a valid email address');
            return;
        }
        setSendingEmail(true);
        try {
            const res = await fetch('/api/admin/tokens/email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: emailTarget.token, email: emailDraft.trim() }),
            });
            const data = (await res.json().catch(() => null)) as {
                error?: string;
                emailStatus?: 'sent' | 'queued' | 'failed';
                emailError?: string;
                email?: string;
            } | null;
            if (!res.ok || data?.error) {
                throw new Error(data?.emailError || data?.error || 'Failed to send email');
            }
            toast.success(`Email ${data?.emailStatus ?? 'queued'}${data?.email ? ` to ${data.email}` : ''}`);
            setEmailTarget(null);
            await Promise.all([loadTokens(), loadEmailStatus()]);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Failed to send email');
        } finally {
            setSendingEmail(false);
        }
    };

    const sendTestEmail = async () => {
        if (!EMAIL_PATTERN.test(testEmail.trim())) {
            toast.error('Enter a valid email address');
            return;
        }
        setSendingTest(true);
        try {
            const res = await fetch('/api/admin/email-test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to: testEmail.trim() }),
            });
            const data = (await res.json().catch(() => null)) as { error?: string } | null;
            if (!res.ok || data?.error) throw new Error(data?.error || 'Test email failed');
            toast.success('Test email sent');
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Test email failed');
        } finally {
            setSendingTest(false);
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text).catch(() => { });
        setCopiedToken(text);
        toast.info('Token copied to clipboard');
        setTimeout(() => setCopiedToken(null), 2000);
    };

    const isExpired = (expiresAt?: string) => expiresAt && new Date(expiresAt) < new Date();

    return (
        <div className="p-4 md:p-6 lg:p-8 space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-zinc-900 dark:text-zinc-50 tracking-tight">Access Tokens</h1>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Generate and manage VIP & Paid access tokens for users.</p>
                </div>
                <div className="flex gap-2">
                    <button onClick={() => { setLoading(true); void Promise.all([loadTokens(), loadEmailStatus(), loadLegacyStats()]); }} className="flex items-center gap-2 px-3 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-medium rounded-xl transition-colors text-sm">
                        <RefreshCw size={14} />
                    </button>
                    <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors text-sm">
                        <Plus size={16} />Generate Token
                    </button>
                </div>
            </div>

            {/* Legacy device migration counters. */}
            <div className="rounded-xl border border-orange-200 dark:border-orange-900 bg-orange-50/60 dark:bg-orange-950/20 p-5 space-y-2">
                <h2 className="font-semibold text-zinc-900 dark:text-zinc-50 text-sm">Legacy device ids still in use</h2>
                {legacyStats ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                        {([
                            ['Tokens', legacyStats.tokens],
                            ['Purchases', legacyStats.purchases],
                            ['Requests', legacyStats.requests],
                            ['Users', legacyStats.users],
                        ] as Array<[string, number]>).map(([label, count]) => (
                            <div key={label} className="rounded-lg bg-white dark:bg-zinc-900/70 p-3">
                                <div className="text-xs text-zinc-500">{label}</div>
                                <div className="text-xl font-bold text-orange-600 dark:text-orange-400">{count}</div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-sm text-zinc-400">Loading legacy counts...</div>
                )}
            </div>

            {/* Email delivery diagnostics. Counts and error text only — never credentials. */}
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-4">
                <div className="flex items-center gap-2">
                    <Mail size={16} className="text-blue-500" />
                    <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">Email status</h2>
                </div>
                {emailStatus ? (
                    <>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/60 p-3">
                                <div className="text-xs text-zinc-500">Pending</div>
                                <div className="text-xl font-bold text-zinc-900 dark:text-zinc-50">{emailStatus.pending}</div>
                            </div>
                            <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/60 p-3">
                                <div className="text-xs text-zinc-500">Sent</div>
                                <div className="text-xl font-bold text-brand-green">{emailStatus.sent}</div>
                            </div>
                            <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/60 p-3">
                                <div className="text-xs text-zinc-500">Failed</div>
                                <div className="text-xl font-bold text-red-500">{emailStatus.failed}</div>
                            </div>
                            <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/60 p-3">
                                <div className="text-xs text-zinc-500">SMTP configured</div>
                                <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-zinc-500">
                                    {Object.entries(emailStatus.config).map(([name, set]) => (
                                        <span key={name} className={set ? 'text-brand-green' : 'text-red-500'}>
                                            {name} {set ? '✓' : '✗'}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </div>
                        {emailStatus.lastErrors.length > 0 && (
                            <div className="space-y-1">
                                <div className="text-xs font-medium text-zinc-500">Last 5 errors</div>
                                {emailStatus.lastErrors.map((error, i) => (
                                    <div key={i} className="flex items-start gap-2 text-xs text-red-500 break-words">
                                        <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                                        <span>{error}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                ) : (
                    <div className="text-sm text-zinc-400">Loading email status...</div>
                )}
                <div className="flex flex-col sm:flex-row gap-2">
                    <input
                        type="email"
                        value={testEmail}
                        onChange={(e) => setTestEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="flex-1 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-zinc-900 dark:text-zinc-50 outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                        onClick={() => void sendTestEmail()}
                        disabled={sendingTest || !EMAIL_PATTERN.test(testEmail.trim())}
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-xl text-sm transition-colors"
                    >
                        <Send size={14} />{sendingTest ? 'Sending...' : 'Send test email'}
                    </button>
                </div>
            </div>

            {showForm && (
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-4">
                    <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">New Access Token</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">Device ID *</label>
                            <input
                                value={form.deviceId}
                                onChange={e => setForm(f => ({ ...f, deviceId: e.target.value }))}
                                placeholder="User device identifier"
                                className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-zinc-900 dark:text-zinc-50 outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">Username (optional)</label>
                            <input
                                value={form.username}
                                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                                placeholder="Bind token to username"
                                className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-zinc-900 dark:text-zinc-50 outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">Access Type *</label>
                            <select
                                value={form.type}
                                onChange={e => setForm(f => ({ ...f, type: e.target.value as 'vip' | 'paid' }))}
                                className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-zinc-900 dark:text-zinc-50 outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="vip">VIP Access</option>
                                <option value="paid">Paid Access</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">Match ID (optional — leave blank for all matches)</label>
                            <input
                                value={form.matchId}
                                onChange={e => setForm(f => ({ ...f, matchId: e.target.value }))}
                                placeholder="e.g. odds_abc123 (leave blank for all)"
                                className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-zinc-900 dark:text-zinc-50 outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">Expires At (optional)</label>
                            <input
                                type="datetime-local"
                                value={form.expiresAt}
                                onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))}
                                className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-zinc-900 dark:text-zinc-50 outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                    </div>
                    <div className="flex gap-3 pt-2">
                        <button onClick={createToken} disabled={creating || !form.deviceId} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-xl text-sm transition-colors">
                            <Key size={14} />{creating ? 'Generating...' : 'Generate & Copy Token'}
                        </button>
                        <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-medium rounded-xl text-sm transition-colors">
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 overflow-hidden">
                {loading ? (
                    <div className="p-12 text-center text-zinc-400">Loading tokens...</div>
                ) : tokens.length === 0 ? (
                    <div className="p-12 text-center text-zinc-400">No tokens generated yet.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-zinc-50 dark:bg-zinc-800/60 text-xs text-zinc-500 dark:text-zinc-400 font-medium">
                                <tr>
                                    <th className="px-4 py-3">Token</th>
                                    <th className="px-4 py-3">User/Device</th>
                                    <th className="px-4 py-3 text-center">Type</th>
                                    <th className="px-4 py-3">Match ID</th>
                                    <th className="px-4 py-3">Created</th>
                                    <th className="px-4 py-3">Expires</th>
                                    <th className="px-4 py-3 text-center">Email</th>
                                    <th className="px-4 py-3 text-center">Status</th>
                                    <th className="px-4 py-3 text-center">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                {tokens.map(token => (
                                    <tr key={token._id} className={`hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors ${!token.isActive ? 'opacity-50' : ''}`}>
                                        <td className="px-4 py-3">
                                            <button
                                                onClick={() => copyToClipboard(token.token)}
                                                className="font-mono text-xs bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                                                title="Click to copy"
                                            >
                                                {copiedToken === token.token ? '✓ Copied' : token.token}
                                            </button>
                                        </td>
                                        <td className="px-4 py-3 max-w-32 truncate">
                                            <div className="font-medium text-zinc-900 dark:text-zinc-100">{token.username || 'Anonymous'}</div>
                                            <button
                                                onClick={() => navigator.clipboard.writeText(token.deviceId).catch(() => { })}
                                                title="Copy full device id"
                                                className="font-mono text-xs text-zinc-500 dark:text-zinc-500 mt-0.5 hover:text-blue-600"
                                            >
                                                {getDeviceDisplayCode(token.deviceId)}
                                            </button>
                                            {isLegacyDeviceId(token.deviceId) && (
                                                <span className="ml-2 rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">LEGACY</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${token.type === 'vip' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'}`}>
                                                {token.type === 'vip' ? <Crown size={10} /> : <DollarSign size={10} />}
                                                {token.type.toUpperCase()}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-xs text-zinc-500 max-w-32 truncate">{token.matchId || 'All matches'}</td>
                                        <td className="px-4 py-3 text-xs text-zinc-500 whitespace-nowrap">{new Date(token.createdAt).toLocaleDateString()}</td>
                                        <td className="px-4 py-3 text-xs text-zinc-500 whitespace-nowrap">
                                            {token.expiresAt
                                                ? <span>{new Date(token.expiresAt).toLocaleDateString()} <span className={cn(isExpired(token.expiresAt) ? 'text-red-500' : 'text-zinc-400')}>({daysLeftLabel(token.expiresAt)})</span></span>
                                                : 'Never'
                                            }
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            {token.emailStatus.status === 'sent'
                                                ? <span className="inline-flex items-center gap-1 text-xs text-brand-green" title={token.emailMasked}><CheckCircle2 size={12} />Sent{token.emailMasked ? ` to ${token.emailMasked}` : ''}</span>
                                                : token.emailStatus.status === 'pending'
                                                    ? <span className="inline-flex items-center gap-1 text-xs text-orange-500" title={token.emailStatus.lastError || token.emailMasked}><Hourglass size={12} />Queued</span>
                                                    : token.emailStatus.status === 'failed'
                                                        ? <span className="inline-flex items-center gap-1 text-xs text-red-500" title={token.emailStatus.lastError || 'Email failed'}><XCircle size={12} />Failed{token.emailStatus.lastError ? ` — ${token.emailStatus.lastError}` : ''}</span>
                                                        : <span className="text-xs text-zinc-400">None</span>}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            {token.revokedAt
                                                ? <span className="inline-flex items-center gap-1 text-xs text-red-500"><Ban size={12} />Revoked</span>
                                                : token.isActive && !isExpired(token.expiresAt)
                                                    ? <span className="inline-flex items-center gap-1 text-xs text-brand-green"><CheckCircle2 size={12} />Active</span>
                                                    : <span className="inline-flex items-center gap-1 text-xs text-zinc-400"><XCircle size={12} />Inactive</span>
                                            }
                                        </td>
                                        <td className="px-4 py-3 text-center flex justify-center gap-2 flex-wrap">
                                            {token.revokedAt ? null : !token.isActive ? (
                                                <button onClick={() => reactivateToken(token.token)} disabled={busyToken === token.token} className="p-1.5 text-blue-500 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors disabled:opacity-50" title="Reactivate">
                                                    <RotateCcw size={16} />
                                                </button>
                                            ) : (
                                                <>
                                                    <button
                                                        onClick={() => openEmailDialog(token)}
                                                        disabled={busyToken === token.token}
                                                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors disabled:opacity-50"
                                                        title={token.email ? `Email ${token.email}` : 'Send token by email'}
                                                    >
                                                        <Mail size={12} />{token.emailStatus.status === 'sent' ? 'Resend' : 'Send token by email'}
                                                    </button>
                                                    <button onClick={() => removeAccess(token)} disabled={busyToken === token.token} className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50" title="Remove access">
                                                        <Ban size={12} />Remove access
                                                    </button>
                                                    <button onClick={() => extendTokenDays(token, 7)} disabled={busyToken === token.token} className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50" title="Extend +7 days">
                                                        <Hourglass size={12} />Extend +7d
                                                    </button>
                                                    <button onClick={() => extendTokenDays(token, 30)} disabled={busyToken === token.token} className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50" title="Extend +30 days">
                                                        <Hourglass size={12} />Extend +30d
                                                    </button>
                                                </>
                                            )}
                                            <button
                                                onClick={() => void deleteToken(token)}
                                                disabled={deletingToken === token.token || busyToken === token.token}
                                                className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                                                title="Permanently delete this token and its pending emails"
                                            >
                                                <Trash2 size={12} />Delete
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {emailTarget && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
                    <div className="w-full max-w-md rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-6 space-y-4">
                        <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">
                            {emailTarget.emailStatus.status === 'sent' ? 'Resend token email' : 'Send token by email'}
                        </h2>
                        <p className="text-xs text-zinc-500 break-all">Token: {emailTarget.username || emailTarget.deviceId} ({emailTarget.type.toUpperCase()})</p>
                        <div>
                            <label className="block text-xs font-medium text-zinc-500 mb-1">Email address</label>
                            <input
                                type="email"
                                value={emailDraft}
                                onChange={(e) => setEmailDraft(e.target.value)}
                                placeholder="you@example.com"
                                autoFocus
                                className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-zinc-900 dark:text-zinc-50 outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div className="flex gap-3">
                            <button
                                onClick={() => void submitTokenEmail()}
                                disabled={sendingEmail || !EMAIL_PATTERN.test(emailDraft.trim())}
                                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-xl text-sm"
                            >
                                <Send size={14} />{sendingEmail ? 'Sending...' : 'Send now'}
                            </button>
                            <button
                                onClick={() => setEmailTarget(null)}
                                className="px-4 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-medium rounded-xl text-sm"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
