import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {playwright,ARTIFACTS} from './lib.mjs';
const {chromium}=await playwright();
const browser=await chromium.launch({headless:true,...(process.env.TW_CHROME?{executablePath:process.env.TW_CHROME}:{}),args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const base=process.argv[2]??'http://127.0.0.1:5173/';
const password=process.env.ROOM_PASSWORD??'local-test-password';
try {
 const errors=[];
 async function page(url=base+'?lang=ja'){const c=await browser.newContext({viewport:{width:1280,height:950},locale:"ja-JP"});await c.addInitScript(()=>Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>2}));const p=await c.newPage();p.on('pageerror',e=>errors.push(String(e)));await p.goto(url);await p.locator('#multiplayer-lobby-root').waitFor();return p;}
 async function unlock(p){
  await p.getByLabel('参加用パスワード',{exact:true}).fill(password);
  assert.equal(await p.getByRole('tab').count(),0,'first visit only shows the password gate');
  await p.getByRole('button',{name:'入る',exact:true}).click();
  await p.getByRole('tab',{name:'ホストを開始',exact:true}).waitFor();
  assert.equal(await p.getByLabel('参加用パスワード',{exact:true}).count(),0);
 }
 const host=await page();
 await mkdir(ARTIFACTS,{recursive:true});
 await host.getByLabel('参加用パスワード',{exact:true}).waitFor();
 await host.screenshot({path:ARTIFACTS+'/multiplayer-password.png'});
 await unlock(host);
 await mkdir(ARTIFACTS,{recursive:true});await host.screenshot({path:ARTIFACTS+'/multiplayer-lobby-host.png'});
 assert.equal(await host.getByRole('button',{name:'新しいゲーム',exact:true}).count(),0);
 await host.getByRole('textbox',{name:'プレイヤー名',exact:true}).fill('Alice');
 await host.getByRole('button',{name:'ホストを開始',exact:true}).click();
 await host.locator('#multiplayer-lobby-root').waitFor({state:'detached',timeout:180_000});
 const code=(await host.locator('.room-code-value').innerText()).trim();assert(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/.test(code),code);
 console.log('PASS multiplayer-only lobby starts a host and shows a short room code');
 const invite=host.url();assert.equal(new URL(invite).hash,'#room='+code.replace('-',''));
 const guest=await page(invite);await unlock(guest);
 assert.equal(await guest.getByRole('tab',{name:/参加コードで参加/}).getAttribute('aria-selected'),'true');
 assert.equal(await guest.getByRole('textbox',{name:'参加コード',exact:true}).inputValue(),code.replace('-',''));
 await guest.getByRole('textbox',{name:'プレイヤー名',exact:true}).fill('Bob');
 await guest.screenshot({path:ARTIFACTS+'/multiplayer-lobby-join.png'});
 await guest.getByRole('button',{name:'参加する',exact:true}).click();
 await guest.locator('#multiplayer-lobby-root').waitFor({state:'detached',timeout:180_000});
 await guest.locator('.room-member').filter({hasText:'Alice'}).waitFor();await host.locator('.room-member').filter({hasText:'Bob'}).waitFor();
 assert.equal(await guest.locator('.save-notice').count(),0,'cooperative state is server-persisted, not an unsaved solo view');
 await host.mouse.move(600,400);await host.keyboard.press('/');const chat=host.getByRole('textbox',{name:'カーソル会話',exact:true});await chat.fill('一緒につくろう');await chat.press('Enter');
 await guest.locator('.shared-cursor .cursor-chat-bubble').filter({hasText:'一緒につくろう'}).waitFor({state:'visible'});
 await guest.screenshot({path:ARTIFACTS+'/multiplayer-lobby-in-game.png'});
 await guest.getByRole('button',{name:'退出',exact:true}).click();
 await guest.locator('#multiplayer-lobby-root').waitFor({timeout:60_000});
 await host.getByRole('button',{name:'退出',exact:true}).click();
 await host.locator('#multiplayer-lobby-root').waitFor({timeout:60_000});
 // An authenticated visitor follows the same invite without a second password prompt.
 await guest.goto(invite);
 await guest.getByRole('tab',{name:/参加コードで参加/}).waitFor();
 assert.equal(await guest.getByLabel('参加用パスワード',{exact:true}).count(),0);
 await guest.getByRole('button',{name:'参加する',exact:true}).click();
 await guest.locator('#multiplayer-lobby-root').waitFor({state:'detached',timeout:180_000});
 assert.equal((await guest.locator('.room-code-value').innerText()).trim(),code);
 await guest.locator('.room-member').filter({hasText:'Bob'}).waitFor();
 console.log('PASS invite survives the password gate; the empty room resumes with the same code');
 assert.deepEqual(errors,[]);
 console.log('PASS joining by formatted code, live participants/chat, and returning to the lobby');
 const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,deviceScaleFactor:1});const mp=await mobile.newPage();await mp.goto(base+'?lang=ja');await mp.locator('#multiplayer-lobby-root').waitFor();assert.equal(await mp.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await mp.screenshot({path:ARTIFACTS+'/multiplayer-lobby-mobile.png'});
 console.log('PASS mobile lobby fits the viewport');
}finally{await browser.close();}
