// Explicit ownership checks. Unknown/global operations are refused in competitive rooms.
export const STARTING_CASH=10000;
export function newCompany(id,name){return {id,name,cash:STARTING_CASH,revenue:0,running:0,upkeep:0,spent:0,fleet:[0,0,0,0,0]};}
export function ownedOperation(op,company,owners){
 const own=(kind,id)=>Number.isSafeInteger(id)&&owners[`${kind}:${id}`]===company;
 const all=(kind,ids)=>Array.isArray(ids)&&ids.every(id=>own(kind,id));
 const end=p=>p&&(p.kind==='free'||(p.kind==='node'&&own('node',p.node))||(p.kind==='edge'&&own('edge',p.edge)));
 const edgeOps=['removeEdge','edgePis','addPoint','edgeLevel','crossover','doubleUp','oneWay'];
 const nodeOps=['moveNode','flying','stationProps','stationTracks','stationWay','reverseStation','stationName','removeStation'];
 const lineOps=['copyLine','setStops','insertStop','dropStop','endLineAt','stopPassed','orderStops','sortStops','turnEnd','openLoop','setTrainCount','setHeadway','lineLook','removeLine','lineCars','lineFast','lineOneWay','linePairs','lineLimit','constructLine','busRoute','busSpacing','busHand','busHandStop'];
 if(edgeOps.includes(op.op))return own('edge',op.edge)?op:null;
 if(nodeOps.includes(op.op))return own('node',op.node)?op:null;
 if(lineOps.includes(op.op)) {
  if(!own('line',op.line))return null;
  if(op.stops&&!all('node',op.stops))return null;
  if(op.station!==undefined&&!own('node',op.station))return null;
  return op;
 }
 if(['edgesLevel','edgesKind','edgesTracks'].includes(op.op))return all('edge',op.edges)?op:null;
 if(['moveNodes','stationUpgrade'].includes(op.op))return all('node',op.nodes)?op:null;
 if(['construct','rebuild','removePieces','blueprintOff'].includes(op.op))return all('edge',op.edges)&&all('node',op.stations)&&(!op.buses||all('line',op.buses))?op:null;
 if(op.op==='route')return end(op.from)&&end(op.to)?op:null;
 if(op.op==='addStation')return op.at&&(op.at.kind==='free'||end(op.at))?op:null;
 if(op.op==='addLine')return all('node',op.stops)?op:null;
 if(op.op==='addBusLine')return op;
 if(op.op==='link')return own('node',op.a)&&own('node',op.b)?op:null;
 if(op.op==='constructAll') {
  const ids=kind=>Object.entries(owners).filter(([key,owner])=>owner===company&&key.startsWith(kind+':')).map(([key])=>Number(key.split(':')[1]));
  return {op:'construct',edges:ids('edge'),stations:ids('node'),buses:ids('line'),enabledOnly:true};
 }
 return null;
}
