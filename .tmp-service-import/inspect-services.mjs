import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const inputPath = 'C:/Users/budge/Downloads/kunchas-services-2026-09-18 (2) (2).xlsx';
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
const summary = await workbook.inspect({
  kind: 'workbook,sheet,table',
  maxChars: 6000,
  tableMaxRows: 8,
  tableMaxCols: 10,
  tableMaxCellChars: 100,
});
console.log(summary.ndjson);
for (const sheet of workbook.worksheets.items) {
  const used = sheet.getUsedRange(true);
  console.log(JSON.stringify({ sheet:sheet.name, range:used?.address || '', values:used?.values || [] }));
}
