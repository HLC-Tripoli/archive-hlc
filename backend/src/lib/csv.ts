const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  // منع حقن صيغ جداول البيانات (CSV formula injection).
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * يبني محتوى CSV بترميز UTF-8 مع BOM (لعرض العربية بشكل صحيح في Excel)
 * ويقوم بتهريب القيم لمنع حقن الصيغ.
 */
export function buildCsv(rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  const body = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  return `\uFEFF${body}\r\n`;
}
