"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type OrderStatus = "PENDING_PAYMENT" | "PAID" | "PROCESSING" | "COMPLETED" | "CANCELLED";
type Order = { id: string; orderCode: string; packageName: string; amountIdr: number; growId: string; customerEmail: string; paymentMethod: string | null; status: OrderStatus; adminNotes: string | null; createdAt: string };
type Package = { id: string; name: string; description: string | null; priceIdr: number; isActive: boolean; sortOrder: number };
type Announcement = { id: string; title: string; body: string; isPublished: boolean; createdAt: string };
type Tab = "orders" | "packages" | "announcements";

const labels: Record<OrderStatus, string> = { PENDING_PAYMENT: "Menunggu pembayaran", PAID: "Pembayaran terkonfirmasi", PROCESSING: "Sedang diproses admin", COMPLETED: "Selesai", CANCELLED: "Dibatalkan" };
const nextStatus: Partial<Record<OrderStatus, OrderStatus>> = { PENDING_PAYMENT: "PAID", PAID: "PROCESSING", PROCESSING: "COMPLETED" };
const rupiah = (value: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Permintaan gagal.");
  return data as T;
}

export default function AdminPanel({ email }: { email: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("orders");
  const [orders, setOrders] = useState<Order[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      if (tab === "orders") setOrders((await api<{ orders: Order[] }>("/api/admin/orders")).orders);
      if (tab === "packages") setPackages((await api<{ packages: Package[] }>("/api/admin/packages")).packages);
      if (tab === "announcements") setAnnouncements((await api<{ announcements: Announcement[] }>("/api/admin/announcements")).announcements);
    } catch (e) { setError(e instanceof Error ? e.message : "Tidak dapat memuat data."); }
  }, [tab]);
  useEffect(() => { void load(); }, [load]);

  async function updateStatus(order: Order, status: OrderStatus) {
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/api/admin/orders/${order.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      setNotice(`${order.orderCode} diperbarui: ${labels[status]}.`); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Status gagal diperbarui."); }
    setBusy(false);
  }
  async function createPackage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/admin/packages", { method: "POST", body: JSON.stringify({ name: form.get("name"), description: form.get("description"), priceIdr: Number(form.get("priceIdr")), sortOrder: Number(form.get("sortOrder")), isActive: true }) });
      event.currentTarget.reset(); setNotice("Paket baru berhasil ditambahkan."); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Paket gagal disimpan."); }
    setBusy(false);
  }
  async function savePackage(pkg: Package, patch: Partial<Package>) {
    setBusy(true); setError("");
    try { await api(`/api/admin/packages/${pkg.id}`, { method: "PATCH", body: JSON.stringify(patch) }); setNotice("Paket diperbarui."); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Paket gagal diperbarui."); }
    setBusy(false);
  }
  async function createAnnouncement(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      await api("/api/admin/announcements", { method: "POST", body: JSON.stringify({ title: form.get("title"), body: form.get("body"), isPublished: form.get("isPublished") === "on" }) });
      event.currentTarget.reset(); setNotice("Pengumuman berhasil disimpan."); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Pengumuman gagal disimpan."); }
    setBusy(false);
  }
  async function toggleAnnouncement(item: Announcement) {
    setBusy(true); setError("");
    try { await api(`/api/admin/announcements/${item.id}`, { method: "PATCH", body: JSON.stringify({ isPublished: !item.isPublished }) }); setNotice("Status pengumuman diperbarui."); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Pengumuman gagal diperbarui."); }
    setBusy(false);
  }
  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); router.replace("/admin/login"); router.refresh(); }

  return <main className="admin-shell">
    <header className="admin-header"><a className="brand" href="/"><span className="brand-mark">G</span><span>GROWTOP<span className="brand-period">.</span></span></a><span className="admin-preview-label">PANEL ADMIN</span><div className="admin-account"><span>{email}</span><button className="button button-outline" onClick={logout}>Keluar</button></div></header>
    <div className="admin-content">
      <div className="admin-title-row"><div><div className="eyebrow">OPERASIONAL TOKO</div><h1>Kelola pesanan<span>.</span></h1><p>Konfirmasi pembayaran, kirim item secara manual, dan perbarui status pesanan.</p></div><button className="button button-outline" onClick={() => void load()}>Muat ulang ↻</button></div>
      <div className="admin-tabs" role="tablist"><button className={tab === "orders" ? "selected" : ""} onClick={() => setTab("orders")}>Pesanan <span>{orders.length}</span></button><button className={tab === "packages" ? "selected" : ""} onClick={() => setTab("packages")}>Paket & harga</button><button className={tab === "announcements" ? "selected" : ""} onClick={() => setTab("announcements")}>Pengumuman</button></div>
      {error && <div className="admin-alert error" role="alert">{error}</div>}{notice && <div className="admin-alert" role="status">{notice}</div>}
      {tab === "orders" && <section className="admin-card"><div className="admin-card-heading"><div><h2>Pesanan terbaru</h2><p>Pembayaran diverifikasi admin; pengiriman item dilakukan manual.</p></div><span className="count-pill">{orders.length} ORDER</span></div>
        {orders.length === 0 ? <div className="empty-state">Belum ada pesanan.</div> : <div className="table-scroll"><table><thead><tr><th>Pesanan</th><th>Paket / Harga</th><th>GrowID</th><th>Pembeli</th><th>Status</th><th>Aksi admin</th></tr></thead><tbody>{orders.map(order => <tr key={order.id}><td><b>{order.orderCode}</b><small>{new Date(order.createdAt).toLocaleString("id-ID")}</small></td><td>{order.packageName}<small>{rupiah(order.amountIdr)} · {order.paymentMethod || "Belum dipilih"}</small></td><td><b>{order.growId}</b></td><td>{order.customerEmail}</td><td><span className={`status-pill ${order.status.toLowerCase()}`}>{labels[order.status]}</span></td><td>{nextStatus[order.status] ? <button className="button button-light button-small" disabled={busy} onClick={() => void updateStatus(order, nextStatus[order.status]!)}>{order.status === "PENDING_PAYMENT" ? "Konfirmasi bayar" : order.status === "PAID" ? "Mulai proses" : "Tandai selesai"} →</button> : <span className="muted-text">—</span>}</td></tr>)}</tbody></table></div>}
      </section>}
      {tab === "packages" && <div className="admin-two-col"><section className="admin-card"><div className="admin-card-heading"><div><h2>Paket aktif & nonaktif</h2><p>Perubahan harga langsung berlaku untuk order baru.</p></div></div><div className="package-admin-list">{packages.map(pkg => <div className="package-admin-row" key={pkg.id}><div><b>{pkg.name}</b><small>{pkg.description || "Tanpa keterangan"}</small></div><strong>{rupiah(pkg.priceIdr)}</strong><button className="button button-outline button-small" disabled={busy} onClick={() => void savePackage(pkg, { isActive: !pkg.isActive })}>{pkg.isActive ? "Nonaktifkan" : "Aktifkan"}</button><button className="button button-outline button-small" disabled={busy} onClick={() => { const raw = window.prompt(`Harga baru untuk ${pkg.name}`, String(pkg.priceIdr)); const priceIdr = Number(raw); if (raw && Number.isInteger(priceIdr) && priceIdr > 0) void savePackage(pkg, { priceIdr }); }}>Ubah harga</button></div>)}</div></section>
        <section className="admin-card"><div className="admin-card-heading"><div><h2>Tambah paket</h2><p>Harga dimasukkan dalam Rupiah.</p></div></div><form className="admin-form" onSubmit={createPackage}><label className="form-field"><span>NAMA PAKET</span><input name="name" required minLength={2} maxLength={80} /></label><label className="form-field"><span>KETERANGAN</span><input name="description" maxLength={240} /></label><label className="form-field"><span>HARGA (IDR)</span><input name="priceIdr" type="number" required min={1} /></label><label className="form-field"><span>URUTAN</span><input name="sortOrder" type="number" defaultValue="0" min={0} /></label><button className="button button-light" disabled={busy}>Simpan paket →</button></form></section></div>}
      {tab === "announcements" && <div className="admin-two-col"><section className="admin-card"><div className="admin-card-heading"><div><h2>Daftar pengumuman</h2><p>Publikasikan perubahan harga atau info update game.</p></div></div><div className="announcement-admin-list">{announcements.length === 0 ? <div className="empty-state">Belum ada pengumuman.</div> : announcements.map(item => <article key={item.id} className="announcement-admin-item"><div className="item-head"><b>{item.title}</b><span className="muted-text">{item.isPublished ? "Tayang" : "Draft"}</span></div><p>{item.body}</p><button className="button button-outline button-small" disabled={busy} onClick={() => void toggleAnnouncement(item)}>{item.isPublished ? "Tarik pengumuman" : "Publikasikan"}</button></article>)}</div></section>
        <section className="admin-card"><div className="admin-card-heading"><div><h2>Tulis pengumuman</h2><p>Konten akan muncul di halaman storefront saat dipublikasikan.</p></div></div><form className="admin-form" onSubmit={createAnnouncement}><label className="form-field"><span>JUDUL</span><input name="title" required minLength={3} maxLength={120} /></label><label className="form-field"><span>ISI PENGUMUMAN</span><textarea name="body" required minLength={3} maxLength={2000} rows={6} /></label><label className="checkbox-field"><input name="isPublished" type="checkbox" /> Publikasikan sekarang</label><button className="button button-light" disabled={busy}>Simpan pengumuman →</button></form></section></div>}
      <p className="admin-footnote">Aksi status dicatat dalam riwayat order. Simpan informasi pembayaran pelanggan sesuai prosedur operasional toko.</p>
    </div>
  </main>;
}
