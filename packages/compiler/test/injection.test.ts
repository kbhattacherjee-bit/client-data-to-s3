import { describe, expect, it } from 'vitest';
import { compile, quoteIdent } from '../src';
import { catalog, chain, clone, filter, params, select } from './helpers';

const nasty = [
  `'; DROP TABLE x; --`, `" OR 1=1 --`, `a"b`, `x'y`, `/* c */ ; SELECT 1`, `\\'`, `é世界🙂`, `%_`, '\u0000', 'a\nb', `$$ ; $$`, `:client`, `?`,
];

describe('injection', () => {
  it('filter values only ever appear as bind parameters', () => {
    for (const v of nasty) {
      const r = compile(chain('commission_summary', [filter({ col: 'desk', op: 'eq', val: v })]), catalog, params);
      expect(r.params.f1).toBe(v);
      expect(r.positional.binds).toContain(v);
      // ':client' and '?' are also our own placeholders, so they can only be checked by the placeholder list below
      if (v !== ':client' && v !== '?') {
        expect(r.sql).not.toContain(v);
        expect(r.positional.sql).not.toContain(v);
      }
      // the only placeholders in the text are the ones we generated
      expect(r.sql.match(/:\w+/g)).toEqual([':client', ':f1']);
    }
  });

  it('hostile column names in rules, select and datasets are rejected, not emitted', () => {
    for (const v of nasty) {
      expect(() => compile(chain('commission_summary', [filter({ col: v, op: 'eq', val: '1' })]), catalog, params)).toThrow();
      expect(() => compile(chain('commission_summary', [select([v])]), catalog, params)).toThrow();
      expect(() => compile(chain(v), catalog, params)).toThrow(/not a dataset/);
    }
  });

  it('hostile operators, folders, formats and clients are rejected', () => {
    expect(() => compile(chain('commission_summary', [filter({ col: 'desk', op: `eq OR 1=1`, val: 'x' })]), catalog, params)).toThrow(/unknown comparison/);
    for (const folder of [`x"; DROP`, 'Bad Name', '../up', '1abc', '']) {
      expect(() => compile(chain('commission_summary', [], { folder }), catalog, params)).toThrow(/folder/);
    }
    expect(() => compile(chain('commission_summary', [], { fmt: `CSV'; --` }), catalog, params)).toThrow(/CSV or Parquet/);
    const c = `acme' OR '1'='1`;
    expect(() => compile(chain('commission_summary', [], { client: c }), catalog, { client: c, allowedClients: ['acme'] })).toThrow();
  });

  it('even an allowed client id is bound, not inlined', () => {
    const c = `o'brien"; --`;
    const r = compile(chain('commission_summary', [], { client: c }), catalog, { client: c, allowedClients: [c] });
    expect(r.sql).not.toContain(c);
    expect(r.params.client).toBe(c);
  });

  it('quoteIdent doubles embedded quotes and refuses control characters', () => {
    expect(quoteIdent('a"b')).toBe('"a""b"');
    expect(quoteIdent('é世界')).toBe('"é世界"');
    for (const bad of ['', 'a\u0000b', 'a\nb', 'x'.repeat(256)]) expect(() => quoteIdent(bad)).toThrow();
  });

  it('a hostile name that somehow is in the catalog is still safely quoted', () => {
    const cat = clone(catalog);
    const m = cat.models.find((x) => x.name === 'security_master')!;
    m.columns.push({ name: `a"b; DROP`, type: 'text', selectable: true, client_key: false });
    // output names must be plain, so the compile is refused at the output step ...
    expect(() => compile(chain('security_master'), cat, params)).toThrow(/cannot be used as an output column name/);
    // ... and if the column is hidden it never reaches SQL
    m.columns[m.columns.length - 1]!.selectable = false;
    expect(compile(chain('security_master'), cat, params).sql).not.toContain('DROP');
  });

  it('malformed input never throws anything but CompileError', () => {
    for (const g of [null, undefined, 1, 'x', [], {}, { nodes: 1, edges: [] }, { nodes: [null], edges: [] }, { nodes: [{ id: 1 }], edges: [{}] }]) {
      expect(() => compile(g, catalog, params)).toThrow(expect.objectContaining({ name: 'CompileError' }));
    }
    const proto = { nodes: [{ id: '__proto__', type: 'constructor', cfg: {} }], edges: [] };
    expect(() => compile(proto, catalog, params)).toThrow(expect.objectContaining({ name: 'CompileError' }));
  });
});
