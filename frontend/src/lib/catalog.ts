import raw from '../../../catalog/catalog.json';
import type { Catalog as CompilerCatalog } from '../../../packages/compiler/src';
import type { ColType, Dataset } from './types';

interface CatalogColumn {
  name: string;
  type: ColType;
  description: string;
  selectable: boolean;
  format: 'currency' | 'none';
  client_key: boolean;
}
interface CatalogModel {
  name: string;
  table: string;
  label: string;
  description: string;
  folder: string;
  reference: boolean;
  columns: CatalogColumn[];
}
interface CatalogFile {
  schema_version: string;
  models: CatalogModel[];
}

const catalog = raw as unknown as CatalogFile;

export const schemaVersion = catalog.schema_version;
/** The same catalog.json, typed for the SQL compiler. */
export const compilerCatalog = raw as unknown as CompilerCatalog;
export const models = catalog.models;

const isVisible = (c: CatalogColumn) => c.selectable && !c.client_key;

/** Datasets as the canvas sees them: visible columns only. The client key and restricted columns never reach the UI. */
export const datasets: Record<string, Dataset> = Object.fromEntries(
  models.map((m) => {
    const vis = m.columns.filter(isVisible);
    return [
      m.name,
      {
        key: m.name,
        name: m.label,
        table: m.table,
        desc: m.description,
        folder: m.folder,
        reference: m.reference,
        cols: vis.map((c) => c.name),
        types: vis.map((c) => c.type),
        descs: vis.map((c) => c.description),
        hidden: m.columns.filter((c) => !isVisible(c)).map((c) => c.name),
      } satisfies Dataset,
    ];
  }),
);

/** Names that exist only as hidden columns, so typing them in "add a column by name" is rejected. */
export const restricted: Set<string> = (() => {
  const hid = new Set<string>();
  const vis = new Set<string>();
  models.forEach((m) => m.columns.forEach((c) => (isVisible(c) ? vis : hid).add(c.name)));
  return new Set([...hid].filter((x) => !vis.has(x)));
})();

const currencyCols = models.flatMap((m) => m.columns.filter((c) => c.format === 'currency').map((c) => c.name));

/** Derived names such as sum_commission inherit the currency format. */
export const isCurrency = (col: string) => currencyCols.some((k) => col === k || col.endsWith('_' + k));

export const clients: Record<string, { name: string; slug: string }> = {
  acme: { name: 'Acme Capital', slug: 'acme' },
  vertex: { name: 'Vertex Partners', slug: 'vertex' },
  smac: { name: 'SMAC', slug: 'smac' },
};

export const s3Path = (client: string, folder: string) =>
  `s3://clearstreet-client-reports/clients/${clients[client].slug}/YYYY/MM/DD/${folder}/`;
