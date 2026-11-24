'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { TrendingUp, Timer, Zap, CheckCircle2, AlertCircle, Loader2, Search, Filter, Calendar, Crown, DollarSign, Star, RefreshCw, Flame, PlusCircle, Trash2, Pencil, Flag } from 'lucide-react';
import { MatchData } from '@trophy-games/shared';
import { MatchDetailModal } from '@/components/MatchDetailModal';
import { ManualMatchModal } from '@/components/ManualMatchModal';
import { cn } from '@/lib/utils';
import { leagueTier, rankOrInfinity } from '@/lib/trending';

// Win probability implied by the bookmaker odds (from the API), normalised to
// remove the margin so the three outcomes sum to ~100%.
function impliedProbabilities(odds?: { home?: number; draw?: number; away?: number }) {
    if (!odds) return null;
    const h = odds.home ?? 0;
    const d = odds.draw ?? 0;
    const a = odds.away ?? 0;
    if (!(h > 1)) return null;
    const ih = 1 / h;
    const id = d > 1 ? 1 / d : 0;
    const ia = a > 1 ? 1 / a : 0;
    const sum = ih + id + ia;
    if (sum <= 0) return null;
    return {
        home: Math.round((ih / sum) * 100),
        draw: id ? Math.round((id / sum) * 100) : 0,
        away: ia ? Math.round((ia / sum) * 100) : 0,
    };
}

// A match is finished (played) — these can't be tipped; they live in History.
function isFinished(status?: string): boolean {
    const s = (status || '').toLowerCase();
    return s === 'finished' || s === 'ft' || s === 'complete';
}

function isLive(status?: string): boolean {
    const s = (status || '').toLowerCase();
    return s === 'live' || s.includes('half') || /\b\d{1,3}'/.test(status || '') || s.includes('h1') || s.includes('h2');
}

// Coloured status banner so each card's state is obvious at a glance.
function statusBadge(status?: string): { label: string; className: string; dot?: boolean } {
    if (isLive(status)) return { label: 'LIVE', className: 'bg-red-500 text-white', dot: true };
    if (isFinished(status)) return { label: 'FINISHED', className: 'bg-zinc-500 text-white' };
    const s = (status || '').toLowerCase();
    if (s === 'scheduled' || s === 'incomplete') return { label: 'SCHEDULED', className: 'bg-blue-600 text-white' };
    return { label: (status || 'UNKNOWN').toUpperCase(), className: 'bg-amber-500 text-white' };
}


export default function MatchesPage() {
    const [matches, setMatches] = useState<MatchData[]>([]);
    const [loading, setLoading] = useState(true);
    const [updatingId, setUpdatingId] = useState<string | null>(null);
    // Fixture sync state: "Refresh fixtures" and the auto-sync-on-open path
    // both run the same server function (syncFixtures); lastSynced feeds the
    // "Last synced …" label.
    const [lastSynced, setLastSynced] = useState<string | null>(null);
    const [syncing, setSyncing] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    // Stored unpublished fixtures for the selected date ("Fetched fixtures
    // (not published)" section): rows with external_id starting 'af-' and
    // tier 'unassigned' — the set the mobile app excludes.
    const [unpublishedFixtures, setUnpublishedFixtures] = useState<MatchData[]>([]);
    const [syncingFixtures, setSyncingFixtures] = useState(false);
    const [syncMessage, setSyncMessage] = useState<string | null>(null);
    const [syncingResults, setSyncingResults] = useState(false);
    const [resultsMessage, setResultsMessage] = useState<string | null>(null);

    // Read league prefill from URL (client-side, avoid useSearchParams Suspense issue)
    const getPrefillLeague = () => {
        if (typeof window === 'undefined') return '';
        const params = new URLSearchParams(window.location.search);
        return params.get('league') || '';
    };

    // Filter State
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<'All' | 'Live' | 'Scheduled' | 'Finished'>('All');
    const [typeFilter, setTypeFilter] = useState<'All' | 'free' | 'paid' | 'vip' | 'unassigned'>('All');
    const [selectedLeague, setSelectedLeague] = useState(getPrefillLeague() || 'All');
    const [dateFilter, setDateFilter] = useState(new Date().toISOString().split('T')[0]);

    // Modal States
    const [selectedMatch, setSelectedMatch] = useState<MatchData | null>(null);
    const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
    const [isManualModalOpen, setIsManualModalOpen] = useState(false);
    // When the manual modal opens via the "Add from fixtures" button, start
    // with the fixture picker already open inside it.
    const [manualModalOpenPicker, setManualModalOpenPicker] = useState(false);
    const [editingMatch, setEditingMatch] = useState<MatchData | null>(null);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search);
            if (params.get('action') === 'new' || params.get('manual') === 'true') {
                // Defer so the URL-driven open doesn't synchronously trigger a
                // cascading render inside the effect.
                queueMicrotask(() => setIsManualModalOpen(true));
            }
        }
    }, []);

    const fetchMatches = async () => {
        try {
            const res = await fetch('/api/admin/matches');
            const data = await res.json();
            if (Array.isArray(data)) {
                setMatches(data);
            }
        } catch (error) {
            console.error('Failed to fetch matches:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        async function initialize() {
            await fetchMatches();
        }
        void initialize();
    }, []);

    const fetchUnpublishedFixtures = useCallback(async () => {
        try {
            const res = await fetch(`/api/admin/unpublished-fixtures?date=${encodeURIComponent(dateFilter)}`);
            const data = (await res.json()) as MatchData[];
            if (Array.isArray(data)) setUnpublishedFixtures(data);
        } catch (error) {
            console.error('Failed to fetch unpublished fixtures:', error);
        }
    }, [dateFilter]);

    useEffect(() => {
        async function initialize() {
            await fetchUnpublishedFixtures();
        }
        void initialize();
    }, [fetchUnpublishedFixtures]);

    const handleRefresh = async () => {
        setLoading(true);
        await fetchMatches();
    };

    // "Refresh fixtures" — runs the same syncFixtures server function as the
    // cron and the auto-sync path, then refreshes the list from the database.
    const runFixturesSync = async () => {
        if (syncing) return;
        setSyncing(true);
        try {
            const res = await fetch('/api/admin/sync-fixtures');
            const data = (await res.json()) as {
                error?: string;
                lastSyncedAt?: string | null;
            };
            if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
            if (data.lastSyncedAt) setLastSynced(data.lastSyncedAt);
            await fetchMatches();
        } catch (error) {
            setErrorMsg(error instanceof Error ? error.message : 'Fixture sync failed');
        } finally {
            setSyncing(false);
        }
    };

    // Load the last fixture sync time; when the Matches page opens and the
    // last sync is older than 3 hours (or never ran), run syncFixtures in the
    // background — the list refreshes when it finishes.
    useEffect(() => {
        let cancelled = false;
        async function loadLastSynced() {
            let lastSyncedAt: string | null = null;
            try {
                const res = await fetch('/api/admin/sync-status');
                const data = (await res.json()) as { lastSyncedAt?: string | null };
                lastSyncedAt = data.lastSyncedAt ?? null;
            } catch (error) {
                console.error('Failed to read last sync time:', error);
            }
            if (cancelled) return;
            setLastSynced(lastSyncedAt);
            if (!lastSyncedAt || Date.now() - Date.parse(lastSyncedAt) >= 3 * 60 * 60 * 1000) {
                // Background auto-sync, once per page open (no retry loop).
                queueMicrotask(() => { void runFixturesSync(); });
            }
        }
        void loadLastSynced();
        return () => { cancelled = true; };
    }, []);

    const handleDeleteMatch = async (matchId: string) => {
        if (!confirm('Are you sure you want to delete this match?')) return;
        setDeletingId(matchId);
        setErrorMsg(null);
        try {
            const res = await fetch(`/api/admin/matches?id=${encodeURIComponent(matchId)}`, {
                method: 'DELETE',
            });
            const data = await res.json();
            if (!res.ok || data.error) {
                throw new Error(data.error || 'Failed to delete');
            }
            setMatches(prev => prev.filter(m => m.id !== matchId));
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : 'Failed to delete match');
        } finally {
            setDeletingId(null);
        }
    };

    const updateMatchType = async (matchId: string, matchType: 'free' | 'paid' | 'vip' | 'unassigned') => {
        const match = matches.find(m => m.id === matchId) ?? unpublishedFixtures.find(m => m.id === matchId);
        setUpdatingId(matchId);
        setErrorMsg(null);
        try {
            const res = await fetch('/api/admin/match-type', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ matchId, matchType, match })
            });
            const data = await res.json();
            if (!res.ok || data.error) {
                throw new Error(data.error || `HTTP ${res.status}`);
            }
            setMatches(prev => prev.map(m =>
                m.id === matchId ? { ...m, matchType } : m
            ));
            setUnpublishedFixtures(prev => prev.map(m =>
                m.id === matchId ? { ...m, matchType } : m
            ));
        } catch (e) {
            console.error('Update failed', e);
            setErrorMsg(e instanceof Error ? e.message : 'Failed to update match type');
            setTimeout(() => setErrorMsg(null), 4000);
        }
        setUpdatingId(null);
    };

    const handleSyncFixtures = async () => {
        setSyncingFixtures(true);
        setErrorMsg(null);
        setSyncMessage(null);
        try {
            const res = await fetch('/api/admin/sync-fixtures', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ date: dateFilter }),
            });
            const data = (await res.json()) as { error?: string; inserted?: number; updated?: number; skipped?: number };
            if (!res.ok || data.error) {
                throw new Error(data.error || `HTTP ${res.status}`);
            }
            setSyncMessage(`Synced — inserted ${data.inserted ?? 0}, updated ${data.updated ?? 0}, skipped ${data.skipped ?? 0}`);
            await fetchUnpublishedFixtures();
            await fetchMatches();
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : 'Failed to sync fixtures');
        } finally {
            setSyncingFixtures(false);
        }
    };

    const handleSyncResults = async () => {
        setSyncingResults(true);
        setResultsMessage(null);
        setErrorMsg(null);
        try {
            const res = await fetch('/api/admin/sync-results');
            const data = await res.json();
            if (!res.ok || data.error) {
                throw new Error(data.error || `HTTP ${res.status}`);
            }
            setResultsMessage(`Results synced — ${data.updated ?? 0} updated, ${data.finished ?? 0} finished, ${data.voided ?? 0} voided`);
            await fetchMatches();
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : 'Failed to sync results');
        } finally {
            setSyncingResults(false);
        }
    };

    const handleOpenModal = (match: MatchData) => {
        setSelectedMatch(match);
        setIsDetailModalOpen(true);
    };

    // Filter Logic. Finished / history matches are kept in the list so they can
    // still be edited (including reverting their result to pending). Base
    // filter = everything except the match-type filter, so the type-chip
    // counts always agree with the visible list.
    const baseMatches = matches.filter(match => {
        const matchesSearch =
            match.homeTeam.toLowerCase().includes(searchQuery.toLowerCase()) ||
            match.awayTeam.toLowerCase().includes(searchQuery.toLowerCase()) ||
            match.league.toLowerCase().includes(searchQuery.toLowerCase());

        const inHistory = isFinished(match.status) || match.isHistory === true;
        const matchesStatus =
            statusFilter === 'All' ||
            (statusFilter === 'Live' && isLive(match.status)) ||
            (statusFilter === 'Scheduled' && !inHistory && !isLive(match.status)) ||
            (statusFilter === 'Finished' && inHistory);

        const matchesLeague = selectedLeague === 'All' || match.league === selectedLeague;
        const matchesDate = !dateFilter || match.timestamp.includes(dateFilter);

        return matchesSearch && matchesStatus && matchesLeague && matchesDate;
    });

    const filteredMatches = baseMatches.filter(match =>
        typeFilter === 'All'
            ? true
            : typeFilter === 'unassigned'
                ? (!match.matchType || match.matchType === 'unassigned')
                : match.matchType === typeFilter
    );

    const uniqueLeagues = Array.from(new Set(matches.map(m => m.league))).sort();

    const matchTypeCounts = {
        unassigned: baseMatches.filter(m => !m.matchType || m.matchType === 'unassigned').length,
        free: baseMatches.filter(m => m.matchType === 'free').length,
        paid: baseMatches.filter(m => m.matchType === 'paid').length,
        vip: baseMatches.filter(m => m.matchType === 'vip').length,
    };

    // Categorise: matches from globally popular leagues first (by importance,
    // then kickoff time), the rest after.
    const topMatches = filteredMatches
        .filter(m => leagueTier(m.league, m.country) !== null)
        .sort((a, b) =>
            (rankOrInfinity(a.league, a.country) - rankOrInfinity(b.league, b.country)) ||
            (new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
        );
    const otherMatches = filteredMatches.filter(m => leagueTier(m.league, m.country) === null);

    const renderMatchCard = (match: MatchData, i: number) => {
        const aiData = match.aiPrediction;
        const probs = impliedProbabilities(match.odds);
        const finished = isFinished(match.status);
        const sb = statusBadge(match.status);

        return (
            <div
                key={`${match.id}-${i}`}
                className="group overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition-all hover:shadow-md cursor-pointer dark:border-zinc-800 dark:bg-zinc-900/50"
                onClick={() => handleOpenModal(match)}
            >
                {/* Status banner */}
                <div className={cn("flex items-center gap-2 px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest", sb.className)}>
                    {sb.dot && <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />}
                    <Timer size={12} />
                    {sb.label}
                    <span className="ml-auto font-medium normal-case opacity-90">
                        {new Date(match.timestamp).toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                </div>

                <div className="flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x dark:divide-zinc-800">

                    {/* Match Info */}
                    <div className="p-6 md:w-1/3 space-y-4">
                        <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-500">
                            <span>{match.league}</span>
                            <div className="flex items-center gap-2">
                                <span className={cn(
                                    "px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                                    match.matchType === 'vip' ? "bg-purple-500 text-white" :
                                        match.matchType === 'paid' ? "bg-orange-500 text-white" :
                                            match.matchType === 'unassigned' || !match.matchType ? "bg-zinc-500 text-white" :
                                                "bg-blue-500 text-white"
                                )}>
                                    {match.matchType || 'unassigned'}
                                </span>
                                {match.id.startsWith('manual-') && (
                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                                        Manual
                                    </span>
                                )}
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setEditingMatch(match);
                                    }}
                                    title="Edit match"
                                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider text-zinc-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors"
                                >
                                    <Pencil size={11} />
                                    Edit
                                </button>
                                {match.id.startsWith('manual-') && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDeleteMatch(match.id);
                                        }}
                                        disabled={deletingId === match.id}
                                        title="Delete manual match"
                                        className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-950/40 text-zinc-400 hover:text-red-500 transition-colors"
                                    >
                                        <Trash2 size={13} />
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <span className="text-lg font-bold text-zinc-900 dark:text-zinc-50">{match.homeTeam}</span>
                                <span className="text-sm font-mono text-zinc-400">{match.odds?.home || '-'}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-lg font-bold text-zinc-900 dark:text-zinc-50">{match.awayTeam}</span>
                                <span className="text-sm font-mono text-zinc-400">{match.odds?.away || '-'}</span>
                            </div>
                        </div>

                        {/* Match Type Buttons — only for matches that can still be tipped */}
                        {finished ? (
                            <div className="pt-2 text-xs text-zinc-400 italic">
                                Finished — also shown in History. Edit to change the result.
                            </div>
                        ) : (
                            <div className="pt-2">
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); updateMatchType(match.id, 'unassigned'); }}
                                        disabled={updatingId === match.id}
                                        className={cn(
                                            "flex-1 flex items-center justify-center gap-1 rounded-xl py-2 text-[10px] font-semibold transition",
                                            !match.matchType || match.matchType === 'unassigned'
                                                ? "bg-zinc-600 text-white"
                                                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                                        )}
                                    >
                                        <Filter size={10} />
                                        None
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); updateMatchType(match.id, 'free'); }}
                                        disabled={updatingId === match.id}
                                        className={cn(
                                            "flex-1 flex items-center justify-center gap-1 rounded-xl py-2 text-[10px] font-semibold transition",
                                            match.matchType === 'free'
                                                ? "bg-blue-600 text-white"
                                                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-400 hover:bg-blue-100 dark:hover:bg-blue-900"
                                        )}
                                    >
                                        <Star size={10} />
                                        Free
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); updateMatchType(match.id, 'paid'); }}
                                        disabled={updatingId === match.id}
                                        className={cn(
                                            "flex-1 flex items-center justify-center gap-1 rounded-xl py-2 text-[10px] font-semibold transition",
                                            match.matchType === 'paid'
                                                ? "bg-orange-500 text-white"
                                                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-400 hover:bg-orange-100 dark:hover:bg-orange-900"
                                        )}
                                    >
                                        <DollarSign size={10} />
                                        Paid
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); updateMatchType(match.id, 'vip'); }}
                                        disabled={updatingId === match.id}
                                        className={cn(
                                            "flex-1 flex items-center justify-center gap-1 rounded-xl py-2 text-[10px] font-semibold transition",
                                            match.matchType === 'vip'
                                                ? "bg-purple-500 text-white"
                                                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-400 hover:bg-purple-100 dark:hover:bg-purple-900"
                                        )}
                                    >
                                        <Crown size={10} />
                                        VIP
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Insights from the API (odds-implied probabilities + stored AI verdict) */}
                    <div className="p-6 md:flex-1 bg-zinc-50/50 dark:bg-zinc-900/20">
                        {aiData ? (
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
                                        <TrendingUp size={16} className="text-blue-600" />
                                        AI Match Verdict
                                    </h4>
                                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 text-blue-600 text-[10px] font-bold dark:bg-blue-500/10">
                                        {aiData.confidence}% CONFIDENCE
                                    </div>
                                </div>

                                <div className="rounded-xl border border-blue-100 bg-blue-50/30 p-4 dark:border-blue-500/20 dark:bg-blue-500/5">
                                    <p className="text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed font-medium">
                                        {aiData.prediction}
                                    </p>
                                </div>

                                <div className="grid gap-2">
                                    {aiData.reasoning?.map((reason: string, ri: number) => (
                                        <div key={ri} className="flex items-start gap-2 text-xs text-zinc-500">
                                            <CheckCircle2 size={14} className="text-brand-green shrink-0 mt-0.5" />
                                            <span>{reason}</span>
                                        </div>
                                    ))}
                                </div>

                                {aiData.suggestedBet && (
                                    <div className="flex items-center gap-2 mt-2 px-3 py-2 rounded-lg bg-zinc-100 text-zinc-600 text-xs dark:bg-zinc-800 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700">
                                        <AlertCircle size={14} className="text-blue-600" />
                                        <span className="font-bold">Pro Tip:</span>
                                        {aiData.suggestedBet}
                                    </div>
                                )}
                            </div>
                        ) : probs ? (
                            <div className="space-y-4">
                                <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
                                    <TrendingUp size={16} className="text-blue-600" />
                                    Match Insights
                                </h4>
                                <p className="text-xs text-zinc-500">Win probability implied by the bookmaker odds.</p>
                                <div className="space-y-2.5">
                                    {[
                                        { label: match.homeTeam, val: probs.home, color: 'bg-brand-green' },
                                        { label: 'Draw', val: probs.draw, color: 'bg-zinc-400' },
                                        { label: match.awayTeam, val: probs.away, color: 'bg-blue-500' },
                                    ].map((row) => (
                                        <div key={row.label} className="space-y-1">
                                            <div className="flex items-center justify-between text-xs">
                                                <span className="font-medium text-zinc-700 dark:text-zinc-300 truncate pr-2">{row.label}</span>
                                                <span className="font-bold text-zinc-900 dark:text-zinc-50 tabular-nums">{row.val}%</span>
                                            </div>
                                            <div className="h-2 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                                                <div className={cn('h-full rounded-full', row.color)} style={{ width: `${row.val}%` }} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-100 text-zinc-700 text-xs dark:bg-zinc-800 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700">
                                    <CheckCircle2 size={14} className="text-brand-green" />
                                    <span className="font-bold">Favored:</span>
                                    {(() => {
                                        const best = Math.max(probs.home, probs.draw, probs.away);
                                        return best === probs.home ? match.homeTeam : best === probs.away ? match.awayTeam : 'Draw';
                                    })()}
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full text-center space-y-3 text-zinc-400">
                                <div className="h-12 w-12 rounded-full bg-white dark:bg-zinc-800 flex items-center justify-center border border-zinc-100 dark:border-zinc-700">
                                    <Zap size={24} />
                                </div>
                                <p className="text-sm max-w-[200px]">No insights available for this match yet.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="p-8 space-y-8">
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex flex-col gap-2">
                    <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50 tracking-tight">Matches</h1>
                    <p className="text-zinc-500 dark:text-zinc-400">Manage every match — edit teams, scores, status, result and AI predictions. Changes sync to mobile.</p>
                </div>
<<<<<<< HEAD
                <div className="flex flex-wrap gap-2 items-center">
                    {resultsMessage && !syncingResults && (
                        <span className="text-xs text-emerald-600 dark:text-emerald-400">{resultsMessage}</span>
                    )}
                    <button
                        onClick={() => void handleSyncResults()}
                        disabled={syncingResults}
                        className="flex items-center justify-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition-colors text-sm shadow-sm disabled:opacity-50"
                    >
                        <RefreshCw size={16} className={syncingResults ? 'animate-spin' : undefined} />
                        {syncingResults ? 'Syncing...' : 'Refresh results'}
                    </button>
=======
                <div className="flex gap-2 items-center">
>>>>>>> 8aa101d (Automatic fixtures sync)
                    <button
                        onClick={() => setIsManualModalOpen(true)}
                        className="flex items-center justify-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-colors text-sm shadow-sm"
                    >
                        <PlusCircle size={16} />
                        Manual Match
                    </button>
                    <button
<<<<<<< HEAD
                        onClick={() => {
                            setManualModalOpenPicker(true);
                            setIsManualModalOpen(true);
                        }}
                        className="flex items-center justify-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition-colors text-sm shadow-sm"
                    >
                        <Flag size={16} />
                        Add from fixtures
                    </button>
                    <button
                        onClick={handleRefresh}
                        className="flex items-center justify-center gap-1 px-4 py-2 bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-bold rounded-xl transition-colors text-sm"
=======
                        onClick={() => void runFixturesSync()}
                        disabled={syncing}
                        className="flex items-center justify-center gap-1 px-4 py-2 bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 font-bold rounded-xl transition-colors text-sm disabled:opacity-50"
>>>>>>> 8aa101d (Automatic fixtures sync)
                    >
                        <RefreshCw size={16} />
                        {syncing ? 'Syncing…' : 'Refresh fixtures'}
                    </button>
                    {lastSynced && (
                        <span className="text-xs text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                            Last synced {new Date(lastSynced).toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </span>
                    )}
                </div>
            </div>

            {/* Error Toast */}
            {errorMsg && (
                <div className="rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 px-4 py-3 text-sm text-red-600 dark:text-red-400">
                    {errorMsg}
                </div>
            )}

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-zinc-900 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800">
                    <div className="text-2xl font-bold text-zinc-900 dark:text-white">{baseMatches.length}</div>
                    <div className="text-sm text-zinc-500">Total Matches</div>
                </div>
                <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-xl border border-blue-200 dark:border-blue-800">
                    <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{matchTypeCounts.free}</div>
                    <div className="text-sm text-blue-600/70 dark:text-blue-400/70">Free Tips</div>
                </div>
                <div className="bg-orange-50 dark:bg-orange-900/20 p-4 rounded-xl border border-orange-200 dark:border-orange-800">
                    <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">{matchTypeCounts.paid}</div>
                    <div className="text-sm text-orange-600/70 dark:text-orange-400/70">Paid Tips</div>
                </div>
                <div className="bg-purple-50 dark:bg-purple-900/20 p-4 rounded-xl border border-purple-200 dark:border-purple-800">
                    <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">{matchTypeCounts.vip}</div>
                    <div className="text-sm text-purple-600/70 dark:text-purple-400/70">VIP Tips</div>
                </div>
            </div>

            {/* Filter Bar */}
            <div className="flex flex-col gap-3 bg-white dark:bg-zinc-900/50 p-3 md:p-4 rounded-xl md:rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
                <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative w-full sm:w-auto">
                        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                        <input
                            type="date"
                            value={dateFilter}
                            onChange={(e) => setDateFilter(e.target.value)}
                            className="w-full sm:w-36 pl-9 pr-2 py-2 rounded-lg border border-zinc-200 bg-zinc-50/50 focus:ring-2 focus:ring-blue-500 outline-none dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100 text-sm"
                        />
                    </div>

                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                        <input
                            type="text"
                            placeholder="Search teams or leagues..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-9 pr-3 py-2 rounded-lg border border-zinc-200 bg-zinc-50/50 focus:ring-2 focus:ring-blue-500 outline-none dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100 text-sm"
                        />
                    </div>

                    <select
                        value={selectedLeague}
                        onChange={(e) => setSelectedLeague(e.target.value)}
                        className="w-full sm:w-auto px-3 py-2 rounded-lg border border-zinc-200 bg-zinc-50/50 outline-none focus:ring-2 focus:ring-blue-500 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100 text-sm"
                    >
                        <option value="All">All Leagues</option>
                        {uniqueLeagues.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>
                </div>

                <div className="flex gap-1 overflow-x-auto pb-1">
                    {(['All', 'Live', 'Scheduled', 'Finished'] as const).map((s) => (
                        <button
                            key={s}
                            onClick={() => setStatusFilter(s)}
                            className={cn(
                                "flex-none px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap",
                                statusFilter === s
                                    ? "bg-blue-600 text-white"
                                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                            )}
                        >
                            {s}
                        </button>
                    ))}
                </div>
            </div>

            {/* Match Type Filter */}
            <div className="flex flex-wrap gap-2 items-center">
                <span className="text-sm font-medium text-zinc-500">Match Type:</span>
                <div className="flex gap-2">
                    {(['All', 'unassigned', 'free', 'paid', 'vip'] as const).map((type) => (
                        <button
                            key={type}
                            onClick={() => setTypeFilter(type)}
                            className={cn(
                                "px-3 py-1.5 rounded-lg text-xs font-bold transition-all capitalize flex items-center gap-1",
                                typeFilter === type
                                    ? type === 'vip' ? 'bg-purple-500 text-white' : type === 'paid' ? 'bg-orange-500 text-white' : type === 'unassigned' ? 'bg-zinc-500 text-white' : 'bg-blue-500 text-white'
                                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                            )}
                        >
                            {type === 'unassigned' && 'Unassigned'}
                            {type === 'free' && 'Free'}
                            {type === 'paid' && '$ Paid'}
                            {type === 'vip' && '★ VIP'}
                            {type === 'All' && 'All'}
                            {type !== 'All' && matchTypeCounts[type] > 0 && (
                                <span className="ml-1 text-[10px] opacity-70">({matchTypeCounts[type]})</span>
                            )}
                        </button>
                    ))}
                </div>
            </div>

            {/* Fetched fixtures (not published) — stored af-* rows that are
                still tier 'unassigned' (the set the mobile app excludes). */}
            <section className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <Flag size={18} className="text-amber-500" />
                        <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-900 dark:text-zinc-50">Fetched fixtures (not published)</h2>
                        <span className="text-xs text-zinc-400">{unpublishedFixtures.length}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        {syncMessage && !syncingFixtures && (
                            <span className="text-xs text-emerald-600 dark:text-emerald-400">{syncMessage}</span>
                        )}
                        <button
                            onClick={() => void handleSyncFixtures()}
                            disabled={syncingFixtures}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs transition-colors disabled:opacity-50"
                        >
                            <RefreshCw size={14} className={syncingFixtures ? 'animate-spin' : undefined} />
                            {syncingFixtures ? 'Syncing...' : 'Sync fixtures now'}
                        </button>
                    </div>
                </div>
                <p className="text-xs text-zinc-400">
                    Stored fixtures fetched from the API that are not published to the app yet (tier &ldquo;unassigned&rdquo;). Set a tier on each to publish it.
                </p>
                {unpublishedFixtures.length === 0 ? (
                    <p className="text-sm text-zinc-400 italic">No stored fixtures are waiting for this date.</p>
                ) : (
                    <div className="grid gap-3">
                        {unpublishedFixtures.map((m) => (
                            <div key={m.id} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 p-4 space-y-3">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                    <div className="space-y-0.5">
                                        <div className="text-sm font-bold text-zinc-900 dark:text-zinc-50">{m.homeTeam} vs {m.awayTeam}</div>
                                        <div className="text-xs text-zinc-400">{m.league}</div>
                                        <div className="text-xs text-zinc-400">
                                            {new Date(m.timestamp).toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        {(['unassigned', 'free', 'paid', 'vip'] as const).map((type) => (
                                            <button
                                                key={type}
                                                onClick={(e) => { e.stopPropagation(); void updateMatchType(m.id, type); }}
                                                disabled={updatingId === m.id}
                                                className={cn(
                                                    "px-2.5 py-1 rounded-lg text-[10px] font-bold transition",
                                                    (m.matchType ?? 'unassigned') === type
                                                        ? type === 'unassigned' ? 'bg-zinc-600 text-white'
                                                            : type === 'free' ? 'bg-blue-600 text-white'
                                                            : type === 'paid' ? 'bg-orange-500 text-white'
                                                            : 'bg-purple-500 text-white'
                                                        : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                                                )}
                                            >
                                                {type === 'unassigned' ? 'None' : type === 'free' ? 'Free' : type === 'paid' ? 'Paid' : 'VIP'}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {loading ? (
                <div className="flex flex-col items-center justify-center py-20 text-zinc-500 gap-4">
                    <Loader2 className="animate-spin text-blue-600" size={40} />
                    <p className="text-sm font-medium">Loading matches...</p>
                </div>
            ) : matches.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 text-zinc-500 gap-6 border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-3xl bg-zinc-50/50 dark:bg-zinc-900/20">
                    <div className="h-16 w-16 rounded-full bg-white dark:bg-zinc-800 flex items-center justify-center shadow-sm border border-zinc-100 dark:border-zinc-700">
                        <Zap size={32} className="text-zinc-300" />
                    </div>
                    <div className="text-center space-y-1">
                        <p className="text-lg font-bold text-zinc-900 dark:text-zinc-50">No matches available</p>
                        <p className="text-sm max-w-[280px] mx-auto text-zinc-500">There are no matches in the data feed right now. Pull to refresh later.</p>
                    </div>
                </div>
            ) : filteredMatches.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 text-zinc-500 gap-6 border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-3xl bg-zinc-50/50 dark:bg-zinc-900/20">
                    <div className="h-16 w-16 rounded-full bg-white dark:bg-zinc-800 flex items-center justify-center shadow-sm border border-zinc-100 dark:border-zinc-700">
                        <Filter size={32} className="text-zinc-300" />
                    </div>
                    <div className="text-center space-y-1">
                        <p className="text-lg font-bold text-zinc-900 dark:text-zinc-50">No matching matches</p>
                        <p className="text-sm max-w-[280px] mx-auto text-zinc-500">Adjust your filters to find the matches you are looking for.</p>
                    </div>
                </div>
            ) : (
                <div className="space-y-8">
                    {topMatches.length > 0 && (
                        <section className="space-y-4">
                            <div className="flex items-center gap-2">
                                <Flame size={18} className="text-orange-500" />
                                <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-900 dark:text-zinc-50">Top Matches</h2>
                                <span className="text-xs text-zinc-400">{topMatches.length}</span>
                            </div>
                            <div className="grid gap-6 overflow-hidden">
                                {topMatches.map((m, i) => renderMatchCard(m, i))}
                            </div>
                        </section>
                    )}

                    {otherMatches.length > 0 && (
                        <section className="space-y-4">
                            <div className="flex items-center gap-2">
                                <Filter size={18} className="text-zinc-400" />
                                <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-500">All Other Matches</h2>
                                <span className="text-xs text-zinc-400">{otherMatches.length}</span>
                            </div>
                            <div className="grid gap-6 overflow-hidden">
                                {otherMatches.map((m, i) => renderMatchCard(m, i))}
                            </div>
                        </section>
                    )}
                </div>
            )}

            {/* Manual Match Creation Modal */}
            <ManualMatchModal
                isOpen={isManualModalOpen}
                openPickerOnStart={manualModalOpenPicker}
                onClose={() => {
                    setIsManualModalOpen(false);
                    setManualModalOpenPicker(false);
                }}
                onSuccess={fetchMatches}
            />

            {/* Edit Match Modal — the same form prefilled with the selected match.
                The key remounts the form whenever the edit target changes. */}
            <ManualMatchModal
                key={editingMatch ? `edit-${editingMatch.id}-${editingMatch.updatedAt ?? ''}` : 'edit-none'}
                isOpen={editingMatch !== null}
                match={editingMatch}
                onClose={() => setEditingMatch(null)}
                onSuccess={fetchMatches}
            />

            {/* Detail Modal */}
            <MatchDetailModal
                isOpen={isDetailModalOpen}
                onClose={() => setIsDetailModalOpen(false)}
                match={selectedMatch}
            />
        </div>
    );
}
