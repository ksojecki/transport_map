export function rankExplicitLocality<T extends { locality?: Record<string, unknown> }>(
  query: string,
  results: T[],
): T[] {
  const normalizedQuery = normalize(query);
  return results
    .map((result, index) => ({
      result,
      index,
      matches: ['city', 'town', 'municipality'].some((key) => {
        const locality = result.locality?.[key];
        return typeof locality === 'string' && normalizedQuery.includes(normalize(locality));
      }),
    }))
    .sort((a, b) => Number(b.matches) - Number(a.matches) || a.index - b.index)
    .map(({ result }) => result);
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pl');
}
