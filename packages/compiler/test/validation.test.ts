import { describe, expect, it } from 'vitest';
import { compile, validate, type Graph } from '../src';
import { catalog, chain, filter, params, select } from './helpers';

const codes = (g: unknown, p = params) => validate(g, catalog, p).issues.map((i) => i.code);

describe('type errors', () => {
  it.each([
    ['gt on text', { col: 'symbol', op: 'gt', val: 'A' }, /cannot be compared/],
    ['contains on number', { col: 'quantity', op: 'contains', val: '5' }, /cannot be compared/],
    ['text in a number column', { col: 'quantity', op: 'gt', val: 'many' }, /needs a number/],
    ['hex / exponent are not numbers', { col: 'quantity', op: 'gt', val: '0x10' }, /needs a number/],
    ['1,000 is not a number', { col: 'quantity', op: 'gt', val: '1,000' }, /needs a number/],
    ['bad date', { col: 'as_of_date', op: 'eq', val: '2026-02-30' }, /YYYY-MM-DD/],
    ['unknown comparison', { col: 'quantity', op: 'approximately', val: '1' }, /unknown comparison/],
    ['too long', { col: 'symbol', op: 'eq', val: 'x'.repeat(501) }, /too long/],
  ])('%s', (_n, rule, msg) => {
    expect(() => compile(chain('client_positions_report', [filter(rule)]), catalog, params)).toThrow(msg);
  });

  it('numbers bind as numbers', () => {
    const r = compile(chain('client_positions_report', [filter({ col: 'quantity', op: 'gt', val: '-0.5' })]), catalog, params);
    expect(r.params.f1).toBe(-0.5);
  });
});

describe('structure', () => {
  it('missing input', () => {
    const g = chain('client_positions_report', [filter()]);
    g.edges = g.edges.filter((e) => e.to !== 'n2');
    expect(codes(g)).toEqual(['MISSING_INPUT']);
  });

  it('cycles are detected', () => {
    const g: Graph = {
      nodes: [
        { id: 'a', type: 'filter', cfg: { rules: [] } },
        { id: 'b', type: 'filter', cfg: { rules: [] } },
        { id: 's3', type: 's3', cfg: { client: 'acme', folder: 'f', fmt: 'CSV' } },
      ],
      edges: [{ from: 'a', to: 'b', port: 'in' }, { from: 'b', to: 'a', port: 'in' }, { from: 'b', to: 's3', port: 'in' }],
    };
    expect(codes(g)).toContain('CYCLE');
    const self: Graph = { nodes: [g.nodes[0]!, g.nodes[2]!], edges: [{ from: 'a', to: 'a', port: 'in' }, { from: 'a', to: 's3', port: 'in' }] };
    expect(codes(self)).toContain('CYCLE');
  });

  it('needs exactly one S3 output, and it cannot feed anything', () => {
    const none = chain('client_positions_report');
    none.nodes = none.nodes.filter((n) => n.type !== 's3');
    none.edges = [];
    expect(codes(none)).toEqual(['OUTPUT_COUNT']);
    const two = chain('client_positions_report');
    two.nodes.push({ id: 's3b', type: 's3', cfg: {} });
    expect(codes(two)).toEqual(['OUTPUT_COUNT']);
    const out = chain('client_positions_report', [filter()]);
    out.edges.push({ from: 's3', to: 'n2', port: 'in' });
    expect(codes(out)).toContain('BAD_EDGE');
  });

  it('bad edges: unknown node, wrong port, two connections into one input', () => {
    const a = chain('client_positions_report');
    a.edges.push({ from: 'ghost', to: 's3', port: 'in' });
    expect(codes(a)).toEqual(['BAD_EDGE']);
    const b = chain('client_positions_report');
    b.edges[0]!.port = 'a';
    expect(codes(b)).toEqual(['BAD_EDGE']);
    const c = chain('client_positions_report');
    c.nodes.push({ id: 'x', type: 'source', cfg: { ds: 'security_master' } });
    c.edges.push({ from: 'x', to: 's3', port: 'in' });
    expect(codes(c)).toEqual(['BAD_EDGE']);
  });

  it('duplicate ids and too many steps', () => {
    const g = chain('client_positions_report');
    g.nodes.push({ id: 'n1', type: 'source', cfg: { ds: 'security_master' } });
    expect(codes(g)).toEqual(['DUPLICATE_NODE_ID']);
    const big = chain('client_positions_report', Array.from({ length: 60 }, () => filter()));
    expect(codes(big)).toEqual(['TOO_MANY_NODES']);
    expect(validate(big, catalog, params, { maxNodes: 100 }).ok).toBe(true);
  });

  it('steps not connected to the output are ignored with a warning', () => {
    const g = chain('client_positions_report');
    g.nodes.push({ id: 'orphan', type: 'source', cfg: { ds: 'soft_dollar_client_report' } });
    const r = compile(g, catalog, params);
    expect(r.sql).not.toContain('SOFT_DOLLAR');
    expect(r.warnings).toEqual(['1 step is not connected to the output and will be ignored.']);
  });

  it('reports every problem at once, without cascading errors', () => {
    const g = chain('nope', [filter({ col: 'x', op: 'eq', val: '1' }), select(['y'])], { folder: 'Bad' });
    const issues = validate(g, catalog, params).issues;
    expect(issues.map((i) => i.code)).toEqual(['UNKNOWN_DATASET', 'BAD_OUTPUT']);
  });
});

describe('scope of this phase', () => {
  it('requests with new fields go to data engineering, not SQL', () => {
    expect(codes(chain('soft_dollar_client_report', [select([], ['realized_pnl'])]))).toEqual(['NEEDS_DATA_ENG']);
  });
  it.each(['addcol', 'join', 'union'])('%s is reported as not available yet', (type) => {
    const ports = type === 'join' || type === 'union' ? ['a', 'b'] : ['in'];
    const g: Graph = {
      nodes: [
        { id: 'n1', type: 'source', cfg: { ds: 'client_positions_report' } },
        { id: 'n2', type: type, cfg: {} },
        { id: 's3', type: 's3', cfg: { client: 'acme', folder: 'f', fmt: 'CSV' } },
      ],
      edges: [...ports.map((p) => ({ from: 'n1', to: 'n2', port: p })), { from: 'n2', to: 's3', port: 'in' }],
    };
    expect(codes(g)).toEqual(['UNSUPPORTED_STEP']);
  });
  it('hiding every column is refused', () => {
    const cols = ['as_of_date', 'symbol', 'quantity', 'market_value'];
    expect(codes(chain('client_positions_report', [select(cols)]))).toEqual(['NO_COLUMNS']);
  });
  it('rejects a malformed run date', () => {
    expect(codes(chain('client_positions_report'), { ...params, runDate: '2026-13-01' })).toEqual(['BAD_PARAM']);
  });
});
