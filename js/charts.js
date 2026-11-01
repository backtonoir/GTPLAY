// GTPLAY v3.4 (server status)
// ==================================================
// GTPLAY LINE CHART
// --------------------------------------------------
// Grafik garis ringan tanpa library (aman untuk CSP).
//   GT.lineChart(points, options) → elemen DOM
//   points : [{ date: "YYYY-MM-DD", value: 25000 }, ...]
// Fitur: area lembut, crosshair + tooltip saat hover /
// sentuh, navigasi keyboard (← →), dan tabel tersembunyi
// untuk pembaca layar. Ukuran mengikuti lebar wadah.
// ==================================================

window.GT = window.GT || {};

GT.lineChart = function (points, options) {
  const opts = Object.assign({
    height: 260,
    label: "Chart",
    formatValue: value => String(value),
    formatDate: date => date,
    formatDateShort: date => date
  }, options || {});

  const NS = "http://www.w3.org/2000/svg";
  const { h } = GT.utils;
  const data = points.slice().sort((a, b) => a.date.localeCompare(b.date));

  const wrap = h("div", { class: "chart", role: "group", "aria-label": opts.label });
  const plot = h("div", { class: "chart-plot", tabindex: "0", "aria-label": `${opts.label}. Use left and right arrow keys to read values.` });
  const tooltip = h("div", { class: "chart-tooltip", role: "status", "aria-live": "polite" });
  plot.append(tooltip);
  wrap.append(plot);

  // Tabel untuk pembaca layar.
  wrap.append(h("table", { class: "sr-only" },
    h("caption", {}, opts.label),
    h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Date"), h("th", { scope: "col" }, "Value"))),
    h("tbody", {}, data.map(point => h("tr", {}, h("td", {}, opts.formatDate(point.date)), h("td", {}, opts.formatValue(point.value)))))
  ));

  function svgEl(tag, attrs) {
    const el = document.createElementNS(NS, tag);
    Object.entries(attrs || {}).forEach(([key, value]) => el.setAttribute(key, String(value)));
    return el;
  }

  // Angka sumbu yang "rapi" (1, 2, 2.5, 5 × 10^n).
  function niceTicks(min, max, count) {
    if (min === max) {
      const pad = Math.max(1, Math.abs(min) * 0.1);
      min -= pad;
      max += pad;
    }
    const rough = (max - min) / Math.max(1, count - 1);
    const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * magnitude).find(s => s >= rough) || 10 * magnitude;
    const start = Math.floor(min / step) * step;
    const end = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
    return ticks;
  }

  let activeIndex = data.length - 1;
  let geometry = null;

  function render() {
    const width = Math.max(260, plot.clientWidth || 600);
    const height = opts.height;
    const pad = { top: 14, right: 14, bottom: 30, left: width < 420 ? 58 : 72 };
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;

    const values = data.map(p => p.value);
    const ticks = niceTicks(Math.min(...values), Math.max(...values), 4);
    const yMin = ticks[0];
    const yMax = ticks[ticks.length - 1];

    const x = index => pad.left + (data.length === 1 ? innerW / 2 : (index / (data.length - 1)) * innerW);
    const y = value => pad.top + innerH - ((value - yMin) / (yMax - yMin || 1)) * innerH;

    const svg = svgEl("svg", { width, height, viewBox: `0 0 ${width} ${height}`, class: "chart-svg", "aria-hidden": "true" });

    const gradientId = `chartFill${Math.random().toString(36).slice(2, 8)}`;
    const defs = svgEl("defs");
    const gradient = svgEl("linearGradient", { id: gradientId, x1: 0, y1: 0, x2: 0, y2: 1 });
    gradient.append(
      svgEl("stop", { offset: "0%", "stop-color": "var(--chart-line)", "stop-opacity": 0.22 }),
      svgEl("stop", { offset: "100%", "stop-color": "var(--chart-line)", "stop-opacity": 0 })
    );
    defs.append(gradient);
    svg.append(defs);

    // Grid + label sumbu Y.
    ticks.forEach(tick => {
      svg.append(svgEl("line", { x1: pad.left, x2: width - pad.right, y1: y(tick), y2: y(tick), class: "chart-grid" }));
      const label = svgEl("text", { x: pad.left - 10, y: y(tick), class: "chart-axis", "text-anchor": "end", "dominant-baseline": "middle" });
      label.textContent = opts.formatValue(tick);
      svg.append(label);
    });

    // Label sumbu X: awal, tengah, akhir (tanpa tumpang tindih).
    const xIndexes = data.length <= 2 ? data.map((_, i) => i) : [0, Math.floor((data.length - 1) / 2), data.length - 1];
    [...new Set(xIndexes)].forEach((index, n, arr) => {
      const anchor = arr.length === 1 ? "middle" : n === 0 ? "start" : n === arr.length - 1 ? "end" : "middle";
      const label = svgEl("text", { x: x(index), y: height - 8, class: "chart-axis", "text-anchor": anchor });
      label.textContent = opts.formatDateShort(data[index].date);
      svg.append(label);
    });

    if (data.length > 1) {
      const linePath = data.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
      const areaPath = `${linePath} L${x(data.length - 1).toFixed(1)},${pad.top + innerH} L${x(0).toFixed(1)},${pad.top + innerH} Z`;
      svg.append(svgEl("path", { d: areaPath, fill: `url(#${gradientId})`, class: "chart-area" }));
      svg.append(svgEl("path", { d: linePath, class: "chart-line" }));
    }

    // Titik terakhir selalu terlihat (nilai terkini).
    const last = data.length - 1;
    svg.append(svgEl("circle", { cx: x(last), cy: y(data[last].value), r: 4, class: "chart-dot" }));

    // Lapisan hover.
    const crosshair = svgEl("line", { y1: pad.top, y2: pad.top + innerH, class: "chart-crosshair" });
    const focusDot = svgEl("circle", { r: 5, class: "chart-dot chart-focus" });
    svg.append(crosshair, focusDot);

    const old = plot.querySelector("svg");
    if (old) old.remove();
    plot.prepend(svg);

    geometry = { x, y, crosshair, focusDot, width, pad, innerW };
    hideFocus();
  }

  function showFocus(index) {
    if (!geometry) return;
    activeIndex = Math.max(0, Math.min(data.length - 1, index));
    const point = data[activeIndex];
    const px = geometry.x(activeIndex);
    const py = geometry.y(point.value);

    geometry.crosshair.setAttribute("x1", px);
    geometry.crosshair.setAttribute("x2", px);
    geometry.crosshair.style.opacity = "1";
    geometry.focusDot.setAttribute("cx", px);
    geometry.focusDot.setAttribute("cy", py);
    geometry.focusDot.style.opacity = "1";

    tooltip.replaceChildren(
      h("span", { class: "chart-tooltip-date" }, opts.formatDate(point.date)),
      h("strong", {}, opts.formatValue(point.value))
    );
    tooltip.classList.add("show");

    const tipWidth = tooltip.offsetWidth || 140;
    const left = Math.min(Math.max(px - tipWidth / 2, 4), geometry.width - tipWidth - 4);
    tooltip.style.transform = `translate(${left}px, ${Math.max(py - 64, 0)}px)`;
  }

  function hideFocus() {
    if (!geometry) return;
    geometry.crosshair.style.opacity = "0";
    geometry.focusDot.style.opacity = "0";
    tooltip.classList.remove("show");
  }

  function indexFromEvent(event) {
    const rect = plot.getBoundingClientRect();
    const px = event.clientX - rect.left;
    if (data.length === 1) return 0;
    const ratio = (px - geometry.pad.left) / geometry.innerW;
    return Math.round(ratio * (data.length - 1));
  }

  plot.addEventListener("pointermove", event => showFocus(indexFromEvent(event)));
  plot.addEventListener("pointerdown", event => showFocus(indexFromEvent(event)));
  plot.addEventListener("pointerleave", hideFocus);
  plot.addEventListener("focus", () => showFocus(activeIndex));
  plot.addEventListener("blur", hideFocus);
  plot.addEventListener("keydown", event => {
    if (event.key === "ArrowLeft") { event.preventDefault(); showFocus(activeIndex - 1); }
    if (event.key === "ArrowRight") { event.preventDefault(); showFocus(activeIndex + 1); }
    if (event.key === "Home") { event.preventDefault(); showFocus(0); }
    if (event.key === "End") { event.preventDefault(); showFocus(data.length - 1); }
  });

  // Render ulang saat ukuran berubah.
  let lastWidth = 0;
  const observer = new ResizeObserver(() => {
    const width = plot.clientWidth;
    if (width && Math.abs(width - lastWidth) > 2) {
      lastWidth = width;
      render();
    }
  });
  observer.observe(plot);

  requestAnimationFrame(render);
  return wrap;
};
