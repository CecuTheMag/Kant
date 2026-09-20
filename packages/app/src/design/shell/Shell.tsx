import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Scenario } from '../core/mock';
import { SCENARIOS } from '../core/mock';
import { InstrumentApp } from '../directions/instrument/InstrumentApp';
import { InstrumentSystem } from '../directions/instrument/InstrumentSystem';
import { SealApp } from '../directions/seal/SealApp';
import { SealSystem } from '../directions/seal/SealSystem';
import { StoreProvider } from '../core/mockstore';

export type DirectionId = 'instrument' | 'seal';
export type ViewId = 'prototype' | 'system' | 'states';
export type DeviceId = 'desktop' | 'laptop' | 'tablet' | 'phone';

const DEVICES: Record<DeviceId, { w: number; h: number; label: string; phone?: boolean }> = {
  desktop: { w: 1440, h: 900, label: 'Desktop · 1440' },
  laptop: { w: 1280, h: 850, label: 'Laptop · 1280' },
  tablet: { w: 834, h: 1112, label: 'Tablet · 834' },
  phone: { w: 390, h: 844, label: 'Phone · 390', phone: true },
};

const DIRECTIONS: { id: DirectionId; label: string }[] = [
  { id: 'instrument', label: 'A · Instrument' },
  { id: 'seal', label: 'B · Seal' },
];

const VIEWS: { id: ViewId; label: string }[] = [
  { id: 'prototype', label: 'Prototype' },
  { id: 'system', label: 'Design system' },
  { id: 'states', label: 'States' },
];

/** Persist the review position in the URL hash so a reload — or a shared link — lands back
 *  on the same direction/view/state instead of resetting to the top. */
function readHash(): { dir: DirectionId; view: ViewId; device: DeviceId; scenario: Scenario } {
  const p = new URLSearchParams(location.hash.replace(/^#/, ''));
  const dir = (p.get('d') as DirectionId) || 'instrument';
  const view = (p.get('v') as ViewId) || 'prototype';
  const device = (p.get('m') as DeviceId) || 'desktop';
  const scenario = (p.get('s') as Scenario) || 'connected';
  return {
    dir: dir === 'seal' ? 'seal' : 'instrument',
    view: VIEWS.some((v) => v.id === view) ? view : 'prototype',
    device: DEVICES[device] ? device : 'desktop',
    scenario: SCENARIOS.some((s) => s.id === scenario) ? scenario : 'connected',
  };
}

export function Shell() {
  const initial = useMemo(readHash, []);
  const [dir, setDir] = useState<DirectionId>(initial.dir);
  const [view, setView] = useState<ViewId>(initial.view);
  const [device, setDevice] = useState<DeviceId>(initial.device);
  const [scenario, setScenario] = useState<Scenario>(initial.scenario);

  useEffect(() => {
    const p = new URLSearchParams({ d: dir, v: view, m: device, s: scenario });
    history.replaceState(null, '', `#${p.toString()}`);
  }, [dir, view, device, scenario]);

  const openState = useCallback((s: Scenario) => {
    setScenario(s);
    setView('prototype');
  }, []);

  const App = dir === 'instrument' ? InstrumentApp : SealApp;
  const System = dir === 'instrument' ? InstrumentSystem : SealSystem;
  const dev = DEVICES[device];
  const framed = device !== 'desktop';

  return (
    <StoreProvider>
    <div className="shell">
      <header className="shell-bar">
        <div className="shell-brand">
          <b>Kant</b>
          <span>design directions</span>
        </div>

        <div className="seg-group">
          <span className="seg-label">Direction</span>
          <div className="seg seg-dir" role="group" aria-label="Design direction">
            {DIRECTIONS.map((d) => (
              <button
                key={d.id}
                aria-pressed={dir === d.id}
                onClick={() => setDir(d.id)}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <div className="seg-group">
          <span className="seg-label">View</span>
          <div className="seg" role="group" aria-label="View">
            {VIEWS.map((v) => (
              <button key={v.id} aria-pressed={view === v.id} onClick={() => setView(v.id)}>
                {v.label}
              </button>
            ))}
          </div>
        </div>

        <div className="shell-spacer" />

        {view === 'prototype' && (
          <div className="seg-group">
            <span className="seg-label">Size</span>
            <div className="seg" role="group" aria-label="Viewport">
              {(Object.keys(DEVICES) as DeviceId[]).map((d) => (
                <button key={d} aria-pressed={device === d} onClick={() => setDevice(d)}>
                  {DEVICES[d].label.split(' · ')[0]}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>

      <main className={`shell-stage${framed ? ' framed' : ''}`}>
        {view === 'prototype' && !framed && (
          <div className="frame-full">
            <App scenario={scenario} onScenario={setScenario} />
          </div>
        )}

        {view === 'prototype' && framed && (
          <div className="frame-wrap">
            <div className={`frame${dev.phone ? ' phone' : ''}`} style={{ width: dev.w, height: dev.h }}>
              {/* An iframe, not a div — see Bare.tsx. Media queries need a real viewport. */}
              <iframe
                key={`${dir}-${device}`}
                className="frame-iframe"
                title={`${dir} prototype at ${dev.w}px`}
                src={`${location.pathname}?bare=1#d=${dir}&s=${scenario}`}
                width={dev.w}
                height={dev.h}
              />
            </div>
            <div className="frame-caption">{dev.label} × {dev.h}</div>
          </div>
        )}

        {view === 'system' && <System />}

        {view === 'states' && <StatesIndex current={scenario} onOpen={openState} dir={dir} />}
      </main>
    </div>
    </StoreProvider>
  );
}

function StatesIndex({
  current,
  onOpen,
  dir,
}: {
  current: Scenario;
  onOpen: (s: Scenario) => void;
  dir: DirectionId;
}) {
  const groups = useMemo(() => {
    const m = new Map<string, typeof SCENARIOS>();
    for (const s of SCENARIOS) {
      const list = m.get(s.group) ?? [];
      list.push(s);
      m.set(s.group, list);
    }
    return [...m.entries()];
  }, []);

  return (
    <div className="docs">
      <h1>States</h1>
      <p className="lede">
        Every state the app can be in, including the ones that are hard to reach for real — a key
        rotating under a verified contact, a relay refusing the dial, an onion path with two hops.
        Pick one and it opens in the {dir === 'instrument' ? 'Instrument' : 'Seal'} prototype.
      </p>

      {groups.map(([group, items]) => (
        <section key={group}>
          <h2>{group}</h2>
          <div className="state-grid">
            {items.map((s) => (
              <button
                key={s.id}
                className="state-card"
                aria-pressed={current === s.id}
                onClick={() => onOpen(s.id)}
              >
                <b>{s.label}</b>
                <span>{s.note}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
