import { describe, expect, it } from 'vitest';
import { analyse, chain, defaultFlow, layout } from './graph';
import { restricted } from './catalog';

describe('default flow (prototype parity)', () => {
  it('joins, filters commission > 1000 and drops hidden columns', () => {
    const { T, st } = analyse(defaultFlow());
    expect(st.miss).toBe(false);
    expect(st.final.cols).toEqual(['trade_date', 'symbol', 'commission', 'net_amount', 'sector']);
    expect(st.final.rows).toHaveLength(5); // 1180, 1980, 1240, 2115, 1530
    expect(T.n3.rows.length).toBe(8);
  });
});

describe('steps', () => {
  it('group keeps one row per key with row_count and totals', () => {
    const g = chain('commission_summary', [{ type: 'group', cfg: { by: 'desk', agg: 'sum' } }], 'smac');
    const { st } = analyse(g);
    expect(st.final.cols[0]).toBe('desk');
    expect(st.final.cols[1]).toBe('row_count');
    expect(st.final.cols).toContain('sum_gross_commission');
    expect(st.final.rows).toHaveLength(2);
  });

  it('addcol rounds to 2 decimals and divide by zero is blank', () => {
    const g = chain('client_positions_report', [{ type: 'addcol', cfg: { name: 'x', a: 'quantity', op: '/', b: '', num: '0' } }], 'acme');
    expect(analyse(g).st.final.rows.every((r) => r[r.length - 1] === '')).toBe(true);
    const g2 = chain('client_positions_report', [{ type: 'addcol', cfg: { name: 'x', a: 'quantity', op: '*', b: '', num: '0.333' } }], 'acme');
    expect(analyse(g2).st.final.rows[0].at(-1)).toBe(Math.round(12500 * 0.333 * 100) / 100);
  });

  it('flags a select with missing columns as needing new data', () => {
    const g = chain('soft_dollar_client_report', [{ type: 'select', cfg: { drop: [], extras: ['realized_pnl'] } }], 'acme');
    expect(analyse(g).st.extras).toEqual(['realized_pnl']);
  });

  it('unconnected steps are reported as incomplete', () => {
    const g = defaultFlow();
    const open = layout({ nodes: g.nodes, edges: g.edges.filter((e) => e.to !== 'n4') });
    expect(analyse(open).st.miss).toBe(true);
  });
});

describe('catalog', () => {
  it('treats internal-only columns as restricted but not the client key shared names', () => {
    expect(restricted.has('broker_notes')).toBe(true);
    expect(restricted.has('commission')).toBe(false);
  });
});
