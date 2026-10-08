import { describe, expect, it } from 'vitest';
import { compile, OPS_BY_TYPE, validate } from '../src';
import { catalog, chain, params } from './helpers';

type R = Record<string, unknown>;
const run = (rule: R, ds = 'commission_summary') => compile(chain(ds, [{ type: 'filter', cfg: { rules: [rule] } }]), catalog, params);
const where = (rule: R, ds?: string) => run(rule, ds).sql.split('\n    WHERE ').pop()!.split('\n  )')[0]!;
const errs = (rule: R, ds = 'commission_summary') => validate(chain(ds, [{ type: 'filter', cfg: { rules: [rule] } }]), catalog, params).issues.map((i) => i.message);

describe('comparison operators', () => {
  it.each([
    ['gte', 'gross_commission', '>='], ['lte', 'gross_commission', '<='], ['gt', 'gross_commission', '>'], ['lt', 'gross_commission', '<'],
  ])('%s on a number', (op, col, sym) => {
    expect(where({ col, op, val: '1500' })).toBe(`"${col}" ${sym} :f1`);
    expect(run({ col, op, val: '1500' }).params.f1).toBe(1500);
  });

  it('dates: gte / lte use TO_DATE, between is inclusive and binds both ends', () => {
    expect(where({ col: 'trade_date', op: 'gte', val: '2026-10-01' })).toBe('"trade_date" >= TO_DATE(:f1)');
    const r = run({ col: 'trade_date', op: 'between', val: '2026-10-01', val2: '2026-10-07' });
    expect(r.sql).toContain('WHERE "trade_date" BETWEEN TO_DATE(:f1) AND TO_DATE(:f2)');
    expect(r.positional.binds).toEqual(['acme', '2026-10-01', '2026-10-07']);
  });

  it('between on numbers, and it needs both values', () => {
    expect(where({ col: 'fees', op: 'between', val: '10', val2: '50' })).toBe('"fees" BETWEEN :f1 AND :f2');
    expect(errs({ col: 'fees', op: 'between', val: '10', val2: '' })).toEqual(['Rule 1: "is between" needs two values.']);
    expect(errs({ col: 'fees', op: 'between', val: '10', val2: 'x' })[0]).toMatch(/needs a number/);
  });

  it('in / not in bind every value; text is case-insensitive', () => {
    const r = run({ col: 'desk', op: 'in', vals: ['Cash', 'Options'] });
    expect(r.sql).toContain('WHERE LOWER("desk") IN (LOWER(:f1), LOWER(:f2))');
    expect(r.positional.binds).toEqual(['acme', 'Cash', 'Options']);
    expect(where({ col: 'fees', op: 'not_in', vals: ['35', '45'] })).toBe('"fees" NOT IN (:f1, :f2)');
    expect(where({ col: 'trade_date', op: 'in', vals: ['2026-10-06', '2026-10-07'] })).toBe('"trade_date" IN (TO_DATE(:f1), TO_DATE(:f2))');
  });

  it('text: starts with, ends with, does not contain', () => {
    expect(where({ col: 'symbol', op: 'starts_with', val: 'AA' })).toBe('STARTSWITH(LOWER("symbol"), LOWER(:f1))');
    expect(where({ col: 'symbol', op: 'ends_with', val: 'PL' })).toBe('ENDSWITH(LOWER("symbol"), LOWER(:f1))');
    expect(where({ col: 'symbol', op: 'not_contains', val: 'X' })).toBe('NOT CONTAINS(LOWER("symbol"), LOWER(:f1))');
  });

  it('blank checks need no value and are never ignored', () => {
    const r = run({ col: 'fees', op: 'is_null' });
    expect(r.sql).toContain('WHERE "fees" IS NULL');
    expect(r.params).toEqual({ client: 'acme' });
    expect(r.warnings).toEqual([]);
    expect(where({ col: 'fees', op: 'is_not_null' })).toBe('"fees" IS NOT NULL');
    // for text, blank means missing or empty
    expect(where({ col: 'desk', op: 'is_null' })).toBe(`("desk" IS NULL OR "desk" = '')`);
    expect(where({ col: 'desk', op: 'is_not_null' })).toBe(`("desk" IS NOT NULL AND "desk" <> '')`);
  });

  it('rules with no value are still ignored, with a warning', () => {
    for (const rule of [{ col: 'fees', op: 'gte', val: '' }, { col: 'desk', op: 'in', vals: [] }, { col: 'desk', op: 'in', vals: [''] }, { col: 'fees', op: 'between' }]) {
      const r = run(rule);
      expect(r.sql).not.toContain('WHERE "fees"');
      expect(r.warnings).toEqual(['1 filter rule has no value and is ignored.']);
    }
  });

  it('summaries read naturally', () => {
    const s = (rule: R) => run(rule).summary[1];
    expect(s({ col: 'fees', op: 'gte', val: '10' })).toBe('Keep rows where fees is at least 10');
    expect(s({ col: 'fees', op: 'lte', val: '10' })).toBe('Keep rows where fees is at most 10');
    expect(s({ col: 'fees', op: 'between', val: '10', val2: '50' })).toBe('Keep rows where fees is between 10 and 50');
    expect(s({ col: 'desk', op: 'in', vals: ['Cash', 'Options'] })).toBe('Keep rows where desk is one of "Cash", "Options"');
    expect(s({ col: 'fees', op: 'is_null' })).toBe('Keep rows where fees is blank');
  });

  it('every operator is allowed only on the column types that make sense', () => {
    expect(errs({ col: 'desk', op: 'gte', val: 'a' })[0]).toMatch(/cannot be compared with "is at least"/);
    expect(errs({ col: 'desk', op: 'between', val: 'a', val2: 'b' })[0]).toMatch(/cannot be compared/);
    expect(errs({ col: 'fees', op: 'starts_with', val: '1' })[0]).toMatch(/cannot be compared with "starts with"/);
    expect(errs({ col: 'fees', op: 'not_contains', val: '1' })[0]).toMatch(/cannot be compared/);
    expect(errs({ col: 'fees', op: 'median', val: '1' })).toEqual(['Rule 1: unknown comparison.']);
    expect(OPS_BY_TYPE.boolean).toEqual(['eq', 'ne', 'is_null', 'is_not_null']);
  });

  it('list limits and malformed shapes', () => {
    expect(errs({ col: 'desk', op: 'in', vals: Array.from({ length: 101 }, (_, i) => 'v' + i) })).toEqual(['Rule 1: a list can have at most 100 values.']);
    expect(errs({ col: 'desk', op: 'in', vals: 'Cash' })).toEqual(['Rule 1 is not in the expected format.']);
    expect(errs({ col: 'desk', op: 'in', vals: [1, 2] })).toEqual(['Rule 1 is not in the expected format.']);
    expect(errs({ col: 'fees', op: 'in', vals: ['1', 'two'] })[0]).toMatch(/needs a number/);
  });

  it('hostile values stay in binds for every operator', () => {
    const evil = `x'); DROP TABLE t; --`;
    for (const rule of [
      { col: 'desk', op: 'in', vals: [evil, 'b'] }, { col: 'desk', op: 'not_in', vals: [evil] }, { col: 'desk', op: 'starts_with', val: evil },
      { col: 'desk', op: 'ends_with', val: evil }, { col: 'desk', op: 'not_contains', val: evil }, { col: 'desk', op: 'ne', val: evil },
    ]) {
      const r = run(rule);
      expect(r.sql).not.toContain('DROP');
      expect(r.positional.binds).toContain(evil);
    }
  });
});
