export type Point = { latitude: number; longitude: number };
export type ContourSource = { point: Point; minutes: number; radiusMeters: number };

// Returns sampled 10-minute isolines from the fastest destination circles.
export function buildContours(
  sources: ContourSource[],
  maximumMinutes: number,
): Array<{ minutes: number; lines: Point[][] }> {
  if (!sources.length || maximumMinutes < 10) return [];
  const origin = sources[0].point;
  const cos = Math.cos((origin.latitude * Math.PI) / 180);
  const project = (point: Point) => ({
    x: (point.longitude - origin.longitude) * 111320 * cos,
    y: (point.latitude - origin.latitude) * 110540,
  });
  const values = sources
    .map((source) => ({
      ...project(source.point),
      base: source.minutes,
      radius: source.radiusMeters,
    }))
    .filter((source) => source.radius > 0);
  if (!values.length) return [];
  const bounds = values.reduce(
    (b, p) => ({
      minX: Math.min(b.minX, p.x - p.radius),
      maxX: Math.max(b.maxX, p.x + p.radius),
      minY: Math.min(b.minY, p.y - p.radius),
      maxY: Math.max(b.maxY, p.y + p.radius),
    }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
  );
  const spacing = Math.max(
    100,
    (bounds.maxX - bounds.minX) / 250,
    (bounds.maxY - bounds.minY) / 250,
  );
  bounds.minX -= spacing;
  bounds.maxX += spacing;
  bounds.minY -= spacing;
  bounds.maxY += spacing;
  const width = Math.ceil((bounds.maxX - bounds.minX) / spacing) + 1,
    height = Math.ceil((bounds.maxY - bounds.minY) / spacing) + 1;
  const grid = new Float32Array(width * height).fill(Infinity);
  for (const source of values) {
    const x0 = Math.max(0, Math.floor((source.x - source.radius - bounds.minX) / spacing)),
      x1 = Math.min(width - 1, Math.ceil((source.x + source.radius - bounds.minX) / spacing));
    const y0 = Math.max(0, Math.floor((source.y - source.radius - bounds.minY) / spacing)),
      y1 = Math.min(height - 1, Math.ceil((source.y + source.radius - bounds.minY) / spacing));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const distance = Math.hypot(
          bounds.minX + x * spacing - source.x,
          bounds.minY + y * spacing - source.y,
        );
        if (distance <= source.radius) {
          const index = y * width + x;
          grid[index] = Math.min(grid[index], source.base + distance / 72);
        }
      }
  }
  const toPoint = ([x, y]: number[]): Point => ({
    latitude: origin.latitude + (bounds.minY + y * spacing) / 110540,
    longitude: origin.longitude + (bounds.minX + x * spacing) / (111320 * cos),
  });
  const results: Array<{ minutes: number; lines: Point[][] }> = [];
  for (let threshold = 10; threshold <= Math.min(90, maximumMinutes); threshold += 10) {
    const segments: number[][][] = [];
    for (let y = 0; y < height - 1; y++)
      for (let x = 0; x < width - 1; x++) {
        const indices = [
          y * width + x,
          y * width + x + 1,
          (y + 1) * width + x + 1,
          (y + 1) * width + x,
        ];
        const coords = [
            [x, y],
            [x + 1, y],
            [x + 1, y + 1],
            [x, y + 1],
          ],
          intersections: number[][] = [];
        for (const [a, b] of [
          [0, 1],
          [1, 2],
          [2, 3],
          [3, 0],
        ])
          if (grid[indices[a]] <= threshold !== grid[indices[b]] <= threshold) {
            const va = grid[indices[a]],
              vb = grid[indices[b]],
              ratio =
                Number.isFinite(va) && Number.isFinite(vb) ? (threshold - va) / (vb - va) : 0.5;
            intersections.push(coords[a].map((n, i) => n + (coords[b][i] - n) * ratio));
          }
        for (let i = 0; i + 1 < intersections.length; i += 2)
          segments.push([intersections[i], intersections[i + 1]]);
      }
    const pointKey = (p: number[]) => p.map((v) => Math.round(v * 1000)).join(':'),
      links = new Map<string, number[][][]>();
    for (const segment of segments)
      for (const point of segment) {
        const key = pointKey(point);
        if (!links.has(key)) links.set(key, []);
        links.get(key)!.push(segment);
      }
    const remaining = new Set(segments),
      lines: Point[][] = [];
    while (remaining.size) {
      const seed = remaining.values().next().value!;
      remaining.delete(seed);
      const line = [seed[0], seed[1]];
      for (const end of [0, 1]) {
        let point = end ? line[line.length - 1] : line[0];
        while (true) {
          const next = links.get(pointKey(point))?.find((segment) => remaining.has(segment));
          if (!next) break;
          remaining.delete(next);
          const other = pointKey(next[0]) === pointKey(point) ? next[1] : next[0];
          if (end) line.push(other);
          else line.unshift(other);
          point = other;
        }
      }
      lines.push(line.map(toPoint));
    }
    results.push({ minutes: threshold, lines });
  }
  return results;
}
