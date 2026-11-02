// GTPLAY v3.8 (clean URLs)
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
      h("h3", { id: `redeem-${order.id}` }, codes.length > 1 ? GT.t("Redeem Codes ({n})", { n: codes.length }) : "Redeem Code")
    ),
    h("ul", { class: "redeem-list" }, codes.map((code, index) =>
      h("li", { class: "redeem-row" },
        h("code", { class: "redeem-code" }, code),
        copyButton(code, codes.length > 1 ? GT.t("Redeem code {n}", { n: index + 1 }) : "Redeem code", "btn btn-light btn-sm redeem-copy")
      )
    )),
    codes.length > 1
      ? h("button", {
          type: "button",
          class: "link-button redeem-copy-all",
          onclick: async () => {
            const ok = await GT.utils.copyText(codes.join("\n"));
            GT.utils.toast(GT.t(ok ? "All redeem codes copied." : "Couldn't copy — select the codes manually."), ok ? "success" : "error");
          }
        }, "Copy all codes")
      : null,
    h("p", { class: "help redeem-help" }, GT.config.REDEEM_HELP || "")
  );
};

// ==================================================
// ANNOUNCEMENT CARD
// --------------------------------------------------
// Dipakai landing page & halaman Announcement.
// ==================================================

GT.announcementCard = function (item) {
  const { h } = GT.utils;
  const category = ["event", "update", "maintenance"].includes(item.category) ? item.category : "update";
  const date = item.publishedOn
    ? new Date(`${item.publishedOn}T00:00:00`).toLocaleDateString(GT.utils.locale(), { day: "numeric", month: "long", year: "numeric" })
    : "";

  return h("article", { class: "announcement-card" },
    h("div", { class: "announcement-top" },
      h("span", { class: `announcement-badge ${category}` }, category),
      h("time", { class: "announcement-date", datetime: item.publishedOn || "" }, date)
    ),
    h("h3", {}, item.title),
    h("p", {}, item.content)
  );
};

// ==================================================
// REVIEW (ulasan pembeli)
// --------------------------------------------------
// Muncul setelah pesanan Completed. Ulasan baru tampil di
// landing page setelah disetujui admin (Admin → Reviews).
// ==================================================

GT.stars = function (rating, label) {
  const { h } = GT.utils;
  const value = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
  return h("span", { class: "stars", role: "img", "aria-label": label || GT.t("{n} out of 5 stars", { n: value }) },
    Array.from({ length: 5 }, (_, i) => h("span", { class: i < value ? "star on" : "star", "aria-hidden": "true" }, "★"))
  );
};

GT.reviewBlock = function (order, accessCode, onSubmitted) {
  const { h, toast } = GT.utils;
  if (!order || order.status !== "completed" || !accessCode) return null;

  if (order.review) {
    const notes = {
      pending: "Thanks! Your review will appear on the website after admin approval.",
      approved: "Thanks! Your review is published on the website.",
      hidden: "Thanks for your feedback!"
    };
    return h("section", { class: "review-card is-done" },
      h("h3", {}, "Your review"),
      GT.stars(order.review.rating),
      order.review.comment ? h("p", { class: "review-comment" }, order.review.comment) : null,
      h("p", { class: "help" }, notes[order.review.status] || notes.hidden)
    );
  }

  let rating = 0;
  const starButtons = [];
  const errorEl = h("p", { class: "error-text", role: "alert" });
  const counter = h("span", { class: "help review-counter" }, "0/300");

  function paint() {
    starButtons.forEach((button, index) => {
      button.classList.toggle("on", index < rating);
      button.setAttribute("aria-checked", String(index + 1 === rating));
      button.tabIndex = (rating ? index + 1 === rating : index === 0) ? 0 : -1;
    });
  }

  function choose(value, focus) {
    rating = value;
    errorEl.textContent = "";
    paint();
    if (focus) starButtons[value - 1].focus();
  }

  for (let i = 1; i <= 5; i += 1) {
    starButtons.push(h("button", {
      type: "button",
      class: "star-btn",
      role: "radio",
      "aria-checked": "false",
      "aria-label": GT.t("{n} out of 5 stars", { n: i }),
      onclick: () => choose(i),
      onkeydown: event => {
        if (["ArrowRight", "ArrowUp"].includes(event.key)) { event.preventDefault(); choose(Math.min(5, (rating || i) + 1), true); }
        if (["ArrowLeft", "ArrowDown"].includes(event.key)) { event.preventDefault(); choose(Math.max(1, (rating || i) - 1), true); }
      }
    }, "★"));
  }

  const comment = h("textarea", {
    class: "input",
    id: `review-${order.id}`,
    maxlength: "300",
    rows: "3",
    placeholder: "How was your order? (optional)",
    oninput: event => { counter.textContent = `${event.target.value.length}/300`; }
  });

  const submit = h("button", { type: "submit", class: "btn btn-primary" }, "Send review");

  const form = h("form", {
    class: "review-card",
    novalidate: true,
    onsubmit: async event => {
      event.preventDefault();
      if (!rating) {
        errorEl.textContent = GT.t("Pick a rating from 1 to 5 stars.");
        starButtons[0].focus();
        return;
      }
      submit.disabled = true;
      try {
        const updated = await GT.api.submitReview(order.id, accessCode, rating, comment.value);
        toast(GT.t("Thanks for your review!"), "success");
        if (onSubmitted) onSubmitted(updated);
      } catch (error) {
        errorEl.textContent = error.message;
        submit.disabled = false;
      }
    }
  },
    h("h3", {}, "Rate your order"),
    h("p", { class: "help" }, "Your review is shown on the website after admin approval. Your GrowID is partly hidden."),
    h("div", { class: "star-input", role: "radiogroup", "aria-label": "Rating" }, starButtons),
    h("div", { class: "field" },
      h("label", { class: "sr-only", for: `review-${order.id}` }, "Comment"),
      comment,
      counter
    ),
    errorEl,
    submit
  );

  paint();
  return form;
};

// Kartu ulasan di landing page.
GT.reviewCard = function (item) {
  const { h } = GT.utils;
  const date = item.createdAt
    ? new Date(item.createdAt).toLocaleDateString(GT.utils.locale(), { day: "numeric", month: "short", year: "numeric" })
    : "";
  return h("article", { class: "review-tile" },
    GT.stars(item.rating),
    item.comment ? h("p", { class: "review-quote" }, item.comment) : h("p", { class: "review-quote muted" }, GT.t("Rated {n}/5", { n: item.rating })),
    h("div", { class: "review-meta" },
      h("strong", {}, item.name),
      h("span", { class: "muted" }, [item.items, date].filter(Boolean).join(" · "))
    ),
    h("p", { class: "review-verified" }, "Verified purchase")
  );
};
