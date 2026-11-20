/** When a user's password expires, as computed by the domain controller. */
export type PasswordExpiry = { kind: 'never' } | { kind: 'mustChange' } | { kind: 'at'; unixMs: number } | { kind: 'unknown' };

const neverValue = 0x7fffffffffffffffn;
const ticksPerMs = 10000n;
const epochOffsetMs = 11644473600000n;

/**
 * Interprets msDS-UserPasswordExpiryTimeComputed: INT64_MAX means never, 0 means the password
 * must be changed at next login, anything else is a Windows FILETIME (100 ns ticks since 1601).
 */
export function parsePasswordExpiry(value: string | undefined): PasswordExpiry {
  if (value === undefined || !/^-?\d+$/.test(value.trim())) return { kind: 'unknown' };
  const ticks = BigInt(value.trim());
  if (ticks >= neverValue || ticks < 0n) return { kind: 'never' };
  if (ticks === 0n) return { kind: 'mustChange' };
  return { kind: 'at', unixMs: Number(ticks / ticksPerMs - epochOffsetMs) };
}

const msPerDay = 86400000;

/** Whole days from `nowMs` until expiry, rounded down; negative once expired. */
export function daysUntilExpiry(expiry: Extract<PasswordExpiry, { kind: 'at' }>, nowMs: number): number {
  return Math.floor((expiry.unixMs - nowMs) / msPerDay);
}

export interface ExpiryLabel {
  text: string;
  level: 'ok' | 'warn' | 'expired' | 'none';
}

/** Human-readable expiry status, warning when `warnDays` or fewer days remain. */
export function describeExpiry(expiry: PasswordExpiry, nowMs: number, warnDays = 14): ExpiryLabel {
  switch (expiry.kind) {
    case 'never':
      return { text: 'Never', level: 'none' };
    case 'mustChange':
      return { text: 'Must change', level: 'expired' };
    case 'unknown':
      return { text: '—', level: 'none' };
    case 'at': {
      if (expiry.unixMs <= nowMs) return { text: 'Expired', level: 'expired' };
      const days = daysUntilExpiry(expiry, nowMs);
      const text = days === 0 ? 'Today' : days === 1 ? '1 day' : `${String(days)} days`;
      return { text, level: days <= warnDays ? 'warn' : 'ok' };
    }
  }
}
