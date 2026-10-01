// Single-person login: one password (APP_PASSWORD), many devices. Each device
// gets its own long random session token; the server keeps only its SHA-256 hash,
// so a leaked database can't be used to sign in.

const enc = new TextEncoder();

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compares two secrets in constant time (by comparing fixed-length hashes). */
export async function secretsMatch(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

export function newSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** "Android · Chrome", "iPhone · Safari", "Windows · Edge"… just to recognise devices. */
export function describeDevice(ua: string | undefined): string {
  if (!ua) return "Unknown device";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "Device";
  const browser = /Edg\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /FxiOS|Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${os} · ${browser}`;
}

/** Slows down password guessing: at most `max` failures per key per window. */
export class FailureLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  constructor(private max = 10, private windowMs = 15 * 60_000) {}

  blocked(key: string, nowMs: number) {
    const h = this.hits.get(key);
    return !!h && h.resetAt > nowMs && h.count >= this.max;
  }

  fail(key: string, nowMs: number) {
    const h = this.hits.get(key);
    if (!h || h.resetAt <= nowMs) this.hits.set(key, { count: 1, resetAt: nowMs + this.windowMs });
    else h.count++;
    if (this.hits.size > 10_000) this.hits.clear();
  }

  clear(key: string) {
    this.hits.delete(key);
  }
}
