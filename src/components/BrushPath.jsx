import React, { useEffect, useRef, useState } from 'react';

export function useBrushSearch(context, getImage) {
  const worker = useRef(null);
  const [state,setState] = useState(null);
  function cancel() {
    worker.current?.terminate();
    worker.current = null;
    setState(null);
  }
  useEffect(() => {
    setState(null);
    return () => {worker.current?.terminate(); worker.current=null;};
  },[context]);

  function search(points,amounts,spacing,previous = null,protectedStroke = null,additionalPair = false) {
    cancel();
    const job = new Worker(new URL('../workers/notan-brush.js',import.meta.url),{type:'module'});
    worker.current=job;
    const comparePair = Boolean(previous) || additionalPair;
    setState({type:'progress',context,points,comparePair,previous});
    const finish = data => {
      if (worker.current !== job) return;
      if (data.type === 'complete') {
        const single = comparePair ? previous?.single : data.candidate;
        const pair = comparePair ? data.candidate : null;
        const improved = single && single.after > data.before + 0.005;
        setState({type: improved || pair ? 'preview' : 'no-match', context, points, samples:data.samples,
          floors:data.floors, tried:data.tried, preserved:data.preserved, before:data.before, alignment:data.alignment, single, pair, compared:comparePair});
      } else {
        setState({...data,context,points,comparePair,previous});
      }
      if (data.type !== 'progress') {job.terminate(); worker.current=null;}
    };
    job.onmessage = event=>finish(event.data);
    job.onerror = event=>finish({type:'error',message:event.message});
    try {
      const image = getImage();
      job.postMessage({image,amounts,spacing,points,comparePair,protectedStroke},[image.data.buffer]);
    } catch (error) {finish({type:'error',message:error.message});}
  }
  function dismiss() {
    const previous = state?.type === 'progress' ? state.previous : null;
    cancel();
    if (previous?.context === context) setState(previous);
  }
  return {result:state?.context===context ? state : null,search,cancel,dismiss};
}

export function BrushPath({map, result, onSearch, onCancel, onKeep, penColor, penWidth, originalDrawing, pending, protectedStroke, onRelease}) {
  const canvas = useRef(null), stroke = useRef(null);
  const [draft,setDraft] = useState([]), [hint,setHint] = useState('');
  const [showGuide,setShowGuide] = useState(true);
  const points = draft.length ? draft : result?.points ?? [];
  const preview = result?.type === 'preview';
  const single = result?.single, pair = result?.pair;
  const [selection,setSelection] = useState('single');
  useEffect(() => { if (pair) setSelection('pair'); }, [pair]);
  const selected = pair && (!single || selection === 'pair') ? pair : single;
  const highlighted = preview ? selected : null;
  function comparePair() {
    setSelection('pair');
    onSearch(result.points,result);
  }
  function editLabel(edit) {
    const action = edit.delta > 0 ? 'Lighten' : 'Darken';
    return `${action} ${map.masses[edit.mass].polarity} mass ${edit.mass+1} by ${Math.abs(edit.delta)} points`;
  }
  const percent = score => (100*score).toFixed(1) + '%';
  useEffect(()=>{
    const img = new ImageData(new Uint8ClampedArray(map.pixels),map.w,map.h);
    if (highlighted) {
      const colors = new Map(highlighted.edits.map(edit=>[edit.mass,edit.delta>0 ? [255,124,18] : [68,156,245]]));
      for (let i=0;i<map.labels.length;i++) {
        const color = colors.get(map.labels[i]);
        if (!color) continue;
        for (let c=0;c<3;c++) img.data[4*i+c] = 0.55*img.data[4*i+c]+0.45*color[c];
      }
    }
    canvas.current.getContext('2d').putImageData(img,0,0);
  },[map,highlighted]);
  function point(e) {
    const rect=e.currentTarget.getBoundingClientRect();
    return [Math.max(0,Math.min(map.w-1,(e.clientX-rect.left)*map.w/rect.width)),
      Math.max(0,Math.min(map.h-1,(e.clientY-rect.top)*map.h/rect.height))];
  }
  function start(e) {
    if (pending || !e.isPrimary || e.button!==0) return;
    onCancel(); setHint(''); setSelection('single'); setShowGuide(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    stroke.current=[point(e)];setDraft(stroke.current.slice());
  }
  function move(e) {
    if (!stroke.current || !e.isPrimary) return;
    const p=point(e), last=stroke.current.at(-1);
    if (Math.hypot(p[0]-last[0],p[1]-last[1])<1) return;
    stroke.current.push(p);setDraft(stroke.current.slice());
  }
  function end(e) {
    if (!stroke.current || !e.isPrimary) return;
    move(e);
    const path=stroke.current;stroke.current=null;setDraft([]);
    if (path.length<2 || path.reduce((sum,p,i)=>i ? sum+Math.hypot(p[0]-path[i-1][0],p[1]-path[i-1][1]) : 0,0)<6) {
      setHint('Drag a little farther to set a direction.');return;
    }
    onSearch(path);
  }
  const guards = protectedStroke ? [...(protectedStroke.earlier ?? []),protectedStroke] : [];
  const keptLabel = guards.length === 1 ? 'Kept pair' : 'Kept drawing';
  const targetLabel = guards.length === 1 ? 'Second stroke' : 'Missed section';
  const strokeLabel = i => ['First stroke','Second stroke'][i] ?? `Stroke ${i+1}`;
  const missed = protectedStroke?.samples.filter((_,i)=>protectedStroke.alignment[i]<0.5) ?? [];
  function traceMissedSection(additionalPair = false) {
    // Keep consecutive samples separate so the suggested stroke never jumps a matched section.
    let longest = [], run = [];
    protectedStroke.samples.forEach((sample,i) => {
      if (protectedStroke.alignment[i] < 0.5) {
        run.push([sample.x,sample.y]);
        if (run.length > longest.length) longest = run.slice();
      } else run = [];
    });
    if (longest.length < 2 || longest.reduce((length,p,i) =>
        i ? length+Math.hypot(p[0]-longest[i-1][0],p[1]-longest[i-1][1]) : 0,0) < 6) {
      setHint('Brush through the marked points to define a longer path.');
      return;
    }
    setHint('');
    onSearch(longest,null,additionalPair);
  }
  const polyline = points.map(p=>p.join(',')).join(' ');
  const guide = alignment => <>
    <polyline points={polyline} stroke="white" strokeWidth="4" fill="none" />
    <polyline points={polyline} stroke="#006b76" strokeWidth="2" fill="none" />
    {points.length>0 && <circle cx={points[0][0]} cy={points[0][1]} r="3" fill="white" stroke="#006b76" />}
    {result?.samples?.map((s,i)=>alignment?.[i]<0.5 && <circle key={i} cx={s.x} cy={s.y} r="2.2" fill="#d44d14" />)}
  </>;
  return <section className={preview && pair ? "brush-work brush-pair-comparison" : "brush-work"}>
    <div className="brush-source">
      <canvas ref={canvas} width={map.w} height={map.h} aria-label="Brush a path on the source image"
        onPointerDown={start} onPointerMove={move} onPointerUp={end}
        onPointerCancel={()=>{stroke.current=null;setDraft([]);}} />
      <svg className="brush-guide" viewBox={`0 0 ${map.w} ${map.h}`} aria-hidden="true">{protectedStroke && <g>
        <polyline points={protectedStroke.points.map(p=>p.join(',')).join(' ')} stroke="#704a9b" strokeWidth="1.5" strokeDasharray="4 3" fill="none" />
        {missed.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r="2.3" fill="#e05612" />)}
      </g>}{guide(highlighted?.alignment ?? result?.alignment)}</svg>
    </div>
    <div className="brush-details">
      <h3>Brush a path</h3>
      {protectedStroke ? <>
        <p>{guards.map((s,i) => `${strokeLabel(i)} protected at ${percent(s.score)}`).join(' · ')}. Brush through the orange dots to try one additional mass edit.</p>
        {missed.length>1 && <button type="button" className="ghost-button" disabled={pending || result?.type==='progress'} onClick={()=>traceMissedSection()}>Trace longest missed section</button>}
        {missed.length>1 && <button type="button" className="ghost-button" disabled={pending || result?.type==='progress'}
          onClick={()=>traceMissedSection(true)}>Try two new masses on the missed section</button>}
        <button type="button" className="ghost-button" onClick={onRelease}>{guards.length === 1 ? 'Release first stroke' : 'Release protected strokes'}</button>
      </> : <p>Drag from where the lines should start toward where you want them to go.</p>}
      {hint && <p role="status">{hint}</p>}
      {result?.type==='progress' && <p role="status">{result.total ? `Trying ${result.comparePair ? 'pair' : 'edit'} ${result.index} of ${result.total}…` : 'Reading the path…'}</p>}
      {result?.type==='error' && <p role="status">{result.message}</p>}
      {result?.type==='no-match' && <p role="status">{protectedStroke
        ? `No tested ${result.compared ? 'pair' : 'edit'} improved the ${targetLabel.toLowerCase()} by more than 0.5 points while preserving ${guards.length === 1 ? "the first stroke" : "all kept strokes"}. Starting match: ${percent(result.before)}. ${result.preserved} of ${result.tried} candidates preserved the kept scores.`
        : 'None of the tested single edits improved this path.'}</p>}
      {(preview || result?.type==='no-match') && !protectedStroke && !result.compared && map.masses.length>=2 &&
        <button type="button" className="ghost-button" onClick={comparePair}>Compare a light/dark pair</button>}
      {result?.compared && !protectedStroke && !pair && <p role="status">No opposite-direction pair is available for these masses.</p>}
      {preview && selected && <>
        {pair && single && <div className="button-row" aria-label="Select a preview">
          <button type="button" className="ghost-button" aria-pressed={selected===single} onClick={()=>setSelection('single')}>Single edit</button>
          <button type="button" className="ghost-button" aria-pressed={selected===pair} onClick={()=>setSelection('pair')}>Two edits</button>
        </div>}
        <strong>{selected.edits.map(editLabel).join(' · ')}</strong>
        {protectedStroke ? <div aria-live="polite">
          {result.floors.map((floor,i) => <p key={i}>{strokeLabel(i)} · {keptLabel} {percent(floor)} → Preview {percent(selected.guardedFits[i].score)}</p>)}
          <p>{targetLabel} · {keptLabel} {percent(result.before)} → Preview {percent(selected.after)}</p>
        </div> : <p>Direction match · Starting drawing {percent(result.before)} · Single {percent(single.after)}{pair && ` · Pair ${percent(pair.after)}`}</p>}
        {pair && single && <p role="status">{comparisonText(single.after,pair.after)}</p>}
        <p>Orange dots mark where the flow misses the stroke by more than 60°.</p>
        <label><input type="checkbox" checked={showGuide} onChange={e=>setShowGuide(e.target.checked)} /> Show path on preview</label>
        <button className="primary-button" type="button" onClick={()=>onKeep(selected)}>{pair ? (selected===pair ? (protectedStroke ? 'Keep two additional edits' : 'Keep pair') : 'Keep single edit') : protectedStroke ? 'Keep additional edit' : 'Keep edit'}</button>
      </>}
      {protectedStroke && result?.compared && result.type==='preview' && <p>{result.preserved} of {result.tried} combinations preserved {guards.length === 1 ? "the first stroke" : "all kept strokes"}.</p>}
      {result && <button type="button" className="ghost-button" onClick={onCancel}>{result.type==='progress' ? 'Cancel search' : 'Discard preview'}</button>}
    </div>
    {preview && originalDrawing && <figure className="brush-original">
      <figcaption>{protectedStroke ? keptLabel : 'Original'} · {protectedStroke?.count ?? originalDrawing.count} lines</figcaption>
      <svg viewBox={`0 0 ${originalDrawing.width} ${originalDrawing.height}`} aria-label={protectedStroke ? keptLabel+' beside suggestion' : 'Original beside brush suggestion'}>
        <path d={protectedStroke?.path ?? originalDrawing.path} fill="none" stroke={penColor} strokeWidth={penWidth} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </figure>}
    {preview && originalDrawing && [single,pair].filter(Boolean).map(candidate=>
      <figure className="brush-preview" key={candidate.edits.length}>
        <figcaption>{candidate===pair ? 'Paired edit' : protectedStroke ? 'Additional edit' : 'Single edit'} · {percent(candidate.after)} direction match</figcaption>
        <svg viewBox={`0 0 ${originalDrawing.width} ${originalDrawing.height}`} aria-label={candidate===pair ? 'Paired drainage drawing' : 'Suggested drainage drawing'}>
          <path d={candidate.path} fill="none" stroke={penColor} strokeWidth={penWidth} strokeLinecap="round" strokeLinejoin="round"/>
          {showGuide && <g transform={`scale(${originalDrawing.width/map.w} ${originalDrawing.height/map.h})`}>{guide(candidate.alignment)}</g>}
        </svg>
      </figure>)}
  </section>;
}


function comparisonText(single, pair) {
  const difference = 100 * (pair - single);
  if (Math.abs(difference) < 0.05) return 'The pair and the single edit match to within 0.1 percentage point.';
  return `The pair scores ${Math.abs(difference).toFixed(1)} percentage points ${difference>0 ? 'higher' : 'lower'} than the single edit.`;
}
