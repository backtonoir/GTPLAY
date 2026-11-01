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
