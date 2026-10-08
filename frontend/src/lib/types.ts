import type { FilterOp } from '../../../packages/compiler/src';
export type { FilterOp };
export type ColType = 'text' | 'number' | 'date' | 'timestamp' | 'boolean';
export type Cell = string | number | boolean | null;

export type NodeType = 'source' | 'select' | 'filter' | 'group' | 'addcol' | 'join' | 'union' | 's3';
export type FnType = Exclude<NodeType, 'source' | 's3'>;
export type Port = 'in' | 'a' | 'b';
export type AggFn = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'count_distinct';
export type ArithOp = '+' | '-' | '*' | '/';

export interface Rule {
  col: string;
  op: FilterOp;
  /** the value, or the lower end of "between" */
  val: string;
  /** upper end of "between" */
  val2?: string;
  /** values of "is one of" / "is not one of" */
  vals?: string[];
}

/** A set of rules combined with AND ("all") or OR ("any"). Groups can nest. */
export interface RuleGroup {
  match: 'all' | 'any';
  rules: RuleItem[];
}
export type RuleItem = Rule | RuleGroup;
export const isGroup = (x: RuleItem): x is RuleGroup => 'rules' in x;

/** One total in a group step: a function applied to a column. `as` is the output name (default fn_col). */
export interface AggSpec {
  col: string;
  fn: AggFn;
  as?: string;
}

/** Superset of every step's config; each step type only uses its own fields (see SPEC section 6). */
export interface Cfg {
  ds?: string;
  drop?: string[];
  extras?: string[];
  match?: 'all' | 'any';
  rules?: RuleItem[];
  by?: string[];
  aggs?: AggSpec[];
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
