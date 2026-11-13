"use strict";
const sdk = require("./xyq-canvas-command-runtime.cjs");
const {randomUUID} = require("node:crypto");
const PERSISTENCE_VERSION = 1;
const OPTIONAL_SCHEMA = Symbol("optional");
function emptyPersistenceState() {
  return { clientId: null, outbound: [], snapshot: null, version: PERSISTENCE_VERSION };
}

function createMemoryPersistence() {
  let state = emptyPersistenceState();
  const copy = (value) => JSON.parse(JSON.stringify(value));
  return {
    async appendOutbound(envelope) { state.outbound.push(copy(envelope)); },
    async clear() { state = emptyPersistenceState(); },
    async loadClientId() { return state.clientId; },
    async loadOutbound() { return copy(state.outbound); },
    async loadSnapshot() { return copy(state.snapshot); },
    async removeOutbound(txId) { state.outbound = state.outbound.filter((value) => value.txId !== txId); },
    async replaceOutbound(envelopes) { state.outbound = copy(envelopes); },
    async replaceOutboundPartition(active, capturedTxIds) {
      const replaced = new Set([...capturedTxIds, ...active.map((value) => value.txId)]);
      state.outbound = [...copy(active), ...state.outbound.filter((value) => !replaced.has(value.txId))];
    },
    async saveClientId(clientId) { state.clientId = clientId; },
    async saveSnapshot(snapshot) { state.snapshot = copy(snapshot); },
    async quarantine() { return ""; },
  };
}


function createCanvasAssetRuntime({ nativeClient, sdk }) {
  const serviceTransport = sdk.createPippitAssetServiceTransport({
    assetQuery: async (request) => ({
      data: { Assets: await nativeClient.getAssetsAllowMissing(request.pippit_asset_ids) },
      ret: 0,
    }),
    mutation: {
      batchGeneratePippitAssetIds: async ({ count = 0 }) => ({
        data: { ids: await nativeClient.allocateAssetIds(count) },
        ret: 0,
      }),
      batchPatchAsset: (request) => nativeClient.apply(request),
    },
  });
  const assetRuntime = sdk.createPippitAssetRuntime({
    storage: false,
    sync: { batchPatchAsset: (request) => nativeClient.apply(request) },
    transport: serviceTransport,
  });
  const loader = sdk.createPippitAssetSdkCanvasLoader({ client: assetRuntime.client, requireCompleteNodeAssets: true, readOnly: true, isLayoutActive: () => false });
  return { assetRuntime, loader };
}

function createCanvasTransportFactory({ assetRuntime, loader }) {
  return ({ canvasId, clientId }) => {
    const transport = assetRuntime.createSyncTransport({
      clientId,
      loader,
      scopeAssetId: canvasId,
    });
    return {
      assetVersions: transport.assetVersions,
      clientId: transport.clientId,
      close: transport.close.bind(transport),
      commit: transport.commit.bind(transport),
      fetchAssets: transport.fetchAssets.bind(transport),
      fetchSnapshot: async (options) => {
        const snapshot = await transport.fetchSnapshot({ ...options, onProgress: undefined });
        return { document: snapshot.state };
      },
      getConnectionState: transport.getConnectionState.bind(transport),
      onConnectionChange: transport.onConnectionChange.bind(transport),
      onInvalidate: transport.onInvalidate.bind(transport),
      syncAssetSubscriptions: transport.syncAssetSubscriptions.bind(transport),
    };
  };
}


function createSchemaValue(json, optional = false) {
  const schema = { ...json };
  Object.defineProperty(schema, OPTIONAL_SCHEMA, { value: optional });
  Object.defineProperties(schema, {
    describe: {
      value(description) {
        return createSchemaValue({ ...json, description }, optional);
      },
    },
    optional: {
      value() {
        return createSchemaValue(json, true);
      },
    },
  });
  return schema;
}

function createSchemaFactory() {
  return {
    array: (item) => createSchemaValue({ items: schemaToJSON(item), type: "array" }),
    boolean: () => createSchemaValue({ type: "boolean" }),
    number: () => createSchemaValue({ type: "number" }),
    string: () => createSchemaValue({ type: "string" }),
    unknown: () => createSchemaValue({}),
  };
}

function schemaToJSON(schema) {
  return Object.fromEntries(Object.entries(schema || {}).filter(([, value]) => typeof value !== "function"));
}


const {edit} = require('./edit.cjs');
async function runCanvas(request, rpc) {
  let approved = false;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let failure;
  const nativeClient = {
    getAssetsAllowMissing: ids => rpc('query', {ids}).then(r=>(r.Assets || []).map(a=>{
      // Jimeng's top-level version is the media schema version, not the patch
      // revision. The SDK normalizer reads version, so translate explicitly.
      const revision = Number(a.Extra?.asset_content_version);
      let text = a.TextInfo;
      if (text?.content) {
        const body = JSON.parse(text.content);
        // The shared XYQ artifact still lacks the frontend's name-only audio
        // restore fix. An empty generation draft lets that older validator recognize the
        // same valid audio asset; it does not invent a model or start generation.
        if (body?.type === 'biz/audio' && body.content && body.content.generation === undefined) {
          text = {...text, content: JSON.stringify({...body, content:{...body.content,generation:{}}})};
        }
      }
      return {...a, TextInfo:text, version: Number.isSafeInteger(revision) && revision >= 0 ? revision : undefined};
    })),
    allocateAssetIds: count => rpc('allocate', {count}).then(r=>r.ids),
    async apply(body) {
      await gate;
      if (!approved) throw new Error('canvas edit aborted before commit');
      try { return {ret:0,data:await rpc('apply',body)}; }
      catch (error) { failure = error; throw error; }
    },
  };
  const {assetRuntime,loader} = createCanvasAssetRuntime({nativeClient,sdk});
  let standalone;
  try {
    const allocate = async () => {
      const ids = await nativeClient.allocateAssetIds(1);
      if (!Array.isArray(ids) || ids.length !== 1 || typeof ids[0] !== 'string') throw new Error('invalid asset ID allocation');
      return ids[0];
    };
    standalone = sdk.createXyqCanvasCommandRuntime({
      canvasId:request.canvasId,allocateAssetId:allocate,persistence:createMemoryPersistence(),
      queryAsset: async id => {
        const a = await assetRuntime.client.assets.getAsset({mediaType:'text',pippitAssetId:id});
        return {asset:a?.text?.content ?? null,version:a?.version};
      },
      sync:{flush:{maxAttempts:1,maxBatchSize:1}},
      transportFactory:createCanvasTransportFactory({assetRuntime,loader}),
    });
    standalone.canvas.start(); await standalone.canvas.whenReady();
    const store = standalone.store;
    const definitions = sdk.createXyqCanvasOpencodeToolDefinitions({
      allocateAssetId:allocate,allocateNodeId:allocate,
      queryMediaAsset:id=>assetRuntime.client.assets.getAsset({pippitAssetId:id}),
      schema:createSchemaFactory(),
      runtime:{store,permissions:['canvas.read','canvas.write','canvas.patch','canvas.asset.read','canvas.asset.write']},
    });
    const mutate = async mutations => {
      const r = JSON.parse(await definitions.apply_mutations.execute({atomic:true,intent:`jimeng-novel ${request.action}`,mutations}));
      const aborted = r.data?.results?.find(x=>x.status==='aborted');
      if (!r.ok || aborted) throw Object.assign(new Error(r.message || r.error?.message || aborted?.reason || 'SDK rejected canvas edit'), {code:r.code || r.error?.code || 'INVALID_ARGUMENT',details:r.details || r.error?.details});
      return r;
    };
    const result = await edit(request,{
      root:()=>store.getRootCanvasContent(),asset:id=>structuredClone(store.getState().assets[id]),
      allocate,mutate,
      guard:ids=>rpc('guard',{ids}),
      configure:(id,projection,body,input)=>rpc('configure',{id,projection,body,input}),
    });
    approved = true; release();
    standalone.canvas.flush(); await standalone.canvas.waitUntilSaved();
    if (failure) throw failure;
    return {...result,saved:true};
  } catch (error) {
    error = failure || error;
    throw Object.assign(new Error(`${error.message}; query the canvas before retrying`), {code:error.code || (approved ? "SAVE_UNCONFIRMED" : "INVALID_ARGUMENT"),details:error.details});
  } finally {
    release(); standalone?.canvas.dispose(); assetRuntime.dispose();
  }
}

// Private pipe protocol: authentication remains in the parent Go process.
if (require.main === module) {
  // Keep stdout exclusively for the private protocol, including SDK diagnostics.
  for (const name of ['log','info','debug']) console[name] = (...values) => console.error(...values);
  const readline = require('node:readline');
  const pending = new Map(); let nextId = 0, started = false;
  const lines = readline.createInterface({input:process.stdin,crlfDelay:Infinity});
  const send = value => process.stdout.write(JSON.stringify(value)+'\n');
  const rpc = (method,body) => new Promise((resolve,reject)=>{
    const id = ++nextId; pending.set(id,{resolve,reject}); send({id,method,body});
  });
  lines.on('line',line=>{
    let message;
    try {message=JSON.parse(line);} catch {process.exitCode=1;lines.close();return;}
    if (!started) {
      started=true;
      runCanvas(message,rpc).then(result=>send({result}),error=>{send({error:error.message,code:error.code,details:error.details});process.exitCode=1;}).finally(()=>{lines.close();process.stdin.destroy();});
    } else {
      const p=pending.get(message.id);
      if (!p) return;
      pending.delete(message.id); message.error ? p.reject(Object.assign(new Error(message.error),{code:message.code,details:message.details})) : p.resolve(message.result);
    }
  });
}
module.exports={runCanvas};
