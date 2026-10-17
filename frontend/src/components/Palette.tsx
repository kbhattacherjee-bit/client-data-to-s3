import { datasets } from '../lib/catalog';
import { FNS } from '../lib/graph';
import type { AppState } from '../lib/useApp';
import type { FnType } from '../lib/types';
import { Icon } from './Icon';
import { NODE_ICON } from './Canvas';

/** Floating, translucent: the canvas keeps scrolling underneath it. Click to add after the selected step, or drag onto the canvas. */
export function Palette({ app }: { app: AppState }) {
  return (
    <div className="float float-top">
      <div className="palette-row">
        <span className="palette-label">Sources</span>
        <div className="chips">
          {Object.values(datasets).map((d) => (
            <button
              key={d.key}
              className="chip source"
              draggable
              title={`${d.cols.length} columns${d.reference ? ' · reference data' : ''}. Click to add, or drag onto the canvas.`}
              onDragStart={(e) => e.dataTransfer.setData('text/plain', 'source:' + d.key)}
              onClick={() => app.addFn('source', d.key)}
            >
              <Icon name="database" size={14} />
              {d.name}
            </button>
          ))}
        </div>
      </div>
      <div className="palette-row">
        <span className="palette-label">Steps</span>
        <div className="chips">
          {(Object.keys(FNS) as FnType[]).map((k) => (
            <button
              key={k}
              className="chip"
              draggable
              title={`${FNS[k][1]}. Click to add after the selected step, or drag onto the canvas.`}
              onDragStart={(e) => e.dataTransfer.setData('text/plain', 'fn:' + k)}
              onClick={() => app.addFn(k)}
            >
              <Icon name={NODE_ICON[k]} size={14} />
              {FNS[k][0]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
