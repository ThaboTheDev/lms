/**
 * CSV for spreadsheet downloads. Quotes are doubled and every field that needs
 * it is quoted. A cell starting with =, +, - or @ is prefixed with an
 * apostrophe: spreadsheets execute such cells as formulas, and a learner's name
 * or a reference typed into a form is exactly where somebody would put one.
 */
export type CsvCell = string | number | boolean | null | undefined | Date;

function cell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  let text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: CsvCell[][]): string {
  // CRLF line endings and a byte-order mark: Excel opens it as UTF-8 without asking.
  return '\uFEFF' + [headers, ...rows].map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function csvFilename(stem: string, at: Date = new Date()): string {
  return `${stem.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}-${at.toISOString().slice(0, 10)}.csv`;
}
