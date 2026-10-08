import { describe, expect, it } from 'vitest';
import { compile, validate } from '../src';
import { catalog, chain, params } from './helpers';

const rule = (col: string, op: string, val: string) => ({ col, op, val });
const flt = (cfg: Record<string, unknown>) => ({ type: 'filter', cfg });
const grp = (cfg: Record<string, unknown>) => ({ type: 'group', cfg });
const msgs = (g: unknown) => validate(g, catalog, params).issues.map((i) => i.message);

describe('filter: all / any and nested groups', () => {
  it('match any joins with OR', () => {
    const r = compile(chain('commission_summary', [flt({ match: 'any', rules: [rule('desk', 'eq', 'Cash'), rule('gross_commission', 'gt', '2000')] })]), catalog, params);
    expect(r.sql).toContain(`WHERE LOWER("desk") = LOWER(:f1)\n      OR "gross_commission" > :f2`);
    expect(r.summary).toContain('Keep rows where desk equals "Cash" or gross_commission is greater than 2000');
  });

  it('match all is the default and unchanged', () => {
    const r = compile(chain('commission_summary', [flt({ rules: [rule('desk', 'eq', 'Cash'), rule('gross_commission', 'gt', '2000')] })]), catalog, params);
    expect(r.sql).toContain(`WHERE LOWER("desk") = LOWER(:f1)\n      AND "gross_commission" > :f2`);
  });

  it('A and (B or C): nested groups are parenthesised and binds stay in textual order', () => {
    const r = compile(chain('commission_summary', [flt({
      match: 'all',
      rules: [rule('gross_commission', 'gt', '1000'), { match: 'any', rules: [rule('desk', 'eq', 'Cash'), rule('symbol', 'contains', 'AP')] }],
    })]), catalog, params);
    expect(r.sql).toContain(`WHERE "gross_commission" > :f1\n      AND (LOWER("desk") = LOWER(:f2) OR CONTAINS(LOWER("symbol"), LOWER(:f3)))`);
    expect(r.positional.binds).toEqual(['acme', 1000, 'Cash', 'AP']);
    expect(r.summary).toContain('Keep rows where gross_commission is greater than 1000 and (desk equals "Cash" or symbol contains "AP")');
  });

  it('OR cannot escape the client predicate: it lives in a different CTE', () => {
    const r = compile(chain('commission_summary', [flt({ match: 'any', rules: [rule('desk', 'eq', 'a'), rule('desk', 'eq', 'b')] })]), catalog, params);
    const [source, filter] = r.sql.split('s2 AS');
    expect(source).toContain('"CLIENT_ID" = :client');
    expect(filter).not.toContain('CLIENT_ID');
    expect(r.sql.match(/ OR /g)?.length).toBe(1);
  });

  it('empty values are dropped from their group, and empty groups vanish', () => {
    const r = compile(chain('commission_summary', [flt({
      match: 'any',
      rules: [rule('desk', 'eq', ''), { match: 'all', rules: [rule('symbol', 'eq', '')] }, rule('symbol', 'eq', 'AAPL')],
    })]), catalog, params);
    // an ignored rule inside "any" must NOT make everything pass
    expect(r.sql).toContain('WHERE LOWER("symbol") = LOWER(:f1)');
    expect(r.sql).not.toContain(' OR ');
    expect(r.warnings).toEqual(['2 filter rules have no value and are ignored.']);
  });

  it('errors are located in nested rules; depth and size are limited', () => {
    const bad = chain('commission_summary', [flt({ rules: [{ match: 'any', rules: [rule('desk', 'gt', 'x')] }] })]);
    expect(msgs(bad)).toEqual(['Rule 1.1: "desk" is a text column and cannot be compared with "is greater than".']);
    const deep = (n: number): Record<string, unknown> => (n === 0 ? rule('desk', 'eq', 'x') : { match: 'all', rules: [deep(n - 1)] });
    expect(validate(chain('commission_summary', [flt({ rules: [deep(2)] })]), catalog, params).ok).toBe(true);
    expect(msgs(chain('commission_summary', [flt({ rules: [deep(5)] })]))).toEqual(['Rule groups can be nested 3 levels deep at most.']);
    expect(msgs(chain('commission_summary', [flt({ match: 'xor', rules: [] })]))).toEqual(['Choose "all" or "any" for how the rules combine.']);
    const many = Array.from({ length: 60 }, () => rule('desk', 'eq', 'x'));
    expect(msgs(chain('commission_summary', [flt({ rules: many })]))).toEqual(['A filter can have at most 50 rules.']);
  });
});

describe('group by', () => {
  const cfg = {
    by: ['desk', 'symbol'],
    aggs: [
      { col: 'gross_commission', fn: 'sum' },
      { col: 'rebates', fn: 'avg', as: 'avg_rebate' },
      { col: 'trade_date', fn: 'max' },
      { col: 'symbol', fn: 'count_distinct', as: 'symbols' },
      { col: 'fees', fn: 'count' },
      { col: 'fees', fn: 'min' },
    ],
  };

  it('compiles several group columns and a different function per column', () => {
    const r = compile(chain('commission_summary', [grp(cfg)]), catalog, params);
    expect(r.sql).toContain(`  s2 AS (
    SELECT "desk", "symbol", ROUND(SUM("gross_commission"), 2) AS "sum_gross_commission", ROUND(AVG("rebates"), 2) AS "avg_rebate", MAX("trade_date") AS "max_trade_date", COUNT(DISTINCT "symbol") AS "symbols", COUNT("fees") AS "count_fees", MIN("fees") AS "min_fees"
    FROM s1
    GROUP BY "desk", "symbol"
  )`);
    expect(r.outputColumns).toEqual([
      { name: 'desk', type: 'text' }, { name: 'symbol', type: 'text' }, { name: 'sum_gross_commission', type: 'number' },
      { name: 'avg_rebate', type: 'number' }, { name: 'max_trade_date', type: 'date' }, { name: 'symbols', type: 'number' },
      { name: 'count_fees', type: 'number' }, { name: 'min_fees', type: 'number' },
    ]);
    expect(r.summary[1]).toBe('Group by desk, symbol and work out total of gross_commission, average of rebates, largest trade_date, count of distinct symbol, count of fees, smallest fees');
  });

  it('no automatic row_count column', () => {
    const r = compile(chain('commission_summary', [grp({ by: ['desk'], aggs: [] })]), catalog, params);
    expect(r.outputColumns.map((c) => c.name)).toEqual(['desk']);
    expect(r.sql).not.toContain('row_count');
  });

  it('downstream steps see the grouped columns', () => {
    const r = compile(chain('commission_summary', [grp({ by: ['desk'], aggs: [{ col: 'fees', fn: 'sum' }] }), flt({ rules: [rule('sum_fees', 'gt', '100')] })]), catalog, params);
    expect(r.sql).toContain('WHERE "sum_fees" > :f1');
    expect(validate(chain('commission_summary', [grp({ by: ['desk'], aggs: [] }), flt({ rules: [rule('fees', 'gt', '1')] })]), catalog, params).issues[0]?.code).toBe('UNKNOWN_COLUMN');
  });

  it.each([
    ['sum of text', { by: ['desk'], aggs: [{ col: 'symbol', fn: 'sum' }] }, /needs a number column, but "symbol" is text/],
    ['avg of date', { by: ['desk'], aggs: [{ col: 'trade_date', fn: 'avg' }] }, /needs a number column/],
    ['min of text', { by: ['desk'], aggs: [{ col: 'symbol', fn: 'min' }] }, /needs a number or date or timestamp column/],
    ['unknown function', { by: ['desk'], aggs: [{ col: 'fees', fn: 'median' }] }, /unknown calculation/],
    ['unknown group column', { by: ['nope'], aggs: [] }, /not a column/],
    ['restricted column', { by: ['client_id'], aggs: [] }, /not a column/],
    ['no group column', { by: [], aggs: [] }, /at least one column/],
    ['old single-column shape', { by: 'desk', agg: 'sum' }, /not in the expected format/],
    ['duplicate group column', { by: ['desk', 'desk'], aggs: [] }, /listed twice/],
    ['name collision', { by: ['desk'], aggs: [{ col: 'fees', fn: 'sum' }, { col: 'rebates', fn: 'sum', as: 'sum_fees' }] }, /both be called "sum_fees"/],
    ['collision with a group column', { by: ['desk'], aggs: [{ col: 'fees', fn: 'sum', as: 'desk' }] }, /both be called "desk"/],
    ['hostile alias', { by: ['desk'], aggs: [{ col: 'fees', fn: 'sum', as: 'x"; DROP TABLE t; --' }] }, /not a valid column name/],
    ['uppercase alias', { by: ['desk'], aggs: [{ col: 'fees', fn: 'sum', as: 'Total' }] }, /not a valid column name/],
  ])('%s', (_n, c, re) => {
    expect(() => compile(chain('commission_summary', [grp(c)]), catalog, params)).toThrow(re);
  });

  it('keeps client isolation: the predicate is still in the source CTE', () => {
    const r = compile(chain('commission_summary', [grp(cfg)]), catalog, params);
    expect(r.sql.indexOf('"CLIENT_ID" = :client')).toBeLessThan(r.sql.indexOf('GROUP BY'));
    expect(r.sql.match(/CLIENT_ID/g)?.length).toBe(1);
  });
});
