import type { Rule } from './types';
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
  it('group keeps one row per key with the chosen totals', () => {
    const g = chain('commission_summary', [{ type: 'group', cfg: { by: ['desk'], aggs: [{ col: 'gross_commission', fn: 'sum' }] } }], 'smac');
    const { st } = analyse(g);
    expect(st.final.cols).toEqual(['desk', 'sum_gross_commission']);
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

describe('group and filter groups', () => {
  it('groups by two columns with a different function per column', () => {
    const g = chain('commission_summary', [{ type: 'group', cfg: { by: ['desk', 'symbol'], aggs: [{ col: 'gross_commission', fn: 'sum' }, { col: 'fees', fn: 'max', as: 'top_fee' }, { col: 'trade_date', fn: 'count_distinct' }] } }], 'smac');
    const { st } = analyse(g);
    expect(st.final.cols).toEqual(['desk', 'symbol', 'sum_gross_commission', 'top_fee', 'count_distinct_trade_date']);
    expect(st.final.rows).toHaveLength(6);
  });

  it('filter any vs all, nested', () => {
    const rule = (col: string, op: 'gt' | 'eq', val: string) => ({ col, op, val });
    const run = (cfg: object) => analyse(chain('commission_summary', [{ type: 'filter', cfg }], 'smac')).st.final.rows.length;
    expect(run({ match: 'all', rules: [rule('desk', 'eq', 'cash'), rule('gross_commission', 'gt', '1200')] })).toBe(2);
    expect(run({ match: 'any', rules: [rule('desk', 'eq', 'cash'), rule('gross_commission', 'gt', '2000')] })).toBe(4);
    expect(run({ match: 'all', rules: [rule('gross_commission', 'gt', '1000'), { match: 'any', rules: [rule('desk', 'eq', 'options'), rule('symbol', 'eq', 'jpm')] }] })).toBe(3);
    // an empty value inside "any" must not make every row pass
    expect(run({ match: 'any', rules: [rule('desk', 'eq', ''), rule('symbol', 'eq', 'jpm')] })).toBe(1);
  });
});

describe('filter operators (mock preview matches the compiler semantics)', () => {
  const rows = (rule: Rule) => analyse(chain('commission_summary', [{ type: 'filter', cfg: { match: 'all', rules: [rule] } }], 'smac')).st.final.rows.length;
  it('gte / lte / between are inclusive', () => {
    expect(rows({ col: 'gross_commission', op: 'gte', val: '1500' })).toBe(3); // 1500, 1700, 2600
    expect(rows({ col: 'gross_commission', op: 'gt', val: '1500' })).toBe(2);
    expect(rows({ col: 'gross_commission', op: 'lte', val: '1100' })).toBe(2); // 1100, 900
    expect(rows({ col: 'gross_commission', op: 'between', val: '1100', val2: '1500' })).toBe(3); // 1500, 1100, 1300
  });
  it('in / not in, text case-insensitive', () => {
    expect(rows({ col: 'symbol', op: 'in', val: '', vals: ['aapl', 'JPM'] })).toBe(3);
    expect(rows({ col: 'symbol', op: 'not_in', val: '', vals: ['aapl', 'JPM'] })).toBe(3);
    expect(rows({ col: 'symbol', op: 'in', val: '', vals: [] })).toBe(6); // no value: rule ignored
  });
  it('starts with / ends with / does not contain', () => {
    expect(rows({ col: 'symbol', op: 'starts_with', val: 'a' })).toBe(2);
    expect(rows({ col: 'symbol', op: 'ends_with', val: 'a' })).toBe(2); // NVDA, ... NVDA
    expect(rows({ col: 'symbol', op: 'not_contains', val: 'A' })).toBe(2); // MSFT, JPM
  });
  it('blank checks', () => {
    expect(rows({ col: 'fees', op: 'is_null', val: '' })).toBe(0);
    expect(rows({ col: 'fees', op: 'is_not_null', val: '' })).toBe(6);
  });
});

describe('catalog', () => {
  it('treats internal-only columns as restricted but not the client key shared names', () => {
    expect(restricted.has('broker_notes')).toBe(true);
    expect(restricted.has('commission')).toBe(false);
  });
});
