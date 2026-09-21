/**
 * Spectora encodes its plain-text fields twice.
 *
 * A section literally named "Basement, Foundation, Crawlspace & Structure" is
 * written into the worksheet XML as "...Crawlspace &amp;amp; Structure". The
 * XML layer resolves one level, leaving "&amp;", so the value still needs one
 * HTML decode before it is the name the inspector typed.
 *
 * Comment bodies are encoded only once: after the XML layer they are already
 * real HTML and must not be decoded again, or "&amp;" inside a comment would
 * collapse into a bare "&" and change the markup.
 *
 * So decoding is applied to names and withheld from bodies. Doing it the
 * wrong way round in either direction corrupts the customer's content, which
 * is why this lives in its own file with its own tests.
 */

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

const ENTITY = /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi

/**
 * Resolves HTML entity references exactly once.
 *
 * Deliberately not repeated until the string stops changing: a name that
 * genuinely contains the text "&amp;" would otherwise be rewritten into "&",
 * turning a faithful import into a silent edit. One pass matches how the
 * value was encoded.
 *
 * Unrecognised entities are left as they are rather than dropped.
 */
export function decodeEntitiesOnce(value: string): string {
  if (!value.includes('&')) return value

  return value.replace(ENTITY, (match, reference: string) => {
    if (reference.startsWith('#')) {
      const codePoint =
        reference[1] === 'x' || reference[1] === 'X'
          ? Number.parseInt(reference.slice(2), 16)
          : Number.parseInt(reference.slice(1), 10)

      if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return match
      try {
        return String.fromCodePoint(codePoint)
      } catch {
        return match
      }
    }

    return NAMED[reference.toLowerCase()] ?? match
  })
}
