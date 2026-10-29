"use client";

import { FormEvent, useEffect, useState } from "react";

type Package = { id: string; name: string; description: string | null; priceIdr: number; isActive: boolean };
type Announcement = { id: string; title: string; body: string; publishedAt: string | null };
type User = { id: string; email: string; role: "CUSTOMER" | "ADMIN" };
type Order = { orderCode: string; packageName: string; amountIdr: number; growId?: string; status: string; createdAt?: string; updatedAt?: string };
const rupiah = (amount: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(amount);
const statusLabels: Record<string, string> = { PENDING_PAYMENT: "Menunggu pembayaran", PAID: "Pembayaran terkonfirmasi", PROCESSING: "Sedang diproses admin", COMPLETED: "Selesai", CANCELLED: "Dibatalkan" };

export default function HomeStorefront() {
  const [packages, setPackages] = useState<Package[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [loadError, setLoadError] = useState("");
  const [step, setStep] = useState(1);
  const [chosen, setChosen] = useState<Package | null>(null);
  const [growId, setGrowId] = useState("");
  const [email, setEmail] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [order, setOrder] = useState<Order | null>(null);
  const [modal, setModal] = useState<"auth" | "track" | "history" | "help" | "announcement" | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [modalError, setModalError] = useState("");
  const [modalInfo, setModalInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [trackedOrder, setTrackedOrder] = useState<Order | null>(null);
  const [history, setHistory] = useState<Order[]>([]);

  useEffect(() => {
    void Promise.all([
      fetch("/api/packages").then(async r => { if (!r.ok) throw new Error("Paket belum dapat dimuat."); return r.json(); }),
      fetch("/api/announcements").then(r => r.json()),
      fetch("/api/auth/me").then(r => r.json()),
    ]).then(([packageData, announcementData, userData]) => {
      setPackages(packageData.packages || []);
      setAnnouncements(announcementData.announcements || []);
      const activeUser = userData.user || null;
      setUser(activeUser);
      if (activeUser?.email) setEmail(activeUser.email);
    }).catch(error => setLoadError(error instanceof Error ? error.message : "Data toko tidak tersedia."));
  }, []);

  function openModal(kind: typeof modal) { setModalError(""); setModalInfo(""); setTrackedOrder(null); setModal(kind); }
  function startOrder(pkg: Package) {
    setChosen(pkg); setGrowId(""); setPaymentMethod(""); setOrder(null); setStep(2);
    document.querySelector("#order")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setModalError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/auth/${authMode === "signup" ? "signup" : "login"}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: form.get("email"), password: form.get("password") }) });
    const data = await response.json(); setBusy(false);
    if (!response.ok) { setModalError(data.error || "Tidak dapat masuk."); return; }
    setUser(data.user); setEmail(data.user.email); setModalInfo(authMode === "signup" ? "Akun berhasil dibuat dan kamu sudah masuk." : "Berhasil masuk.");
    setTimeout(() => setModal(null), 650);
  }
  async function createOrder() {
    if (!chosen) return;
    setBusy(true); setLoadError("");
    try {
      const response = await fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ packageId: chosen.id, growId, customerEmail: email, paymentMethod }) });
      const data = await response.json();
      if (!response.ok) { setLoadError(data.error || "Order belum dapat dibuat."); return; }
      setOrder(data.order); setStep(5);
    } catch { setLoadError("Server belum dapat dihubungi. Coba lagi sebentar."); }
    finally { setBusy(false); }
  }
  async function submitTrack(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setModalError(""); setTrackedOrder(null);
    const form = new FormData(event.currentTarget);
    const query = new URLSearchParams({ orderCode: String(form.get("orderCode")), email: String(form.get("email")) });
    const response = await fetch(`/api/orders/track?${query}`); const data = await response.json(); setBusy(false);
    if (!response.ok) { setModalError(data.error || "Pesanan tidak ditemukan."); return; }
    setTrackedOrder(data.order);
  }
  async function openHistory() {
    openModal("history");
    if (!user) return;
    const response = await fetch("/api/orders/mine"); const data = await response.json();
    if (!response.ok) { setModalError(data.error || "Riwayat tidak dapat dimuat."); return; }
    setHistory(data.orders || []);
  }
  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); setUser(null); setEmail(""); setModal(null); }
  const latestAnnouncement = announcements[0];
  const paymentChoices = ["QRIS", "E-Wallet", "Virtual Account", "Transfer Bank"];

  return <>
    <div className="announcement-strip"><span className="live-dot"></span> Pesanan diproses otomatis oleh bot setelah pembayaran dikonfirmasi</div>
    <header className="site-header">
      <a className="brand" href="#home"><span className="brand-mark">G</span><span>GTPLAY<span className="brand-period">.</span></span></a>
      <nav className="main-nav" aria-label="Navigasi utama"><a className="nav-link active" href="#home">Beranda</a><a className="nav-link" href="#order">Top Up</a><a className="nav-link" href="#how">Cara Beli</a><a className="nav-link" href="#news">Pengumuman</a><button className="nav-link nav-button" onClick={() => void openHistory()}>Riwayat</button></nav>
      <div className="header-actions">{user ? <button className="button button-quiet" onClick={() => void logout()}>{user.email.split("@")[0]} · Keluar</button> : <button className="button button-quiet" onClick={() => { setAuthMode("login"); openModal("auth"); }}>Masuk</button>}<button className="button button-light button-small" onClick={() => document.querySelector("#order")?.scrollIntoView({ behavior: "smooth" })}>Top Up Sekarang <span>↗</span></button><button className="menu-button" aria-label="Buka navigasi" onClick={() => document.querySelector(".main-nav")?.classList.toggle("open")}>☰</button></div>
    </header>

    <main id="home">
      <section className="hero section-wrap">
        <div className="hero-copy"><div className="eyebrow"><span className="eyebrow-line"></span> TOP UP GTPLAY PRIVATE SERVER</div><h1>Item game,<br /><span>tanpa ribet.</span></h1><p>Pilih paket, masukkan GrowID, lalu pantau pesananmu sampai item dikirim oleh admin.</p><div className="hero-actions"><button className="button button-light button-large" onClick={() => document.querySelector("#order")?.scrollIntoView({ behavior: "smooth" })}>Mulai Top Up <span>→</span></button><a className="text-link" href="#how">Lihat cara kerja <span>↘</span></a></div><div className="hero-meta"><span className="avatar-stack"><i>G</i><i>+</i></span><span>Pesanan tercatat dan bisa dilacak</span></div></div>
        <div className="hero-art" aria-label="Ilustrasi GTPLAY"><div className="art-orbit orbit-one"></div><div className="art-orbit orbit-two"></div><div className="art-label label-top">GTPLAY / ID</div><div className="cube-wrap"><div className="cube"><span>G</span></div></div><div className="art-label label-bottom"><span className="live-dot"></span> SIMPLE · SECURE · TRACKED</div><div className="floating-card float-card-one"><span className="mini-icon">↗</span><span><b>Pesanan baru</b><small>Diproses admin</small></span><span className="tiny-check">✓</span></div><div className="floating-card float-card-two"><span className="float-number">01</span><span><b>GrowID</b><small>Data pemain aman</small></span></div></div>
      </section>

      <section className="ticker section-wrap"><span>GTPLAY PRIVATE SERVER</span><b>✳</b><span>PEMBAYARAN RUPIAH</span><b>✳</b><span>PENGIRIMAN MANUAL OLEH ADMIN</span><b>✳</b><span>RIWAYAT PESANAN</span></section>

      <section className="order-section section-wrap" id="order">
        <div className="section-heading"><div><div className="eyebrow">MULAI TRANSAKSI</div><h2>Top up dalam<br /><span>beberapa langkah.</span></h2></div><p>Ikuti panduan di bawah. Pastikan GrowID benar sebelum membuat pesanan.</p></div>
        <div className="order-layout">
          <div className="chat-panel">
            <div className="chat-topbar"><div className="chat-agent"><span className="agent-mark">G</span><span><b>Asisten GTPLAY</b><small><i className="live-dot"></i> Panduan pembelian</small></span></div><span className="secure-label">● ORDER TERCATAT</span></div>
            <div className="chat-messages" aria-live="polite">
              <div className="message message-bot"><span>Halo! Selamat datang di GTPLAY. Paket apa yang ingin kamu beli?</span></div>
              {loadError && <div className="message message-bot"><span>{loadError}</span></div>}
              {!packages.length && !loadError && <div className="message message-bot"><span>Memuat paket… Hubungkan database dan jalankan seed untuk menampilkan paket.</span></div>}
              {step === 1 && packages.length > 0 && <div className="chat-compose"><div className="compose-label">PILIH PAKET</div><div className="package-grid">{packages.map((pkg, index) => <button className="package-card" key={pkg.id} onClick={() => startOrder(pkg)}><span className="package-amount">{pkg.name}</span><span className="package-sub">{pkg.description || "Item digital"}</span><b>{rupiah(pkg.priceIdr)}</b>{index === 1 && <i className="popular-tag">POPULER</i>}</button>)}</div><p className="compose-hint">Paket dan harga mengikuti data yang dikelola admin.</p></div>}
              {step === 2 && chosen && <><div className="message message-user"><span>{chosen.name} — {rupiah(chosen.priceIdr)}</span></div><div className="message message-bot"><span>Masukkan GrowID tujuan pengiriman item.</span></div><div className="chat-compose"><div className="compose-label">DATA PEMAIN</div><label className="form-field"><span>GROWID</span><input value={growId} onChange={e => setGrowId(e.target.value)} minLength={2} maxLength={24} placeholder="Masukkan GrowID kamu" /></label><p className="compose-hint">Pastikan ejaan GrowID benar sebelum melanjutkan.</p><div className="compose-actions"><button className="compose-back" onClick={() => setStep(1)}>← Ganti paket</button><button className="button button-light" onClick={() => growId.trim().length >= 2 ? setStep(3) : setLoadError("Masukkan GrowID minimal 2 karakter.")}>Lanjut <span>→</span></button></div></div></>}
              {step === 3 && chosen && <><div className="message message-user"><span>GrowID: {growId}</span></div><div className="message message-bot"><span>Masukkan email untuk bukti dan pelacakan pesanan.</span></div><div className="chat-compose"><div className="compose-label">DATA PEMBELI</div><div className="summary-box"><div className="summary-row"><span>Paket</span><b>{chosen.name}</b></div><div className="summary-row"><span>GrowID</span><b>{growId}</b></div><div className="summary-row summary-total"><span>Total</span><b>{rupiah(chosen.priceIdr)}</b></div></div><label className="form-field"><span>EMAIL</span><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="nama@email.com" /></label><div className="compose-actions"><button className="compose-back" onClick={() => setStep(2)}>← Kembali</button><button className="button button-light" onClick={() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? setStep(4) : setLoadError("Masukkan alamat email yang valid.")}>Pilih pembayaran <span>→</span></button></div></div></>}
              {step === 4 && chosen && <><div className="message message-user"><span>{email}</span></div><div className="message message-bot"><span>Pilih metode yang akan kamu gunakan.</span></div><div className="chat-compose"><div className="compose-label">METODE PEMBAYARAN</div><div className="payment-list">{paymentChoices.map(method => <button key={method} className={`payment-choice ${paymentMethod === method ? "selected" : ""}`} onClick={() => setPaymentMethod(method)}><b>{method}</b><small>Instruksi pembayaran akan disediakan admin</small></button>)}</div><p className="compose-hint">Payment gateway belum dihubungkan. Order yang dibuat menunggu konfirmasi pembayaran admin.</p><div className="compose-actions"><button className="compose-back" onClick={() => setStep(3)}>← Kembali</button><button className="button button-light" disabled={!paymentMethod || busy} onClick={() => setStep(5)}>Lihat ringkasan <span>→</span></button></div></div></>}
              {step === 5 && chosen && !order && <><div className="message message-user"><span>{paymentMethod}</span></div><div className="message message-bot"><span>Periksa detailnya. Setelah dibuat, order menunggu pembayaran dan konfirmasi admin.</span></div><div className="chat-compose"><div className="compose-label">RINGKASAN PESANAN</div><div className="summary-box"><div className="summary-row"><span>Produk</span><b>GTPLAYia Private Server</b></div><div className="summary-row"><span>Paket</span><b>{chosen.name}</b></div><div className="summary-row"><span>GrowID</span><b>{growId}</b></div><div className="summary-row"><span>Pembayaran</span><b>{paymentMethod}</b></div><div className="summary-row"><span>Email</span><b>{email}</b></div><div className="summary-row summary-total"><span>Total</span><b>{rupiah(chosen.priceIdr)}</b></div></div><div className="compose-actions"><button className="compose-back" onClick={() => setStep(4)}>← Ubah metode</button><button className="button button-light" disabled={busy} onClick={() => void createOrder()}>{busy ? "Membuat order…" : "Buat pesanan →"}</button></div></div></>}
              {step === 5 && order && <><div className="message message-bot"><span>Order kamu berhasil dicatat. Simpan nomor order untuk melacak prosesnya.</span></div><div className="chat-compose"><div className="compose-label">ORDER DIBUAT</div><div className="summary-box"><div className="summary-row"><span>Nomor order</span><b>{order.orderCode}</b></div><div className="summary-row"><span>Status</span><b>{statusLabels[order.status] || order.status}</b></div><div className="summary-row"><span>GrowID</span><b>{order.growId}</b></div><div className="summary-row summary-total"><span>Total</span><b>{rupiah(order.amountIdr)}</b></div></div><p className="compose-hint">Simpan nomor ini. Admin akan memperbarui status setelah pembayaran dikonfirmasi. Pembayaran online belum terhubung.</p><div className="compose-actions"><button className="button button-outline" onClick={() => { setOrder(null); setChosen(null); setStep(1); }}>Pesanan baru</button><button className="button button-light" onClick={() => { openModal("track"); }}>Lacak order <span>→</span></button></div></div></>}
            </div>
          </div>
          <aside className="order-aside"><div className="aside-card price-card"><span className="aside-kicker">LAYANAN GTPLAY</span><div className="price-feature"><div className="price-icon">G</div><div><b>GTPLAYia Private Server</b><small>Item dikirim manual admin</small></div></div><div className="price-rule"></div><div className="price-line"><span>Paket aktif</span><b>{packages.length}</b></div><div className="price-line"><span>Mata uang</span><b>Rupiah (IDR)</b></div><div className="price-line"><span>Data pemain</span><b>GrowID</b></div><button className="button button-light full-width" onClick={() => document.querySelector("#order")?.scrollIntoView({ behavior: "smooth" })}>Pilih Paket <span>→</span></button></div><div className="service-card"><div className="service-icon">◷</div><div><b>Status pesanan jelas</b><p>Pantau proses dari pembayaran hingga item dikirim.</p></div></div><div className="service-card"><div className="service-icon">⌁</div><div><b>Butuh bantuan?</b><p>Hubungi admin jika ada kendala transaksi.</p><button className="inline-link" onClick={() => openModal("help")}>Buka bantuan ↗</button></div></div></aside>
        </div>
      </section>

      <section className="how-section section-wrap" id="how"><div className="section-heading compact"><div><div className="eyebrow">SINGKAT DAN JELAS</div><h2>Cara <span>kerjanya.</span></h2></div><p>Setiap tahap memberi tahu apa yang perlu kamu lakukan berikutnya.</p></div><div className="how-grid"><article className="how-card"><div className="how-number">01</div><div className="how-icon">▤</div><h3>Pilih paket</h3><p>Pilih item game dan nominal yang sesuai kebutuhanmu.</p></article><article className="how-card"><div className="how-number">02</div><div className="how-icon">⌨</div><h3>Masukkan GrowID</h3><p>Periksa GrowID agar item terkirim ke akun yang tepat.</p></article><article className="how-card"><div className="how-number">03</div><div className="how-icon">₨</div><h3>Selesaikan pembayaran</h3><p>Gunakan instruksi pembayaran yang diberikan admin.</p></article><article className="how-card"><div className="how-number">04</div><div className="how-icon">✓</div><h3>Admin kirim item</h3><p>Admin memproses order dan memperbarui status.</p></article></div></section>

      <section className="news-section section-wrap" id="news"><div className="section-heading compact"><div><div className="eyebrow">INFO TERBARU</div><h2>Pengumuman<span>.</span></h2></div></div>{latestAnnouncement ? <div className="news-card"><div className="news-date"><span>INFO</span><b>{latestAnnouncement.publishedAt ? new Date(latestAnnouncement.publishedAt).getDate() : "—"}</b><small>{latestAnnouncement.publishedAt ? new Date(latestAnnouncement.publishedAt).toLocaleDateString("id-ID", { month: "short", year: "numeric" }).toUpperCase() : "TERBARU"}</small></div><div className="news-copy"><div className="news-tags"><span className="tag">LAYANAN</span></div><h3>{latestAnnouncement.title}</h3><p>{latestAnnouncement.body}</p></div><button className="news-arrow news-open" aria-label="Baca pengumuman" onClick={() => openModal("announcement")}>↗</button></div> : <div className="news-card"><div className="news-copy"><h3>Belum ada pengumuman</h3><p>Pengumuman terbaru akan muncul di sini.</p></div></div>}</section>

      <section className="history-section section-wrap"><div className="history-banner"><div><div className="eyebrow">PESANANMU</div><h2>Semua tercatat.<br /><span>Mudah dipantau.</span></h2><p>Masuk untuk melihat riwayat, atau lacak order tamu menggunakan nomor order dan email checkout.</p></div><div className="history-actions">{user ? <button className="button button-light" onClick={() => void openHistory()}>Riwayat akun <span>→</span></button> : <button className="button button-light" onClick={() => { setAuthMode("login"); openModal("auth"); }}>Masuk / Daftar <span>→</span></button>}<button className="button button-outline" onClick={() => openModal("track")}>Lacak order tamu</button></div><div className="history-watermark">G</div></div></section>
    </main>
    <footer className="site-footer section-wrap"><a className="brand" href="#home"><span className="brand-mark">G</span><span>GTPLAY<span className="brand-period">.</span></span></a><span>© 2026 GTPLAY · GTPLAYia Private Server</span><div><a href="#news">Pengumuman</a><button onClick={() => openModal("help")}>Bantuan</button><a href="/admin/login">Admin</a></div></footer>

    {modal && <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setModal(null); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle"><button className="modal-close" aria-label="Tutup" onClick={() => setModal(null)}>×</button>
      {modal === "auth" && <><div className="eyebrow">AKUN GTPLAY</div><h2 id="modalTitle">{authMode === "login" ? "Masuk ke akun" : "Buat akun"}</h2><div className="auth-switch"><button className={authMode === "login" ? "selected" : ""} onClick={() => { setAuthMode("login"); setModalError(""); }}>Masuk</button><button className={authMode === "signup" ? "selected" : ""} onClick={() => { setAuthMode("signup"); setModalError(""); }}>Daftar</button></div><form onSubmit={submitAuth}><label className="form-field"><span>EMAIL</span><input name="email" type="email" required placeholder="nama@email.com" /></label><label className="form-field"><span>KATA SANDI {authMode === "signup" ? "(MINIMAL 12 KARAKTER)" : ""}</span><input name="password" type="password" required minLength={authMode === "signup" ? 12 : 1} autoComplete={authMode === "signup" ? "new-password" : "current-password"} /></label>{modalError && <div className="form-error">{modalError}</div>}{modalInfo && <p>{modalInfo}</p>}<button className="button button-light full-width" disabled={busy}>{busy ? "Memproses…" : authMode === "login" ? "Masuk" : "Daftar"} <span>→</span></button></form></>}
      {modal === "track" && <><div className="eyebrow">PELACAKAN ORDER</div><h2 id="modalTitle">Lacak pesanan</h2>{trackedOrder ? <div className="summary-box"><div className="summary-row"><span>Order</span><b>{trackedOrder.orderCode}</b></div><div className="summary-row"><span>Status</span><b>{statusLabels[trackedOrder.status] || trackedOrder.status}</b></div><div className="summary-row"><span>Paket</span><b>{trackedOrder.packageName}</b></div><div className="summary-row summary-total"><span>Total</span><b>{rupiah(trackedOrder.amountIdr)}</b></div></div> : <form onSubmit={submitTrack}><p>Gunakan nomor order dan email checkout untuk melihat statusnya.</p><label className="form-field"><span>NOMOR ORDER</span><input name="orderCode" required placeholder="GT-..." /></label><label className="form-field"><span>EMAIL CHECKOUT</span><input name="email" type="email" required placeholder="nama@email.com" /></label>{modalError && <div className="form-error">{modalError}</div>}<button className="button button-light full-width" disabled={busy}>{busy ? "Mencari…" : "Cari order"} <span>→</span></button></form>}</>}
      {modal === "history" && <><div className="eyebrow">AKUN GTPLAY</div><h2 id="modalTitle">Riwayat pembelian</h2>{!user ? <><p>Masuk untuk melihat semua order yang tersimpan di akun.</p><button className="button button-light full-width" onClick={() => { setAuthMode("login"); setModal("auth"); }}>Masuk / Daftar →</button></> : history.length ? history.map(item => <div className="summary-box history-row" key={item.orderCode}><div className="summary-row"><span>{item.orderCode}</span><b>{statusLabels[item.status] || item.status}</b></div><div className="summary-row"><span>{item.packageName} · {item.growId || "GrowID"}</span><b>{rupiah(item.amountIdr)}</b></div></div>) : <p>{modalError || "Belum ada order yang terhubung ke akun ini."}</p>}</>}
      {modal === "help" && <><div className="eyebrow">DUKUNGAN</div><h2 id="modalTitle">Bantuan GTPLAY</h2><p>Jika ada masalah dengan pembayaran atau GrowID, hubungi admin dan sertakan nomor order. Kanal chat bantuan dapat disambungkan setelah kontak layanan ditentukan.</p><div className="summary-box"><div className="summary-row"><span>Pemrosesan</span><b>Manual oleh admin</b></div><div className="summary-row"><span>Data tujuan</span><b>GrowID</b></div></div></>}
      {modal === "announcement" && latestAnnouncement && <><div className="eyebrow">PENGUMUMAN</div><h2 id="modalTitle">{latestAnnouncement.title}</h2><p>{latestAnnouncement.body}</p></>}
    </section></div>}
  </>;
}
