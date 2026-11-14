import { read } from '../lib/notan/notan-route.js';
import { applyToneEdits } from '../lib/notan/whatif.js';
import { fieldFromReading, traceField } from '../lib/notan/trace.js';
import { sampleStroke, measureFit, nearbyMasses } from '../lib/notan/brush.js';
import { createPostLines } from '../helpers.js';

function singleCandidates(masses, amounts) {
  const edits = [];
  for (const mass of masses) {
    const start = amounts[mass] ?? 0;
    const values = new Set([-20, 20, -40, 40].map(delta => Math.max(-100, Math.min(100, start + delta))));
    for (const amount of values) {
      if (amount !== start) edits.push({ mass, amount, delta: amount - start });
    }
  }
  return edits;
}

function pairedCandidates(edits, oppositeOnly) {
  const pairs = [];
  for (let i = 0; i < edits.length; i++) {
    for (let j = i + 1; j < edits.length; j++) {
      const a = edits[i], b = edits[j];
      if (a.mass === b.mass || (oppositeOnly && Math.sign(a.delta) === Math.sign(b.delta))) continue;
      pairs.push([a,b]);
    }
  }
  return pairs;
}

self.onmessage = async ({data: {image, amounts, points, spacing, comparePair, protectedStroke}}) => {
  try {
    const samples = sampleStroke(points);
    if (!samples.length) throw new Error('Draw a longer path.');
    const {width,height} = image;
    const original = read(image.data,width,height);
    function editedReading(changes) {
      if (!Object.keys(changes).length) return original;
      return read(applyToneEdits(image,original,changes),width,height);
    }
    const startingReading = editedReading(amounts);
    const before = measureFit(startingReading,samples);
    const guards = protectedStroke ? [...(protectedStroke.earlier ?? []), protectedStroke].map(stroke => {
      const samples = sampleStroke(stroke.points);
      return {samples, floor:Math.max(stroke.score,measureFit(startingReading,samples).score)};
    }) : [];
    const available = original.targets.filter(t => !Object.hasOwn(amounts,t.id));
    let masses = nearbyMasses(original,samples);
    if (protectedStroke) {
      masses = comparePair ? nearbyMasses(original,samples,6,available) : available.map(t=>t.id);
    }
    const edits = singleCandidates(masses,amounts);
    const groups = comparePair ? pairedCandidates(edits,!protectedStroke) : edits.map(edit => [edit]);
    let winner;
    let preserved = 0;
    for (const [index,group] of groups.entries()) {
      self.postMessage({type:'progress', index:index+1, total:groups.length});
      const changes = {...amounts};
      for (const {mass,amount} of group) {
        if (amount) changes[mass] = amount;
        else delete changes[mass];
      }
      const reading = editedReading(changes);
      const guardedFits = guards.map(guard => measureFit(reading,guard.samples));
      if (guardedFits.some((fit,i) => fit.score < guards[i].floor)) continue;
      preserved++;
      const fit = measureFit(reading,samples);
      const size = group.reduce((sum,edit)=>sum+Math.abs(edit.delta),0);
      if (!winner || fit.score > winner.fit.score + 1e-8 ||
          (Math.abs(fit.score-winner.fit.score)<=1e-8 && size<winner.size)) {
        winner = {edits:group,reading,fit,changes,size,guardedFits};
      }
    }
    let candidate = null;
    if (winner && (!protectedStroke || !comparePair || winner.fit.score > before.score + 0.005)) {
      const lines = await traceField(fieldFromReading(winner.reading),spacing,width,height);
      let path='';
      if (lines.length) createPostLines(([,value])=>{path=value;})(lines);
      candidate = {edits:winner.edits, changes:winner.changes, after:winner.fit.score,
        alignment:winner.fit.alignment, guardedFits:winner.guardedFits, path, count:lines.length};
    }
    self.postMessage({type:'complete', candidate, samples, floors:guards.map(g => g.floor), tried:groups.length, preserved, before:before.score, alignment:before.alignment});
  } catch(error) {
    self.postMessage({type:'error',message:error.message});
  }
};
