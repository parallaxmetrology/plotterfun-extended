// Sample at equal distances so slow pointer motion has the same weight as fast motion.
import { best, GRID_STEP, toPx, toXY } from './notan-route.js';

export function sampleStroke(points, count = 32) {
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    lengths.push(lengths[i - 1] + Math.hypot(points[i][0]-points[i-1][0], points[i][1]-points[i-1][1]));
  }
  const total = lengths.at(-1);
  if (total < 6) return [];
  let j = 1;
  function at(d) {
    while (j < points.length - 1 && lengths[j] < d) j++;
    const t = (d - lengths[j-1]) / (lengths[j] - lengths[j-1] || 1);
    return points[j-1].map((v, axis) => v + t * (points[j][axis] - v));
  }
  const samples = [];
  let a = at(0);
  for (let i = 1; i <= count; i++) {
    const b = at(total * i / count);
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    if (len > 0) samples.push({x: (a[0]+b[0])/2, y: (a[1]+b[1])/2, dx: dx/len, dy: dy/len});
    a = b;
  }
  return samples;
}

// Query the same four-pixel cells as the final streamline integrator.
export function measureFit(reading, samples) {
  const visited = new Map(), empty = new Set();
  const alignment = samples.map(({x,y,dx,dy}) => {
    const col = Math.round((x-1.5)/GRID_STEP), row = Math.round((y-1.5)/GRID_STEP);
    const cx = col*GRID_STEP+1.5, cy = row*GRID_STEP+1.5;
    if (cx < 0 || cy < 0 || cx >= reading.w-0.5 || cy >= reading.h-0.5) return 0;
    const key = row*reading.w+col;
    if (!visited.has(key)) {
      const [t] = best(reading, toXY(reading,cx,cy), null, empty, []);
      visited.set(key,t ? toPx(reading,t._x,t._y) : null);
    }
    const target = visited.get(key);
    if (!target) return 0;
    const vx = target[0]-x, vy = target[1]-y, len = Math.hypot(vx,vy);
    if (len < 2) return 0;
    return Math.max(0, Math.min(1, (vx*dx+vy*dy)/len));
  });
  return { score: alignment.reduce((sum,n)=>sum+n,0)/samples.length, alignment };
}

export function nearbyMasses(reading, samples, limit = 3, targets = reading.targets) {
  // Include the end of the brushstroke, and masses along its interior.
  const nearest = (group) => targets.map(t => {
    const [x,y] = toPx(reading,t._x,t._y);
    const distance = Math.min(...group.map(p=>Math.hypot(x-p.x,y-p.y)));
    return { id:t.id, distance };
  }).sort((a,b)=>a.distance-b.distance || a.id-b.id).map(t=>t.id);
  return [...new Set([...nearest(samples.slice(-3)).slice(0,1), ...nearest(samples)])].slice(0,limit);
}
