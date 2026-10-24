export type CoverageRequest = {
  latitude: number;
  longitude: number;
  date: string;
  time: string;
  journeyLimit: number;
  walkMinutes: number;
  minimumTransfer: number;
  includeTransfers: boolean;
};

const validDate = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const validTime = (value: unknown): value is string =>
  typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const bounded = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

export function validCoverageRequest(body: unknown): body is CoverageRequest {
  if (!body || typeof body !== 'object') return false;
  const request = body as Record<string, unknown>;
  return (
    bounded(request.latitude, -90, 90) &&
    bounded(request.longitude, -180, 180) &&
    validDate(request.date) &&
    validTime(request.time) &&
    bounded(request.journeyLimit, 0, 90) &&
    bounded(request.walkMinutes, 0, 15) &&
    bounded(request.minimumTransfer, 0, 5) &&
    typeof request.includeTransfers === 'boolean'
  );
}
