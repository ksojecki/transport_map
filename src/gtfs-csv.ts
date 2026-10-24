import { parse } from 'csv-parse';

export function createGtfsParser(onHeaders: (headers: string[]) => void) {
  return parse({
    bom: true,
    columns: (headers: string[]) => {
      onHeaders(headers);
      return headers;
    },
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
  });
}
