import { describe, expect, it } from 'vitest';
import { compile } from '../src';
import { catalog, chain, clone, filter, params, select } from './helpers';

describe('golden SQL', () => {
  it('source only, client scoped', () => {
    const r = compile(chain('client_positions_report'), catalog, params);
    expect(r.sql).toBe(`WITH
  s1 AS (
    SELECT "AS_OF_DATE" AS "as_of_date", "SYMBOL" AS "symbol", "QUANTITY" AS "quantity", "MARKET_VALUE" AS "market_value"
    FROM "REPORTING"."CLIENT_POSITIONS_REPORT"
    WHERE "CLIENT_ID" = :client
  )
SELECT "as_of_date", "symbol", "quantity", "market_value"
FROM s1`);
    expect(r.params).toEqual({ client: 'acme' });
    expect(r.outputColumns.map((c) => c.name)).toEqual(['as_of_date', 'symbol', 'quantity', 'market_value']);
    expect(r.delivery).toEqual({ client: 'acme', folder: 'out_folder', fmt: 'CSV' });
  });

  it('hides restricted columns and the client key from the source', () => {
    const r = compile(chain('soft_dollar_client_report'), catalog, params);
    expect(r.sql).not.toMatch(/BROKER_NOTES/i);
    expect(r.outputColumns.map((c) => c.name)).not.toContain('client_id');
    expect(r.outputColumns.map((c) => c.name)).not.toContain('broker_notes');
  });

  it('select then filter on a number', () => {
    const r = compile(
      chain('soft_dollar_client_report', [select(['soft_dollar_amount', 'net_amount']), filter({ col: 'commission', op: 'gt', val: '1000' })]),
      catalog, params,
    );
    expect(r.sql).toBe(`WITH
  s1 AS (
    SELECT "TRADE_DATE" AS "trade_date", "SYMBOL" AS "symbol", "COMMISSION" AS "commission", "SOFT_DOLLAR_AMOUNT" AS "soft_dollar_amount", "NET_AMOUNT" AS "net_amount"
    FROM "REPORTING"."SOFT_DOLLAR_CLIENT_REPORT"
    WHERE "CLIENT_ID" = :client
  ),
  s2 AS (
    SELECT "trade_date", "symbol", "commission"
    FROM s1
  ),
  s3 AS (
    SELECT *
    FROM s2
    WHERE "commission" > :f1
  )
SELECT "trade_date", "symbol", "commission"
FROM s3`);
    expect(r.params).toEqual({ client: 'acme', f1: 1000 });
    expect(r.summary).toEqual([
      'Start from Soft-dollar commissions',
      'Hide columns: soft_dollar_amount, net_amount',
      'Keep rows where commission is greater than 1000',
      'Write to S3 for acme as CSV in "out_folder" (3 columns)',
    ]);
  });

  it('text comparisons are case-insensitive and contains is a substring test', () => {
    const r = compile(
      chain('commission_summary', [filter({ col: 'desk', op: 'eq', val: 'cash' }, { col: 'symbol', op: 'contains', val: 'AP' }, { col: 'desk', op: 'ne', val: 'Options' })]),
      catalog, params,
    );
    expect(r.sql).toContain(`WHERE LOWER("desk") = LOWER(:f1)\n      AND CONTAINS(LOWER("symbol"), LOWER(:f2))\n      AND LOWER("desk") <> LOWER(:f3)`);
    expect(r.params).toMatchObject({ f1: 'cash', f2: 'AP', f3: 'Options' });
  });

  it('dates use TO_DATE on the bound value', () => {
    const r = compile(chain('client_positions_report', [filter({ col: 'as_of_date', op: 'eq', val: '2026-10-07' })]), catalog, params);
    expect(r.sql).toContain('WHERE "as_of_date" = TO_DATE(:f1)');
    expect(r.params.f1).toBe('2026-10-07');
  });

  it('a rule with an empty value is ignored, with a warning', () => {
    const r = compile(chain('client_positions_report', [filter({ col: 'quantity', op: 'gt', val: '' })]), catalog, params);
    expect(r.sql).not.toContain('WHERE "quantity"');
    expect(r.sql).toContain('SELECT *\n    FROM s1\n  )');
    expect(r.warnings).toEqual(['1 filter rule has no value and is ignored.']);
    expect(r.summary).toContain('Filter rows (no rules, so every row passes)');
  });

  it('reference datasets get no client filter', () => {
    const r = compile(chain('security_master'), catalog, params);
    expect(r.sql).not.toContain('WHERE');
    expect(r.sql).toContain('"REFERENCE"."SECURITY_MASTER"');
    expect(r.params).toEqual({});
  });

  it('positional binds follow the order of appearance', () => {
    const r = compile(chain('client_positions_report', [filter({ col: 'quantity', op: 'gt', val: '5000' }, { col: 'symbol', op: 'eq', val: 'aapl' })]), catalog, params);
    expect(r.positional.sql).toContain('WHERE "CLIENT_ID" = ?');
    expect(r.positional.sql).not.toMatch(/:\w+/);
    expect(r.positional.binds).toEqual(['acme', 5000, 'aapl']);
  });

  it('physicalCase preserve leaves names as the catalog has them', () => {
    const r = compile(chain('client_positions_report'), catalog, params, { physicalCase: 'preserve' });
    expect(r.sql).toContain('SELECT "as_of_date", "symbol"');
    expect(r.sql).toContain('FROM "reporting"."client_positions_report"\n    WHERE "client_id" = :client');
  });

  it('adds the run date only for models that declare date_column', () => {
    const cat = clone(catalog);
    cat.models.find((m) => m.name === 'client_positions_report')!.date_column = 'as_of_date';
    const r = compile(chain('client_positions_report'), cat, { ...params, runDate: '2026-10-07' });
    expect(r.sql).toContain(`WHERE "CLIENT_ID" = :client\n      AND "AS_OF_DATE" = TO_DATE(:run_date)`);
    expect(r.params).toEqual({ client: 'acme', run_date: '2026-10-07' });
    // no run date supplied, or model without date_column: no date predicate
    expect(compile(chain('client_positions_report'), cat, params).sql).not.toContain('run_date');
    expect(compile(chain('commission_summary'), cat, { ...params, runDate: '2026-10-07' }).sql).not.toContain('run_date');
  });
});

describe('determinism', () => {
  it('node and edge order in the JSON does not change the SQL', () => {
    const g = chain('soft_dollar_client_report', [select(['net_amount']), filter({ col: 'commission', op: 'gt', val: '1' })]);
    const shuffled = { nodes: [...g.nodes].reverse(), edges: [...g.edges].reverse() };
    expect(compile(shuffled, catalog, params).sql).toBe(compile(g, catalog, params).sql);
  });
});
