# WA Gateway Server — EVAN13

## Deploy ke Railway (GRATIS)

### Langkah 1 — Buat akun Railway
1. Buka https://railway.app
2. Sign up pakai GitHub (gratis)

### Langkah 2 — Upload project
1. Buka https://github.com → buat repo baru bernama `wa-gateway`
2. Upload semua isi folder `WaGateway` ke repo itu
3. Di Railway → New Project → Deploy from GitHub Repo → pilih `wa-gateway`
4. Railway otomatis detect Node.js dan jalankan `npm start`

### Langkah 3 — Dapat URL server
1. Di Railway → Settings → Networking → Generate Domain
2. Copy URL nya (contoh: `https://wa-gateway-xxx.railway.app`)
3. **URL ini yang dimasukkan ke APK**

### Langkah 4 — Tambah sender di panel
1. Buka URL server di browser
2. Masukkan nomor sender (format 62xxx)
3. Klik Tambah → QR muncul → scan pakai WA
4. Status jadi ✅ Terhubung

### Langkah 5 — Update URL di APK
- Buka file `ApiConfig.java` di project APK
- Ganti `SERVER_URL` dengan URL Railway Vanzzz

---

## Endpoint API

| Method | Endpoint | Fungsi |
|---|---|---|
| GET | `/api/status` | Status server & semua sender |
| POST | `/api/sender/add` | Tambah sender baru |
| GET | `/api/sender/list` | List semua sender |
| GET | `/api/sender/qr/:number` | Ambil QR code |
| DELETE | `/api/sender/:number` | Hapus sender |
| POST | `/api/send/message` | Kirim 1 pesan |
| POST | `/api/spam/message` | Spam pesan |
| POST | `/api/spam/call` | Spam call |
