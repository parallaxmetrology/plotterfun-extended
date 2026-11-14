import { traceField } from '../../src/lib/notan/trace.js';
import { createPostLines } from '../../src/helpers.js';

self.onmessage = async ({ data: field }) => {
  const lines = await traceField(field, 6, 1200, 697);
  createPostLines(([, path]) => self.postMessage(path))(lines);
};
