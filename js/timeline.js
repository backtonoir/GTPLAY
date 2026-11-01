// GTPLAY v3.1 (redeem code)
// ==================================================
// GTPLAY ORDER TIMELINE
// --------------------------------------------------
// Dipakai halaman Payment & Track Order.
// Jalur sukses: Pending Payment → Payment Submitted →
// Payment Verified → Processing → Completed.
// Expired / Cancelled / Rejected ditampilkan sebagai
// langkah terakhir yang gagal.
// ==================================================

window.GT = window.GT || {};

GT.timeline = function (order) {
  const { h, STATUS, STATUS_FLOW, TERMINAL_FAIL, formatDateTime } = GT.utils;

  const events = Array.isArray(order.events) ? order.events : [];
  const firstAt = status => {
    const event = events.find(item => item.status === status);
    return event ? event.at : null;
  };

  const failed = TERMINAL_FAIL.includes(order.status);

  // Langkah terjauh yang pernah dicapai di jalur sukses.
  let reached = 0;
  STATUS_FLOW.forEach((status, index) => {
    if (firstAt(status) || order.status === status) reached = Math.max(reached, index);
  });

  const items = STATUS_FLOW.map((status, index) => {
    let state = "pending";
    if (index < reached || (index === reached && (failed || order.status === "completed"))) state = "done";
    if (index === reached && !failed && order.status !== "completed") state = "current";
    if (status === "completed" && order.status === "completed") state = "done";

    const at = firstAt(status);
    return { status, state, at };
  });

  // Jika gagal, sembunyikan langkah setelah titik gagal.
  const visible = failed ? items.slice(0, reached + 1) : items;

  if (failed) {
    const event = events.slice().reverse().find(item => item.status === order.status);
    visible.push({ status: order.status, state: "failed", at: event ? event.at : order.updatedAt, note: event && event.note });
  }

  return h("ol", { class: "timeline", "aria-label": "Order timeline" },
    visible.map(item =>
      h("li", { class: item.state },
        h("span", { class: "timeline-dot", "aria-hidden": "true" },
          item.state === "done" ? "✓" : item.state === "failed" ? "×" : ""),
        h("div", {},
          h("p", { class: "timeline-title" },
            STATUS[item.status] ? STATUS[item.status].label : item.status,
            item.state === "current" ? h("span", { class: "sr-only" }, " (current step)") : null
          ),
          item.at ? h("p", { class: "timeline-meta" }, formatDateTime(item.at)) : null,
          item.state === "failed" && item.note ? h("p", { class: "timeline-meta" }, item.note) : null
        )
      )
    )
  );
};

// ==================================================
// REDEEM CODE CARD
// --------------------------------------------------
// Item dikirim dalam bentuk redeem code. Admin bisa
// menulis beberapa code (satu per baris); tiap code
// punya tombol Copy sendiri. Muncul setelah Completed.
// ==================================================

GT.redeemBlock = function (order) {
  const { h, copyButton } = GT.utils;
  if (!order || !order.redeemCode) return null;

  const codes = String(order.redeemCode).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (codes.length === 0) return null;

  return h("section", { class: "redeem-card", "aria-labelledby": `redeem-${order.id}` },
    h("div", { class: "redeem-head" },
      h("p", { class: "eyebrow" }, "Your item"),
      h("h3", { id: `redeem-${order.id}` }, codes.length > 1 ? `Redeem Codes (${codes.length})` : "Redeem Code")
    ),
    h("ul", { class: "redeem-list" }, codes.map((code, index) =>
      h("li", { class: "redeem-row" },
        h("code", { class: "redeem-code" }, code),
        copyButton(code, codes.length > 1 ? `Redeem code ${index + 1}` : "Redeem code", "btn btn-light btn-sm redeem-copy")
      )
    )),
    codes.length > 1
      ? h("button", {
          type: "button",
          class: "link-button redeem-copy-all",
          onclick: async () => {
            const ok = await GT.utils.copyText(codes.join("\n"));
            GT.utils.toast(ok ? "All redeem codes copied." : "Couldn't copy — select the codes manually.", ok ? "success" : "error");
          }
        }, "Copy all codes")
      : null,
    h("p", { class: "help redeem-help" }, GT.config.REDEEM_HELP || "")
  );
};
