const namespacedFields = new Set([
  'stop_id',
  'route_id',
  'trip_id',
  'service_id',
  'agency_id',
  'shape_id',
  'parent_station',
  'block_id',
]);

export function namespaceId(value: string, field: string, provider: string): string {
  return namespacedFields.has(field) && value !== '' ? `${provider}:${value}` : value;
}
