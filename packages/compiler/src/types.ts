export type ColType = 'text' | 'number' | 'date' | 'timestamp' | 'boolean';
export type FilterOp =
  | 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'in' | 'not_in'
  | 'contains' | 'not_contains' | 'starts_with' | 'ends_with' | 'is_null' | 'is_not_null';

/** The subset of catalog.json (see catalog/build_catalog.py) the compiler reads. */
export interface CatalogColumn {
  name: string;
  type: ColType;
  selectable: boolean;
  client_key: boolean;
}
export interface CatalogModel {
  name: string;
  /** "schema.model", as written by build_catalog.py */
  table: string;
  label: string;
  folder: string;
  reference: boolean;
  client_column: string | null;
  /** Proposal for SPEC open item #4: column the runner's date is matched against. Not in the catalog yet. */
  date_column?: string | null;
  columns: CatalogColumn[];
}
export interface Catalog {
  schema_version: string;
  models: CatalogModel[];
}

/** The flow graph as stored by the UI (SPEC section 6). Treated as untrusted input. */
export interface Graph {
  nodes: { id: string; type: string; cfg?: Record<string, unknown> }[];
  edges: { from: string; to: string; port: string }[];
}

export interface CompileParams {
  /** The client this run is for. Must equal the output step's client and be in allowedClients. */
  client: string;
  /** Server-side list of clients the caller may use (SPEC open item #5). */
  allowedClients: readonly string[];
  /** YYYY-MM-DD. Only used for models that declare date_column (SPEC open item #4). */
  runDate?: string;
}

export interface CompileOptions {
  /** Default 50 (SPEC section 6). */
  maxNodes?: number;
  /**
   * How physical table and column names are cased in Snowflake. dbt models are normally stored
   * upper case because identifiers are created unquoted. Default 'upper'. ASSUMPTION, see docs/decisions.md.
   */
  physicalCase?: 'upper' | 'lower' | 'preserve';
}

export type IssueCode =
  | 'BAD_GRAPH' | 'TOO_MANY_NODES' | 'DUPLICATE_NODE_ID' | 'UNKNOWN_STEP_TYPE' | 'UNSUPPORTED_STEP'
  | 'BAD_EDGE' | 'OUTPUT_COUNT' | 'MISSING_INPUT' | 'CYCLE' | 'UNKNOWN_DATASET' | 'CATALOG_INVALID'
  | 'UNKNOWN_COLUMN' | 'NEEDS_DATA_ENG' | 'NO_COLUMNS' | 'BAD_RULE' | 'TYPE_ERROR'
  | 'CLIENT_NOT_ALLOWED' | 'BAD_OUTPUT' | 'BAD_PARAM';

export interface Issue {
  code: IssueCode;
  /** Plain language, safe to show to a requester. */
  message: string;
  nodeId?: string;
}

export type ParamValue = string | number | boolean;

export interface CompileResult {
  /** Named binds (:client, :f1, ...). This is the text a human approves and the one that gets hashed. */
  sql: string;
  params: Record<string, ParamValue>;
  /** Same query with `?` binds in textual order, for drivers that need positional binds. */
  positional: { sql: string; binds: ParamValue[] };
  outputColumns: { name: string; type: ColType }[];
  /** Numbered plain-language steps for the approver. */
  summary: string[];
  warnings: string[];
  /** What the handoff adapter needs (SPEC open item #3). */
  delivery: { client: string; folder: string; fmt: 'CSV' | 'Parquet' };
}

export class CompileError extends Error {
  constructor(public readonly issues: Issue[]) {
    super(issues.map((i) => i.message).join('; '));
    this.name = 'CompileError';
  }
}
