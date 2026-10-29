"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function AdminLoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: form.get("email"), password: form.get("password") }) });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) { setError(data.error || "Tidak dapat masuk."); return; }
    if (data.user.role !== "ADMIN") { await fetch("/api/auth/logout", { method: "POST" }); setError("Akun ini tidak memiliki akses admin."); return; }
    router.replace("/admin"); router.refresh();
  }
  return <main className="login-shell"><Link className="brand" href="/"><span className="brand-mark">G</span><span>GROWTOP<span className="brand-period">.</span></span></Link><section className="login-card"><div className="eyebrow">AKSES KHUSUS</div><h1>Masuk admin<span>.</span></h1><p>Kelola pesanan, harga paket, dan pengumuman GrowTop.</p><form onSubmit={submit}><label className="form-field"><span>EMAIL ADMIN</span><input name="email" type="email" autoComplete="username" required placeholder="admin@domain.com" /></label><label className="form-field"><span>KATA SANDI</span><input name="password" type="password" autoComplete="current-password" required /></label>{error && <div className="form-error" role="alert">{error}</div>}<button className="button button-light full-width" disabled={busy}>{busy ? "Memeriksa…" : "Masuk ke panel"}<span>→</span></button></form></section><Link className="text-link" href="/">← Kembali ke beranda</Link></main>;
}
