import { datasets } from '../lib/catalog';
import { FNS } from '../lib/graph';
import type { AppState } from '../lib/useApp';
import type { FnType } from '../lib/types';

export function Palette({ app }: { app: AppState }) {
  return (
    <div className="palette">
      <div className="palette-row">
        <span className="kicker">Sources</span>
        <div className="chips">
          {Object.values(datasets).map((d) => (
            <div
              key={d.key}
              className="chip source"
              draggable
              title={`${d.cols.length} columns${d.reference ? ' · reference' : ''}`}
              onDragStart={(e) => e.dataTransfer.setData('text/plain', 'source:' + d.key)}
              onClick={() => app.addFn('source', d.key)}
            >
              {d.name}
            </div>
          ))}
        </div>
      </div>
      <div className="palette-row">
        <span className="kicker">Functions</span>
        <div className="chips">
          {(Object.keys(FNS) as FnType[]).map((k) => (
            <div
              key={k}
              className="chip"
              draggable
              title={FNS[k][1]}
              onDragStart={(e) => e.dataTransfer.setData('text/plain', 'fn:' + k)}
              onClick={() => app.addFn(k)}
            >
              {FNS[k][0]}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
