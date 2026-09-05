const express    = require('express');
const cors       = require('cors');
const bodyParser = require('body-parser');
const qrcode     = require('qrcode');
const path       = require('path');
const fs         = require('fs');
const crypto     = require('crypto');
const getPanelHtml = require('./panel.js');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// ===================== WA SESSIONS =====================
const sessions       = {};
const sessionStates  = {};
const qrCodes        = {};
const senderPasswords = {};

const PASS_FILE  = path.join(__dirname, 'sender_passwords.json');
const CODES_FILE = path.join(__dirname, 'redeem_codes.json');

// Redeem codes: { "feature:code": { feature, used, createdAt } }
const redeemCodes = {};

const OWNER_KEY = 'EVAN13_OWNER_2024';

let makeWASocket, useMultiFileAuthState, DisconnectReason, makeCacheableSignalKeyStore, pinoLogger;
try {
    const b = require('@whiskeysockets/baileys');
    makeWASocket = b.makeWASocket;
    useMultiFileAuthState = b.useMultiFileAuthState;
    DisconnectReason = b.DisconnectReason;
    makeCacheableSignalKeyStore = b.makeCacheableSignalKeyStore;
    pinoLogger = require('pino')({ level: 'silent' });
    console.log('Baileys loaded OK');
} catch(e) { console.log('Baileys error:', e.message); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function hashPass(p) { return crypto.createHash('sha256').update(p).digest('hex'); }

function loadPasswords() {
    try { if (fs.existsSync(PASS_FILE)) Object.assign(senderPasswords, JSON.parse(fs.readFileSync(PASS_FILE,'utf8'))); } catch(e) {}
}
function savePasswords() { fs.writeFileSync(PASS_FILE, JSON.stringify(senderPasswords), 'utf8'); }

function loadCodes() {
    try { if (fs.existsSync(CODES_FILE)) Object.assign(redeemCodes, JSON.parse(fs.readFileSync(CODES_FILE,'utf8'))); } catch(e) {}
}
function saveCodes() { fs.writeFileSync(CODES_FILE, JSON.stringify(redeemCodes), 'utf8'); }

// ===================== WA SESSION =====================
async function createSession(num) {
    if (!makeWASocket) return;
    const dir = path.join(__dirname, 'sessions', num);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(dir);
    sessionStates[num] = 'connecting';
    const sock = makeWASocket({
        auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pinoLogger) },
        printQRInTerminal: false, logger: pinoLogger,
        browser: ['Vanzzz Tools','Chrome','120.0.0'], connectTimeoutMs: 30000
    });
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', async function(update) {
        var qr = update.qr, connection = update.connection, lastDisconnect = update.lastDisconnect;
        if (qr) { qrCodes[num] = await qrcode.toDataURL(qr); sessionStates[num] = 'qr'; }
        if (connection === 'open') { sessionStates[num]='connected'; qrCodes[num]=null; sessions[num]=sock; }
        if (connection === 'close') {
            var code = lastDisconnect&&lastDisconnect.error&&lastDisconnect.error.output ? lastDisconnect.error.output.statusCode : 0;
            sessionStates[num]='disconnected'; delete sessions[num];
            if (code !== DisconnectReason.loggedOut) setTimeout(function(){ createSession(num); }, 5000);
            else { var d=path.join(__dirname,'sessions',num); if(fs.existsSync(d)) fs.rmSync(d,{recursive:true,force:true}); delete sessionStates[num]; delete qrCodes[num]; }
        }
    });
    sessions[num] = sock;
}

async function loadSessions() {
    var dir = path.join(__dirname, 'sessions');
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir); return; }
    for (var d of fs.readdirSync(dir)) { await createSession(d); await sleep(1000); }
}

// ===================== ROUTES =====================
app.get('/', function(req, res) { res.send(getPanelHtml()); });

app.get('/api/status', function(req, res) {
    var connected = Object.values(sessionStates).filter(function(s){return s==='connected';}).length;
    res.json({ status:'running', totalSenders:Object.keys(sessionStates).length, connectedSenders:connected,
        senders:Object.keys(sessionStates).map(function(n){return{number:n,status:sessionStates[n]};}) });
});

// Sender management
app.post('/api/sender/add', async function(req, res) {
    if (!makeWASocket) return res.status(503).json({error:'Baileys tidak tersedia'});
    var number=req.body.number, name=req.body.name, password=req.body.password;
    if (!number) return res.status(400).json({error:'Nomor wajib'});
    if (!name)   return res.status(400).json({error:'Nama wajib'});
    if (!password) return res.status(400).json({error:'Password wajib'});
    var num = number.replace(/[^0-9]/g,'');
    if (sessionStates[num]==='connected') return res.json({status:'already_connected',number:num});
    senderPasswords[num] = {name:name, hash:hashPass(password)};
    savePasswords();
    createSession(num);
    res.json({status:'connecting',number:num,name:name,message:'Tunggu QR lalu scan'});
});

app.post('/api/sender/verify', function(req, res) {
    var number=req.body.number, password=req.body.password;
    if (!number||!password) return res.status(400).json({error:'number dan password wajib'});
    var num=number.replace(/[^0-9]/g,''), data=senderPasswords[num];
    if (!data) return res.status(404).json({valid:false,error:'Sender tidak ditemukan di server'});
    res.json({valid: data.hash===hashPass(password), name: data.name||num});
});

app.get('/api/sender/list', function(req, res) {
    res.json({senders:Object.keys(sessionStates).map(function(num){
        var info=senderPasswords[num]||{};
        return{number:num,name:info.name||'-',status:sessionStates[num],hasQr:!!qrCodes[num]};
    })});
});

app.get('/api/sender/qr/:number', function(req, res) {
    var qr=qrCodes[req.params.number];
    if (!qr) return res.status(404).json({error:'QR tidak tersedia',status:sessionStates[req.params.number]||'unknown'});
    res.json({qr:qr,number:req.params.number});
});

app.delete('/api/sender/:number', async function(req, res) {
    var num=req.params.number, password=req.body?req.body.password:null, data=senderPasswords[num];
    if (data&&password&&data.hash!==hashPass(password)) return res.status(403).json({error:'Password salah'});
    if (sessions[num]) { try{await sessions[num].logout();}catch(e){} delete sessions[num]; }
    delete sessionStates[num]; delete qrCodes[num]; delete senderPasswords[num]; savePasswords();
    var dir=path.join(__dirname,'sessions',num); if(fs.existsSync(dir)) fs.rmSync(dir,{recursive:true,force:true});
    res.json({status:'deleted',number:num});
});

// ===================== REDEEM CODE =====================
// Buat kode (Owner only)
app.post('/api/redeem/create', function(req, res) {
    var feature=req.body.feature, count=Math.min(parseInt(req.body.count)||1,20), ownerKey=req.body.owner_key;
    if (ownerKey !== OWNER_KEY) return res.status(403).json({error:'Bukan Owner!'});
    if (!feature) return res.status(400).json({error:'feature wajib'});

    var generated = [];
    for (var i=0;i<count;i++) {
        var letters='abcdefghijklmnopqrstuvwxyz', r5='', r5n='';
        for(var j=0;j<5;j++) r5+=letters[Math.floor(Math.random()*26)];
        for(var j=0;j<5;j++) r5n+=Math.floor(Math.random()*10);
        var now=new Date(), dateStr=now.getDate()+'/'+(now.getMonth()+1)+'/'+String(now.getFullYear()).slice(2);
        var code=r5+'-'+r5n+'-'+dateStr;
        var fullKey=feature+':'+code;
        redeemCodes[fullKey]={feature:feature,used:false,createdAt:dateStr};
        generated.push({code:code,feature:feature});
    }
    saveCodes();
    res.json({success:true,codes:generated});
});

// List kode (Owner only)
app.get('/api/redeem/list', function(req, res) {
    if (req.query.owner_key!==OWNER_KEY) return res.status(403).json({error:'Bukan Owner!'});
    res.json({codes:redeemCodes});
});

// Gunakan kode (semua user)
app.post('/api/redeem/use', function(req, res) {
    var inputCode=req.body.code;
    if (!inputCode) return res.status(400).json({error:'code wajib'});
    var foundKey=null, found=null;
    Object.keys(redeemCodes).forEach(function(key){
        var codeOnly=key.split(':').slice(1).join(':');
        if (codeOnly.toLowerCase()===inputCode.toLowerCase()) { found=redeemCodes[key]; foundKey=key; }
    });
    if (!found) return res.status(404).json({valid:false,error:'Kode tidak valid!'});
    if (found.used) return res.status(400).json({valid:false,error:'Kode sudah digunakan!'});
    redeemCodes[foundKey].used=true; saveCodes();
    res.json({valid:true,feature:found.feature,message:'Kode berhasil digunakan!'});
});

// ===================== SPAM MESSAGE & CALL =====================
app.post('/api/spam/message', async function(req, res) {
    var senders=req.body.senders, target=req.body.target, message=req.body.message, count=req.body.count||5;
    if (!senders||!target||!message) return res.status(400).json({error:'senders, target, message wajib'});
    var targetJid=target.replace(/[^0-9]/g,'')+'@s.whatsapp.net', results=[];
    for (var i=0;i<senders.length;i++) {
        var sNum=senders[i].replace(/[^0-9]/g,''), sock=sessions[sNum];
        if (!sock||sessionStates[sNum]!=='connected'){results.push({sender:sNum,status:'not_connected',sent:0});continue;}
        var sent=0;
        for(var j=0;j<count;j++){try{await sock.sendMessage(targetJid,{text:message});sent++;await sleep(500);}catch(e){}}
        results.push({sender:sNum,status:'done',sent:sent});
    }
    res.json({success:true,results:results});
});

app.post('/api/spam/call', async function(req, res) {
    var senders=req.body.senders, target=req.body.target, count=req.body.count||10;
    if (!senders||!target) return res.status(400).json({error:'senders dan target wajib'});
    var targetJid=target.replace(/[^0-9]/g,'')+'@s.whatsapp.net', results=[], idx=0;
    for (var i=0;i<count;i++) {
        var sNum=senders[idx%senders.length].replace(/[^0-9]/g,''); idx++;
        var sock=sessions[sNum];
        if (!sock||sessionStates[sNum]!=='connected'){results.push({call:i+1,sender:sNum,status:'not_connected'});continue;}
        try {
            await sock.sendMessage(targetJid,{audio:{url:'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3'},pttPlayback:true,mimetype:'audio/ogg; codecs=opus'});
            results.push({call:i+1,sender:sNum,status:'called'});
        } catch(e){ results.push({call:i+1,sender:sNum,status:'error',msg:e.message}); }
        await sleep(2000);
    }
    res.json({success:true,results:results,totalCalls:count});
});

// ===================== START =====================
loadPasswords();
loadCodes();
loadSessions().then(function() {
    app.listen(PORT, function() { console.log('Vanzzz Tools Server jalan di port '+PORT); });
});
