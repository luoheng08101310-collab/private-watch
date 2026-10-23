import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { getDatabase, ref, set, onValue, push, query, limitToLast, onChildAdded } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';

const $ = id => document.getElementById(id);
const decoder = new TextDecoder(), encoder = new TextEncoder();
const b64 = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64 = str => Uint8Array.from(atob(str.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-str.length%4)%4)), c => c.charCodeAt(0));
const random = size => crypto.getRandomValues(new Uint8Array(size));
let db, roomId, key, uid, unsubscribe = null, localVersion = 0, latest = null, lastStateJSON = '', suppress = 0, started = false, seen = new Set();
const announce = msg => { $('alert').textContent = msg; $('alert').classList.remove('hidden'); };
const clearAlert = () => $('alert').classList.add('hidden');
const pauseInputEvents = () => { suppress = Date.now()+1100; };
const validVideo = s => { try { const u = new URL(s); return u.protocol==='https:' && !u.username && !u.password && s.length<=2048; } catch { return false; }};

async function seal(obj) {
  const iv=random(12), plain=encoder.encode(JSON.stringify(obj));
  const enc=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,plain));
  return {iv:b64(iv), data:b64(enc)};
}
async function openSeal(envelope) {
  const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(envelope.iv)},key,unb64(envelope.data));
  return JSON.parse(decoder.decode(bytes));
}
async function init() {
  if (firebaseConfig.apiKey === 'REPLACE_ME') throw Error('还没有配置 Firebase：请先编辑 firebase-config.js。');
  if (!db) { const app=initializeApp(firebaseConfig); const auth=getAuth(app); const u=await signInAnonymously(auth); uid=u.user.uid; db=getDatabase(app); }
}
const roomPath = () => `rooms/${roomId}`;
async function sendState({url, position, playing}) {
  const state={url,position,playing,at:Date.now(),by:uid};
  await set(ref(db,`${roomPath()}/state`),await seal(state));
}
async function create() {
  clearAlert(); const url=$('videoInput').value.trim();
  if(!validVideo(url)) return announce('请输入完整的 HTTPS 视频文件直链，例如 https://example.com/video.mp4');
  $('createBtn').disabled=true;
  try {
    await init(); roomId=b64(random(18)); const secret=random(32);
    key=await crypto.subtle.importKey('raw',secret,'AES-GCM',false,['encrypt','decrypt']);
    const fragment=new URLSearchParams({room:roomId,key:b64(secret)});
    history.replaceState(null,'',location.pathname+location.search+'#'+fragment.toString());
    await sendState({url,position:0,playing:false});
    enter();
  } catch(e) { announce('创建失败：'+e.message); } finally {$('createBtn').disabled=false;}
}
async function join() {
  clearAlert(); $('joinBtn').disabled=true;
  try {
    const params=new URLSearchParams(location.hash.slice(1));
    roomId=params.get('room'); const secret=unb64(params.get('key')||'');
    if(!/^[A-Za-z0-9_-]{24}$/.test(roomId||'')||secret.length!==32) throw Error('邀请链接格式不正确');
    key=await crypto.subtle.importKey('raw',secret,'AES-GCM',false,['encrypt','decrypt']);
    await init(); enter();
  } catch(e) {announce('加入失败：'+e.message);} finally {$('joinBtn').disabled=false;}
}
function enter() {
  $('setup').classList.add('hidden'); $('room').classList.remove('hidden');
  $('roomShort').textContent=roomId.slice(0,6).toUpperCase();
  $('status').textContent='已连接，等待房间状态';
  const video=$('video');
  unsubscribe?.();
  unsubscribe=onValue(ref(db,`${roomPath()}/state`), async snapshot => {
    if(!snapshot.exists()) { $('status').textContent='房间不存在或已被删除'; return; }
    try {
      const state=await openSeal(snapshot.val());
      if(!validVideo(state.url)||typeof state.position!=='number'||typeof state.playing!=='boolean') throw Error('无效状态');
      if(!Number.isFinite(state.position)||state.position<0||state.position>1e9) throw Error('无效进度');
      latest=state;
      pauseInputEvents();
      if(video.dataset.src!==state.url){video.dataset.src=state.url;video.src=state.url;video.load();}
      const target=state.position+(state.playing?Math.max(0,(Date.now()-state.at)/1000):0);
      if(Math.abs(video.currentTime-target)>1.5) {try{video.currentTime=target;}catch{ /* wait for metadata */ }}
      if(state.playing && video.paused){try{await video.play();$('tapTip').classList.add('hidden');}catch{$('tapTip').classList.remove('hidden');}}
      else if(!state.playing && !video.paused)video.pause();
      $('status').textContent='加密同步已开启';
    } catch(e){announce('无法解密房间数据：可能是邀请密钥错误，或网络有问题。');}
  },error=>announce('同步连接失败：'+error.message));
  onChildAdded(query(ref(db,`${roomPath()}/chat`),limitToLast(80)),async snap=>{
    if(seen.has(snap.key))return;seen.add(snap.key);
    try{const m=await openSeal(snap.val());if(typeof m.text!=='string')return;
      const div=document.createElement('div');div.className='message'+(m.by===uid?' mine':'');
      const title=document.createElement('small');title.textContent=m.by===uid?'我':'朋友';
      const msg=document.createElement('span');msg.textContent=m.text.slice(0,500);
      div.append(title,msg);$('chatLog').append(div);$('chatLog').scrollTop=$('chatLog').scrollHeight;
    }catch{/* ignore unreadable ciphertext */}
  },error=>announce('聊天连接失败：'+error.message));
  started=true;
}
function notifyChange(){
  if(!started||Date.now()<suppress||!latest) return;
  const video=$('video');if(!video.dataset.src)return;
  const now=Date.now();localVersion=now;
  sendState({url:video.dataset.src,position:video.currentTime||0,playing:!video.paused}).catch(e=>announce('同步失败：'+e.message));
}
$('createBtn').addEventListener('click',create);
$('joinBtn').addEventListener('click',join);
$('copyBtn').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(location.href);$('copyBtn').textContent='已复制 ✓';}catch{announce('无法自动复制，请从浏览器地址栏复制完整的 # 邀请链接。');}});
$('syncBtn').addEventListener('click',()=>{if(!latest)return;const v=$('video');pauseInputEvents();const t=latest.position+(latest.playing?Math.max(0,(Date.now()-latest.at)/1000):0);v.currentTime=t;if(latest.playing)v.play().catch(()=>{$('tapTip').classList.remove('hidden')});else v.pause();});
$('changeBtn').addEventListener('click',async()=>{const url=$('changeInput').value.trim();if(!validVideo(url))return announce('请输入 HTTPS 视频直链');try{localVersion=Date.now();await sendState({url,position:0,playing:false});$('changeInput').value='';}catch(e){announce(e.message)}});
$('chatForm').addEventListener('submit',async e=>{e.preventDefault();const input=$('chatInput'),text=input.value.trim();if(!text||!db)return;input.value='';try{await push(ref(db,`${roomPath()}/chat`),await seal({by:uid,text,at:Date.now()}));}catch(err){announce('发送失败：'+err.message);}});
for(const event of ['play','pause','seeked'])$('video').addEventListener(event,notifyChange);
// 间隔校准，有助于长时间观影防止时钟漂移。状态中只有加密数据。
setInterval(()=>{if(!started||!latest||$('video').paused||Date.now()<suppress)return;notifyChange()},12000);
if(new URLSearchParams(location.hash.slice(1)).has('room')){$('joinPrompt').classList.remove('hidden');$('videoInput').parentElement.querySelector('#createBtn').textContent='创建另一个加密房间 →';}
