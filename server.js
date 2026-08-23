const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const qrcode = require('qrcode');
const NodeCache = require('node-cache');
const { makeWASocket, useMultiFileAuthState, DisconnectReason, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Cache untuk QR code
const qrCache = new NodeCache({ stdTTL: 60 });
// Simpan semua sesi sender
const sessions = {}; // { senderNumber: WASocket }
const sessionStates = {}; // { senderNumber: 'connecting' | 'connected' | 'disconnected' }
const qrCodes = {}; // { senderNumber: qrBase64 }

const logger = pino({ level: 'silent' });

// ===================== FUNGSI KONEKSI =====================

async function createSession(senderNumber) {
    const sessionDir = path.join(__dirname, 'sessions', senderNumber);
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    sessionStates[senderNumber] = 'connecting';

    const sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger)
        },
        printQRInTerminal: false,
        logger,
        browser: ['WA Tools', 'Chrome', '120.0.0'],
        connectTimeoutMs: 30000,
        retryRequestDelayMs: 2000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            const qrBase64 = await qrcode.toDataURL(qr);
            qrCodes[senderNumber] = qrBase64;
            sessionStates[senderNumber] = 'qr';
            console.log(`[${senderNumber}] QR siap di-scan`);
        }

        if (connection === 'open') {
            sessionStates[senderNumber] = 'connected';
            qrCodes[senderNumber] = null;
            sessions[senderNumber] = sock;
            console.log(`[${senderNumber}] ✅ Terhubung!`);
        }

        if (connection === 'close') {
            const code = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = code !== DisconnectReason.loggedOut;
            console.log(`[${senderNumber}] ❌ Disconnect (code: ${code})`);
            sessionStates[senderNumber] = 'disconnected';
            delete sessions[senderNumber];

            if (shouldReconnect) {
                console.log(`[${senderNumber}] 🔄 Reconnect...`);
                setTimeout(() => createSession(senderNumber), 5000);
            } else {
                // Hapus sesi jika logout
                fs.rmSync(path.join(__dirname, 'sessions', senderNumber), { recursive: true, force: true });
            }
        }
    });

    sessions[senderNumber] = sock;
    return sock;
}

// Load sesi yang sudah ada saat startup
async function loadExistingSessions() {
    const sessionsDir = path.join(__dirname, 'sessions');
    if (!fs.existsSync(sessionsDir)) { fs.mkdirSync(sessionsDir); return; }
    const dirs = fs.readdirSync(sessionsDir);
    for (const dir of dirs) {
        console.log(`🔄 Load sesi: ${dir}`);
        await createSession(dir);
        await new Promise(r => setTimeout(r, 1000));
    }
}

// ===================== ROUTES =====================

// Halaman utama — panel QR
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Tambah sender baru & mulai sesi
app.post('/api/sender/add', async (req, res) => {
    const { number } = req.body;
    if (!number) return res.status(400).json({ error: 'Nomor wajib diisi' });

    const normalized = number.replace(/[^0-9]/g, '');
    if (sessions[normalized] && sessionStates[normalized] === 'connected') {
        return res.json({ status: 'already_connected', number: normalized });
    }

    await createSession(normalized);
    res.json({ status: 'connecting', number: normalized, message: 'Tunggu QR muncul lalu scan' });
});

// Cek status semua sender
app.get('/api/sender/list', (req, res) => {
    const list = Object.keys(sessionStates).map(num => ({
        number: num,
        status: sessionStates[num],
        hasQr: !!qrCodes[num]
    }));
    res.json({ senders: list });
});

// Ambil QR code untuk sender tertentu
app.get('/api/sender/qr/:number', (req, res) => {
    const num = req.params.number;
    const qr = qrCodes[num];
    if (!qr) return res.status(404).json({ error: 'QR tidak tersedia', status: sessionStates[num] || 'unknown' });
    res.json({ qr, number: num });
});

// Hapus / logout sender
app.delete('/api/sender/:number', async (req, res) => {
    const num = req.params.number;
    if (sessions[num]) {
        try { await sessions[num].logout(); } catch(e) {}
        delete sessions[num];
    }
    delete sessionStates[num];
    delete qrCodes[num];
    const dir = path.join(__dirname, 'sessions', num);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    res.json({ status: 'deleted', number: num });
});

// ===================== KIRIM PESAN =====================

app.post('/api/send/message', async (req, res) => {
    const { sender, target, message } = req.body;

    if (!sender || !target || !message) {
        return res.status(400).json({ error: 'sender, target, message wajib diisi' });
    }

    const senderNum = sender.replace(/[^0-9]/g, '');
    const targetNum = target.replace(/[^0-9]/g, '');
    const targetJid = targetNum + '@s.whatsapp.net';

    const sock = sessions[senderNum];
    if (!sock || sessionStates[senderNum] !== 'connected') {
        return res.status(503).json({ error: 'Sender tidak terhubung', status: sessionStates[senderNum] });
    }

    try {
        await sock.sendMessage(targetJid, { text: message });
        res.json({ success: true, sender: senderNum, target: targetNum });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ===================== SPAM PESAN =====================

app.post('/api/spam/message', async (req, res) => {
    const { senders, target, message, count } = req.body;
    // count = jumlah pesan per sender (default 5)
    const perSender = count || 5;

    if (!senders || !target || !message) {
        return res.status(400).json({ error: 'senders, target, message wajib diisi' });
    }

    const targetNum = target.replace(/[^0-9]/g, '');
    const targetJid = targetNum + '@s.whatsapp.net';
    const results = [];

    for (const sender of senders) {
        const senderNum = sender.replace(/[^0-9]/g, '');
        const sock = sessions[senderNum];

        if (!sock || sessionStates[senderNum] !== 'connected') {
            results.push({ sender: senderNum, status: 'not_connected', sent: 0 });
            continue;
        }

        let sent = 0;
        for (let i = 0; i < perSender; i++) {
            try {
                await sock.sendMessage(targetJid, { text: message });
                sent++;
                await new Promise(r => setTimeout(r, 500)); // delay antar pesan
            } catch(e) {
                console.error(`Error kirim dari ${senderNum}:`, e.message);
            }
        }
        results.push({ sender: senderNum, status: 'done', sent });
    }

    res.json({ success: true, results, target: targetNum });
});

// ===================== CALL SPAM =====================

app.post('/api/spam/call', async (req, res) => {
    const { senders, target, count } = req.body;
    const totalCalls = count || 10;

    if (!senders || !target) {
        return res.status(400).json({ error: 'senders dan target wajib diisi' });
    }

    const targetNum = target.replace(/[^0-9]/g, '');
    const targetJid = targetNum + '@s.whatsapp.net';
    const results = [];

    let callCount = 0;
    let senderIdx = 0;

    while (callCount < totalCalls) {
        const senderNum = senders[senderIdx % senders.length].replace(/[^0-9]/g, '');
        senderIdx++;

        const sock = sessions[senderNum];
        if (!sock || sessionStates[senderNum] !== 'connected') {
            results.push({ call: callCount + 1, sender: senderNum, status: 'not_connected' });
            callCount++;
            continue;
        }

        try {
            // WA voice call via Baileys
            await sock.sendMessage(targetJid, {
                audio: { url: '' },
                pttPlayback: true,
                mimetype: 'audio/ogg; codecs=opus'
            });

            // Alternatif: trigger call via relayCall jika tersedia
            if (sock.relayCall) {
                await sock.relayCall(targetJid);
            }

            results.push({ call: callCount + 1, sender: senderNum, status: 'called' });
        } catch(e) {
            results.push({ call: callCount + 1, sender: senderNum, status: 'error', msg: e.message });
        }

        callCount++;
        // 2 detik berdering → putus → ulang
        await new Promise(r => setTimeout(r, 2000));
    }

    res.json({ success: true, results, totalCalls: callCount });
});

// ===================== STATUS SERVER =====================

app.get('/api/status', (req, res) => {
    const connected = Object.values(sessionStates).filter(s => s === 'connected').length;
    res.json({
        status: 'running',
        totalSenders: Object.keys(sessionStates).length,
        connectedSenders: connected,
        senders: Object.keys(sessionStates).map(n => ({
            number: n,
            status: sessionStates[n]
        }))
    });
});

// ===================== START SERVER =====================

loadExistingSessions().then(() => {
    app.listen(PORT, () => {
        console.log(`\n✅ WA Gateway Server berjalan di port ${PORT}`);
        console.log(`🌐 Buka browser: http://localhost:${PORT}`);
        console.log(`📱 Panel QR tersedia di halaman utama\n`);
    });
});
