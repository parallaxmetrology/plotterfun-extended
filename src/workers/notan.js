import { createPostLines, postLines } from '../helpers.js';
import { read } from '../lib/notan/notan-route.js';
import { applyToneEdits } from '../lib/notan/whatif.js';
import { fieldFromReading, prepareField, traceField } from '../lib/notan/trace.js';

self.postMessage(['sliders', [
  { label: 'Notan spacing', displayLabel: 'Line spacing (working pixels)', value: 6, min: 3, max: 16, step: 1, deferRestart: true },
  { label: 'Lighten strongest dark mass', displayLabel: 'Lighten strongest dark mass (%)', value: 0, min: 0, max: 100, step: 1, deferRestart: true },
]]);

let original;
async function compareMass(config, image, spacing) {
  const { revision, amounts } = config.notanEdit;
  if (original?.revision !== revision) {
    const reading = read(image.data, image.width, image.height);
    original = { revision, reading, field: fieldFromReading(reading) };
    const { w, h, rgb, labels, targets } = reading;
    const pixels = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      for (let ch = 0; ch < 3; ch++) pixels[4*i+ch] = 255 * rgb[3*i+ch];
      pixels[4*i+3] = 255;
    }
    self.postMessage(['notan-map', { revision, w, h, pixels, labels,
      masses: targets.map(({ id, polarity }) => ({ id, polarity })) }]);
  }
  if (original.spacing !== spacing) {
    const lines = await traceField(original.field, spacing, image.width, image.height);
    let path = '';
    if (lines.length) createPostLines(([, data]) => { path = data; })(lines);
    original.spacing = spacing;
    original.path = path;
    original.count = lines.length;
    self.postMessage(['notan-original', { path, width: image.width, height: image.height, count: lines.length }]);
  }
  const { reading } = original;
  if (!Object.keys(amounts ?? {}).length || !reading.targets.length) {
    self.postMessage(['msg', reading.targets.length ? `${original.count} drainage lines` : 'No light or dark masses found']);
    self.postMessage(['svg-path', original.path]);
    return;
  }
  const pixels = applyToneEdits(image, reading, amounts);
  const field = fieldFromReading(read(pixels, image.width, image.height));
  const lines = await traceField(field, spacing, image.width, image.height);
  self.postMessage(['msg', `${lines.length} drainage lines`]);
  postLines(lines);
}

self.onmessage = async ({ data: [config, image] }) => {
  try {
    self.postMessage(['msg', 'Reading light and dark masses…']);
    const spacing = Math.min(16, Math.max(3, Number(config['Notan spacing']) || 6));
    if (config.notanEdit) {
      await compareMass(config, image, spacing);
      return;
    }
    const percent = Math.min(100, Math.max(0, Number(config['Lighten strongest dark mass']) || 0));
    const field = prepareField(image, percent);
    const lines = await traceField(field, spacing, image.width, image.height);
    self.postMessage(['msg', `${lines.length} drainage lines`]);
    postLines(lines);
  } catch (error) {
    self.postMessage(['msg', `Notan drainage failed: ${error.message}`]);
    postLines([]);
  }
};
