// GTPLAY v3.5 (server stats via Lua)
// ==================================================
// GTPLAY TRACK ORDER PAGE (track.html)
// --------------------------------------------------
// Pesanan hanya bisa dilihat dengan Order ID + kode akses,
// jadi orang lain tidak bisa melihat pesanan dengan
// menebak Order ID atau GrowID.
// ==================================================

(function () {
  const { h, $, formatRupiah, formatDateTime, statusBadge } = GT.utils;

  const formEl = $("#trackForm");
  const idInput = $("#trackOrderId");
  const codeInput = $("#trackCode");
  const errorEl = $("#trackError");
  const submitBtn = $("#trackSubmit");
  const resultEl = $("#trackResult");
  const deviceList = $("#deviceOrders");
  const modeNotice = $("#trackModeNotice");

  function infoRow(label, value) {
    return h("div", { class: "summary-row" }, h("span", {}, label), h("span", { class: "value" }, value));
  }

  function renderOrder(order, code) {
    const actions = h("div", { class: "modal-actions start" });

    if (order.status === "pending_payment") {
      actions.append(h("a", {
        class: "btn btn-primary",
        href: `payment.html?order=${encodeURIComponent(order.id)}#k=${encodeURIComponent(code)}`
      }, "Continue to payment"));
    }

    actions.append(h("a", {
      class: "btn btn-outline",
      href: GT.utils.whatsappURL(`Halo Admin ${GT.config.STORE_NAME}, saya ingin menanyakan pesanan ${order.id} (GrowID: ${order.growId}).`),
      target: "_blank",
      rel: "noopener noreferrer"
    }, "Ask admin about this order"));

    resultEl.replaceChildren(
      h("article", { class: "card reveal" },
        h("div", { class: "order-head" },
          h("div", {},
            h("p", { class: "eyebrow" }, "Order"),
            h("p", { class: "order-id" }, order.id)
          ),
          statusBadge(order.status)
        ),
        infoRow("GrowID", order.growId),
        infoRow("Order date", formatDateTime(order.createdAt)),
        infoRow("Items", order.items.map(item => `${item.name} ×${item.quantity}`).join(", ")),
        h("div", { class: "summary-row summary-total" }, h("span", {}, "Total Payment"), h("strong", {}, formatRupiah(order.total))),
        GT.redeemBlock(order),
        order.adminNote && order.status === "rejected"
          ? h("div", { class: "notice notice-danger track-note" }, h("p", {}, `Admin note: ${order.adminNote}`))
          : null,
        h("h3", { class: "card-title timeline-title-head track-tl-head" }, "Timeline"),
        GT.timeline(order),
        actions
      )
    );
  }

  async function track(orderId, code) {
    errorEl.textContent = "";
    submitBtn.disabled = true;
    submitBtn.replaceChildren(h("span", { class: "spinner", "aria-hidden": "true" }), "Searching…");

    try {
      const order = await GT.api.getOrder(orderId, code);
      GT.api.myOrders.add({ id: order.id, code, createdAt: order.createdAt });
      renderOrder(order, code);
      renderDeviceOrders();
      resultEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (error) {
      resultEl.replaceChildren();
      errorEl.textContent = error.message;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Track order";
    }
  }

  function renderDeviceOrders() {
    const refs = GT.api.myOrders.list();

    if (refs.length === 0) {
      deviceList.replaceChildren(h("li", { class: "help" }, "Orders you create on this device will appear here."));
      return;
    }

    deviceList.replaceChildren(...refs.map(ref =>
      h("li", {},
        h("a", {
          href: `track.html?order=${encodeURIComponent(ref.id)}`,
          onclick: event => {
            event.preventDefault();
            idInput.value = ref.id;
            codeInput.value = ref.code;
            history.replaceState(null, "", `track.html?order=${encodeURIComponent(ref.id)}`);
            track(ref.id, ref.code);
          }
        },
          h("span", {}, ref.id),
          h("span", { class: "muted" }, ref.createdAt ? new Date(ref.createdAt).toLocaleDateString("id-ID") : "View")
        )
      )
    ));
  }

  formEl.addEventListener("submit", event => {
    event.preventDefault();
    const orderId = idInput.value.trim().toUpperCase();
    const code = codeInput.value.trim().toUpperCase();

    if (!orderId || !code) {
      errorEl.textContent = "Enter both the Order ID and the access code.";
      (orderId ? codeInput : idInput).focus();
      return;
    }

    track(orderId, code);
  });

  if (GT.api.isDemo) {
    modeNotice.hidden = false;
    modeNotice.replaceChildren(h("p", {}, "Payment verification and delivery are confirmed by the admin on WhatsApp. If your status hasn't changed after paying, contact admin with your Order ID."));
  }

  GT.layout.init().catch(() => {});
  renderDeviceOrders();

  // track.html?order=ID → isi otomatis bila kode tersimpan di perangkat ini.
  const presetId = (GT.utils.getParam("order") || "").trim().toUpperCase();
  if (presetId) {
    idInput.value = presetId;
    const code = GT.api.myOrders.codeFor(presetId);
    if (code) {
      codeInput.value = code;
      track(presetId, code);
    } else {
      codeInput.focus();
    }
  }
})();
