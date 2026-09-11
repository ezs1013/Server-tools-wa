const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const getPanelHtml = require('./panel.js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

const sessions = {};
const sessionStates = {};
const qrCodes = {};

let makeWASocket, useMultiFileAuthState, DisconnectReason, makeCacheableSignalKeyStore, pinoLogger;

try {
    const baileys = require('@whiskeysockets/baileys');
    makeWASocket = baileys.makeWASocket;
    useMultiFileAuthState = baileys.useMultiFileAuthState;
    DisconnectReason = baileys.DisconnectReason;
    makeCacheableSignalKeyStore = baileys.makeCacheableSignalKeyStore;
    pinoLogger = require('pino')({ level: 'silent' });
    console.log('Baileys loaded OK');
} catch(e) {
    console.log('Baileys error:', e.message);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ===================== SESSION =====================

async function createSession(num) {
    if (!makeWASocket) return;
    const dir = path.join(__dirname, 'sessions', num);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(dir);
    sessionStates[num] = 'connecting';

    const sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pinoLogger)
        },
        printQRInTerminal: false,
        logger: pinoLogger,
        browser: ['WA Tools', 'Chrome', '120.0.0'],
        connectTimeoutMs: 30000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async function(update) {
        var connection = update.connection;
        var lastDisconnect = update.lastDisconnect;
        var qr = update.qr;

        if (qr) {
            qrCodes[num] = await qrcode.toDataURL(qr);
            sessionStates[num] = 'qr';
            console.log('QR ready for:', num);
        }

        if (connection === 'open') {
            sessionStates[num] = 'connected';
            qrCodes[num] = null;
            sessions[num] = sock;
            console.log('Connected:', num);
        }

        if (connection === 'close') {
            var code = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output ? lastDisconnect.error.output.statusCode : 0;
            sessionStates[num] = 'disconnected';
            delete sessions[num];
            console.log('Disconnected:', num, 'code:', code);

            if (code !== DisconnectReason.loggedOut) {
                setTimeout(function() { createSession(num); }, 5000);
            } else {
                var d = path.join(__dirname, 'sessions', num);
                if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
                delete sessionStates[num];
                delete qrCodes[num];
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

app.get('/', function(req, res) {
    res.send(getPanelHtml());
});

app.get('/api/status', function(req, res) {
    var connected = Object.values(sessionStates).filter(function(s) { return s === 'connected'; }).length;
    res.json({
        status: 'running',
        totalSenders: Object.keys(sessionStates).length,
        connectedSenders: connected,
        senders: Object.keys(sessionStates).map(function(n) { return { number: n, status: sessionStates[n] }; })
    });
});

app.post('/api/sender/add', async function(req, res) {
    if (!makeWASocket) return res.status(503).json({ error: 'Baileys tidak tersedia' });
    var number = req.body.number;
    if (!number) return res.status(400).json({ error: 'Nomor wajib diisi' });
    var num = number.replace(/[^0-9]/g, '');
    if (sessionStates[num] === 'connected') return res.json({ status: 'already_connected', number: num });
    createSession(num);
    res.json({ status: 'connecting', number: num, message: 'Tunggu QR muncul lalu scan' });
});

app.get('/api/sender/list', function(req, res) {
    var list = Object.keys(sessionStates).map(function(num) {
        return { number: num, status: sessionStates[num], hasQr: !!qrCodes[num] };
    });
    res.json({ senders: list });
});

app.get('/api/sender/qr/:number', function(req, res) {
    var qr = qrCodes[req.params.number];
    if (!qr) return res.status(404).json({ error: 'QR tidak tersedia', status: sessionStates[req.params.number] || 'unknown' });
    res.json({ qr: qr, number: req.params.number });
});

app.delete('/api/sender/:number', async function(req, res) {
    var num = req.params.number;
    if (sessions[num]) { try { await sessions[num].logout(); } catch(e) {} delete sessions[num]; }
    delete sessionStates[num];
    delete qrCodes[num];
    var dir = path.join(__dirname, 'sessions', num);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    res.json({ status: 'deleted', number: num });
});

app.post('/api/spam/message', async function(req, res) {
    var senders = req.body.senders;
    var target = req.body.target;
    var message = req.body.message;
    var count = req.body.count || 5;

    if (!senders || !target || !message) return res.status(400).json({ error: 'senders, target, message wajib' });

    var targetJid = target.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
    var results = [];

    for (var i = 0; i < senders.length; i++) {
        var senderNum = senders[i].replace(/[^0-9]/g, '');
        var sock = sessions[senderNum];
        if (!sock || sessionStates[senderNum] !== 'connected') {
            results.push({ sender: senderNum, status: 'not_connected', sent: 0 });
            continue;
        }
        var sent = 0;
        for (var j = 0; j < count; j++) {
            try { await sock.sendMessage(targetJid, { text: message }); sent++; await sleep(500); } catch(e) {}
        }
        results.push({ sender: senderNum, status: 'done', sent: sent });
    }
    res.json({ success: true, results: results });
});

app.post('/api/spam/call', async function(req, res) {
    var senders = req.body.senders;
    var target = req.body.target;
    var count = req.body.count || 10;

    if (!senders || !target) return res.status(400).json({ error: 'senders dan target wajib' });

    var targetJid = target.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
    var results = [];
    var idx = 0;

    for (var i = 0; i < count; i++) {
        var senderNum = senders[idx % senders.length].replace(/[^0-9]/g, '');
        idx++;
        var sock = sessions[senderNum];
        if (!sock || sessionStates[senderNum] !== 'connected') {
            results.push({ call: i+1, sender: senderNum, status: 'not_connected' });
            continue;
        }
        try {
            await sock.sendMessage(targetJid, {
                audio: { url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' },
                pttPlayback: true,
                mimetype: 'audio/ogg; codecs=opus'
            });
            results.push({ call: i+1, sender: senderNum, status: 'called' });
        } catch(e) {
            results.push({ call: i+1, sender: senderNum, status: 'error', msg: e.message });
        }
        await sleep(2000);
    }
    res.json({ success: true, results: results, totalCalls: count });
});

// ===================== START =====================

loadSessions().then(function() {
    app.listen(PORT, function() {
        console.log('Server jalan di port ' + PORT);
    });
});
