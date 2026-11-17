import type { Map as GameMap } from "maplibre-gl";
import { effect } from "@preact/signals";
import { multiplayer, publishCursor, sharedCursors } from "../game/multiplayer";
import { t } from "../i18n";

const COLORS=["#b83c65","#2463ac","#287149","#6948a3","#a04d18"];
export function cursorColor(id:string){let n=0;for(const c of id)n=(Math.imul(n,31)+c.charCodeAt(0))>>>0;return COLORS[n%COLORS.length];}
export function startSharedCursors(map:GameMap) {
  const host=map.getContainer();
  const root=document.createElement("div");root.className="shared-cursors";root.setAttribute("aria-label",t("multiplayer.cursors"));host.append(root);
  const nodes=new Map<string,{root:HTMLDivElement;name:HTMLSpanElement;bubble:HTMLDivElement}>();
  let point={x:host.clientWidth/2,y:host.clientHeight/2},inside=false,text="",expires:ReturnType<typeof setTimeout>|null=null;
  const input=document.createElement("input");input.className="cursor-chat-input";input.type="text";input.maxLength=200;input.hidden=true;input.autocomplete="off";root.append(input);
  const ownBubble=document.createElement("div");ownBubble.className="cursor-chat-bubble cursor-chat-own";ownBubble.hidden=true;root.append(ownBubble);
  function positionLocal(){const x=Math.max(4,Math.min(point.x+20,host.clientWidth-225)),y=Math.max(4,Math.min(point.y+24,host.clientHeight-75));for(const el of [input,ownBubble])el.style.transform=`translate(${x}px,${y}px)`;}
  function send(){if(!inside){publishCursor(null);return;}const p=map.unproject([point.x,point.y]);publishCursor({lng:p.lng,lat:p.lat,text});}
  function finish(clear=false){input.hidden=true;input.blur();text=clear?"":input.value;ownBubble.textContent=text;ownBubble.hidden=!text;send();if(expires)clearTimeout(expires);expires=setTimeout(()=>{text="";ownBubble.hidden=true;send();},8000);}
  input.addEventListener("input",()=>{text=input.value;send();});
  input.addEventListener("keydown",e=>{e.stopPropagation();if(e.key==="Enter"){e.preventDefault();finish();}else if(e.key==="Escape"){e.preventDefault();finish(true);}});
  input.addEventListener("blur",()=>{if(!input.hidden)finish();});
  map.on("mousemove",e=>{point={x:e.point.x,y:e.point.y};inside=true;positionLocal();send();});
  host.addEventListener("mouseleave",()=>{if(!input.hidden)return;inside=false;send();});
  document.addEventListener("keydown",e=>{
    if(e.key!=="/"||e.ctrlKey||e.metaKey||e.altKey||multiplayer.peek().status!=="connected")return;
    const target=e.target;
    if(target instanceof Element&&target.closest('input,textarea,select,[contenteditable="true"]'))return;
    e.preventDefault();e.stopImmediatePropagation();inside=true;text="";input.value="";input.hidden=false;ownBubble.hidden=true;input.setAttribute("aria-label",t("multiplayer.cursorChat"));input.placeholder=t("multiplayer.cursorChatPlaceholder");positionLocal();input.focus();send();
  },true);
  function render(){
    const cursors=sharedCursors.peek();
    for(const [id,n] of nodes)if(!cursors.has(id)){n.root.remove();nodes.delete(id);}
    for(const [id,c] of cursors){
      let n=nodes.get(id);
      if(!n){
        const box=document.createElement("div");box.className="shared-cursor";box.dataset.peer=id;box.style.setProperty("--cursor-color",cursorColor(id));
        const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");svg.setAttribute("viewBox","0 0 20 26");svg.setAttribute("aria-hidden","true");
        const path=document.createElementNS("http://www.w3.org/2000/svg","path");path.setAttribute("d","M2 2L3 22L8 16L12 25L16 23L12 14L20 14Z");svg.append(path);
        const name=document.createElement("span");name.className="shared-cursor-name";
        const bubble=document.createElement("div");bubble.className="cursor-chat-bubble";
        box.append(svg,name,bubble);root.prepend(box);n={root:box,name,bubble};nodes.set(id,n);
      }
      const p=map.project([c.lng,c.lat]);n.root.style.transform=`translate(${p.x}px,${p.y}px)`;n.root.hidden=p.x<-250||p.x>host.clientWidth+20||p.y<-100||p.y>host.clientHeight+20;
      n.name.textContent=c.name;n.bubble.textContent=c.text;n.bubble.hidden=!c.text||Date.now()-c.textAt>10_000;
    }
  }
  effect(()=>{void sharedCursors.value;render();});
  effect(()=>{if(multiplayer.value.status!=="connected"){sharedCursors.value=new Map();input.hidden=true;ownBubble.hidden=true;inside=false;}});
  map.on("move",()=>{render();if(inside)send();});
  setInterval(render,1000);
}
