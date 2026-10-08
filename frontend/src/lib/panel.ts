import type { Graph, FlowNode, Table } from './types';

const edgeInput = (g: Graph, T: Record<string, Table>, id: string, p: 'in' | 'a' | 'b') => {
  const e = g.edges.find((q) => q.to === id && q.port === p);
  return e ? T[e.from] : null;
};

/** Upstream tables for a step: the single input (`in`) or both inputs of a join/union. */
export function inputOf(g: Graph, T: Record<string, Table>, n: FlowNode) {
  const two = n.type === 'join' || n.type === 'union';
  const inTable = two ? null : edgeInput(g, T, n.id, 'in');
  return { inTable, inCols: inTable ? inTable.cols : [], A: edgeInput(g, T, n.id, 'a'), B: edgeInput(g, T, n.id, 'b') };
}
