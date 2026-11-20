'use client';

import React, { useEffect, useState } from 'react';
import {
    AlertCircle, CheckCircle2, ChevronDown, Crown,
    DollarSign, Filter, Flag, Loader2, Sparkles, Star, X
} from 'lucide-react';
import { MatchData } from '@trophy-games/shared';
import { FixturePicker, toDatetimeLocal } from '@/components/FixturePicker';
import type { ApiFootballFixture } from '@/lib/api-football';
import { cn } from '@/lib/utils';

interface ManualMatchModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    /** When provided the modal edits this match instead of creating a new one. */
    match?: MatchData | null;
    /** Open the fixture picker as soon as the modal opens. */
    openPickerOnStart?: boolean;
}

type MatchType = 'free' | 'paid' | 'vip' | 'unassigned';
type MatchResult = 'pending' | 'win' | 'lose' | 'draw';

interface FormState {
    homeTeam: string;
    awayTeam: string;
    league: string;
    leagueLogo: string;
    homeTeamLogo: string;
    awayTeamLogo: string;
    country: string;
    countryFlag: string;
    timestamp: string;
    status: string;
    homeScore: string;
    awayScore: string;
    matchType: MatchType;
    homeOdds: string;
    drawOdds: string;
    awayOdds: string;
    prediction: string;
    confidence: string;
    suggestedBet: string;
    reasoning: string;
    generatedAt: string;
    isTrending: boolean;
    result: MatchResult;
}

type TextField = Exclude<keyof FormState, 'matchType' | 'isTrending' | 'result'>;

const MATCH_TYPES = [
    { value: 'unassigned', label: 'Unassigned', icon: Filter, color: 'border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-200 bg-zinc-50 dark:bg-zinc-800' },
    { value: 'free', label: 'Free', icon: Star, color: 'border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30' },
    { value: 'paid', label: 'Paid', icon: DollarSign, color: 'border-orange-300 dark:border-orange-700 text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/30' },
    { value: 'vip', label: 'VIP', icon: Crown, color: 'border-purple-300 dark:border-purple-700 text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/30' },
] as const;

const MATCH_RESULTS = [
    { value: 'pending', label: 'Pending' },
    { value: 'win', label: 'Won' },
    { value: 'lose', label: 'Lost' },
    { value: 'draw', label: 'Draw' },
] as const;

const MATCH_STATUSES = [
    'Scheduled', 'Live', 'HT', 'Finished', 'FT', 'Postponed', 'Cancelled', 'Abandoned',
] as const;

const INPUT_CLASS = 'min-h-[48px] w-full rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3.5 py-3 text-sm text-zinc-900 dark:text-zinc-50 placeholder:text-zinc-400 outline-none focus:ring-2 focus:ring-blue-500';
const TEXTAREA_CLASS = cn(INPUT_CLASS, 'min-h-[96px] resize-y leading-relaxed');

const getDefaultTimestamp = (): string => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    return d.toISOString().slice(0, 16);
};

const formFromMatch = (match?: MatchData | null): FormState => ({
    homeTeam: match?.homeTeam ?? '',
    awayTeam: match?.awayTeam ?? '',
    league: match?.league ?? '',
    leagueLogo: match?.leagueLogo ?? '',
    homeTeamLogo: match?.homeTeamLogo ?? '',
    awayTeamLogo: match?.awayTeamLogo ?? '',
    country: match?.country ?? '',
    countryFlag: match?.countryFlag ?? '',
    timestamp: match ? toDatetimeLocal(match.timestamp) : getDefaultTimestamp(),
    status: match?.status ?? 'Scheduled',
    homeScore: match?.homeScore !== undefined ? String(match.homeScore) : '',
    awayScore: match?.awayScore !== undefined ? String(match.awayScore) : '',
    matchType: match?.matchType ?? 'unassigned',
    homeOdds: match?.odds?.home ?? '',
    drawOdds: match?.odds?.draw ?? '',
    awayOdds: match?.odds?.away ?? '',
    prediction: match?.aiPrediction?.prediction ?? '',
    // An empty confidence keeps a match with no AI data "all empty" so the
    // prediction object is omitted instead of being sent with a dummy value.
    confidence: match?.aiPrediction ? String(match.aiPrediction.confidence) : '',
    suggestedBet: match?.aiPrediction?.suggestedBet ?? '',
    reasoning: match?.aiPrediction?.reasoning.join('\n') ?? '',
    generatedAt: match?.aiPrediction?.generatedAt ?? '',
    isTrending: match?.isTrending ?? false,
    result: match?.result ?? 'pending',
});

interface FieldProps {
    label: string;
    htmlFor?: string;
    required?: boolean;
    hint?: string;
    children: React.ReactNode;
}

function Field({ label, htmlFor, required, hint, children }: FieldProps) {
    return (
        <div className="space-y-1.5">
            <label htmlFor={htmlFor} className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {label}{required && <span className="text-red-500"> *</span>}
            </label>
            {children}
            {hint && <p className="text-xs leading-snug text-zinc-500 dark:text-zinc-400">{hint}</p>}
        </div>
    );
}

export function ManualMatchModal({ isOpen, onClose, onSuccess, match, openPickerOnStart }: ManualMatchModalProps) {
    const isEdit = Boolean(match);
    const [form, setForm] = useState<FormState>(() => formFromMatch(match));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [fixturesOpen, setFixturesOpen] = useState(false);

    // The parent remounts this component with a new key whenever the edit
    // target changes, so the initializer always seeds the latest match data.
    useEffect(() => {
        if (!isOpen) return;
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.body.style.overflow = 'hidden';
        window.addEventListener('keydown', handleEsc);
        return () => {
            document.body.style.overflow = 'unset';
            window.removeEventListener('keydown', handleEsc);
        };
    }, [isOpen, onClose]);

    // Close the picker when the modal closes; open it right away when the
    // caller asked for it (e.g. "Add from fixtures" on the matches page).
    // Deferred via microtask to avoid cascading renders inside the effect.
    useEffect(() => {
        queueMicrotask(() => {
            if (isOpen && openPickerOnStart) {
                setFixturesOpen(true);
            } else if (!isOpen) {
                setFixturesOpen(false);
            }
        });
    }, [isOpen, openPickerOnStart]);

    // Picking a fixture prefills the manual fields — teams, league, kickoff
    // time, and the logos/country the API has. The picker closes so the
    // filled fields become visible.
    const handlePickFromFixture = (f: ApiFootballFixture) => {
        setForm(prev => ({
            ...prev,
            homeTeam: f.homeTeam.name.trim(),
            awayTeam: f.awayTeam.name.trim(),
            league: f.league.name.trim(),
            country: f.league.country || prev.country,
            timestamp: toDatetimeLocal(f.date),
            leagueLogo: f.league.logo || '',
            homeTeamLogo: f.homeTeam.logo || '',
            awayTeamLogo: f.awayTeam.logo || '',
        }));
        setFixturesOpen(false);
    };

    const setText = (key: TextField) => (
        e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
    ) => setForm(prev => ({ ...prev, [key]: e.target.value }));

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        // Only these four fields are required; everything else has a default.
        if (!form.homeTeam.trim()) {
            setError('Home team name is required.');
            return;
        }
        if (!form.awayTeam.trim()) {
            setError('Away team name is required.');
            return;
        }
        if (!form.league.trim()) {
            setError('League/competition is required.');
            return;
        }
        if (!form.timestamp) {
            setError('Kickoff date & time is required.');
            return;
        }

        const kickoff = new Date(form.timestamp);
        if (Number.isNaN(kickoff.getTime())) {
            setError('Enter a valid kickoff date & time.');
            return;
        }

        const parseScore = (value: string, label: string): number | null => {
            if (!value.trim()) return null;
            const number = Number(value);
            if (!Number.isInteger(number) || number < 0) {
                setError(`${label} must be a non-negative whole number.`);
                return null;
            }
            return number;
        };
        if (form.homeScore.trim() && parseScore(form.homeScore, 'Home score') === null) return;
        if (form.awayScore.trim() && parseScore(form.awayScore, 'Away score') === null) return;

        const numericConfidence = form.confidence.trim() ? Number(form.confidence) : undefined;
        if (numericConfidence !== undefined &&
            (!Number.isFinite(numericConfidence) || numericConfidence < 1 || numericConfidence > 100)) {
            setError('Confidence must be between 1 and 100.');
            return;
        }

        // The AI prediction uses a 0–100 percentage scale (no conversion).
        // If every prediction field is empty, send no AI keys at all — Convex
        // rejects null for v.optional fields and an omitted key leaves a
        // stored prediction untouched on edit.
        const hasAiInput = Boolean(
            form.prediction.trim() || form.confidence.trim() ||
            form.suggestedBet.trim() || form.reasoning.trim()
        );

        setSaving(true);
        try {
            const res = await fetch('/api/admin/matches', {
                method: isEdit ? 'PUT' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...(isEdit && match ? { matchId: match.id } : {}),
                    homeTeam: form.homeTeam.trim(),
                    awayTeam: form.awayTeam.trim(),
                    league: form.league.trim(),
                    leagueLogo: form.leagueLogo.trim(),
                    homeTeamLogo: form.homeTeamLogo.trim(),
                    awayTeamLogo: form.awayTeamLogo.trim(),
                    country: form.country.trim(),
                    countryFlag: form.countryFlag.trim(),
                    timestamp: kickoff.toISOString(),
                    status: form.status.trim() || 'Scheduled',
                    homeScore: form.homeScore.trim() || null,
                    awayScore: form.awayScore.trim() || null,
                    matchType: form.matchType,
                    homeOdds: form.homeOdds.trim(),
                    drawOdds: form.drawOdds.trim(),
                    awayOdds: form.awayOdds.trim(),
                    isTrending: form.isTrending,
                    result: form.result,
                    ...(hasAiInput ? {
                        prediction: form.prediction.trim(),
                        confidence: numericConfidence ?? '',
                        suggestedBet: form.suggestedBet.trim(),
                        // One point per line; the API drops blank lines.
                        reasoning: form.reasoning,
                        generatedAt: form.generatedAt || undefined,
                    } : {}),
                }),
            });

            const data = await res.json();
            if (!res.ok || data.error) {
                throw new Error(data.error || `Failed to ${isEdit ? 'update' : 'create'} match`);
            }

            setForm(formFromMatch(match));
            onSuccess();
            onClose();
        } catch (err: unknown) {
            setError(err instanceof Error
                ? err.message
                : `An error occurred while ${isEdit ? 'updating' : 'creating'} the match.`);
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
            <div
                className="absolute inset-0 bg-zinc-950/60 backdrop-blur-sm"
                onClick={onClose}
            />

            <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-white shadow-2xl dark:bg-zinc-900 sm:h-auto sm:max-h-[92dvh] sm:max-w-lg sm:rounded-3xl sm:border sm:border-zinc-200 dark:sm:border-zinc-800">
                {/* Header */}
                <div className="flex shrink-0 items-center justify-between border-b border-zinc-100 p-5 dark:border-zinc-800">
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                        <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
                            {isEdit ? 'Edit Match' : 'Add New Match'}
                        </h2>
                        <button
                            type="button"
                            onClick={() => setFixturesOpen(prev => !prev)}
                            aria-pressed={fixturesOpen}
                            className="flex shrink-0 items-center gap-1.5 rounded-xl border border-blue-500/30 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-600 transition-colors hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-400 dark:hover:bg-blue-900"
                        >
                            <Flag size={15} />
                            Pick from fixtures
                        </button>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close"
                        className="min-h-[44px] min-w-[44px] rounded-xl p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSave} className="flex min-h-0 flex-1 flex-col">
                    {/* Fixture picker — shown when the admin opens it from the
                        header button or presses "Pick from fixtures". */}
                    {fixturesOpen && (
                        <div className="max-h-[52vh] shrink-0 overflow-y-auto border-b border-zinc-100 px-5 pb-4 pt-2 dark:border-zinc-800">
                            <FixturePicker onSelect={handlePickFromFixture} />
                        </div>
                    )}

                    {/* Body — the only scrolling region */}
                    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 scrollbar-thin scrollbar-thumb-zinc-200 dark:scrollbar-thumb-zinc-800">
                        {error && (
                            <div className="flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
                                <AlertCircle size={16} className="shrink-0" />
                                <span>{error}</span>
                            </div>
                        )}

                        <Field label="Home Team" htmlFor="match-home" required>
                            <input id="match-home" type="text" value={form.homeTeam} onChange={setText('homeTeam')}
                                placeholder="e.g. Arsenal" className={INPUT_CLASS} />
                        </Field>

                        <Field label="Away Team" htmlFor="match-away" required>
                            <input id="match-away" type="text" value={form.awayTeam} onChange={setText('awayTeam')}
                                placeholder="e.g. Chelsea" className={INPUT_CLASS} />
                        </Field>

                        <Field label="League" htmlFor="match-league" required>
                            <input id="match-league" type="text" value={form.league} onChange={setText('league')}
                                placeholder="e.g. Premier League" className={INPUT_CLASS} />
                        </Field>

                        <Field
                            label="Match Date & Time"
                            htmlFor="match-timestamp"
                            required
                            hint="Completed matches stay in tips on their kick-off date, and appear in Wins once a result is recorded."
                        >
                            <input id="match-timestamp" type="datetime-local" value={form.timestamp} onChange={setText('timestamp')}
                                className={INPUT_CLASS} />
                        </Field>

                        <Field label="Prediction" htmlFor="match-prediction">
                            <textarea id="match-prediction" rows={3} value={form.prediction} onChange={setText('prediction')}
                                placeholder="e.g. Arsenal to win & over 1.5 goals" className={TEXTAREA_CLASS} />
                        </Field>

                        {/* 1X2 odds — always visible, one per row */}
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                                <DollarSign size={15} className="text-blue-600 dark:text-blue-400" />
                                Odds (1X2)
                            </div>
                            <Field label="1 (Home)" htmlFor="match-home-odds">
                                <input id="match-home-odds" type="text" inputMode="decimal" value={form.homeOdds} onChange={setText('homeOdds')}
                                    placeholder="e.g. 1.85" className={INPUT_CLASS} />
                            </Field>
                            <Field label="X (Draw)" htmlFor="match-draw-odds">
                                <input id="match-draw-odds" type="text" inputMode="decimal" value={form.drawOdds} onChange={setText('drawOdds')}
                                    placeholder="e.g. 3.40" className={INPUT_CLASS} />
                            </Field>
                            <Field label="2 (Away)" htmlFor="match-away-odds">
                                <input id="match-away-odds" type="text" inputMode="decimal" value={form.awayOdds} onChange={setText('awayOdds')}
                                    placeholder="e.g. 4.20" className={INPUT_CLASS} />
                            </Field>
                        </div>

                        <Field label="Confidence (%)" htmlFor="match-confidence" hint="0–100 scale, the same percentage shown on tips.">
                            <input id="match-confidence" type="number" min="1" max="100" value={form.confidence} onChange={setText('confidence')}
                                placeholder="75" className={INPUT_CLASS} />
                        </Field>

                        {/* Tier — four explicit buttons matching the schema's four values */}
                        <div className="space-y-2">
                            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                                <Sparkles size={15} className="text-purple-500" />
                                Tier
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                {MATCH_TYPES.map((t) => {
                                    const Icon = t.icon;
                                    const isSelected = form.matchType === t.value;
                                    return (
                                        <button
                                            key={t.value}
                                            type="button"
                                            onClick={() => setForm(prev => ({ ...prev, matchType: t.value }))}
                                            aria-pressed={isSelected}
                                            className={cn(
                                                'flex min-h-[48px] items-center justify-center gap-2 rounded-xl border px-2 text-xs font-semibold transition-colors',
                                                isSelected
                                                    ? cn(t.color, 'ring-2 ring-blue-500')
                                                    : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                                            )}
                                        >
                                            <Icon size={14} />
                                            {t.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <Field label="Reasoning (optional)" htmlFor="match-reasoning" hint="One point per line. Blank lines are ignored.">
                            <textarea id="match-reasoning" rows={4} value={form.reasoning} onChange={setText('reasoning')}
                                placeholder={'Strong recent form\nKey player returning'} className={TEXTAREA_CLASS} />
                        </Field>

                        {/* Everything else that is editable stays here, collapsed by default. */}
                        <details className="group rounded-2xl border border-zinc-200 bg-zinc-50/60 dark:border-zinc-700 dark:bg-zinc-800/40">
                            <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-between px-4 text-sm font-semibold text-zinc-700 dark:text-zinc-200 [&::-webkit-details-marker]:hidden">
                                More options
                                <ChevronDown size={16} className="text-zinc-400 transition-transform group-open:rotate-180" />
                            </summary>
                            <div className="space-y-4 border-t border-zinc-200 px-4 py-4 dark:border-zinc-700">
                                <Field label="Status" htmlFor="match-status">
                                    <select id="match-status" value={form.status} onChange={setText('status')} className={INPUT_CLASS}>
                                        {!MATCH_STATUSES.some(status => status === form.status) && (
                                            <option value={form.status}>{form.status}</option>
                                        )}
                                        {MATCH_STATUSES.map(status => (
                                            <option key={status} value={status}>{status}</option>
                                        ))}
                                    </select>
                                </Field>

                                <Field label="Result" htmlFor="match-result">
                                    <select id="match-result" value={form.result}
                                        onChange={(e) => setForm(prev => ({ ...prev, result: e.target.value as MatchResult }))}
                                        className={INPUT_CLASS}>
                                        {MATCH_RESULTS.map(option => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                </Field>

                                <Field label="Home Score" htmlFor="match-home-score">
                                    <input id="match-home-score" type="number" min="0" value={form.homeScore} onChange={setText('homeScore')}
                                        placeholder="—" className={INPUT_CLASS} />
                                </Field>

                                <Field label="Away Score" htmlFor="match-away-score">
                                    <input id="match-away-score" type="number" min="0" value={form.awayScore} onChange={setText('awayScore')}
                                        placeholder="—" className={INPUT_CLASS} />
                                </Field>

                                <Field label="Suggested Bet (optional)" htmlFor="match-suggested-bet">
                                    <input id="match-suggested-bet" type="text" value={form.suggestedBet} onChange={setText('suggestedBet')}
                                        placeholder="e.g. Over 2.5 Goals @ 1.85" className={INPUT_CLASS} />
                                </Field>

                                <label className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-xl border border-zinc-200 px-3.5 text-sm font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-200">
                                    <input type="checkbox" checked={form.isTrending}
                                        onChange={(e) => setForm(prev => ({ ...prev, isTrending: e.target.checked }))}
                                        className="h-5 w-5 rounded border-zinc-300 accent-blue-600" />
                                    Mark as trending 🔥
                                </label>

                                <Field label="Country" htmlFor="match-country">
                                    <input id="match-country" type="text" value={form.country} onChange={setText('country')}
                                        placeholder="e.g. England" className={INPUT_CLASS} />
                                </Field>

                                <Field label="League Logo URL" htmlFor="match-league-logo">
                                    <input id="match-league-logo" type="text" value={form.leagueLogo} onChange={setText('leagueLogo')}
                                        placeholder="https://..." className={INPUT_CLASS} />
                                </Field>

                                <Field label="Country Flag URL" htmlFor="match-country-flag">
                                    <input id="match-country-flag" type="text" value={form.countryFlag} onChange={setText('countryFlag')}
                                        placeholder="https://..." className={INPUT_CLASS} />
                                </Field>

                                <Field label="Home Team Logo URL" htmlFor="match-home-logo">
                                    <input id="match-home-logo" type="text" value={form.homeTeamLogo} onChange={setText('homeTeamLogo')}
                                        placeholder="https://..." className={INPUT_CLASS} />
                                </Field>

                                <Field label="Away Team Logo URL" htmlFor="match-away-logo">
                                    <input id="match-away-logo" type="text" value={form.awayTeamLogo} onChange={setText('awayTeamLogo')}
                                        placeholder="https://..." className={INPUT_CLASS} />
                                </Field>
                            </div>
                        </details>
                    </div>

                    {/* Footer — outside the scroll region so it is always visible */}
                    <div className="flex shrink-0 items-center gap-3 border-t border-zinc-100 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                        <button type="button" onClick={onClose} disabled={saving}
                            className="min-h-[48px] flex-1 rounded-xl border border-zinc-200 text-sm font-semibold text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
                            Cancel
                        </button>
                        <button type="submit" disabled={saving}
                            className="flex min-h-[48px] flex-[2] items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white shadow-md shadow-blue-500/20 hover:bg-blue-700 disabled:opacity-50">
                            {saving ? (
                                <>
                                    <Loader2 size={16} className="animate-spin" />
                                    Saving...
                                </>
                            ) : (
                                <>
                                    <CheckCircle2 size={16} />
                                    {isEdit ? 'Save Changes' : 'Save Match'}
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
