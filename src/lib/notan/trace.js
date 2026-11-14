import computeStreamlines from './streamlines/index.js';
import { GRID_STEP, landingField, read, toPx } from './notan-route.js';
import { applyEdit } from './whatif.js';

// The first-stop field only. Later route history and basin statistics are unnecessary for plotting.
export function prepareField(image, lightenPercent = 0) {
  const { data, width, height } = image;
  let reading = read(data, width, height);
  if (lightenPercent > 0) {
    const dark = reading.targets.find(t => t.polarity === 'dark');
    if (dark) {
      const edit = applyEdit(data, width, height, reading.labels, reading.w, reading.h,
        dark.id, 'lighter', lightenPercent / 100);
      reading = read(edit.pixels, width, height);
    }
  }
  return fieldFromReading(reading);
}

export function fieldFromReading(reading) {
  const { grid, gw, gh, cols, rows } = landingField(reading);
  return {
    width: reading.w, height: reading.h, grid, gw, gh, col0: cols[0], row0: rows[0],
    targets: reading.targets.map(t => toPx(reading, t._x, t._y)),
  };
}

export async function traceField(field, spacing = 6, outputWidth = field.width, outputHeight = field.height) {
  const { width, height, gw, gh, grid, targets } = field;
  if (!targets.length || !gw || !gh) return [];
  const seeds = [];
  const stride = 3 * spacing;
  for (let y = Math.min(stride / 2, height / 2); y < height; y += stride) {
    for (let x = Math.min(stride / 2, width / 2); x < width; x += stride) seeds.push({ x, y });
  }
  const lines = [];
  const scaleX = outputWidth / width, scaleY = outputHeight / height;
  const job = computeStreamlines({
    vectorField({ x, y }) {
      const col = Math.round((x - field.col0) / GRID_STEP);
      const row = Math.round((y - field.row0) / GRID_STEP);
      if (col < 0 || col >= gw || row < 0 || row >= gh) return null;
      const target = targets[grid[row * gw + col]];
      if (!target) return null;
      const dx = target[0] - x, dy = target[1] - y;
      return dx * dx + dy * dy < 4 ? null : { x: dx, y: dy };
    },
    boundingBox: { left: 0, top: 0, width, height },
    seed: seeds, dSep: spacing, dTest: spacing * 0.45, timeStep: 0.6,
    stepsPerIteration: 40, maxTimePerIteration: 14,
    onStreamlineAdded(points) {
      lines.push(points.map(p => [p.x * scaleX, p.y * scaleY]));
    },
  });
  await job.run();
  return lines;
}
