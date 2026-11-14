import React, { useEffect, useRef, useState } from 'react';

export default function NotanMassEditor({ map, edit, onChange, onExample, brushOpen, onBrush }) {
  const canvas = useRef(null);
  const [hint, setHint] = useState('');
  const selected = map?.masses.find(m => m.id === edit.mass)
    ?? map?.masses.find(m => m.polarity === 'dark') ?? map?.masses[0];

  const amounts = edit.amounts ?? {};
  const saved = amounts[selected?.id] ?? 0;
  const [amount, setAmount] = useState(saved);
  useEffect(() => { setAmount(saved); }, [saved, selected?.id, map?.revision]);
  useEffect(() => { setHint(''); }, [map?.revision]);
  useEffect(() => {
    if (!canvas.current || !map) return;
    const { w, h, pixels, labels } = map;
    const ctx = canvas.current.getContext('2d');
    const img = new ImageData(new Uint8ClampedArray(pixels), w, h);
    if (selected) {
      const highlight = [255, 118, 24];
      for (let i = 0; i < labels.length; i++) {
        if (labels[i] !== selected.id) continue;
        const edge = i % w === 0 || i % w === w - 1 || labels[i-1] !== selected.id ||
          labels[i+1] !== selected.id || labels[i-w] !== selected.id || labels[i+w] !== selected.id;
        const opacity = edge ? 1 : 0.32;
        for (let ch = 0; ch < 3; ch++) {
          const offset = 4 * i + ch;
          img.data[offset] += (highlight[ch] - img.data[offset]) * opacity;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [map, selected]);

  function pick(event) {
    const rect = canvas.current.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / rect.width * map.w);
    const y = Math.floor((event.clientY - rect.top) / rect.height * map.h);
    const id = map.labels[y * map.w + x];
    if (!(id >= 0)) {
      setHint('That point is outside the detected masses.');
      return;
    }
    setHint('');
    onChange({ mass: id });
  }

  function commit(value) {
    const next = Math.min(100, Math.max(-100, Number(value) || 0));
    setAmount(next);
    if (!selected || next === saved) return;
    const changes = { ...amounts };
    if (next) changes[selected.id] = next;
    else delete changes[selected.id];
    onChange({ mass: selected.id, amounts: changes });
  }

  return <section className="panel notan-editor">
    <div className="panel-title">Edit a mass</div>
    <button type="button" className="ghost-button" aria-pressed={brushOpen} onClick={onBrush}>{brushOpen ? 'Close path brush' : 'Brush a path'}</button>
    {brushOpen && !map && <p>Load the sunflower preview below, or select your photo and click Use image.</p>}
    {map && <>
      <p>Click a shape to change its tone. Select another to add a second edit.</p>
      <canvas ref={canvas} width={map.w} height={map.h} onClick={pick} aria-label="Painting with selected mass highlighted" />
      {selected && <>
        <label className="control-group">Selected mass
          <select aria-label="Selected mass" className="select-input" value={selected.id} onChange={e => { setHint(''); onChange({ mass: Number(e.target.value) }); }}>
            {map.masses.map(m => <option key={m.id} value={m.id}>{m.polarity === 'dark' ? 'Dark' : 'Light'} mass {m.id + 1}</option>)}
          </select>
        </label>
        <label className="control-group">Tone change (%)
          <input type="number" className="number-input" min="-100" max="100" value={amount}
            onChange={e => setAmount(e.target.value)} onBlur={e => commit(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commit(e.currentTarget.value); }} />
        </label>
        <input type="range" aria-label="Darken or lighten selected mass" min="-100" max="100" value={amount}
          onChange={e => setAmount(Number(e.target.value))} onPointerUp={e => commit(e.currentTarget.value)}
          onKeyUp={e => commit(e.currentTarget.value)} onBlur={e => commit(e.currentTarget.value)} />
        <div className="notan-scale"><span>Darken</span><button type="button" onClick={() => commit(0)}>Reset mass</button><span>Lighten</span></div>
      </>}
      {Object.keys(amounts).length > 0 && <div className="notan-edit-list">
        <span className="panel-subtitle">Active edits</span>
        {map.masses.filter(m => amounts[m.id]).map(m =>
          <button key={m.id} type="button" className="ghost-button" aria-pressed={m.id === selected?.id}
            onClick={() => onChange({ mass: m.id })}>
            {m.polarity === 'dark' ? 'Dark' : 'Light'} mass {m.id + 1} · {amounts[m.id] > 0 ? '+' : ''}{amounts[m.id]}%
          </button>)}
        <button type="button" className="ghost-button" onClick={() => onChange({ amounts: {} })}>Clear all edits</button>
      </div>}
      {hint && <p role="status">{hint}</p>}
    </>}
    <button type="button" className="ghost-button" onClick={()=>onExample('sunflower')}>Load sunflower preview</button>
    <button type="button" className="ghost-button" onClick={()=>onExample('jeong')}>Load Jeong Seon example</button>
  </section>;
}
