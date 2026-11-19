import type { MatchData } from '@trophy-games/shared';

/** AI prediction shape shared by the Supabase `ai_prediction` jsonb column and
 * the camelCase response bodies (aiPrediction). Mirrors the Convex
 * aiPrediction field so web response shapes stay identical. */
export type AiPrediction = NonNullable<MatchData['aiPrediction']>;

export type MatchResult = NonNullable<MatchData['result']>;
export type MatchTier = NonNullable<MatchData['matchType']>;
export type MatchOdds = NonNullable<MatchData['odds']>;

/** Raw row shape returned by PostgREST for the `matches` table. */
export interface MatchRow {
    id: string;
    home_team: string;
    away_team: string;
    league: string;
    kickoff: string;
    score: string;
    status: string;
    result: MatchResult | null;
    tier: MatchTier | null;
    odds: MatchOdds | null;
    trending: boolean | null;
    is_history: boolean | null;
    match_date: string | null;
    ai_prediction: AiPrediction | null;
    external_id: string | null;
    details: Record<string, unknown> | null;
}

/**
 * The JSON shape the web API routes return for matches. Same field names as
 * the old Convex docs (`id`, `homeTeam`, `aiPrediction`, `matchType`, ...).
 * `homeScore`/`awayScore` are derived from the `score` column by
 * mapMatch, exactly like a Convex doc carrying explicit score fields.
 * Rich detail fields (homeForm, potentials, ...) live in `details` (no
 * dedicated columns) and are mirrored here for typed access.
 */
export type DbMatch = MatchData & {
    _id: string;
    details?: Record<string, unknown>;
    [key: string]: unknown;
};

/** Partial AI prediction accepted by saveAIPrediction (no generatedAt — the
 * data layer stamps it, mirroring the Convex mutation). */
export type SaveAIPredictionInput = Omit<AiPrediction, 'generatedAt'>;

/** Edit payload accepted by updateMatch (matches the web admin UI form). */
export interface MatchUpdateFields {
    league?: string;
    leagueLogo?: string;
    homeTeam?: string;
    homeTeamLogo?: string;
    awayTeam?: string;
    awayTeamLogo?: string;
    country?: string;
    countryFlag?: string;
    timestamp?: string;
    status?: string;
    score?: string;
    homeScore?: number | null;
    awayScore?: number | null;
    matchType?: MatchTier;
    isTrending?: boolean;
    odds?: { home: string; away: string; draw?: string } | null;
    aiPrediction?: AiPrediction;
    result?: MatchResult;
    isHistory?: boolean;
    matchDate?: string;
}

/** Optional proxy match payload used by updateMatchType/saveAIPrediction. */
export interface ProxyMatchInput {
    id: string;
    league: string;
    leagueId?: number;
    leagueLogo?: string;
    homeTeam: string;
    homeTeamId?: number;
    homeTeamLogo?: string;
    awayTeam: string;
    awayTeamId?: number;
    awayTeamLogo?: string;
    country?: string;
    countryFlag?: string;
    timestamp: string;
    status: string;
    score?: string;
    homeScore?: number;
    awayScore?: number;
    matchType?: MatchTier;
    isTrending?: boolean;
    odds?: { home: string; away: string; draw?: string };
}

/** Input accepted by createMatch (the web admin create flow). */
export interface CreateMatchInput {
    id: string;
    league: string;
    homeTeam: string;
    awayTeam: string;
    timestamp: string;
    status: string;
    score?: string;
    homeScore?: number;
    awayScore?: number;
    leagueLogo?: string;
    homeTeamLogo?: string;
    awayTeamLogo?: string;
    country?: string;
    countryFlag?: string;
    matchType?: MatchTier;
    isTrending?: boolean;
    odds?: { home: string; away: string; draw?: string };
    aiPrediction?: AiPrediction;
}
