import raw from '../../../catalog/catalog.json';
import type { Catalog, CompileParams, Graph } from '../src';

export const catalog = raw as unknown as Catalog;
export const params: CompileParams = { client: 'acme', allowedClients: ['acme', 'vertex'] };

type Mid = { type: string; cfg: Record<string, unknown> };

/** source -> mids... -> s3, with generated ids. */
export function chain(ds: string, mids: Mid[] = [], s3: Record<string, unknown> = {}): Graph {
  const nodes: Graph['nodes'] = [{ id: 'n1', type: 'source', cfg: { ds } }];
  const edges: Graph['edges'] = [];
  let prev = 'n1';
  mids.forEach((m, i) => {
    const id = 'n' + (i + 2);
    nodes.push({ id, type: m.type, cfg: m.cfg });
    edges.push({ from: prev, to: id, port: 'in' });
    prev = id;
  });
  nodes.push({ id: 's3', type: 's3', cfg: { client: 'acme', folder: 'out_folder', fmt: 'CSV', ...s3 } });
  edges.push({ from: prev, to: 's3', port: 'in' });
  return { nodes, edges };
}

export const filter = (...rules: { col: string; op: string; val: string }[]): Mid => ({ type: 'filter', cfg: { rules } });
export const select = (drop: string[] = [], extras: string[] = []): Mid => ({ type: 'select', cfg: { drop, extras } });

export const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
