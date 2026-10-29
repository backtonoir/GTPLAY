import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import AdminPanel from "./panel";

export default async function AdminPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/admin/login");
  return <AdminPanel email={admin.email} />;
}
