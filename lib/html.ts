import sanitizeHtml from 'sanitize-html'

/**
 * Cleans a comment body for display.
 *
 * Applied when rendering, never before storing. The stored HTML stays exactly
 * as the export had it, so what is shown can be made safe without the
 * database quietly drifting away from the customer's file. It also means a
 * later change to this list does not require re-importing anything.
 *
 * The tags below are the ones Spectora's editor can produce. Anything else,
 * including scripts and event handlers, is dropped: comment bodies arrive
 * from an uploaded file and are not trusted.
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'div', 'span',
    'strong', 'b', 'em', 'i', 'u', 's',
    'ul', 'ol', 'li',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'blockquote', 'a',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    '*': ['style'],
  },
  allowedStyles: {
    '*': {
      'color': [/^#[0-9a-f]{3,6}$/i, /^rgb\(/],
      'background-color': [/^#[0-9a-f]{3,6}$/i, /^rgb\(/],
      'text-align': [/^left$|^right$|^center$|^justify$/],
      'font-weight': [/^bold$|^normal$|^\d{3}$/],
      'text-decoration': [/^underline$|^line-through$|^none$/],
    },
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  transformTags: {
    // Templates contain links to manufacturer and reference pages. Opening
    // them in a new tab without this pair lets the target script the opener.
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
  },
}

export function renderCommentHtml(html: string): string {
  return sanitizeHtml(html, OPTIONS)
}

/** Comment text with the markup removed, for previews and search. */
export function toPlainText(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim()
}
