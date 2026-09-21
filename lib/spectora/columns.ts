/**
 * The columns we read out of a Spectora export.
 *
 * Headers are matched on the text before any bracketed hint, because Spectora
 * writes its own documentation into the header cell: the severity column is
 * headed "Category (-1: Low, 0: Med, 1: High)". Matching the whole string
 * would make the importer break the first time that hint is reworded.
 *
 * Eleven of the file's forty-two columns are mapped. The rest are not dropped:
 * every non-empty value in them is kept verbatim on the comment it belongs to,
 * and reported on the import summary.
 */
export const MAPPED_COLUMNS = {
  sectionName: 'Section Name',
  itemName: 'Item Name',
  commentName: 'Comment Name',
  commentText: 'Comment Text',
  commentType: 'Comment Type',
  severity: 'Category',
  choiceOptions: 'Multiple Choice Options',
  unitOptions: 'Unit Type Options',
  recommendation: 'Recommendation',
  order: 'Order',
  answerType: 'Answer Type',
  defaultValue: 'Default Value',
} as const

export type MappedColumn = keyof typeof MAPPED_COLUMNS

/** Columns without which a file is not a Spectora template export at all. */
export const REQUIRED_COLUMNS: MappedColumn[] = [
  'sectionName',
  'itemName',
  'commentName',
  'commentText',
]

function normalise(header: string): string {
  // Drop the parenthesised hint, collapse whitespace, ignore case.
  return header
    .replace(/\(.*$/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

/**
 * Locates each mapped column in the header row.
 *
 * "Default Value" and "Default Value 2" share a prefix, so matching is exact
 * on the normalised label rather than by prefix; "Default Value 2" is left
 * unmapped and travels with the rest of the unmapped columns.
 */
export function locateColumns(header: string[]): Map<MappedColumn, number> {
  const byLabel = new Map<string, number>()
  header.forEach((cell, index) => {
    const key = normalise(cell)
    // First occurrence wins: a duplicated header should not silently redirect
    // a mapped field to a later column.
    if (key && !byLabel.has(key)) byLabel.set(key, index)
  })

  const located = new Map<MappedColumn, number>()
  for (const [column, label] of Object.entries(MAPPED_COLUMNS) as [MappedColumn, string][]) {
    const index = byLabel.get(normalise(label))
    if (index !== undefined) located.set(column, index)
  }
  return located
}
