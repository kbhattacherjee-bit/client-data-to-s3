export type ColType = 'text' | 'number' | 'date' | 'timestamp' | 'boolean';
export type Cell = string | number | boolean | null;

export type NodeType = 'source' | 'select' | 'filter' | 'group' | 'addcol' | 'join' | 'union' | 's3';
export type FnType = Exclude<NodeType, 'source' | 's3'>;
export type Port = 'in' | 'a' | 'b';
export type FilterOp = 'gt' | 'lt' | 'eq' | 'ne' | 'contains';
export type Agg = 'sum' | 'avg' | 'max';
export type ArithOp = '+' | '-' | '*' | '/';

export interface Rule {
  col: string;
  op: FilterOp;
  val: string;
}

/** Superset of every step's config; each step type only uses its own fields (see SPEC section 6). */
export interface Cfg {
  ds?: string;
  drop?: string[];
  extras?: string[];
  rules?: Rule[];
  by?: string;
  agg?: Agg;
  name?: string;
  a?: string;
  op?: ArithOp;
  b?: string;
  num?: string;
  key?: string;
  type?: 'inner' | 'left';
  client?: string;
  folder?: string;
  fmt?: 'CSV' | 'Parquet';
}

export interface FlowNode {
  id: string;
  type: NodeType;
  x: number;
  y: number;
  cfg: Cfg;
}

export interface Edge {
  from: string;
  to: string;
  port: Port;
}

export interface Graph {
  nodes: FlowNode[];
  edges: Edge[];
}

/** Result of evaluating one step. */
export interface Table {
  cols: string[];
  types: ColType[];
  rows: Cell[][];
  err?: string;
  warn?: string;
}

export type RequestStatus = 'Draft' | 'Pending' | 'Approved' | 'Rejected' | 'In data-eng' | 'Needs attention' | 'Paused';

export interface ReportRequest {
  id: string;
  name: string;
  client: string;
  status: RequestStatus;
  last: string;
  by: string;
  graph: Graph;
}

export interface Dataset {
  key: string;
  name: string;
  table: string;
  desc: string;
  folder: string;
  reference: boolean;
  cols: string[];
  types: ColType[];
  descs: string[];
  hidden: string[];
}
