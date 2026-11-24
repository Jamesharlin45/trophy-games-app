'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { AlertCircle, Flag, Loader2, RefreshCw } from 'lucide-react';
import type { ApiFootballFixture } from '@/lib/api-football';
import { cn } from '@/lib/utils';

// The three dates the fixtures API allows: yesterday, today and tomorrow (UTC).
export function utcDateOffset(offsetDays: number): string {
    const now = new Date();
    return new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays)
    ).toISOString().slice(0, 10);
}

const FIXTURE_DATES = [utcDateOffset(-1), utcDateOffset(0), utcDateOffset(1)];

// datetime-local inputs use local wall-clock time, while stored timestamps
// are ISO UTC strings — convert the fixture kickoff to that shape so callers
// can prefill a form field with it.
export function toDatetimeLocal(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDateLabel(iso: string): string {
    const d = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: '2-digit' });
}

function formatFixtureTime(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return `${d.toLocaleDateString([], { month: 'short', day: '2-digit' })} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

// Controls are 44px+ tall so they stay tappable on phones.
const CONTROL_CLASS =
    'min-h-[44px] w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50';
const LABEL_CLASS = 'block text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400';

interface FixturePickerProps {
    /** Called when the user taps a fixture — prefill the surrounding form. */
    onSelect: (fixture: ApiFootballFixture) => void;
    /** Extra classes on the outer div (e.g. a max-height when embedded in a modal). */
    className?: string;
}

export function FixturePicker({ onSelect, className }: FixturePickerProps) {
    const [date, setDate] = useState(utcDateOffset(0));
    const [fixtures, setFixtures] = useState<ApiFootballFixture[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [leagueFilter, setLeagueFilter] = useState('');
    const [retryTick, setRetryTick] = useState(0);

    // Load fixtures for the selected date. All setState calls happen after
    // awaits, so the effect body starts the async work without synchronous
    // state updates.
    useEffect(() => {
        let cancelled = false;
        async function load() {
            setFixtures([]);
            setLoading(true);
            setError(null);
            try {
                const res = await fetch(`/api/admin/fixtures?date=${encodeURIComponent(date)}`);
                const data = (await res.json()) as { error?: string; fixtures?: ApiFootballFixture[] };
                if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
                if (!cancelled) setFixtures(Array.isArray(data.fixtures) ? data.fixtures : []);
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load fixtures');
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        void load();
        return () => { cancelled = true; };
    }, [date, retryTick]);

    const leagueOptions = useMemo(() => {
        const seen = new Set<string>();
        for (const f of fixtures) seen.add(f.league.name);
        return [...seen];
    }, [fixtures]);

    const visibleFixtures = useMemo(() => {
        const q = search.trim().toLowerCase();
        return fixtures.filter(f => {
            if (leagueFilter && f.league.name !== leagueFilter) return false;
            if (!q) return true;
            return `${f.homeTeam.name} ${f.awayTeam.name} ${f.league.name} ${f.league.country}`.toLowerCase().includes(q);
        });
    }, [fixtures, search, leagueFilter]);

    return (
        <div className={cn('flex flex-col gap-3', className)}>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                <label htmlFor="fixture-date" className={LABEL_CLASS}>Fixture Date</label>
                <select
                    id="fixture-date"
                    value={date}
                    onChange={e => setDate(e.target.value)}
                    className={CONTROL_CLASS}
                >
                    {FIXTURE_DATES.map(d => (
                        <option key={d} value={d}>{formatDateLabel(d)}</option>
                    ))}
                </select>

                <label htmlFor="fixture-league" className={LABEL_CLASS}>League</label>
                <select
                    id="fixture-league"
                    value={leagueFilter}
                    onChange={e => setLeagueFilter(e.target.value)}
                    className={CONTROL_CLASS}
                >
                    <option value="">All Leagues</option>
                    {leagueOptions.map(name => (
                        <option key={name} value={name}>{name}</option>
                    ))}
                </select>

                <label htmlFor="fixture-search" className={LABEL_CLASS}>Search Team or League</label>
                <input
                    id="fixture-search"
                    type="search"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="e.g. Manchester United"
                    className={CONTROL_CLASS}
                />
            </div>

            {error && (
                <div className="flex items-center justify-between gap-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 px-3.5 py-3 text-sm text-red-600 dark:text-red-400">
                    <span className="flex items-center gap-2">
                        <AlertCircle size={16} className="shrink-0" />
                        <span>{error}</span>
                    </span>
                    <button
                        type="button"
                        onClick={() => setRetryTick(t => t + 1)}
                        className="flex shrink-0 items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold transition-colors hover:bg-red-100"
                    >
                        <RefreshCw size={12} />
                        Try again
                    </button>
                </div>
            )}

            {loading && (
                <div className="flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
                    <Loader2 size={16} className="animate-spin" />
                    <span>Loading fixtures…</span>
                </div>
            )}

            {!loading && !error && fixtures.length === 0 && (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    No fixtures found for {formatDateLabel(date)}.
                </p>
            )}

            {!loading && !error && fixtures.length > 0 && visibleFixtures.length === 0 && (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">No matches for your filters.</p>
            )}

            {visibleFixtures.length > 0 && (
                <ul className="space-y-1">
                    {visibleFixtures.map(f => (
                        <li key={f.id}>
                            <button
                                type="button"
                                onClick={() => onSelect(f)}
                                className="flex min-h-[44px] w-full items-center gap-3.5 rounded-xl py-2.5 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                            >
                                {f.league.logo ? (
                                    <Image src={f.league.logo} alt="" width={36} height={36} unoptimized className="h-9 w-9 shrink-0 rounded-md object-contain" />
                                ) : (
                                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-zinc-100 dark:bg-zinc-800">
                                        <Flag size={16} className="text-zinc-400" />
                                    </div>
                                )}
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2.5">
                                        {f.homeTeam.logo ? (
                                            <Image src={f.homeTeam.logo} alt="" width={20} height={20} unoptimized className="h-5 w-5 shrink-0 rounded-full object-contain" />
                                        ) : (
                                            <span className="h-5 w-5 shrink-0 rounded-full bg-zinc-100 dark:bg-zinc-800" />
                                        )}
                                        <span className="truncate font-semibold text-sm text-zinc-900 dark:text-zinc-50">{f.homeTeam.name}</span>
                                        <span className="text-sm text-zinc-300 dark:text-zinc-600">vs</span>
                                        {f.awayTeam.logo ? (
                                            <Image src={f.awayTeam.logo} alt="" width={20} height={20} unoptimized className="h-5 w-5 shrink-0 rounded-full object-contain" />
                                        ) : (
                                            <span className="h-5 w-5 shrink-0 rounded-full bg-zinc-100 dark:bg-zinc-800" />
                                        )}
                                        <span className="truncate font-semibold text-sm text-zinc-900 dark:text-zinc-50">{f.awayTeam.name}</span>
                                    </div>
                                    <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                                        <span className="truncate">{f.league.name}</span>
                                        {f.league.country && <span>· {f.league.country}</span>}
                                        <span>· {formatFixtureTime(f.date)}</span>
                                        {f.status && <span>· {f.status}</span>}
                                    </div>
                                </div>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
