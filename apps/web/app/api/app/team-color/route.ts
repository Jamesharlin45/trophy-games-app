/**
 * GET /api/app/team-color?url=<crest url>
 *
 * Computes the dominant colour of a team crest served by the app's existing
 * crest hosts. The host allow-list is the SSRF guard: every crest URL the app
 * uses comes from one of these hosts.
 *
 * Dominant colour = saturation-weighted average over the centre of the
 * image, ignoring transparent, near-white, near-black and grey pixels.
 * Result: { hex } with a long cache lifetime.
 */

import { NextResponse } from 'next/server';

/** Hosts that can legitimately serve team crests to this app. */
const ALLOWED_HOSTS = new Set([
  'cdn.footystats.org', // FootyStats CDN (match-stats logos)
  'media.api-sports.io', // API-Football CDN (admin-picked team logos)
  'us3.bot-hosting.net', // FootyStats proxy (matches by-id)
]);

const MAX_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 5000;
const CENTER_SIZE = 64;

export const dynamic = 'force-dynamic';

function toHex(r: number, g: number, b: number): string {
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function isAllowedCrestUrl(input: string): URL | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) return null;
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  return url;
}

/**
 * Dominant colour of the image at `buffer`, or null when there is no
 * colourful pixel. Sharp decodes/resizes in C++ — cheap on mid-range phones
 * is not the goal here; the server side is fine with this.
 */
async function dominantColor(buffer: Buffer): Promise<string | null> {
  try {
    // Load the native module only when this endpoint is actually called. It
    // has no prebuilt binary for every host OS, and an eager top-level import
    // makes `next build` fail while collecting page data on those platforms.
    const { default: sharp } = await import('sharp');
    const { data, info } = await sharp(buffer)
      .resize(CENTER_SIZE, CENTER_SIZE, { fit: 'fill', withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const channels = info.channels;
    const pixelCount = info.width * info.height;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let sumWeight = 0;
    // Sample every Nth pixel to bound work without changing the result
    // meaningfully (weighted average is invariant to stride for stationary signals).
    const stride = Math.max(1, Math.ceil(pixelCount / 4096));

    for (let i = 0; i < pixelCount; i += stride) {
      const idx = i * channels;
      const r = data[idx]!;
      const g = data[idx + 1]!;
      const b = data[idx + 2]!;
      const alpha = channels > 3 ? data[idx + 3]! : 255;
      if (alpha < 128) continue; // ignore transparent
      const luma = 0.2126 * (r / 255) + 0.7152 * (g / 255) + 0.0722 * (b / 255);
      if (luma > 0.96 || luma < 0.05) continue; // near-white / near-black
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const saturation = max === 0 ? 0 : (max - min) / max;
      if (saturation < 0.08) continue; // grey
      const weight = Math.pow(saturation, 1.5);
      sumR += r * weight;
      sumG += g * weight;
      sumB += b * weight;
      sumWeight += weight;
    }

    if (sumWeight <= 0) return null;
    return toHex(Math.round(sumR / sumWeight), Math.round(sumG / sumWeight), Math.round(sumB / sumWeight));
  } catch {
    return null;
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const crestUrl = searchParams.get('url');
  if (!crestUrl) {
    return NextResponse.json({ error: 'url is required' }, { status: 400 });
  }

  const target = isAllowedCrestUrl(crestUrl);
  if (!target) {
    return NextResponse.json({ error: 'crest URL host is not allowed' }, { status: 403 });
  }

  let arrayBuffer: ArrayBuffer;
  try {
    const response = await fetch(target, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
      headers: { accept: 'image/*,*/*' },
    });
    if (response.redirected) {
      const finalUrl = isAllowedCrestUrl(response.url);
      if (!finalUrl) {
        return NextResponse.json({ error: 'redirect leaves the allowed hosts' }, { status: 403 });
      }
    }
    if (!response.ok) {
      return NextResponse.json({ error: `upstream status ${response.status}` }, { status: 502 });
    }
    const contentLength = response.headers.get('content-length');
    if (contentLength && Number(contentLength) > MAX_BYTES) {
      return NextResponse.json({ error: 'crest image too large' }, { status: 413 });
    }
    arrayBuffer = await response.arrayBuffer();
  } catch {
    return NextResponse.json({ error: 'crest fetch failed' }, { status: 502 });
  }

  if (arrayBuffer.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: 'crest image too large' }, { status: 413 });
  }

  const hex = await dominantColor(Buffer.from(arrayBuffer));
  if (!hex) {
    return NextResponse.json({ error: 'no dominant colour found' }, { status: 422 });
  }

  return NextResponse.json(
    { hex },
    {
      headers: {
        'Cache-Control': 'public, max-age=604800, s-maxage=604800, stale-while-revalidate=1209600',
      },
    },
  );
}
