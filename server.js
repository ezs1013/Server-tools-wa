const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const qrcode = require('qrcode');
const NodeCache = require('node-cache');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// Serve static inline — tidak bergantung folder public
const sessions = {};
const sessionStates = {};
const qrCodes = {};

let makeWASocket, useMultiFileAuthState, DisconnectReason, makeCacheableSignalKeyStore, pino;

try {
    const baileys = require('@whiskeysockets/baileys');
    makeWASocket = baileys.makeWASocket;
    useMultiFileAuthState = baileys.useMultiFileAuthState;
    DisconnectReason = baileys.DisconnectReason;
    makeCacheableSignalKeyStore = baileys.makeCacheableSignalKeyStore;
    pino = require('pino')({ level: 'silent' });
    console.log('✅ Baileys loaded');
} catch(e) {
    console.log('⚠️ Baileys belum terinstall, jalankan: npm install');
}

// ===================== PANEL HTML INLINE =====================
const PANEL_HTML = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WA Gateway — EVAN13</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',sans-serif;background:#0D1B2A;color:#E3F2FD;min-height:100vh}
header{background:#1565C0;padding:18px 24px}
header h1{font-size:20px;color:#fff}
header p{font-size:12px;color:#BBDEFB;margin-top:2px}
.wrap{max-width:860px;margin:0 auto;padding:24px 16px}
.card{background:#152238;border-radius:14px;padding:20px;margin-bottom:16px;border:1px solid #1E3A5F}
.card h2{font-size:14px;color:#42A5F5;margin-bottom:14px;text-transform:uppercase;letter-spacing:1px}
input{width:100%;padding:11px 14px;border-radius:8px;border:1px solid #1E3A5F;background:#0D1B2A;color:#E3F2FD;font-size:14px;outline:none}
input:focus{border-color:#1565C0}
.row{display:flex;gap:10px;margin-top:10px}
.btn{padding:11px 20px;border-radius:8px;border:none;cursor:pointer;font-size:13px;font-weight:bold}
.btn-blue{background:#1565C0;color:#fff}.btn-blue:hover{background:#1976D2}
.btn-red{background:#C62828;color:#fff}.btn-red:hover{background:#D32F2F}
.url-box{background:#0D1B2A;border-radius:8px;padding:12px 14px;font-family:monospace;font-size:13px;color:#42A5F5;word-break:break-all;border:1px solid #1E3A5F;margin-bottom:10px}
.item{background:#0D1B2A;border-radius:8px;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;border:1px solid #1E3A5F;margin-bottom:8px}
.badge{padding:3px 10px;border-radius:20px;font-size:11px;font-weight:bold}
.ok{background:#2E7D32;color:#fff}.conn{background:#E65100;color:#fff}
.qr{background:#1565C0;color:#fff}.dis{background:#424242;color:#fff}
.modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:99;align-items:center;justify-content:center}
.modal.show{display:flex}
.mbox{background:#152238;border-radius:16px;padding:28px;text-align:center;max-width:320px;width:90%}
.mbox h3{color:#42A5F5;margin-bottom:6px}
.mbox p{color:#90CAF9;font-size:12px;margin-bottom:14px}
.mbox img{width:240px;height:240px;background:#fff;border-radius:10px;padding:6px}
.cls{margin-top:12px;display:block;color:#90CAF9;cursor:pointer;font-size:12px}
#empty{color:#546E7A;font-size:13px}
</style>
</head>
<body>
<header>
  <h1>⚡ WA Gateway</h1>
  <p>by EVAN13 — Panel Sender</p>
</header>
<div class="wrap">

  <div class="card">
    <h2>🌐 URL Server</h2>
    <div class="url-box" id="sUrl">Memuat...</div>
    <button class="btn btn-blue" onclick="copyUrl()">📋 Copy URL untuk APK</button>
  </div>

  <div class="card">
    <h2>➕ Tambah Sender</h2>
    <input type="tel" id="num" placeholder="Nomor sender: 6281234567890"/>
    <p style="color:#90CAF9;font-size:11px;margin-top:6px">Format 62xxx tanpa + atau spasi</p>
    <div class="row">
      <button class="btn btn-blue" onclick="addSender()">Tambah & Scan QR</button>
    </div>
  </div>

  <div class="card">
    <h2>📱 Daftar Sender</h2>
    <div id="list"><p id="empty">Belum ada sender</p></div>
  </div>

</div>

<div class="modal" id="modal">
  <div class="mbox">
    <h3>Scan QR Code</h3>
    <p>WA → Perangkat Tertaut → Tautkan Perangkat</p>
    <img id="qrImg" src="" alt="QR"/>
    <span class="cls" onclick="closeModal()">✕ Tutup</span>
  </div>
</div>

<script>
document.getElementById('sUrl').textContent = location.origin;
function copyUrl(){navigator.clipboard.writeText(location.origin);alert('URL disalin!')}

async function addSender(){
  const n = document.getElementById('num').value.trim();
  if(!n){alert('Masukkan nomor!');return}
  const r = await fetch('/api/sender/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({number:n})});
  const d = await r.json();
  document.getElementById('num').value='';
  load();
  // Poll QR
  let t=0;
  const iv=setInterval(async()=>{
    t++;
    const qr=await fetch('/api/sender/qr/'+d.number);
    if(qr.ok){const q=await qr.json();showQr(q.qr,d.number);clearInterval(iv)}
    if(t>12)clearInterval(iv);
  },3000);
}

function showQr(src,num){
  document.getElementById('qrImg').src=src;
  document.getElementById('modal').classList.add('show');
  const iv=setInterval(async()=>{
    const r=await fetch('/api/status');
    const d=await r.json();
    const s=d.senders.find(x=>x.number===num);
    if(s&&s.status==='connected'){closeModal();load();clearInterval(iv)}
  },3000);
}
function closeModal(){document.getElementById('modal').classList.remove('show')}

async function showQrBtn(num){
  const r=await fetch('/api/sender/qr/'+num);
  if(!r.ok){alert('QR tidak tersedia');return}
  const d=await r.json();showQr(d.qr,num);
}

async function del(num){
  if(!confirm('Hapus sender '+num+'?'))return;
  await fetch('/api/sender/'+num,{method:'DELETE'});load();
}

function badge(s){
  const m={connected:['✅ Terhubung','ok'],connecting:['🔄 Connecting','conn'],qr:['📷 Scan QR','qr'],disconnected:['❌ Disconnect','dis']};
  const[l,c]=m[s]||['❓','dis'];
  return '<span class="badge '+c+'">'+l+'</span>';
}

async function load(){
  const r=await fetch('/api/sender/list');
  const d=await r.json();
  const el=document.getElementById('list');
  if(!d.senders.length){el.innerHTML='<p id="empty">Belum ada sender</p>';return}
  el.innerHTML=d.senders.map(s=>`
    <div class="item">
      <span style="font-size:14px;font-weight:bold">📱 ${s.number}</span>
      <div style="display:flex;gap:8px;align-items:center">
        ${badge(s.status)}
        ${s.hasQr?`<button class="btn btn-blue" style="padding:5px 10px;font-size:11px" onclick="showQrBtn('${s.number}')">QR</button>`:''}
        <button class="btn btn-red" style="padding:5px 10px;font-size:11px" onclick="del('${s.number}')">Hapus</button>
      </div>
    </div>`).join('');
}

load();setInterval(load,5000);
</script>
</body>
</html>`;

// ===================== ROUTES =====================

app.get('/', (req, res) => res.send(PANEL_HTML));

app.post('/api/sender/add', async (req, res) => {
    if (!makeWASocket) return res.status(503).json({ error: 'Baileys belum terinstall' });
    const { number } = req.body;
    if (!number) return res.status(400).json({ error: 'Nomor wajib diisi' });
    const num = number.replace(/[^0-9]/g, '');
    if (sessionStates[num] === 'connected') return res.json({ status: 'already_connected', number: num });
    createSession(num);
    res.json({ status: 'connecting', number: num, message: 'Tunggu QR muncul lalu scan' });
});

app.get('/api/sender/list', (req, res) => {
    const list = Object.keys(sessionStates).map(num => ({
        number: num, status: sessionStates[num], hasQr: !!qrCodes[num]
    }));
    res.json({ senders: list });
});

app.get('/api/sender/qr/:number', (req, res) => {
    const qr = qrCodes[req.params.number];
    if (!qr) return res.status(404).json({ error: 'QR tidak tersedia', status: sessionStates[req.params.number] || 'unknown' });
    res.json({ qr, number: req.params.number });
});

app.delete('/api/sender/:number', async (req, res) => {
    const num = req.params.number;
    if (sessions[num]) { try { await sessions[num].logout(); } catch(e) {} delete sessions[num]; }
    delete sessionStates[num];
    delete qrCodes[num];
    const dir = path.join(__dirname, 'sessions', num);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    res.json({ status: 'deleted', number: num });
});

app.post('/api/spam/message', async (req, res) => {
    const { senders, target, message, count } = req.body;
    if (!senders || !target || !message) return res.status(400).json({ error: 'senders, target, message wajib' });
    const targetJid = target.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
    const perSender = count || 5;
    const results = [];
    for (const sender of senders) {
        const num = sender.replace(/[^0-9]/g, '');
        const sock = sessions[num];
        if (!sock || sessionStates[num] !== 'connected') { results.push({ sender: num, status: 'not_connected', sent: 0 }); continue; }
        let sent = 0;
        for (let i = 0; i < perSender; i++) {
            try { await sock.sendMessage(targetJid, { text: message }); sent++; await sleep(500); } catch(e) {}
        }
        results.push({ sender: num, status: 'done', sent });
    }
    res.json({ success: true, results });
});

app.post('/api/spam/call', async (req, res) => {
    const { senders, target, count } = req.body;
    if (!senders || !target) return res.status(400).json({ error: 'senders dan target wajib' });
    const targetJid = target.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
    const total = count || 10;
    const results = [];
    let idx = 0;
    for (let i = 0; i < total; i++) {
        const num = senders[idx % senders.length].replace(/[^0-9]/g, '');
        idx++;
        const sock = sessions[num];
        if (!sock || sessionStates[num] !== 'connected') { results.push({ call: i+1, sender: num, status: 'not_connected' }); continue; }
        try {
            await sock.sendMessage(targetJid, { audio: { url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' }, pttPlayback: true, mimetype: 'audio/ogg; codecs=opus' });
            results.push({ call: i+1, sender: num, status: 'called' });
        } catch(e) { results.push({ call: i+1, sender: num, status: 'error', msg: e.message }); }
        await sleep(2000);
    }
    res.json({ success: true, results, totalCalls: total });
});

app.get('/api/status', (req, res) => {
    const connected = Object.values(sessionStates).filter(s => s === 'connected').length;
    res.json({ status: 'running', totalSenders: Object.keys(sessionStates).length, connectedSenders: connected, senders: Object.keys(sessionStates).map(n => ({ number: n, status: sessionStates[n] })) });
});

// ===================== SESSION =====================

async function createSession(num) {
    if (!makeWASocket) return;
    const dir = path.join(__dirname, 'sessions', num);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(dir);
    sessionStates[num] = 'connecting';
    const sock = makeWASocket({ auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino) }, printQRInTerminal: false, logger: pino, browser: ['WA Tools', 'Chrome', '120.0.0'], connectTimeoutMs: 30000 });
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        if (qr) { qrCodes[num] = await qrcode.toDataURL(qr); sessionStates[num] = 'qr'; }
        if (connection === 'open') { sessionStates[num] = 'connected'; qrCodes[num] = null; sessions[num] = sock; console.log(`✅ ${num} terhubung`); }
        if (connection === 'close') {
            const code = lastDisconnect?.error?.output?.statusCode;
            sessionStates[num] = 'disconnected'; delete sessions[num];
            if (code !== DisconnectReason.loggedOut) setTimeout(() => createSession(num), 5000);
            else { fs.rmSync(dir, { recursive: true, force: true }); delete sessionStates[num]; delete qrCodes[num]; }
        }
    });
    sessions[num] = sock;
}

async function loadSessions() {
    const dir = path.join(__dirname, 'sessions');
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir); return; }
    for (const d of fs.readdirSync(dir)) { await createSession(d); await sleep(1000); }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

loadSessions().then(() => {
    app.listen(PORT, () => console.log(`✅ Server jalan di port ${PORT}`));
});
