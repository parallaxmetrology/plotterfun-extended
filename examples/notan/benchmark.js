import { prepareField, traceField } from '../../src/lib/notan/trace.js';
import { createPostLines } from '../../src/helpers.js';

async function traceMain(field) {
  let path;
  const lines = await traceField(field, 6, 1200, 697);
  createPostLines(([, value]) => { path = value; })(lines);
  return path;
}

function traceWorker(worker, field) {
  return new Promise((resolve, reject) => {
    worker.onmessage = event => resolve(event.data);
    worker.onerror = event => reject(new Error(event.message));
    worker.postMessage(field);
  });
}

async function measure(trace) {
  // Prime an 8 ms main-thread heartbeat, include the partial interval at completion.
  const interval = 8;
  let last, worstGap = 0;
  const tick = () => {
    const now = performance.now();
    worstGap = Math.max(worstGap, now - last);
    last = now;
  };
  const start = last = performance.now();
  const timer = setInterval(tick, interval);
  try {
    const path = await trace();
    tick();
    return { path, elapsedMs: last - start, maxTimerDelayMs: Math.max(0, worstGap - interval) };
  } finally {
    clearInterval(timer);
  }
}

async function benchmark() {
  const report = document.querySelector('#report');
  const bitmap = await createImageBitmap(await (await fetch('./jeong.png')).blob(), { colorSpaceConversion: 'none' });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  if (image.width !== 1200 || image.height !== 697) throw new Error('Unexpected fixture size');
  const results = { browser: navigator.userAgent, spacing: 6, timerIntervalMs: 8, samples: [] };
  for (const lightenPercent of [0, 40]) {
    report.textContent = 'Preparing field at ' + lightenPercent + '%';
    const field = prepareField(image, lightenPercent);
    const worker = new Worker(new URL('./trace-worker.js', import.meta.url), { type: 'module' });
    try {
      const expected = await traceMain(field);
      if (!expected || await traceWorker(worker, field) !== expected) throw new Error('Warm-up paths differ');
      for (let pair = 0; pair < 6; pair++) {
        report.textContent = 'Lightening ' + lightenPercent + '%, pair ' + (pair + 1) + ' of 6';
        for (const thread of pair % 2 ? ['worker', 'main'] : ['main', 'worker']) {
          const {path, elapsedMs, maxTimerDelayMs} = await measure(
            () => thread === 'worker' ? traceWorker(worker, field) : traceMain(field));
          if (path !== expected) throw new Error('SVG paths differ');
          results.samples.push({ lightenPercent, pair: pair + 1, thread, elapsedMs, maxTimerDelayMs,
            lines: expected.split(' M').length - 1 });
        }
      }
    } finally {
      worker.terminate();
    }
  }
  return results;
}

document.querySelector('#run').onclick = async event => {
  event.target.disabled = true;
  try {
    document.querySelector('#report').textContent = JSON.stringify(await benchmark(), null, 2);
  } catch (error) {
    document.querySelector('#report').textContent = error.stack;
  } finally {
    document.querySelector('#run').disabled = false;
  }
};
