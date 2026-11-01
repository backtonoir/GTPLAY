// ==================================================
// GTPLAY PAYMENT PAGE (payment.html?order=ID#k=CODE)
// --------------------------------------------------
// • Countdown dihitung dari expiresAt milik pesanan
//   (bukan dari waktu halaman dibuka) → refresh tidak
//   mereset timer.
// • Saat timer habis, status diambil ulang dari data
//   pesanan; validasi kedaluwarsa sebenarnya ada di
//   server (mode Supabase) / data layer (demo).
// ==================================================

(function () {
  const { h, $, formatRupiah, formatCountdown, formatDateTime, toast, statusBadge, confirmDialog } = GT.utils;

  const root = $("#paymentRoot");
  const orderId = (GT.utils.getParam("order") || "").trim().toUpperCase();
  let accessCode = (GT.utils.getHashParam("k") || "").trim().toUpperCase();

  let order = null;
  let clockOffset = 0;
  let tickTimer = null;
  let pollTimer = null;
  let proofFile = null;
  let proofPreviewUrl = null;
  let busy = false;

  // ------------------------------------------------
  // ACCESS
  // ------------------------------------------------

  if (orderId && !accessCode) accessCode = (GT.api.myOrders.codeFor(orderId) || "").toUpperCase();
  if (orderId && accessCode) GT.api.myOrders.add({ id: orderId, code: accessCode });

  // ------------------------------------------------
  // SMALL PARTS
  // ------------------------------------------------

  function copyButton(value, label) {
    return h("button", {
      type: "button",
      class: "copy-button",
      "aria-label": `Copy ${label}`,
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(value);
          toast(`${label} copied.`, "success");
        } catch (error) {
          toast(`Couldn't copy — select the ${label.toLowerCase()} manually.`, "error");
        }
      }
    }, "Copy");
  }

  function infoRow(label, valueNode) {
    return h("div", { class: "summary-row" }, h("span", {}, label), h("span", { class: "value" }, valueNode));
  }

  function orderCard() {
    return h("div", { class: "card" },
      h("div", { class: "order-head" },
        h("div", {},
          h("p", { class: "eyebrow" }, "Order"),
          h("div", { class: "copy-row" }, h("span", { class: "order-id" }, order.id), copyButton(order.id, "Order ID"))
        ),
        statusBadge(order.status)
      ),
      infoRow("GrowID", h("strong", {}, order.growId)),
      infoRow("Access code", h("span", { class: "copy-row" }, h("strong", { class: "access-code" }, accessCode), copyButton(accessCode, "Access code"))),
      infoRow("Created", formatDateTime(order.createdAt)),
      h("table", { class: "line-table order-lines" },
        h("thead", {}, h("tr", {},
          h("th", { scope: "col" }, "Item"),
          h("th", { scope: "col" }, "Unit"),
          h("th", { scope: "col" }, "Qty"),
          h("th", { scope: "col" }, "Subtotal")
        )),
        h("tbody", {}, order.items.map(item =>
          h("tr", {},
            h("td", {}, item.name),
            h("td", {}, formatRupiah(item.unitPrice)),
            h("td", {}, `×${item.quantity}`),
            h("td", {}, formatRupiah(item.subtotal))
          )
        ))
      ),
      h("div", { class: "summary-row summary-total" }, h("span", {}, "Total Payment"), h("strong", {}, formatRupiah(order.total))),
      h("p", { class: "help access-help" }, "Save your Order ID and access code — you need both to track this order from another device.")
    );
  }

  function whatsappMessage() {
    const lines = order.items.map(item => `• ${item.name} x${item.quantity}\n  ${formatRupiah(item.subtotal)}`);

    return [
      `Halo Admin ${GT.config.STORE_NAME}, saya ingin konfirmasi pembayaran.`,
      "",
      `Order ID: ${order.id}`,
      `GrowID: ${order.growId}`,
      "",
      "Detail Pesanan:",
      ...lines,
      "",
      `Total Item: ${order.items.reduce((sum, item) => sum + item.quantity, 0)}`,
      `Total Pembayaran: ${formatRupiah(order.total)}`,
      "",
      "Saya sudah melakukan pembayaran melalui QRIS.",
      GT.api.isDemo
        ? "Berikut saya lampirkan bukti pembayarannya."
        : "Bukti pembayaran sudah saya upload di website.",
      "",
      "Mohon konfirmasi pembayaran dan proses pesanan saya.",
      "Terima kasih."
    ].join("\n");
  }

  function whatsappButton(label) {
    return h("button", {
      type: "button",
      class: "btn btn-whatsapp btn-block btn-lg",
      onclick: () => GT.utils.openExternal(GT.utils.whatsappURL(whatsappMessage()))
    }, label);
  }

  function orderAgainButton() {
    return h("button", {
      type: "button",
      class: "btn btn-primary",
      onclick: () => {
        GT.cart.replace(order.items.map(item => ({ id: item.productId, qty: item.quantity })));
        window.location.href = "checkout.html";
      }
    }, "Order again");
  }

  // ------------------------------------------------
  // TIMELINE (shared with track page via GT.timeline)
  // ------------------------------------------------

  function timeline() {
    return GT.timeline ? GT.timeline(order) : null;
  }

  // ------------------------------------------------
  // PENDING PAYMENT
  // ------------------------------------------------

  function remainingMs() {
    return new Date(order.expiresAt).getTime() - (Date.now() + clockOffset);
  }

  function countdownBlock() {
    const total = GT.config.PAYMENT_WINDOW_MINUTES * 60000;
    const timeEl = h("span", { class: "countdown-time", id: "countdownTime", role: "timer", "aria-live": "off" }, formatCountdown(remainingMs()));
    const bar = h("span", {});
    const wrap = h("div", { class: "countdown" },
      h("div", {},
        h("p", { class: "countdown-label", id: "countdownLabel" }, "Payment expires in"),
        h("p", { class: "help" }, `Expires at ${new Date(order.expiresAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`)
      ),
      timeEl
    );
    const container = h("div", {}, wrap, h("div", { class: "countdown-bar" }, bar));

    function tick() {
      const left = remainingMs();
      timeEl.textContent = formatCountdown(left);
      bar.style.transform = `scaleX(${Math.max(0, Math.min(1, left / total))})`;
      wrap.classList.toggle("urgent", left > 0 && left <= 60000);

      if (left <= 0) {
        clearInterval(tickTimer);
        wrap.classList.add("expired");
        $("#countdownLabel", wrap).textContent = "Payment expired";
        // Konfirmasi status dari data pesanan (bukan hanya dari timer).
        setTimeout(() => refresh(), 600);
      }
    }

    clearInterval(tickTimer);
    tick();
    tickTimer = setInterval(tick, 1000);
    return container;
  }

  function qrisCard() {
    return h("div", { class: "card" },
      countdownBlock(),
      h("div", { class: "qris-frame" },
        GT.utils.imageWithFallback({
          src: GT.config.QRIS_IMAGE,
          alt: `QRIS ${GT.config.STORE_NAME}`,
          fallback: "QRIS image not found. Please contact admin.",
          className: "qris-media",
          eager: true
        }),
        h("p", { class: "qris-caption" }, "Scan with any banking or e-wallet app that supports QRIS."),
        h("div", { class: "qris-amount" },
          h("span", {}, "Pay exactly"),
          h("strong", {}, formatRupiah(order.total))
        )
      ),
      h("h3", { class: "card-title instructions-title" }, "How to pay"),
      h("ol", { class: "instructions" },
        h("li", {}, "Open your banking or e-wallet app and choose Scan QRIS."),
        h("li", {}, `Enter exactly ${formatRupiah(order.total)} and complete the payment.`),
        h("li", {}, "Take a screenshot of the payment receipt."),
        h("li", {}, "Upload it below and tap “I Have Paid” before the timer ends.")
      )
    );
  }

  function proofForm() {
    const preview = h("span", { class: "file-drop-icon", "aria-hidden": "true" }, "⬆");
    const nameEl = h("strong", {}, "Upload payment proof");
    const hintEl = h("span", {}, `PNG, JPG or WEBP · max ${GT.config.MAX_PROOF_MB} MB`);
    const errorEl = h("p", { class: "error-text", role: "alert" });

    const input = h("input", {
      type: "file",
      id: "proofInput",
      accept: "image/png,image/jpeg,image/webp",
      "aria-describedby": "proofHint",
      onchange: event => setFile(event.target.files[0])
    });

    const drop = h("label", { class: "file-drop", for: "proofInput" },
      input, preview, h("span", { class: "file-drop-text", id: "proofHint" }, nameEl, hintEl)
    );

    ["dragenter", "dragover"].forEach(type => drop.addEventListener(type, event => {
      event.preventDefault();
      drop.classList.add("dragging");
    }));
    ["dragleave", "drop"].forEach(type => drop.addEventListener(type, () => drop.classList.remove("dragging")));
    drop.addEventListener("drop", event => {
      event.preventDefault();
      if (event.dataTransfer.files[0]) setFile(event.dataTransfer.files[0]);
    });

    function setFile(file) {
      errorEl.textContent = "";
      if (proofPreviewUrl) URL.revokeObjectURL(proofPreviewUrl);
      proofPreviewUrl = null;
      proofFile = null;

      if (!file) return;

      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
        errorEl.textContent = "Please choose a PNG, JPG, or WEBP image.";
        input.value = "";
        return;
      }
      if (file.size > GT.config.MAX_PROOF_MB * 1024 * 1024) {
        errorEl.textContent = `File is larger than ${GT.config.MAX_PROOF_MB} MB.`;
        input.value = "";
        return;
      }

      proofFile = file;
      proofPreviewUrl = URL.createObjectURL(file);
      preview.replaceChildren(h("img", { src: proofPreviewUrl, alt: "" }));
      nameEl.textContent = file.name;
      hintEl.textContent = `${(file.size / 1024).toFixed(0)} KB · tap to change`;
    }

    const paidBtn = h("button", { type: "submit", class: "btn btn-primary btn-block btn-lg" }, "I Have Paid");

    const cancelBtn = h("button", {
      type: "button",
      class: "btn btn-danger btn-block",
      onclick: async () => {
        const ok = await confirmDialog({
          title: "Cancel this order?",
          message: "The items will be released back to the store. Don't cancel if you've already paid — contact admin instead.",
          confirmLabel: "Cancel order",
          danger: true
        });
        if (!ok) return;
        await runAction(cancelBtn, "Cancelling…", () => GT.api.cancelOrder(order.id, accessCode), "Order cancelled.");
      }
    }, "Cancel Order");

    return h("form", {
      class: "card",
      novalidate: true,
      onsubmit: async event => {
        event.preventDefault();
        if (!proofFile) {
          errorEl.textContent = "Please attach your payment screenshot first.";
          input.focus();
          return;
        }
        if (remainingMs() <= 0) {
          errorEl.textContent = "This payment session has expired.";
          refresh();
          return;
        }
        await runAction(paidBtn, "Submitting…", () => GT.api.submitPayment(order.id, accessCode, proofFile), "Payment proof submitted.");
      }
    },
      h("h2", { class: "card-title" }, "Confirm your payment"),
      h("div", { class: "field" }, drop, errorEl),
      h("div", { class: "stack pay-actions" }, paidBtn, cancelBtn),
      h("p", { class: "help center-text" }, "Please pay the exact amount. Your order is processed after an admin verifies the payment.")
    );
  }

  async function runAction(button, busyLabel, action, successMessage) {
    if (busy) return;
    busy = true;
    const original = button.textContent;
    button.disabled = true;
    button.replaceChildren(h("span", { class: "spinner", "aria-hidden": "true" }), busyLabel);

    try {
      order = await action();
      toast(successMessage, "success");
      busy = false;
      render();
    } catch (error) {
      busy = false;
      toast(error.message, "error");
      button.disabled = false;
      button.textContent = original;
      if (["ORDER_EXPIRED", "INVALID_STATUS"].includes(error.code)) refresh();
    }
  }

  // ------------------------------------------------
  // OTHER STATES
  // ------------------------------------------------

  function statusPanel() {
    const s = order.status;
    const panel = h("div", { class: "card stack" });

    if (s === "payment_submitted") {
      panel.append(
        h("h2", { class: "card-title" }, "Payment submitted"),
        GT.api.isDemo
          ? h("div", { class: "notice notice-warn" },
              h("p", {}, h("strong", {}, "One more step: "), "send your order details and payment screenshot to admin on WhatsApp. Admin confirms orders there."))
          : h("div", { class: "notice notice-info" },
              h("p", {}, "Admin has received your payment proof and will verify it. This page updates automatically.")),
        whatsappButton(GT.api.isDemo ? "Send to Admin via WhatsApp" : "Contact Admin on WhatsApp"),
        GT.api.isDemo ? h("p", { class: "help center-text" }, "WhatsApp opens with your order details. Attach the payment screenshot before sending.") : ""
      );
    } else if (s === "payment_verified" || s === "processing") {
      panel.append(
        h("h2", { class: "card-title" }, s === "processing" ? "Your order is being processed" : "Payment verified"),
        h("div", { class: "notice notice-ok" }, h("p", {}, "Your payment has been verified. The admin will send the items to your GrowID."))
      );
    } else if (s === "completed") {
      panel.append(
        h("h2", { class: "card-title" }, "Order completed"),
        h("div", { class: "notice notice-ok" }, h("p", {}, `Your items were sent to ${order.growId}. Thanks for shopping at GTPLAY!`)),
        h("a", { class: "btn btn-outline", href: "index.html#store" }, "Back to store")
      );
    } else if (s === "expired") {
      panel.append(
        h("h2", { class: "card-title" }, "Payment session expired"),
        h("div", { class: "notice notice-warn" },
          h("p", {}, "This order wasn't paid in time, so the items were released."),
          h("p", {}, h("strong", {}, "Already paid? "), "Don't pay again — send your proof to admin on WhatsApp.")
        ),
        h("div", { class: "modal-actions start" }, orderAgainButton(), h("a", {
          class: "btn btn-outline",
          href: GT.utils.whatsappURL(whatsappMessage()),
          target: "_blank",
          rel: "noopener noreferrer"
        }, "I already paid"))
      );
    } else if (s === "cancelled" || s === "rejected") {
      panel.append(
        h("h2", { class: "card-title" }, s === "cancelled" ? "Order cancelled" : "Payment rejected"),
        h("div", { class: s === "rejected" ? "notice notice-danger" : "notice" },
          h("p", {}, s === "rejected"
            ? (order.adminNote ? `Admin note: ${order.adminNote}` : "The admin could not verify this payment. Contact admin if you think this is a mistake.")
            : "This order was cancelled. No payment is needed.")
        ),
        h("div", { class: "modal-actions start" }, orderAgainButton(), s === "rejected" ? whatsappButton("Contact Admin") : null)
      );
    }

    const tl = timeline();
    if (tl) panel.append(h("h3", { class: "card-title timeline-title-head" }, "Order timeline"), tl);

    return panel;
  }

  // ------------------------------------------------
  // RENDER / LOAD
  // ------------------------------------------------

  function render() {
    clearInterval(tickTimer);

    if (order.status === "pending_payment") {
      root.replaceChildren(
        h("div", { class: "pay-grid" },
          qrisCard(),
          h("div", { class: "stack" }, orderCard(), proofForm())
        )
      );
    } else {
      root.replaceChildren(h("div", { class: "pay-grid" }, statusPanel(), orderCard()));
    }

    schedulePoll();
  }

  // Status yang bisa berubah oleh admin → cek berkala.
  function schedulePoll() {
    clearInterval(pollTimer);
    if (["payment_submitted", "payment_verified", "processing"].includes(order.status)) {
      pollTimer = setInterval(() => refresh(true), 20000);
    }
  }

  async function refresh(silent) {
    try {
      const next = await GT.api.getOrder(orderId, accessCode);
      if (next.serverNow) clockOffset = new Date(next.serverNow).getTime() - Date.now();
      const changed = !order || next.status !== order.status;
      order = next;
      if (!silent || changed) render();
      if (silent && changed) toast(`Order status: ${GT.utils.STATUS[order.status].label}`, "info");
    } catch (error) {
      if (silent) return;
      showError(error);
    }
  }

  function showError(error) {
    root.replaceChildren(
      h("div", { class: "state-block" },
        h("p", { class: "state-title" }, error.code === "ORDER_NOT_FOUND" ? "Order not found" : "Couldn't load this order"),
        h("p", { class: "state-text" }, error.message),
        h("div", { class: "modal-actions" },
          h("a", { class: "btn btn-outline", href: "track.html" }, "Track an order"),
          error.code === "ORDER_NOT_FOUND" ? null : h("button", { type: "button", class: "btn btn-primary", onclick: () => refresh() }, "Try again")
        )
      )
    );
  }

  GT.layout.init().catch(() => {});

  if (!orderId || !accessCode) {
    root.replaceChildren(
      h("div", { class: "state-block" },
        h("p", { class: "state-title" }, "Payment link is incomplete"),
        h("p", { class: "state-text" }, "Open your order from the Track Order page using your Order ID and access code."),
        h("a", { class: "btn btn-primary", href: "track.html" }, "Track order")
      )
    );
    return;
  }

  refresh();

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && order) refresh(true);
  });

  window.addEventListener("pagehide", () => {
    if (proofPreviewUrl) URL.revokeObjectURL(proofPreviewUrl);
  });
})();
