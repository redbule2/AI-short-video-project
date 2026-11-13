"use strict";
const { randomUUID } = require('node:crypto');
const own = (o, k) => Object.hasOwn(o, k);

// Public CLI names stay stable. Only SDK mutations know the persisted canvas shape.
async function edit(request, api) {
  const { action, input = {}, nodeId } = request;
  const { mutate, root, asset, allocate, configure } = api;
  // Metadata/layout edits are safe while generation runs. Content/media/delete
  // and explicit edge changes must observe the same Go state rules as node run.
  const targets = new Set();
  if (action === 'node.update' && Object.keys(input).some(k => !['name','position','size'].includes(k))) targets.add(nodeId);
  if (action === 'node.delete') for (const id of request.nodeIds || []) targets.add(id);
  if (action.startsWith('edge.')) {
    const edges = root().edges;
    for (const id of action === 'edge.delete' ? input.edgeIds || [] : [input.edgeId]) {
      if (edges[id]) { targets.add(edges[id].source); targets.add(edges[id].target); }
    }
    for (const key of ['sourceNodeId','targetNodeId']) if (input[key]) targets.add(input[key]);
  }
  if (targets.size) await api.guard([...targets]);
  const requireNode = id => {
    const n = root().nodes[id];
    if (!n) throw new Error(`node ${id} does not exist`);
    return n;
  };
  const selected = ids => {
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !id)) throw new Error('nodeIds must be a nonempty unique array');
    ids.forEach(requireNode);
    for (const id of ids) {
      let p = requireNode(id).parentId;
      const seen = new Set([id]);
      while (p) {
        if (seen.has(p) || ids.includes(p)) throw new Error('select either a group or its child, not both');
        seen.add(p); p = requireNode(p).parentId;
      }
    }
    return ids;
  };
  const groupNode = id => {
    const n = requireNode(id);
    if (n.type !== 'group') throw new Error('group not found');
    return n;
  };
  const fieldCheck = keys => {
    for (const k of Object.keys(input)) if (!keys.includes(k)) throw new Error(`unknown field ${k}`);
  };
  const apply = async mutations => { if (mutations.length) await mutate(mutations); };
  const setName = (id, name) => ({ kind: 'update_node_data', id, patch: { title: name } });
  if (action === 'node.create' || action === 'node.update') {
    let id = nodeId;
    if (action === 'node.create') {
      id = await allocate();
      await apply([{ kind: 'create_biz_node', nodeKind: input.type, id, ...(input.position ? { topLeft: input.position } : {}) }]);
    } else requireNode(id);
    const configured = await configure(id, requireNode(id), asset(id), input);
    const changes = [ { kind: 'update_node_data', id, patch: configured.content }, { kind: 'update_asset', assetId: id, extraPatch: { jimengNovel: configured.cli } } ];
    // The public position is relative to its group; SDK set_node_position is world space.
    if (input.position && action !== 'node.create') {
      const n = requireNode(id);
      changes.push({kind: 'move_nodes', ids: [id], delta: {dx: (input.position.x ?? n.x) - n.x, dy: (input.position.y ?? n.y) - n.y}});
    }
    if (input.size) {
      const n = requireNode(id);
      changes.push({kind: 'resize_node', id, size: {w: input.size.width ?? n.w, h: input.size.height ?? n.h}});
    }
    await apply(changes);
    return {nodeId: id};
  }
  if (action === 'node.delete') {
    const ids = selected(request.nodeIds);
    if (ids.some(id => requireNode(id).children?.length)) throw new Error('dissolve group before deleting');
    await apply([{kind: 'delete_nodes', ids}]);
    return {deletedNodeIds: ids};
  }
  if (action.startsWith('edge.')) {
    fieldCheck(action === 'edge.create' ? ['sourceNodeId','targetNodeId','label'] : action === 'edge.update' ? ['edgeId','sourceNodeId','targetNodeId','label'] : ['edgeIds']);
    if (action === 'edge.delete') {
      const ids = input.edgeIds;
      if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length || ids.some(id => !root().edges[id])) throw new Error('edgeIds must contain existing unique edges');
      await apply([{kind: 'delete_edges', ids}]); return {deletedEdgeIds: ids};
    }
    const id = action === 'edge.create' ? `edge$${randomUUID()}` : input.edgeId;
    const previous = root().edges[id];
    if (action === 'edge.update' && !previous) throw new Error('edge not found');
    const edge = {...previous, id, type: 'reference', sourceHandle: previous?.sourceHandle ?? 'right', targetHandle: previous?.targetHandle ?? 'left', source: input.sourceNodeId ?? previous?.source, target: input.targetNodeId ?? previous?.target, data: {...previous?.data}};
    requireNode(edge.source); requireNode(edge.target);
    if (edge.source === edge.target) throw new Error('two distinct endpoints required');
    if (own(input,'label')) {
      if (typeof input.label !== 'string') throw new Error('label must be a string');
      edge.data.label = input.label;
    }
    // Replacing through SDK also repairs legacy CLI edges missing their type.
    await apply([...(previous ? [{kind: 'delete_edges', ids: [id]}] : []), {kind: 'create_edge', edge}]);
    return {edgeId: id, sourceNodeId: edge.source, targetNodeId: edge.target, label: edge.data.label ?? null};
  }
  if (action === 'group.create') {
    fieldCheck(['nodeIds','name']);
    const ids = selected(input.nodeIds);
    if (ids.length < 2) throw new Error('group requires at least two nodes');
    if (own(input,'name') && typeof input.name !== 'string') throw new Error('name must be string');
    const before = new Set(Object.keys(root().nodes));
    await apply([{kind: 'group_nodes', ids}]);
    const groupId = Object.keys(root().nodes).find(id => !before.has(id));
    if (!groupId) throw new Error('SDK did not create group');
    if (own(input,'name')) await apply([setName(groupId,input.name)]);
    return {groupId};
  }
  if (action === 'group.dissolve') {
    fieldCheck(['groupId']);
    const nodeIds = [...(groupNode(input.groupId).children || [])];
    await apply([{kind:'ungroup',groupId:input.groupId}]); return {nodeIds};
  }
  if (action === 'group.move') {
    fieldCheck(['nodeIds','parentGroupId','index']);
    const ids = selected(input.nodeIds);
    if (!own(input,'parentGroupId') || (input.parentGroupId !== null && typeof input.parentGroupId !== 'string')) throw new Error('parentGroupId required; null moves to root');
    if (input.parentGroupId !== null) groupNode(input.parentGroupId);
    for (const id of ids) {
      const seen = new Set([id]); let parent = input.parentGroupId;
      while (parent) {
        if (seen.has(parent)) throw new Error('group move would create a cycle');
        seen.add(parent); parent = requireNode(parent).parentId;
      }
    }
    if (own(input,'index') && input.parentGroupId !== null) {
      const remaining = (groupNode(input.parentGroupId).children || []).filter(id=>!ids.includes(id));
      if (input.index > remaining.length) throw new Error('index out of bounds');
    }
    if (own(input,'index') && (!Number.isInteger(input.index) || input.index < 0)) throw new Error('index must be nonnegative integer');
    await apply(ids.map((nodeId,i) => ({kind:'reparent',nodeId,newParentId:input.parentGroupId,...(own(input,'index') ? {index:input.index+i} : {})})));
    return {changedNodeIds:ids};
  }
  if (action === 'group.update') {
    fieldCheck(['groupId','name','collapsed','orderedNodeIds']);
    const g = groupNode(input.groupId), mutations = [];
    if (own(input,'name')) { if (typeof input.name !== 'string') throw new Error('name must be string'); mutations.push(setName(g.id,input.name)); }
    if (own(input,'collapsed')) { if (typeof input.collapsed !== 'boolean') throw new Error('collapsed must be boolean'); mutations.push({kind:'set_group_collapsed',groupId:g.id,collapsed:input.collapsed}); }
    if (own(input,'orderedNodeIds')) mutations.push({kind:'reorder_children',groupId:g.id,orderedChildren:input.orderedNodeIds});
    await apply(mutations);
    const n = groupNode(g.id); return {groupId:g.id,name:n.data?.title ?? '',collapsed:n.data?.collapsed ?? false,nodeIds:n.children};
  }
  if (action.startsWith('layout.')) {
    const names = {move:['delta'],align:['direction'],distribute:['axis'],arrange:['layout','horizontalGap','verticalGap','columns'],auto:['strategy']};
    const op = action.split('.')[1];
    if (!names[op]) throw new Error('unknown layout action');
    fieldCheck(['nodeIds',...names[op]]);
    const ids = selected(input.nodeIds ?? (op === 'auto' ? Object.values(root().nodes).filter(n=>!n.parentId).map(n=>n.id) : undefined));
    let m;
    if (op === 'move') {
      if (!input.delta || !Number.isFinite(input.delta.x) || !Number.isFinite(input.delta.y) || Object.keys(input.delta).some(k=>!['x','y'].includes(k))) throw new Error('delta requires numeric x/y');
      m = {kind:'move_nodes',ids,delta:{dx:input.delta.x,dy:input.delta.y}};
    } else if (op === 'align') m = {kind:'align_nodes',ids,direction:input.direction};
    else if (op === 'distribute') m = {kind:'distribute_nodes',ids,axis:input.axis};
    else {
      const layout = op === 'auto' ? (input.strategy ?? 'grid') : input.layout;
      if (!['row','column','grid'].includes(layout)) throw new Error('layout must be row/column/grid; auto supports grid');
      for (const key of ['horizontalGap','verticalGap']) if (own(input,key) && (!Number.isFinite(input[key]) || input[key] < 0)) throw new Error('gap must be nonnegative');
      if (own(input,'columns') && (!Number.isInteger(input.columns) || input.columns < 1)) throw new Error('columns must be positive integer');
      m = {kind:'arrange_nodes',ids,layout:({row:'horizontal',column:'vertical',grid:'grid'})[layout],options:{horizontalGap:input.horizontalGap ?? 80,verticalGap:input.verticalGap ?? 80,...(input.columns ? {gridColumns:input.columns} : {})}};
    }
    await apply([m]); return {changedNodeIds:ids};
  }
  throw new Error(`unsupported canvas edit ${action}`);
}

module.exports = {edit};
