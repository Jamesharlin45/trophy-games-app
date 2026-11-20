/**
 * Server-only helper for the API-Football (v3) predictions endpoint.
 *
 * Base URL: https://v3.football.api-sports.io
 * Header:   x-apisports-key (process.env.API_FOOTBALL_KEY, read server-side only)
 * Endpoint: GET /predictions?fixture=<fixtureId>
 *
 * Like the fixtures endpoint, the API reports failures inside the JSON
 * "errors" field ([] = success) rather than via HTTP status codes, so that
 * field is always checked. The predictions object carries the graded
 * percentages (percent.home / draw / away), advice and the team form stats.
 */

import {
    ApiFootballError,
    getApiFootballKey,
    readApiFootballResponse,
} from './api-football';

const PREDICTIONS_URL = 'https://v3.football.api-sports.io/predictions';

/** Prediction percentages/advice/form extracted from the /predictions response. */
export interface ApiFixturePrediction {
    /** Graded percentages (0-100), as returned by the API. */
    percent?: { home?: number; draw?: number; away?: number };
    /** API advice string (e.g. "Combo Winner : X and Over 2.5 goals"). */
    advice?: string;
    /** Recent form labels (e.g. "WLL") for the home/away team. */
    form?: { home?: string; away?: string };
}

export interface ApiFixturePredictionResult {
    ok: boolean;
    prediction?: ApiFixturePrediction;
    error?: string;
}

function parsePercent(value: unknown): number | undefined {
    if (typeof value !== 'string') return undefined;
    const num = Number(value.replace(/%/g, '').trim());
    return Number.isFinite(num) ? num : undefined;
}

interface RawPredictionResponse {
    errors?: unknown;
    response?: Array<{
        predictions?: {
            winner?: { name?: string };
            advice?: string;
            percent?: { home?: string; draw?: string; away?: string };
        };
        teams?: {
            home?: { last_5?: { form?: string } };
            away?: { last_5?: { form?: string } };
        };
    }>;
}

/** Fetch the API prediction for one fixture. Never throws: failures come
 * back as { ok: false, error } so runs can collect per-fixture errors. */
export async function fetchFixturePrediction(fixtureId: number): Promise<ApiFixturePredictionResult> {
    const key = process.env.API_FOOTBALL_KEY;
    if (!key) return { ok: false, error: 'API_FOOTBALL_KEY is not configured' };

    let res: Response;
    try {
        res = await fetch(`${PREDICTIONS_URL}?fixture=${fixtureId}`, {
            headers: { 'x-apisports-key': key },
        });
    } catch (error) {
        const reason = error instanceof Error ? error.message : 'network error';
        return { ok: false, error: `Failed to reach API-Football: ${reason}` };
    }
    if (!res.ok) {
        return { ok: false, error: `API-Football returned HTTP ${res.status} for fixture ${fixtureId}` };
    }

    let body: RawPredictionResponse;
    try {
        body = await res.json();
    } catch {
        return { ok: false, error: 'API-Football returned an unparseable response' };
    }

    if (Array.isArray(body.errors) && body.errors.length > 0) {
        const messages = body.errors
            .filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
            .map((e) => e.trim());
        return { ok: false, error: messages.length > 0 ? messages.join('; ') : 'API-Football errors' };
    }

    const entry = body.response?.[0];
    const pred = entry?.predictions;
    if (!pred) return { ok: true, prediction: {} };

    const formHome = entry?.teams?.home?.last_5?.form?.trim();
    const formAway = entry?.teams?.away?.last_5?.form?.trim();

    return {
        ok: true,
        prediction: {
            percent: {
                home: parsePercent(pred.percent?.home),
                draw: parsePercent(pred.percent?.draw),
                away: parsePercent(pred.percent?.away),
            },
            advice: typeof pred.advice === 'string' ? pred.advice.trim() : undefined,
            form: {
                home: formHome && formHome.length > 0 ? formHome : undefined,
                away: formAway && formAway.length > 0 ? formAway : undefined,
            },
        },
    };
}
