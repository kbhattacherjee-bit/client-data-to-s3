import { describe, expect, it } from 'vitest';
import { compile, type Graph } from '../src';
import { catalog, chain, filter, params, select } from './helpers';

const shapes: [string, (ds: string) => Graph][] = [
  ['bare', (ds) => chain(ds)],
  ['select', (ds) => chain(ds, [select()])],
  ['filter', (ds) => chain(ds, [filter()])],
  ['select+filter+select', (ds) => chain(ds, [select(), filter(), select()])],
];

describe('client isolation', () => {
  for (const m of catalog.models) {
    for (const [name, make] of shapes) {
      it(`${m.name} / ${name}: client predicate is present exactly when the dataset is client scoped`, () => {
        const r = compile(make(m.name), catalog, params);
        const physicalClientCol = `"${m.client_column?.toUpperCase()}" = :client`;
        const hits = r.sql.split(physicalClientCol).length - 1;
        expect(hits).toBe(m.reference ? 0 : 1);
        expect(r.params.client).toBe(m.reference ? undefined : 'acme');
        // the predicate sits in the source CTE, before any other step
        if (!m.reference) expect(r.sql.indexOf(physicalClientCol)).toBeLessThan(r.sql.indexOf('s2') === -1 ? Infinity : r.sql.indexOf('s2'));
      });
    }
  }

  it('the client comes from the request, never from the graph alone', () => {
    const g = chain('client_positions_report', [], { client: 'vertex' });
    expect(() => compile(g, catalog, params)).toThrow(/different client/);
  });

  it('a client the caller may not use is rejected', () => {
    const g = chain('client_positions_report', [], { client: 'evil' });
    expect(() => compile(g, catalog, { client: 'evil', allowedClients: ['acme'] })).toThrow(/cannot run reports/);
  });

  it('a client-scoped model without a client column is refused, not run unscoped', () => {
    const cat = JSON.parse(JSON.stringify(catalog));
    cat.models.find((m: { name: string }) => m.name === 'client_positions_report').client_column = null;
    expect(() => compile(chain('client_positions_report'), cat, params)).toThrow(/no client column/);
  });

  it('restricted and client key columns cannot be named in a rule or select', () => {
    for (const col of ['broker_notes', 'client_id']) {
      expect(() => compile(chain('soft_dollar_client_report', [filter({ col, op: 'eq', val: 'x' })]), catalog, params)).toThrow(/not a column/);
      expect(() => compile(chain('soft_dollar_client_report', [select([col])]), catalog, params)).toThrow(/Unknown column/);
    }
  });
});
