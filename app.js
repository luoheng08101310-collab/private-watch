import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { getDatabase, ref, set, onValue, push, query, limitToLast, onChildAdded } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';

const $ = id => document.getElementById(id);
const decoder = new TextDecoder(), encoder = new TextEncoder();
const b64 = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64 = str => Uint8Array.from(atob(str.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-str.length%4)%4)), c => c.charCodeAt(0));
const random = size => crypto.getRandomValues(new Uint8Array(size));
let db, roomId, key, uid, unsubscribe = null, latest = null, suppress = 0, started = false, seen = new Set(), currentKind = '', hls = null, countdownTimer = null;
const announce = msg => { $('alert').textContent = msg; $('alert').classList.remove('hidden'); };
const clearAlert = () => $('alert').classList.add('hidden');
const pauseInputEvents = () => { suppress = Date.now()+1100; };
const validVideo = s => { try { const u=new URL(s); return u.protocol==='https:' && !u.username && !u.password && s.length<=2048; }catch{return false;} };
const videoType = url => {const u=new URL(url);const host=u.hostname.toLowerCase();if((host==='bilibili.com'||host.endsWith('.bilibili.com')||host==='b23.tv') && /\/video\/(BV[0-9A-Za-z]+)/.test(u.pathname))return 'bili';if(/\.m3u8(?:$|[?#])/i.test(url))return 'hls';if(/\.(mp4|webm|ogv|ogg|m4v)(?:$|[?#])/i.test(url))return 'file';return 'external';};
const showMode = k => { currentKind=k; $('video').classList.toggle('hidden', k==='bili'||k==='external'); $('biliFrame').classList.toggle('hidden',k!=='bili'); $('externalPanel').classList.toggle('hidden',k!=='external');$('tapTip').classList.add('hidden');$('modeHelp').textContent=k==='file'?'MP4/WebM：支持自动同步播放、暂停和进度。':k==='hls'?'M3U8：当源站允许跨域播放时支持自动同步。':k==='bili'?'B站官方嵌入：播放器可观看但不能保证自动同步，请使用下方共享时间点。':'外部网站：双方各自打开原站观看，下方可以发送共享时间点；不能自动控制原站播放器。';};
function clearHls(){if(hls){hls.destroy();hls=null;}}
async function useSource(url){const k=videoType(url);const v=$('video');if(v.dataset.src===url && currentKind===k)return;clearHls();v.pause();v.removeAttribute('src');v.load();v.dataset.src=url;showMode(k);$('openSource').onclick=()=>window.open(url,'_blank','noopener,noreferrer');if(k==='file'){v.src=url;v.load();}else if(k==='hls'){if(v.canPlayType('application/vnd.apple.mpegurl')){v.src=url;v.load();}else{try{const mod=await import('https://cdn.jsdelivr.net/npm/hls.js@1.6.13/+esm');const Hls=mod.default;if(!Hls.isSupported())throw Error('浏览器不支持 HLS');hls=new Hls({enableWorker:true});hls.loadSource(url);hls.attachMedia(v);hls.on(Hls.Events.ERROR,(_,d)=>{if(d.fatal)announce('M3U8 播放失败：可能是源站跨域限制、链接过期或视频编码不支持。');});}catch(e){announce('HLS 加载失败：'+e.message);}}}else if(k==='bili'){const m=new URL(url).pathname.match(/\/video\/(BV[0-9A-Za-z]+)/);$('biliFrame').src='https://player.bilibili.com/player.html?bvid='+encodeURIComponent(m[1])+'&autoplay=0';}else{$('biliFrame').removeAttribute('src');}}
function timeFormat(sec){if(!Number.isFinite(sec)||sec<0)return'00:00';const s=Math.floor(sec),h=Math.floor(s/3600),m=Math.floor(s%3600/60),r=s%60;return h?`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}`:`${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}`;}
function parseTime(t){const a=t.trim().split(':').map(Number);if(!a.length||a.length>3||a.some(n=>!Number.isInteger(n)||n<0)||a.slice(1).some(n=>n>59))return null;return a.reduce((v,n)=>v*60+n,0);}


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
  if(!validVideo(url)) return announce('请输入完整 HTTPS 视频网址');
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
      await useSource(state.url);
      if(currentKind==='file'||currentKind==='hls'){
        const target=state.position+(state.playing?Math.max(0,(Date.now()-state.at)/1000):0);
        if(Math.abs(video.currentTime-target)>1.5){try{video.currentTime=target;}catch{}}
        if(state.playing && video.paused){try{await video.play();$('tapTip').classList.add('hidden');}catch{$('tapTip').classList.remove('hidden');}}
        else if(!state.playing && !video.paused)video.pause();
      }
      $('sharedTime').textContent='房间共享时间点：'+timeFormat(state.position)+' · '+(state.playing?'播放参考':'暂停参考')+'（外部网站需手动调整）';
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
  const video=$('video');if(!video.dataset.src || !['file','hls'].includes(currentKind))return;
  sendState({url:video.dataset.src,position:video.currentTime||0,playing:!video.paused}).catch(e=>announce('同步失败：'+e.message));
}
$('createBtn').addEventListener('click',create);
$('joinBtn').addEventListener('click',join);
$('copyBtn').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(location.href);$('copyBtn').textContent='已复制 ✓';}catch{announce('无法自动复制，请从浏览器地址栏复制完整的 # 邀请链接。');}});
$('syncBtn').addEventListener('click',()=>{if(!latest)return;if(!['file','hls'].includes(currentKind)){ $('sharedTime').textContent='共享时间点：'+timeFormat(latest.position)+'（请在原视频网站手动跳转）';return;}const v=$('video');pauseInputEvents();const t=latest.position+(latest.playing?Math.max(0,(Date.now()-latest.at)/1000):0);v.currentTime=t;if(latest.playing)v.play().catch(()=>{$('tapTip').classList.remove('hidden')});else v.pause();});
$('changeBtn').addEventListener('click',async()=>{const url=$('changeInput').value.trim();if(!validVideo(url))return announce('请输入 HTTPS 视频网址');try{await sendState({url,position:0,playing:false});$('changeInput').value='';}catch(e){announce(e.message)}});
$('sendTimeBtn').addEventListener('click',async()=>{const sec=parseTime($('manualTime').value);if(sec===null||sec>1e9)return announce('时间格式请使用 01:23 或 01:02:03');if(!latest)return;try{await sendState({url:latest.url,position:sec,playing:false});$('manualTime').value='';}catch(e){announce('发送时间点失败：'+e.message);}});
$('readyBtn').addEventListener('click',()=>{$('chatInput').value='我准备好了 ✅';$('chatForm').requestSubmit();});
$('countdownBtn').addEventListener('click',()=>{if(!latest)return;const n=10;sendState({url:latest.url,position:latest.position,playing:false}).catch(()=>{});$('chatInput').value='倒计时 10 秒后同时点击原网站播放 ▶';$('chatForm').requestSubmit();let left=n;clearInterval(countdownTimer);$('countdown').textContent='倒计时 '+left+' 秒';countdownTimer=setInterval(()=>{$('countdown').textContent=--left>0?'倒计时 '+left+' 秒':'现在同时播放！';if(left<=0)clearInterval(countdownTimer);},1000);});
$('chatForm').addEventListener('submit',async e=>{e.preventDefault();const input=$('chatInput'),text=input.value.trim();if(!text||!db)return;input.value='';try{await push(ref(db,`${roomPath()}/chat`),await seal({by:uid,text,at:Date.now()}));}catch(err){announce('发送失败：'+err.message);}});
for(const event of ['play','pause','seeked'])$('video').addEventListener(event,notifyChange);
// 间隔校准，有助于长时间观影防止时钟漂移。状态中只有加密数据。
setInterval(()=>{if(!started||!latest||!['file','hls'].includes(currentKind)||$('video').paused||Date.now()<suppress)return;notifyChange()},12000);
if(new URLSearchParams(location.hash.slice(1)).has('room')){$('joinPrompt').classList.remove('hidden');$('videoInput').parentElement.querySelector('#createBtn').textContent='创建另一个加密房间 →';}
