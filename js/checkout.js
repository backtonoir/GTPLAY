// GTPLAY v3.8 (clean URLs)
// ==================================================
// GTPLAY CHECKOUT PAGE (checkout.html)
// --------------------------------------------------
// Ringkasan pesanan + GrowID → Confirm Order.
// Pesanan dibuat lewat GT.api.createOrder, yang menghitung
// ulang harga & stok (di server pada mode Supabase).
// ==================================================

(function () {
  const { h, $, formatRupiah, toast, storage, validateGrowId } = GT.utils;

  const root = $("#checkoutRoot");
  const GROWID_KEY = "gtplay:last-growid";
  let submitting = false;

  // Nilai form disimpan di sini supaya tidak hilang saat
  // ringkasan dirender ulang (mis. qty diubah).
  const form = {
    growId: storage.get(GROWID_KEY, ""),
    confirmed: false
  };

  function quantityControl(line) {
    const { product, quantity } = line;

    return h("div", { class: "qty", role: "group", "aria-label": GT.t("Quantity for {name}", { name: product.name }) },
      h("button", {
        type: "button",
        class: "qty-btn",
        "aria-label": "Decrease quantity",
        disabled: quantity <= 1 || submitting,
        onclick: () => GT.cart.setQty(product.id, quantity - 1)
      }, "−"),
      h("span", { class: "qty-value" }, quantity),
      h("button", {
        type: "button",
        class: "qty-btn",
        "aria-label": "Increase quantity",
        disabled: quantity >= product.stock || submitting,
        onclick: () => GT.cart.setQty(product.id, quantity + 1)
      }, "+")
    );
  }

  function summaryCard(lines) {
    return h("div", { class: "card" },
      h("div", { class: "order-head" },
        h("h2", { class: "card-title" }, "Order summary"),
        h("a", { class: "link-button", href: "/store#store" }, "+ Add more items")
      ),
      h("table", { class: "line-table" },
        h("thead", {},
          h("tr", {},
            h("th", { scope: "col" }, "Item"),
            h("th", { scope: "col" }, "Unit price"),
            h("th", { scope: "col" }, "Qty"),
            h("th", { scope: "col" }, "Subtotal")
          )
        ),
        h("tbody", {},
          lines.map(line =>
            h("tr", {},
              h("td", {},
                h("div", { class: "item-cell" },
                  GT.utils.imageWithFallback({
                    src: line.product.image,
                    alt: "",
                    fallback: line.product.fallback,
                    className: "cart-thumb"
                  }),
                  h("div", {},
                    h("strong", {}, line.product.name),
                    h("span", { class: "muted" }, GT.t("{category} · {n} in stock", { category: line.product.category, n: line.product.stock })),
                    h("button", {
                      type: "button",
                      class: "link-button danger",
                      disabled: submitting,
                      onclick: () => GT.cart.remove(line.product.id)
                    }, "Remove")
                  )
                )
              ),
              h("td", {},
                line.product.originalPrice ? h("s", { class: "price-old block" }, formatRupiah(line.product.originalPrice)) : null,
                h("span", { class: line.product.originalPrice ? "is-sale" : null }, formatRupiah(line.product.price))),
              h("td", {}, quantityControl(line)),
              h("td", {}, h("strong", {}, formatRupiah(line.subtotal)))
            )
          )
        )
      )
    );
  }

  function confirmCard() {
    const growInput = h("input", {
      class: "input",
      id: "growIdInput",
      name: "growId",
      placeholder: "Enter your GrowID",
      autocomplete: "off",
      autocapitalize: "off",
      spellcheck: "false",
      maxlength: "24",
      required: true,
      "aria-describedby": "growIdHelp growIdError",
      value: form.growId,
      oninput: event => {
        form.growId = event.target.value;
        growError.textContent = "";
        growInput.removeAttribute("aria-invalid");
      }
    });

    const growError = h("p", { class: "error-text", id: "growIdError", role: "alert" });

    const confirmBox = h("input", {
      type: "checkbox",
      id: "growIdConfirm",
      checked: form.confirmed,
      onchange: event => { form.confirmed = event.target.checked; }
    });

    const formError = h("p", { class: "error-text", role: "alert" });

    const submitBtn = h("button", { class: "btn btn-primary btn-block btn-lg", type: "submit" }, "Confirm Order");

    const el = h("form", {
      class: "card sticky-col",
      novalidate: true,
      onsubmit: async event => {
        event.preventDefault();
        if (submitting) return;

        formError.textContent = "";
        const check = validateGrowId(form.growId);

        if (!check.ok) {
          growError.textContent = check.message;
          growInput.setAttribute("aria-invalid", "true");
          growInput.focus();
          return;
        }

        if (!form.confirmed) {
          formError.textContent = GT.t("Please confirm your GrowID is correct.");
          confirmBox.focus();
          return;
        }

        await submitOrder(check.value, submitBtn, formError);
      }
    },
      h("h2", { class: "card-title" }, "Your details"),
      h("div", { class: "field" },
        h("label", { class: "label", for: "growIdInput" }, "GrowID"),
        growInput,
        h("p", { class: "help", id: "growIdHelp" }, "Admin uses this to identify your order. Letters, numbers, or underscore."),
        growError
      ),
      h("label", { class: "checkbox", for: "growIdConfirm" },
        confirmBox,
        h("span", {}, "I've double-checked my GrowID")
      ),
      h("div", { class: "cart-summary", style: null },
        h("div", { class: "summary-row" }, h("span", {}, "Items"), h("span", { class: "value" }, String(GT.cart.count()))),
        GT.cart.savings() > 0
          ? h("div", { class: "summary-row savings-row" }, h("span", {}, "You save"), h("span", { class: "value" }, `−${formatRupiah(GT.cart.savings())}`))
          : null,
        h("div", { class: "summary-row summary-total" }, h("span", {}, "Total Payment"), h("strong", {}, formatRupiah(GT.cart.total())))
      ),
      h("div", { class: "notice notice-info checkout-notice" },
        h("p", {}, GT.t("After you confirm, you'll have {min} minutes to pay with QRIS. Stock is held for you during that time.", { min: GT.config.PAYMENT_WINDOW_MINUTES }))
      ),
      formError,
      submitBtn
    );

    return el;
  }

  async function submitOrder(growId, button, errorEl) {
    submitting = true;
    button.disabled = true;
    button.replaceChildren(h("span", { class: "spinner", "aria-hidden": "true" }), "Creating order…");

    try {
      const items = GT.cart.lines().map(line => ({ productId: line.product.id, quantity: line.quantity }));
      const result = await GT.api.createOrder({ growId, items });

      storage.set(GROWID_KEY, growId);
      GT.api.myOrders.add({ id: result.orderId, code: result.accessCode });
      GT.cart.clear();

      window.location.href = `/payment?order=${encodeURIComponent(result.orderId)}#k=${encodeURIComponent(result.accessCode)}`;
    } catch (error) {
      submitting = false;
      errorEl.textContent = error.message || GT.t("Could not create the order.");
      toast(error.message || GT.t("Could not create the order."), "error");

      // Stok/harga berubah → muat ulang katalog agar keranjang disesuaikan.
      if (error.code === "MAINTENANCE") {
        setTimeout(() => window.location.replace("/maintenance"), 1500);
      }

      if (["OUT_OF_STOCK", "PRODUCT_UNAVAILABLE"].includes(error.code)) {
        await GT.layout.loadCatalog(true).catch(() => {});
      }

      button.disabled = false;
      button.textContent = GT.t("Confirm Order");
      if (!GT.cart.isEmpty()) render(errorEl.textContent);
    }
  }

  function render(errorMessage) {
    if (submitting) return;
    const lines = GT.cart.lines();

    if (lines.length === 0) {
      root.replaceChildren(
        h("div", { class: "state-block" },
          h("p", { class: "state-title" }, "Your cart is empty"),
          h("p", { class: "state-text" }, "Add items from the store before checking out."),
          h("a", { class: "btn btn-primary", href: "/store#store" }, "Go to store")
        )
      );
      return;
    }

    const confirm = confirmCard();
    root.replaceChildren(h("div", { class: "split" }, summaryCard(lines), confirm));

    if (errorMessage) {
      const target = confirm.querySelector('.error-text[role="alert"]:not(#growIdError)');
      if (target) target.textContent = errorMessage;
    }
  }

  GT.layout.init()
    .then(() => {
      render();
      GT.cart.onChange(() => render());
    })
    .catch(() => {
      root.replaceChildren(
        h("div", { class: "state-block" },
          h("p", { class: "state-title" }, "Couldn't load your order"),
          h("p", { class: "state-text" }, "Item prices could not be loaded. Check your connection and try again."),
          h("button", { type: "button", class: "btn btn-outline", onclick: () => window.location.reload() }, "Try again")
        )
      );
    });
})();
