module.exports = function getPanelHtml() {
    return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vanzzz Tools Server</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:sans-serif;background:#0D1B2A;color:#E3F2FD;min-height:100vh}
header{background:#1565C0;padding:16px 20px}
header h1{font-size:18px;color:#fff}
.wrap{max-width:860px;margin:0 auto;padding:20px 16px}
.card{background:#152238;border-radius:12px;padding:18px;margin-bottom:14px;border:1px solid #1E3A5F}
.card h2{font-size:12px;color:#42A5F5;margin-bottom:12px;text-transform:uppercase;letter-spacing:1px}
input,select{width:100%;padding:9px 12px;border-radius:8px;border:1px solid #1E3A5F;background:#0D1B2A;color:#E3F2FD;font-size:13px;outline:none;margin-bottom:8px}
.btn{padding:9px 18px;border-radius:8px;border:none;cursor:pointer;font-size:13px;font-weight:bold;width:100%;margin-top:4px}
.btn-blue{background:#1565C0;color:#fff}
.btn-red{background:#C62828;color:#fff;width:auto;padding:5px 10px;font-size:11px}
.item{background:#0D1B2A;border-radius:8px;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;border:1px solid #1E3A5F;margin-bottom:6px}
.badge{padding:3px 8px;border-radius:20px;font-size:10px;font-weight:bold}
.ok{background:#2E7D32;color:#fff}.qr-s{background:#1565C0;color:#fff}.dis{background:#424242;color:#fff}
.modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:99;align-items:center;justify-content:center}
.modal.show{display:flex}
.mbox{background:#152238;border-radius:14px;padding:24px;text-align:center;max-width:300px;width:90%}
.mbox img{width:220px;height:220px;background:#fff;border-radius:8px;padding:4px}
.url-box{background:#0D1B2A;border-radius:8px;padding:10px;font-family:monospace;font-size:12px;color:#42A5F5;word-break:break-all;border:1px solid #1E3A5F;margin-bottom:8px}
.note{font-size:11px;color:#90CAF9;margin-top:4px}
</style>
</head>
<body>
<header><h1>⚡ Vanzzz Tools Gateway</h1></header>
<div class="wrap">

<div class="card">
<h2>URL Server</h2>
<div class="url-box" id="sUrl">Memuat...</div>
<button class="btn btn-blue" onclick="copyUrl()">Copy URL</button>
</div>

<div class="card">
<h2>Tambah Sender</h2>
<input type="tel" id="num" placeholder="Nomor (6281xxx)"/>
<input type="text" id="name" placeholder="Nama pemilik"/>
<input type="password" id="pass" placeholder="Password sender"/>
<p class="note">Password ini dipakai saat tambah sender di APK</p>
<button class="btn btn-blue" onclick="addSender()">Tambah &amp; Scan QR</button>
</div>

<div class="card">
<h2>Daftar Sender</h2>
<div id="list"><p style="color:#546E7A;font-size:13px">Belum ada sender</p></div>
</div>

</div>

<div class="modal" id="modal">
<div class="mbox">
<h3 style="color:#42A5F5;margin-bottom:6px">Scan QR Code</h3>
<p style="color:#90CAF9;font-size:12px;margin-bottom:12px">WA → Perangkat Tertaut → Tautkan</p>
<img id="qrImg" src="" alt="QR"/>
<span onclick="closeModal()" style="display:block;margin-top:12px;color:#90CAF9;cursor:pointer;font-size:12px">Tutup</span>
</div>
</div>

<div class="modal" id="delModal">
<div class="mbox">
<h3 style="color:#FF5252;margin-bottom:6px">Hapus Sender</h3>
<p id="delNum" style="color:#90CAF9;font-size:12px;margin-bottom:10px"></p>
<input type="password" id="delPass" placeholder="Password sender"/>
<button class="btn btn-red" style="width:100%;margin-top:6px" onclick="confirmDel()">Hapus</button>
<span onclick="closeDelModal()" style="display:block;margin-top:10px;color:#90CAF9;cursor:pointer;font-size:12px">Batal</span>
</div>
</div>

<script>
document.getElementById("sUrl").textContent=location.origin;
function copyUrl(){navigator.clipboard.writeText(location.origin);alert("Disalin!")}
var pendingDelNum="";
async function addSender(){
  var n=document.getElementById("num").value.trim(),nm=document.getElementById("name").value.trim(),p=document.getElementById("pass").value.trim();
  if(!n||!nm||!p){alert("Semua field wajib!");return}
  var r=await fetch("/api/sender/add",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({number:n,name:nm,password:p})});
  var d=await r.json();
  if(!r.ok){alert("Error: "+(d.error||"Gagal"));return}
  document.getElementById("num").value="";document.getElementById("name").value="";document.getElementById("pass").value="";
  load();
  var t=0,iv=setInterval(async function(){
    t++;var qr=await fetch("/api/sender/qr/"+d.number);
    if(qr.ok){var q=await qr.json();showQr(q.qr,d.number);clearInterval(iv)}
    if(t>12)clearInterval(iv);
  },3000);
}
function showQr(src,num){
  document.getElementById("qrImg").src=src;
  document.getElementById("modal").classList.add("show");
  var iv=setInterval(async function(){
    var r=await fetch("/api/status"),d=await r.json();
    var s=d.senders.find(function(x){return x.number===num});
    if(s&&s.status==="connected"){closeModal();load();clearInterval(iv)}
  },3000);
}
function closeModal(){document.getElementById("modal").classList.remove("show")}
function openDelModal(num){pendingDelNum=num;document.getElementById("delNum").textContent="Nomor: "+num;document.getElementById("delPass").value="";document.getElementById("delModal").classList.add("show")}
function closeDelModal(){document.getElementById("delModal").classList.remove("show")}
async function confirmDel(){
  var p=document.getElementById("delPass").value.trim();
  if(!p){alert("Masukkan password!");return}
  var r=await fetch("/api/sender/"+pendingDelNum,{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:p})});
  if(!r.ok){alert("Password salah!");return}
  closeDelModal();load();
}
async function load(){
  var r=await fetch("/api/sender/list"),d=await r.json();
  var el=document.getElementById("list");
  if(!d.senders.length){el.innerHTML='<p style="color:#546E7A;font-size:13px">Belum ada sender</p>';return}
  var html="";
  d.senders.forEach(function(s){
    var badge=s.status==="connected"?'<span class="badge ok">Terhubung</span>':s.status==="qr"?'<span class="badge qr-s">Scan QR</span>':'<span class="badge dis">Disconnect</span>';
    html+='<div class="item"><div><div style="font-size:14px;font-weight:bold">'+s.number+'</div><div style="font-size:11px;color:#90CAF9">'+s.name+'</div></div><div style="display:flex;gap:6px;align-items:center">'+badge;
    if(s.hasQr)html+='<button class="btn-red" onclick="showQrBtn(\''+s.number+'\')">QR</button>';
    html+='<button class="btn-red" onclick="openDelModal(\''+s.number+'\')">Hapus</button></div></div>';
  });
  el.innerHTML=html;
}
async function showQrBtn(num){var r=await fetch("/api/sender/qr/"+num);if(!r.ok){alert("QR tidak tersedia");return}var d=await r.json();showQr(d.qr,num);}
load();setInterval(load,5000);
</script>
</body>
</html>`;
};
