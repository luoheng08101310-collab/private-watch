
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {
  getDatabase, ref, set, onValue, push,
  query, limitToLast, onChildAdded,
  forceLongPolling
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';

const $ = id => document.getElementById(id);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const b64 = bytes =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

const unb64 = str => {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(
    atob(s + '='.repeat((4 - s.length % 4) % 4)),
    c => c.charCodeAt(0)
  );
};

const random = size => crypto.getRandomValues(new Uint8Array(size));

let db, roomId, key, uid;
let unsubscribe = null;
let latest = null;
let suppress = 0;
let started = false;
let seen = new Set();
let currentKind = '';
let hls = null;
let countdownTimer = null;

const announce = msg => {
  const el = $('alert');
  if (!el) {
    console.error(msg);
    return;
  }
  el.textContent = msg;
  el.classList.remove('hidden');
};

const clearAlert = () => {
  $('alert')?.classList.add('hidden');
};

function explainError(e, stage) {
  const code = String(e?.code || '');
  const message = String(e?.message || e || '未知错误');

  if (code.includes('operation-not-allowed')) {
    return 'Firebase 匿名登录未启用。请在 Authentication → 登录方式中启用 Anonymous。';
  }

  if (code.includes('invalid-api-key')) {
    return 'Firebase API Key 无效，请检查 firebase-config.js。';
  }

  if (code.includes('unauthorized-domain')) {
    return '当前网站域名未加入 Firebase Authentication 的授权域名。';
  }

  if (
    code.includes('permission-denied') ||
    /permission.denied/i.test(message)
  ) {
    return 'Firebase 数据库拒绝写入。请检查 Realtime Database 的 Rules 是否已发布。';
  }

  if (
    code.includes('network-request-failed') ||
    /failed to fetch|networkerror/i.test(message)
  ) {
    return '无法连接 Firebase，请检查网络或浏览器拦截情况。';
  }

  return `${stage}失败：${code ? code + ' · ' : ''}${message}`;
}

const pauseInputEvents = () => {
  suppress = Date.now() + 1100;
};

const validVideo = s => {
  try {
    const u = new URL(s);
    return u.protocol === 'https:' &&
      !u.username && !u.password && s.length <= 2048;
  } catch {
    return false;
  }
};

const videoType = url => {
  const u = new URL(url);
  const host = u.hostname.toLowerCase();

  if (
    (host === 'bilibili.com' ||
      host.endsWith('.bilibili.com') ||
      host === 'b23.tv') &&
    /\/video\/(BV[0-9A-Za-z]+)/i.test(u.pathname)
  ) return 'bili';

  if (/\.m3u8(?:$|[?#])/i.test(url)) return 'hls';

  if (/\.(mp4|webm|ogv|ogg|m4v)(?:$|[?#])/i.test(url)) {
    return 'file';
  }

  return 'external';
};

const showMode = kind => {
  currentKind = kind;

  $('video').classList.toggle(
    'hidden', kind === 'bili' || kind === 'external'
  );
  $('biliFrame').classList.toggle('hidden', kind !== 'bili');
  $('externalPanel').classList.toggle('hidden', kind !== 'external');
  $('tapTip').classList.add('hidden');

  const help = {
    file: 'MP4/WebM：支持同步播放、暂停和进度。',
    hls: 'M3U8：源站允许跨域播放时支持同步。',
    bili: 'B站嵌入播放器：播放控制可能受平台限制，请使用共享时间点。',
    external: '外部网站：双方分别打开原站观看，可通过聊天和时间点协同。'
  };

  $('modeHelp').textContent = help[kind] || '';
};

function clearHls() {
  if (hls) {
    hls.destroy();
    hls = null;
  }
}

async function useSource(url) {
  const kind = videoType(url);
  const video = $('video');

  if (video.dataset.src === url && currentKind === kind) return;

  clearHls();
  video.pause();
  video.removeAttribute('src');
  video.load();
  video.dataset.src = url;

  showMode(kind);

  $('openSource').onclick = () => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  if (kind === 'file') {
    video.src = url;
    video.load();
    return;
  }

  if (kind === 'hls') {
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      video.load();
      return;
    }

    try {
      const mod = await import(
        'https://cdn.jsdelivr.net/npm/hls.js@1.6.13/+esm'
      );
      const Hls = mod.default;

      if (!Hls.isSupported()) throw Error('浏览器不支持 HLS');

      hls = new Hls();
      hls.loadSource(url);
      hls.attachMedia(video);

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          announce('M3U8 播放失败：可能是跨域限制、链接过期或视频编码不支持。');
        }
      });
    } catch (e) {
      announce('HLS 加载失败：' + e.message);
    }
    return;
  }

  if (kind === 'bili') {
    const match = new URL(url).pathname.match(/\/video\/(BV[0-9A-Za-z]+)/i);

    if (!match) {
      announce('无法识别 B站视频编号。请使用标准 BV 视频链接。');
      return;
    }

    $('biliFrame').src =
      'https://player.bilibili.com/player.html?bvid=' +
      encodeURIComponent(match[1]) + '&autoplay=0';
    return;
  }

  $('biliFrame').removeAttribute('src');
}

function timeFormat(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '00:00';

  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;

  return h
    ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function parseTime(t) {
  const a = t.trim().split(':').map(Number);

  if (
    !a.length || a.length > 3 ||
    a.some(n => !Number.isInteger(n) || n < 0) ||
    a.slice(1).some(n => n > 59)
  ) return null;

  return a.reduce((v, n) => v * 60 + n, 0);
}

async function seal(obj) {
  const iv = random(12);
  const plain = encoder.encode(JSON.stringify(obj));

  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain)
  );

  return { iv: b64(iv), data: b64(encrypted) };
}

async function openSeal(envelope) {
  const bytes = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(envelope.iv) },
    key,
    unb64(envelope.data)
  );

  return JSON.parse(decoder.decode(bytes));
}


async function init() {
  if (!firebaseConfig?.apiKey ||
      firebaseConfig.apiKey === 'REPLACE_ME') {
    throw new Error('Firebase 尚未配置');
  }

  if (!db) {
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);

    const result = await signInAnonymously(auth);
    uid = result.user.uid;

    // 禁用 WebSocket，改用 HTTP 长轮询
    forceLongPolling();

    db = getDatabase(app, firebaseConfig.databaseURL);

    console.log('Firebase 初始化完成，UID:', uid);
  }
}


const roomPath = () => `rooms/${roomId}`;


async function sendState({url, position, playing}) {
  if (!db) {
    throw new Error('Firebase 数据库尚未初始化');
  }

  const state = {
    url,
    position,
    playing,
    at: Date.now(),
    by: uid
  };

  const encrypted = await seal(state);

  const timeout = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(
        '数据库写入超时：Firebase 可能没有连接成功。请确认 Realtime Database 安全规则已经发布，且网络允许访问 Firebase。'
      ));
    }, 10000);
  });

  await Promise.race([
    set(ref(db, `${roomPath()}/state`), encrypted),
    timeout
  ]);
}




async function create() {
  clearAlert();

  const url = $('videoInput').value.trim();
  const btn = $('createBtn');

  if (!validVideo(url)) {
    announce('请输入完整的 HTTPS 视频网址');
    return;
  }

  btn.disabled = true;

  let stage = 'Firebase 匿名登录';

  const withTimeout = (promise, ms, message) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(message)), ms
      );

      Promise.resolve(promise).then(
        value => {
          clearTimeout(timer);
          resolve(value);
        },
        error => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });

  try {
    btn.textContent = '正在连接 Firebase...';

    await withTimeout(
      init(),
      15000,
      '登录等待超时，请检查 Firebase Authentication'
    );

    stage = '生成加密密钥';
    btn.textContent = '正在生成加密房间...';

    const newRoomId = b64(random(18));
    const secret = random(32);

    const newKey = await crypto.subtle.importKey(
      'raw',
      secret,
      'AES-GCM',
      false,
      ['encrypt', 'decrypt']
    );

    roomId = newRoomId;
    key = newKey;

    stage = '写入 Firebase 数据库';
    btn.textContent = '正在保存房间...';

    await withTimeout(
      sendState({
        url: url,
        position: 0,
        playing: false
      }),
      15000,
      '数据库写入超时，请检查数据库规则和网络连接'
    );

    const fragment = new URLSearchParams({
      room: roomId,
      key: b64(secret)
    });

    history.replaceState(
      null,
      '',
      location.pathname +
      location.search +
      '#' +
      fragment.toString()
    );

    enter();

  } catch (e) {
    console.error('创建房间失败：', stage, e);

    announce(
      stage + '失败：' +
      (e.message || String(e))
    );

  } finally {
    btn.disabled = false;
    btn.textContent = '创建加密房间 →';
  }
}


async function join() {
  clearAlert();
  $('joinBtn').disabled = true;

  try {
    const params = new URLSearchParams(location.hash.slice(1));
    roomId = params.get('room');

    const secret = unb64(params.get('key') || '');

    if (!/^[A-Za-z0-9_-]{24}$/.test(roomId || '') || secret.length !== 32) {
      throw Error('邀请链接格式不正确，请使用完整邀请链接。');
    }

    key = await crypto.subtle.importKey(
      'raw', secret, 'AES-GCM', false, ['encrypt', 'decrypt']
    );

    await init();
    enter();
  } catch (e) {
    announce('加入失败：' + explainError(e, '加入房间'));
  } finally {
    $('joinBtn').disabled = false;
  }
}

function enter() {
  $('setup').classList.add('hidden');
  $('room').classList.remove('hidden');
  $('roomShort').textContent = roomId.slice(0, 6).toUpperCase();
  $('status').textContent = '已连接，等待房间状态';

  const video = $('video');

  unsubscribe?.();

  unsubscribe = onValue(
    ref(db, `${roomPath()}/state`),
    async snapshot => {
      if (!snapshot.exists()) {
        $('status').textContent = '房间不存在或尚未写入状态';
        return;
      }

      try {
        const state = await openSeal(snapshot.val());

        if (
          !validVideo(state.url) ||
          typeof state.position !== 'number' ||
          typeof state.playing !== 'boolean' ||
          !Number.isFinite(state.position) ||
          state.position < 0 || state.position > 1e9
        ) throw Error('无效房间状态');

        latest = state;
        pauseInputEvents();

        await useSource(state.url);

        if (currentKind === 'file' || currentKind === 'hls') {
          const target = state.position +
            (state.playing ? Math.max(0, (Date.now() - state.at) / 1000) : 0);

          if (Math.abs(video.currentTime - target) > 1.5) {
            try { video.currentTime = target; } catch {}
          }

          if (state.playing && video.paused) {
            try {
              await video.play();
              $('tapTip').classList.add('hidden');
            } catch {
              $('tapTip').classList.remove('hidden');
            }
          } else if (!state.playing && !video.paused) {
            video.pause();
          }
        }

        $('sharedTime').textContent =
          '房间共享时间点：' + timeFormat(state.position) +
          (state.playing ? ' · 播放参考' : ' · 暂停参考') +
          '（外部网站需手动调整）';

        $('status').textContent = '加密同步已开启';
      } catch (e) {
        console.error('读取房间状态失败：', e);
        announce('无法解密房间数据，请确认使用的是完整邀请链接。');
      }
    },
    error => announce('同步连接失败：' + explainError(error, '同步连接'))
  );

  onChildAdded(
    query(ref(db, `${roomPath()}/chat`), limitToLast(80)),
    async snap => {
      if (seen.has(snap.key)) return;
      seen.add(snap.key);

      try {
        const m = await openSeal(snap.val());
        if (typeof m.text !== 'string') return;

        const div = document.createElement('div');
        div.className = 'message' + (m.by === uid ? ' mine' : '');

        const title = document.createElement('small');
        title.textContent = m.by === uid ? '我' : '朋友';

        const msg = document.createElement('span');
        msg.textContent = m.text.slice(0, 500);

        div.append(title, msg);
        $('chatLog').append(div);
        $('chatLog').scrollTop = $('chatLog').scrollHeight;
      } catch {
        // 忽略无法解密的历史消息
      }
    },
    error => announce('聊天连接失败：' + explainError(error, '聊天连接'))
  );

  started = true;
}

function notifyChange() {
  if (!started || Date.now() < suppress || !latest) return;

  const video = $('video');

  if (!video.dataset.src || !['file', 'hls'].includes(currentKind)) return;

  sendState({
    url: video.dataset.src,
    position: video.currentTime || 0,
    playing: !video.paused
  }).catch(e => announce('同步失败：' + explainError(e, '同步')));
}

$('createBtn').addEventListener('click', create);
$('joinBtn').addEventListener('click', join);

$('copyBtn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    $('copyBtn').textContent = '已复制 ✓';
  } catch {
    announce('请从浏览器地址栏复制完整邀请链接。');
  }
});

$('syncBtn').addEventListener('click', () => {
  if (!latest) return;

  if (!['file', 'hls'].includes(currentKind)) {
    $('sharedTime').textContent =
      '共享时间点：' + timeFormat(latest.position) +
      '（请在原视频网站手动跳转）';
    return;
  }

  const video = $('video');
  pauseInputEvents();

  const target = latest.position +
    (latest.playing ? Math.max(0, (Date.now() - latest.at) / 1000) : 0);

  video.currentTime = target;

  if (latest.playing) {
    video.play().catch(() => $('tapTip').classList.remove('hidden'));
  } else {
    video.pause();
  }
});

$('changeBtn').addEventListener('click', async () => {
  const url = $('changeInput').value.trim();

  if (!validVideo(url)) return announce('请输入 HTTPS 视频网址。');

  try {
    await sendState({ url, position: 0, playing: false });
    $('changeInput').value = '';
  } catch (e) {
    announce('更换视频失败：' + explainError(e, '更换视频'));
  }
});

$('sendTimeBtn').addEventListener('click', async () => {
  const sec = parseTime($('manualTime').value);

  if (sec === null || sec > 1e9) {
    return announce('时间格式请使用 01:23 或 01:02:03。');
  }

  if (!latest) return;

  try {
    await sendState({
      url: latest.url,
      position: sec,
      playing: false
    });
    $('manualTime').value = '';
  } catch (e) {
    announce('发送时间点失败：' + explainError(e, '发送时间点'));
  }
});

$('readyBtn').addEventListener('click', () => {
  $('chatInput').value = '我准备好了 ✅';
  $('chatForm').requestSubmit();
});

$('countdownBtn').addEventListener('click', () => {
  if (!latest) return;

  sendState({
    url: latest.url,
    position: latest.position,
    playing: false
  }).catch(() => {});

  $('chatInput').value = '倒计时 10 秒后同时点击原网站播放 ▶';
  $('chatForm').requestSubmit();

  let left = 10;
  clearInterval(countdownTimer);
  $('countdown').textContent = '倒计时 ' + left + ' 秒';

  countdownTimer = setInterval(() => {
    left--;
    $('countdown').textContent = left > 0
      ? '倒计时 ' + left + ' 秒'
      : '现在同时播放！';

    if (left <= 0) clearInterval(countdownTimer);
  }, 1000);
});

$('chatForm').addEventListener('submit', async e => {
  e.preventDefault();

  const input = $('chatInput');
  const text = input.value.trim();

  if (!text || !db) return;

  input.value = '';

  try {
    await push(
      ref(db, `${roomPath()}/chat`),
      await seal({ by: uid, text, at: Date.now() })
    );
  } catch (err) {
    announce('发送失败：' + explainError(err, '发送消息'));
  }
});

for (const event of ['play', 'pause', 'seeked']) {
  $('video').addEventListener(event, notifyChange);
}

setInterval(() => {
  if (
    !started || !latest ||
    !['file', 'hls'].includes(currentKind) ||
    $('video').paused || Date.now() < suppress
  ) return;

  notifyChange();
}, 12000);

if (new URLSearchParams(location.hash.slice(1)).has('room')) {
  $('joinPrompt').classList.remove('hidden');
  $('createBtn').textContent = '创建另一个加密房间 →';
}
