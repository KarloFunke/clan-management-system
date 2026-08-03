/**
 * The CoC API's timestamp format, normalised to ISO 8601.
 *
 * Every time the API hands back — war start/end, preparation start — is written COMPACT, with the
 * separators stripped: `20260803T100000.000Z`. That is a legal ISO 8601 "basic format" string and
 * `new Date()` rejects it outright, yielding an Invalid Date whose `.getTime()` is NaN.
 *
 * It went unnoticed for a long time because the value is usually handed straight to Postgres, which
 * parses the basic format happily — so anything reading a war's time back OUT of the database sees a
 * clean ISO string and works. The bug only surfaces where an API value is used WITHOUT that round
 * trip: the Discord lineup notices take `war.startTime` directly from the poll, and rendered
 * `<t:NaN:f>` as their battle-day countdown.
 *
 * Normalising at the ingestion boundary keeps the quirk in one place: nothing downstream should have
 * to know the API formats time differently from the rest of the app.
 */

const COMPACT = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\.\d+)?Z$/;

/**
 * Convert a CoC API timestamp to ISO 8601 extended format, or null if it is absent/unparseable.
 *
 * Already-extended strings pass through unchanged, so this is safe to apply to a value that may have
 * come from either the API or the database — and safe to apply twice.
 */
export function parseCoCTime(value: string | null | undefined): string | null {
  if (!value) return null;

  const m = COMPACT.exec(value.trim());
  if (m) {
    const [, y, mo, d, h, mi, s, ms] = m;
    return `${y}-${mo}-${d}T${h}:${mi}:${s}${ms ?? '.000'}Z`;
  }

  // Anything else: accept it only if it is a date at all, so a malformed value becomes an explicit
  // null rather than a NaN that renders as broken text somewhere far from here.
  return Number.isNaN(new Date(value).getTime()) ? null : value;
}
