// ==================================================
// FEEDBACK PAGE (feedback.html)
// --------------------------------------------------
// Player mengirim saran / laporan bug. Validasi di sini
// hanya untuk UX — batas & aturan sebenarnya dicek ulang
// di server (submit_feedback di migration_v5_feedback.sql).
// ==================================================

(function () {
  const { h, $, toast, validateGrowId, storage } = GT.utils;

  const MIN = 10;
  const MAX = 500;
  const GROWID_KEY = "gtplay:feedback:growid";

  const form = $("#feedbackForm");
  const kindGroup = $("#feedbackKind");
  const growInput = $("#feedbackGrowId");
  const messageInput = $("#feedbackMessage");
  const messageLabel = $("#feedbackMessageLabel");
  const count = $("#feedbackCount");
  const errorText = $("#feedbackError");
  const submit = $("#feedbackSubmit");
  const result = $("#feedbackResult");

  const COPY = {
    suggestion: { label: "Saran kamu", placeholder: "Contoh: tambahkan event mingguan dengan hadiah item langka…" },
    bug: { label: "Jelaskan bug-nya", placeholder: "Contoh: di world START, pintu tidak bisa dibuka setelah relog. Langkah: …" }
  };

  let kind = "suggestion";

  function setKind(next) {
    kind = next;
    kindGroup.querySelectorAll("[data-kind]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.kind === kind));
    });
    messageLabel.textContent = COPY[kind].label;
    messageInput.placeholder = COPY[kind].placeholder;
  }

  function updateCount() {
    const length = messageInput.value.trim().length;
    count.textContent = `${length} / ${MAX}`;
    count.classList.toggle("is-low", length > 0 && length < MIN);
  }

  kindGroup.addEventListener("click", event => {
    const button = event.target.closest("[data-kind]");
    if (button) setKind(button.dataset.kind);
  });

  messageInput.addEventListener("input", updateCount);

  form.addEventListener("submit", async event => {
    event.preventDefault();
    errorText.textContent = "";

    const grow = validateGrowId(growInput.value);
    if (!grow.ok) {
      errorText.textContent = grow.message;
      growInput.focus();
      return;
    }
    const message = messageInput.value.trim();
    if (message.length < MIN) {
      errorText.textContent = GT.t("Write at least {n} characters.", { n: MIN });
      messageInput.focus();
      return;
    }

    submit.disabled = true;
    submit.replaceChildren(h("span", { class: "spinner", "aria-hidden": "true" }), " Mengirim…");

    try {
      await GT.api.submitFeedback(kind, grow.value, message);
      storage.set(GROWID_KEY, grow.value);
      messageInput.value = "";
      updateCount();
      result.replaceChildren(
        h("div", { class: "notice notice-ok" },
          h("p", {}, h("strong", {}, "Terima kasih! "),
            kind === "bug" ? "Laporan bug kamu sudah terkirim ke admin." : "Saran kamu sudah terkirim ke admin.")
        )
      );
      toast("Feedback terkirim.", "success");
    } catch (error) {
      errorText.textContent = error.message;
    } finally {
      submit.disabled = false;
      submit.textContent = "Kirim";
    }
  });

  const savedGrowId = storage.get(GROWID_KEY, "");
  if (typeof savedGrowId === "string") growInput.value = savedGrowId;
  if (GT.utils.getParam("type") === "bug") setKind("bug");
  else setKind("suggestion");
  updateCount();

  GT.layout.init().catch(() => {});
})();
