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

const sessions       = {};
const sessionStates  = {};
const qrCodes        = {};
const senderPasswords = {}; // { number: hashedPassword }

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

function hashPass(pass) {
    return crypto.createHash('sha256').update(pass).digest('hex');
}

// Load password data dari file
function loadPasswords() {
    const f = path.join(__dirname, 'sender_passwords.json');
    if (fs.existsSync(f)) {
        try { Object.assign(senderPasswords, JSON.parse(fs.readFileSync(f,'utf8'))); } catch(e) {}
    }
}

function savePasswords() {
    fs.writeFileSync(path.join(__dirname, 'sender_passwords.json'), JSON.stringify(senderPasswords), 'utf8');
}

// ===================== SESSION =====================

async function createSession(num) {
    if (!makeWASocket) return;
    const dir = path.join(__dirname, 'sessions', num);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(dir);
    sessionStates[num] = 'connecting';

    const sock = makeWASocket({
        auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pinoLogger) },
        printQRInTerminal: false,
        logger: pinoLogger,
        browser: ['Vanzzz Tools', 'Chrome', '120.0.0'],
        connectTimeoutMs: 30000
    });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', async function(update) {
        var qr         = update.qr;
        var connection = update.connection;
        var lastDisconnect = update.lastDisconnect;

        if (qr) {
            qrCodes[num] = await qrcode.toDataURL(qr);
            sessionStates[num] = 'qr';
            console.log('QR ready:', num);
        }
        if (connection === 'open') {
            sessionStates[num] = 'connected';
            qrCodes[num] = null;
            sessions[num] = sock;
            console.log('Connected:', num);
        }
        if (connection === 'close') {
            var code = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output
                ? lastDisconnect.error.output.statusCode : 0;
            sessionStates[num] = 'disconnected';
            delete sessions[num];
            if (code !== DisconnectReason.loggedOut) {
                setTimeout(function() { createSession(num); }, 5000);
            } else {
                var d = path.join(__dirname, 'sessions', num);
                if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
                delete sessionStates[num];
                delete qrCodes[num];
                delete senderPasswords[num];
                savePasswords();
            }
        }
    });
    sessions[num] = sock;
}

async function loadSessions() {
    var dir = path.join(__dirname, 'sessions');
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir); return; }
    var list = fs.readdirSync(dir);
    for (var i = 0; i < list.length; i++) {
        await createSession(list[i]);
        await sleep(1000);
    }
}

// ===================== ROUTES =====================

app.get('/', function(req, res) { res.send(getPanelHtml()); });

app.get('/api/status', function(req, res) {
    var connected = Object.values(sessionStates).filter(function(s) { return s === 'connected'; }).length;
    res.json({
        status: 'running',
        totalSenders: Object.keys(sessionStates).length,
        connectedSenders: connected,
        senders: Object.keys(sessionStates).map(function(n) { return { number: n, status: sessionStates[n] }; })
    });
});

// Tambah sender — minta nomor + nama + password
app.post('/api/sender/add', async function(req, res) {
    if (!makeWASocket) return res.status(503).json({ error: 'Baileys tidak tersedia' });
    var number   = req.body.number;
    var name     = req.body.name;
    var password = req.body.password;

    if (!number)   return res.status(400).json({ error: 'Nomor wajib diisi' });
    if (!name)     return res.status(400).json({ error: 'Nama wajib diisi' });
    if (!password) return res.status(400).json({ error: 'Password wajib diisi' });

    var num = number.replace(/[^0-9]/g, '');
    if (sessionStates[num] === 'connected') return res.json({ status: 'already_connected', number: num });

    // Simpan password
    senderPasswords[num] = { name: name, hash: hashPass(password) };
    savePasswords();

    createSession(num);
    res.json({ status: 'connecting', number: num, name: name, message: 'Tunggu QR lalu scan' });
});

// Verifikasi password sender (dipakai APK saat tambah sender)
app.post('/api/sender/verify', function(req, res) {
    var number   = req.body.number;
    var password = req.body.password;
    if (!number || !password) return res.status(400).json({ error: 'number dan password wajib' });

    var num  = number.replace(/[^0-9]/g, '');
    var data = senderPasswords[num];
    if (!data) return res.status(404).json({ valid: false, error: 'Sender tidak ditemukan di server' });

    var valid = data.hash === hashPass(password);
    res.json({ valid: valid, name: valid ? data.name : null });
});

app.get('/api/sender/list', function(req, res) {
    var list = Object.keys(sessionStates).map(function(num) {
        var info = senderPasswords[num] || {};
        return { number: num, name: info.name || '-', status: sessionStates[num], hasQr: !!qrCodes[num] };
    });
    res.json({ senders: list });
});

app.get('/api/sender/qr/:number', function(req, res) {
    var qr = qrCodes[req.params.number];
    if (!qr) return res.status(404).json({ error: 'QR tidak tersedia', status: sessionStates[req.params.number] || 'unknown' });
    res.json({ qr: qr, number: req.params.number });
});

// Hapus sender — perlu password
app.delete('/api/sender/:number', async function(req, res) {
    var num      = req.params.number;
    var password = req.body ? req.body.password : null;
    var data     = senderPasswords[num];

    if (data && password && data.hash !== hashPass(password)) {
        return res.status(403).json({ error: 'Password salah' });
    }

    if (sessions[num]) { try { await sessions[num].logout(); } catch(e) {} delete sessions[num]; }
    delete sessionStates[num];
    delete qrCodes[num];
    delete senderPasswords[num];
    savePasswords();

    var dir = path.join(__dirname, 'sessions', num);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    res.json({ status: 'deleted', number: num });
});

// Spam pesan
app.post('/api/spam/message', async function(req, res) {
    var senders = req.body.senders;
    var target  = req.body.target;
    var message = req.body.message;
    var count   = req.body.count || 5;
    if (!senders || !target || !message) return res.status(400).json({ error: 'senders, target, message wajib' });

    var targetJid = target.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
    var results   = [];

    for (var i = 0; i < senders.length; i++) {
        var sNum = senders[i].replace(/[^0-9]/g, '');
        var sock = sessions[sNum];
        if (!sock || sessionStates[sNum] !== 'connected') { results.push({ sender: sNum, status: 'not_connected', sent: 0 }); continue; }
        var sent = 0;
        for (var j = 0; j < count; j++) {
            try { await sock.sendMessage(targetJid, { text: message }); sent++; await sleep(500); } catch(e) {}
        }
        results.push({ sender: sNum, status: 'done', sent: sent });
    }
    res.json({ success: true, results: results });
});

// Spam call
app.post('/api/spam/call', async function(req, res) {
    var senders = req.body.senders;
    var target  = req.body.target;
    var count   = req.body.count || 10;
    if (!senders || !target) return res.status(400).json({ error: 'senders dan target wajib' });

    var targetJid = target.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
    var results   = [];
    var idx = 0;

    for (var i = 0; i < count; i++) {
        var sNum = senders[idx % senders.length].replace(/[^0-9]/g, '');
        idx++;
        var sock = sessions[sNum];
        if (!sock || sessionStates[sNum] !== 'connected') { results.push({ call: i+1, sender: sNum, status: 'not_connected' }); continue; }
        try {
            await sock.sendMessage(targetJid, {
                audio: { url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' },
                pttPlayback: true,
                mimetype: 'audio/ogg; codecs=opus'
            });
            results.push({ call: i+1, sender: sNum, status: 'called' });
        } catch(e) {
            results.push({ call: i+1, sender: sNum, status: 'error', msg: e.message });
        }
        await sleep(2000);
    }
    res.json({ success: true, results: results, totalCalls: count });
});

// ===================== START =====================
loadPasswords();
loadSessions().then(function() {
    app.listen(PORT, function() { console.log('Vanzzz Tools Server jalan di port ' + PORT); });
});
