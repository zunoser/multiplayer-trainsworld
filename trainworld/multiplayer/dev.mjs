import { fileURLToPath } from "node:url";
import { Miniflare } from './miniflare-v4.mjs';
const mf=new Miniflare({modules:['index.mjs','competition.mjs'].map(name=>({type:'ESModule',path:fileURLToPath(new URL('./src/'+name,import.meta.url))})),compatibilityDate:'2026-07-30',port:8787,host:'0.0.0.0',durableObjects:{ROOMS:{className:'RailwayRoom',useSQLite:true}},resourcePersistencePath:'../../artifacts/multiplayer-state',bindings:{DEV_ORIGIN:'http://127.0.0.1:5173',ROOM_PASSWORD:process.env.ROOM_PASSWORD??'local-test-password'},assets:{directory:fileURLToPath(new URL('../app/dist/',import.meta.url)),binding:'ASSETS',routerConfig:{has_user_worker:true,invoke_user_worker_ahead_of_assets:false}},cf:false});
console.log(String(await mf.ready));
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,async()=>{await mf.dispose();process.exit(0);});
