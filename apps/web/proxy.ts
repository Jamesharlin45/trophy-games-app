import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

// Protect only the admin area:
//   /admin/:path*       dashboard pages (admin area)
//   /api/admin/:path*   admin API routes
export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};

const ADMIN_USERNAME = 'admin';
const ADMIN_PREFIXES = ['/admin', '/api/admin'];
const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const textEncoder = new TextEncoder();

function isProtectedPath(pathname: string): boolean {
  return ADMIN_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

// Decodes standard base64 (padding optional, whitespace ignored) to bytes.
// Returns null when the input is not valid base64.
function base64ToBytes(input: string): Uint8Array | null {
  const encoded = input.replace(/\s+/g, '').replace(/=+$/, '');
  const len = encoded.length;
  if (len % 4 === 1) return null;

  const bytes = new Uint8Array((len * 3) >> 2);
  let outLen = 0;

  for (let i = 0; i < len; i += 4) {
    const remaining = len - i; // 1..4 chars in this group
    const values = new Array<number>(4);
    for (let j = 0; j < remaining; j++) {
      const index = BASE64_ALPHABET.indexOf(encoded[i + j]);
      if (index === -1) return null;
      values[j] = index;
    }

    const b0 = (values[0] << 2) | (values[1] >> 4);
    bytes[outLen++] = b0;
    if (remaining >= 3) {
      const b1 = ((values[1] & 0x0f) << 4) | (values[2] >> 2);
      bytes[outLen++] = b1;
    }
    if (remaining >= 4) {
      const b2 = ((values[2] & 0x03) << 6) | values[3];
      bytes[outLen++] = b2;
    }
  }

  return bytes.subarray(0, outLen);
}

// Constant-time byte comparison: the loop never exits early, so response
// time does not reveal whether or where bytes differ.
function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

// Parses the base64 payload of an "Authorization: Basic ..." header.
function basicAuthCredentials(header: string | null): Uint8Array | null {
  const match = header ? /^Basic\s+(\S+)$/i.exec(header.trim()) : null;
  if (!match) return null;
  return base64ToBytes(match[1]);
}

export default function proxy(request: NextRequest): NextResponse {
  const pathname = request.nextUrl.pathname;

  if (!isProtectedPath(pathname)) {
    return NextResponse.next();
  }

  const password = process.env.ADMIN_PASSWORD;
  if (typeof password !== 'string' || password.length === 0) {
    // Fail closed: the admin area stays locked when the password is not set.
    return NextResponse.json(
      { error: 'admin area is not configured' },
      { status: 503 }
    );
  }

  const expected = textEncoder.encode(`${ADMIN_USERNAME}:${password}`);
  const credentials = basicAuthCredentials(
    request.headers.get('authorization')
  );
  if (!credentials || !timingSafeEqualBytes(credentials, expected)) {
    return NextResponse.json(
      { error: 'unauthorized' },
      {
        status: 401,
        headers: { 'WWW-Authenticate': 'Basic realm="admin"' },
      }
    );
  }

  return NextResponse.next();
}
