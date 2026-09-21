/**
 * What happened to a piece of the source file during import.
 *
 * The first two are deliberately separate. "The export never contained this"
 * and "we chose not to keep this" are different answers to give a customer
 * who is asking whether their template survived, and only one of them is
 * something we could fix.
 */
export type ImportIssueKind =
  | 'missing_from_export'
  | 'unsupported_by_importer'
  | 'degenerate_default'
  | 'normalised'
  | 'malformed_row'
  | 'ambiguous'

export type IssueSeverity = 'info' | 'warning' | 'error'

export type ImportIssue = {
  kind: ImportIssueKind
  severity: IssueSeverity
  sourceColumn: string | null
  sourceRow: number | null
  /** How many rows this one issue stands for, so column-wide notes stay readable. */
  affectedCount: number
  message: string
  sample: string | null
}

export type ParsedComment = {
  name: string
  bodyHtml: string
  commentType: string | null
  answerType: string | null
  recommendation: string | null
  severity: number | null
  defaultValue: string | null
  choiceOptions: string[]
  unitOptions: string[]
  position: number
  /** 1-based spreadsheet row, counting the header as row 1. */
  sourceRow: number
  rawExtras: Record<string, string>
}

export type ParsedItem = {
  name: string
  position: number
  comments: ParsedComment[]
}

export type ParsedSection = {
  name: string
  position: number
  items: ParsedItem[]
}

export type ParsedTemplate = {
  name: string
  sections: ParsedSection[]
}

export type ImportStats = {
  /** Data rows in the file, excluding the header. */
  sourceRowCount: number
  mappedRowCount: number
  unmappedRowCount: number
  sourceColumnCount: number
  mappedColumnCount: number
  sectionCount: number
  itemCount: number
  commentCount: number
}

export type ParseResult = {
  template: ParsedTemplate
  issues: ImportIssue[]
  stats: ImportStats
}
