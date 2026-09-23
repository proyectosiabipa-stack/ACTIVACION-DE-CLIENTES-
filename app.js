const REMOTE_DATA_URL = "https://script.google.com/macros/s/AKfycby-04Usb_MBXAxG7O-FtV8VpogxrzgiAjD0AUyCujMIrpBla6U8RdDHPjfBF5FKRz4L/exec";
const LIVE_REFRESH_INTERVAL_MS = 120000;
// Apps Script debe procesar toda la facturacion antes de responder. Con una hoja
// grande puede tardar mas de 45 segundos, por eso el portal espera sin cortar la
// lectura y no usa ningun archivo local como sustituto.
const REMOTE_REQUEST_TIMEOUT_MS = 120000;

let data = null;
let detail = [];
let isRefreshingRemote = false;
const filters = {
  seller: document.getElementById("sellerFilter"),
  assignment: document.getElementById("assignmentFilter"),
  zone: document.getElementById("zoneFilter"),
  type: document.getElementById("typeFilter"),
  segment: document.getElementById("segmentFilter"),
  status: document.getElementById("statusFilter"),
  search: document.getElementById("searchInput"),
};
const daysRange = {
  min: document.getElementById("dayMin"),
  max: document.getElementById("dayMax"),
  label: document.getElementById("dayRangeLabel"),
  fill: document.getElementById("rangeFill"),
};
const state = { selectedClient: null, selectedSellerZones: new Set(), selectedFinalMonths: new Set(), selectedArticleMonths: new Set(), zoneSearch: "", articleSearch: "" };

const fmt = new Intl.NumberFormat("es-VE", { maximumFractionDigits: 0 });
const money = new Intl.NumberFormat("es-VE", {
  style: "currency",
  currency: "USD",
  currencyDisplay: "narrowSymbol",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
const pct = value => `${(value * 100).toFixed(1)}%`;
const toNumber = value => Number(value ?? 0) || 0;
const daysWithoutPurchase = row => {
  if (row.dias_sin_facturar === "" || row.dias_sin_facturar == null) return 365;
  return Math.max(0, Number(row.dias_sin_facturar) || 0);
};
const formatDaysWithoutPurchase = row => row.dias_sin_facturar === "" || row.dias_sin_facturar == null
  ? "-"
  : fmt.format(daysWithoutPurchase(row));
function classifyCustomer(row) {
  const days = daysWithoutPurchase(row);
  if (!row.ultima_factura || row.segmento === "NUNCA FACTURADO") return "NUNCA FACTURADO";
  if (days <= 30) return "ACTIVO 0-30 DIAS";
  if (days <= 60) return "RIESGO 31-60 DIAS";
  if (days <= 90) return "INACTIVO 61-90 DIAS";
  if (days <= 180) return "DORMIDO 91-180 DIAS";
  return "PERDIDO MAS DE 180 DIAS";
}

const activeFilterContainer = document.getElementById("activeFilters");
const clientTableEl = document.getElementById("clientTable");
const detailPanel = document.getElementById("detailPanel");
const detailClientTitle = document.getElementById("detailClientTitle");
const detailClientContent = document.getElementById("detailClientContent");
const tooltipEl = document.getElementById("tooltip");
const sellerMessageFilter = document.getElementById("sellerMessageFilter");
const zonePickerButton = document.getElementById("zonePickerButton");
const zonePickerLabel = document.getElementById("zonePickerLabel");
const zonePickerPanel = document.getElementById("zonePickerPanel");
const zoneSearchInput = document.getElementById("zoneSearchInput");
const zoneOptions = document.getElementById("zoneOptions");
const selectedZoneChips = document.getElementById("selectedZoneChips");
const finalMonthOptions = document.getElementById("finalMonthOptions");
const articleMonthOptions = document.getElementById("articleMonthOptions");
const articleSearchInput = document.getElementById("articleSearchInput");

function showTooltip(event) {
  const target = event.currentTarget;
  const text = target.dataset.tooltip || "";
  if (!text) return;
  tooltipEl.textContent = text;
  tooltipEl.classList.add("visible");
  tooltipEl.setAttribute("aria-hidden", "false");
  const offset = 14;
  const x = Math.min(window.innerWidth - 220, event.clientX + 18);
  const y = Math.max(16, event.clientY - 8);
  tooltipEl.style.left = `${x}px`;
  tooltipEl.style.top = `${y}px`;
}

function hideTooltip() {
  tooltipEl.classList.remove("visible");
  tooltipEl.setAttribute("aria-hidden", "true");
}

function bindTooltipTargets() {
  const targets = document.querySelectorAll("[data-tooltip]");
  targets.forEach(el => {
    if (el.dataset.bound === "true") return;
    el.dataset.bound = "true";
    el.addEventListener("mouseenter", showTooltip);
    el.addEventListener("mousemove", showTooltip);
    el.addEventListener("mouseleave", hideTooltip);
    el.addEventListener("focus", showTooltip);
    el.addEventListener("blur", hideTooltip);
  });
}

function normalizeLabel(value) {
  const text = String(value ?? "").trim();
  if (!text) return "Sin dato";
  const normalized = text.toUpperCase();
  if (["NO TIENE", "NO ASIGNADO", "SIN DATO", "SIN ASIGNAR", "N/A", "NA", "NULL", "NO HAY"].includes(normalized)) {
    return "Sin asignación";
  }
  return text;
}

function searchKey(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
}

function unique(field) {
  return [...new Set(detail.map(row => normalizeLabel(row[field])).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function fillSelect(select, values) {
  if (!select) return;
  const currentValue = select.value;
  select.innerHTML = `<option value="">Todos</option>` + values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
  if ([...select.options].some(option => option.value === currentValue)) {
    select.value = currentValue;
  }
}

function refreshFilterOptions() {
  fillSelect(filters.seller, unique("vendedor"));
  refreshZoneFilterOptions();
  fillSelect(filters.type, unique("tipo_cliente"));
  fillSelect(filters.segment, unique("segmento"));
}

function sellerZones(seller) {
  if (!seller) return unique("zona");
  return [...new Set(
    detail
      .filter(row => normalizeLabel(row.vendedor) === seller)
      .map(row => normalizeLabel(row.zona))
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b));
}

function refreshZoneFilterOptions() {
  const selectedSeller = filters.seller.value;
  const availableZones = sellerZones(selectedSeller);
  const activeZone = filters.zone.value;
  fillSelect(filters.zone, availableZones);
  if (activeZone && !availableZones.includes(activeZone)) filters.zone.value = "";
}

Object.entries(filters).forEach(([name, el]) => {
  if (name !== "seller") el.addEventListener("input", render);
});
filters.seller.addEventListener("change", () => {
  // Al cambiar de vendedor se libera una zona que pudiera venir de otra cartera.
  // Asi se ve completa la cartera del vendedor nuevo, con todas sus zonas.
  filters.zone.value = "";
  refreshZoneFilterOptions();
  state.selectedClient = null;
  render();
});
[daysRange.min, daysRange.max].forEach(el => el.addEventListener("input", () => {
  if (Number(daysRange.min.value) > Number(daysRange.max.value)) {
    if (document.activeElement === daysRange.min) {
      daysRange.max.value = daysRange.min.value;
    } else {
      daysRange.min.value = daysRange.max.value;
    }
  }
  updateDayRangeUI();
  render();
}));
document.getElementById("resetBtn").addEventListener("click", () => {
  filters.seller.value = "";
  filters.assignment.value = "";
  filters.zone.value = "";
  filters.type.value = "";
  filters.segment.value = "";
  filters.status.value = "";
  filters.search.value = "";
  daysRange.min.value = "0";
  daysRange.max.value = "365";
  state.selectedClient = null;
  updateDayRangeUI();
  render();
});
document.getElementById("clearDayRangeBtn").addEventListener("click", () => {
  daysRange.min.value = "0";
  daysRange.max.value = "365";
  updateDayRangeUI();
  render();
});
document.getElementById("closeDetailBtn").addEventListener("click", () => {
  state.selectedClient = null;
  renderDetailPanel([]);
});
document.getElementById("exportBtn")?.addEventListener("click", downloadCSV);
document.getElementById("copyAllSellerMessages")?.addEventListener("click", () => copyAllSellerMessages());
sellerMessageFilter?.addEventListener("input", () => renderSellerMessages(detail));
zonePickerButton?.addEventListener("click", () => toggleZonePicker());
zoneSearchInput?.addEventListener("input", () => {
  state.zoneSearch = zoneSearchInput.value;
  syncSellerZoneFilter(detail);
});
zoneSearchInput?.addEventListener("keydown", event => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  const firstVisible = zoneOptions?.querySelector("[data-zone-option]");
  if (!firstVisible) return;
  firstVisible.checked = true;
  state.selectedSellerZones.add(firstVisible.value);
  renderSellerMessages(detail);
});
document.getElementById("clearSellerZones")?.addEventListener("click", () => {
  state.selectedSellerZones.clear();
  renderSellerMessages(detail);
});
selectedZoneChips?.addEventListener("click", event => {
  const button = event.target.closest("[data-remove-zone]");
  if (!button) return;
  state.selectedSellerZones.delete(button.dataset.removeZone);
  renderSellerMessages(detail);
});
zoneOptions?.addEventListener("change", event => {
  const input = event.target.closest("[data-zone-option]");
  if (!input) return;
  if (input.checked) state.selectedSellerZones.add(input.value);
  else state.selectedSellerZones.delete(input.value);
  renderSellerMessages(detail);
});
document.addEventListener("click", event => {
  const picker = document.getElementById("sellerZonePicker");
  if (!picker || picker.contains(event.target)) return;
  closeZonePicker();
});
document.getElementById("sellerMessages")?.addEventListener("click", event => {
  const button = event.target.closest("[data-copy-seller]");
  if (button) {
    copySellerMessage(button.dataset.copySeller);
    return;
  }
  const pdfButton = event.target.closest("[data-pdf-seller]");
  if (!pdfButton) return;
  downloadSellerPdf(pdfButton.dataset.pdfSeller);
});
finalMonthOptions?.addEventListener("change", event => {
  const input = event.target.closest("[data-final-month]");
  if (!input) return;
  if (input.checked) state.selectedFinalMonths.add(input.value);
  else state.selectedFinalMonths.delete(input.value);
  renderFinalSummary();
});
document.getElementById("finalClearMonths")?.addEventListener("click", () => {
  state.selectedFinalMonths.clear();
  renderFinalSummary();
});
articleMonthOptions?.addEventListener("change", event => {
  const input = event.target.closest("[data-article-month]");
  if (!input) return;
  if (input.checked) state.selectedArticleMonths.add(input.value);
  else state.selectedArticleMonths.delete(input.value);
  renderArticlesSummary();
});
articleSearchInput?.addEventListener("input", () => {
  state.articleSearch = articleSearchInput.value;
  renderArticlesSummary();
});
document.getElementById("articleClearMonths")?.addEventListener("click", () => {
  state.selectedArticleMonths.clear();
  renderArticlesSummary();
});
window.addEventListener("hashchange", applyViewMode);
const filtersToggle = document.getElementById("filtersToggle");
const filterDock = document.querySelector(".filterDock");
filtersToggle?.addEventListener("click", () => {
  const collapsed = filterDock.classList.toggle("filtersCollapsed");
  filtersToggle.setAttribute("aria-expanded", String(!collapsed));
  filtersToggle.textContent = collapsed ? "Mostrar filtros ↓" : "Ocultar filtros ↑";
});
if (window.matchMedia("(max-width: 760px)").matches) {
  filterDock?.classList.add("filtersCollapsed");
  filtersToggle?.setAttribute("aria-expanded", "false");
  if (filtersToggle) filtersToggle.textContent = "Mostrar filtros ↓";
}

activeFilterContainer.addEventListener("click", event => {
  const chip = event.target.closest("[data-clear-filter]");
  if (!chip) return;
  const { filter, value } = chip.dataset;
  if (filter === "status") {
    filters.status.value = "";
  } else if (filter === "search") {
    filters.search.value = "";
  } else if (filter === "daysRange") {
    daysRange.min.value = "0";
    daysRange.max.value = "365";
    updateDayRangeUI();
  } else {
    filters[filter].value = "";
  }
  render();
});

clientTableEl.addEventListener("click", event => {
  const row = event.target.closest("tr[data-client-code]");
  if (!row) return;
  state.selectedClient = row.dataset.clientCode;
  renderDetailPanel(currentRows());
  renderClientTable(currentRows().slice().sort((a, b) => daysWithoutPurchase(b) - daysWithoutPurchase(a)).slice(0, 500));
});

function updateDayRangeUI() {
  const minValue = Math.max(0, Number(daysRange.min.value) || 0);
  const maxValue = Math.max(minValue, Number(daysRange.max.value) || 0);
  daysRange.min.value = String(minValue);
  daysRange.max.value = String(maxValue);
  const minPercent = (minValue / 365) * 100;
  const maxPercent = (maxValue / 365) * 100;
  daysRange.fill.style.left = `${minPercent}%`;
  daysRange.fill.style.width = `${Math.max(maxPercent - minPercent, 2)}%`;
  daysRange.label.textContent = `Mostrar clientes entre ${minValue} y ${maxValue === 365 ? "365+" : maxValue} días sin compra`;
}

function currentRows() {
  const q = filters.search.value.trim().toUpperCase();
  const minDays = Number(daysRange.min.value);
  const maxDays = Number(daysRange.max.value);
  return detail.filter(row => {
    const rowDays = daysWithoutPurchase(row);
    if (rowDays < minDays || rowDays > maxDays) return false;
    if (filters.seller.value && normalizeLabel(row.vendedor) !== filters.seller.value) return false;
    if (filters.assignment.value && row.estado_asignacion !== filters.assignment.value) return false;
    if (filters.zone.value && normalizeLabel(row.zona) !== filters.zone.value) return false;
    if (filters.type.value && normalizeLabel(row.tipo_cliente) !== filters.type.value) return false;
    if (filters.segment.value && normalizeLabel(row.segmento) !== filters.segment.value) return false;
    if (filters.status.value && row.estado_facturacion !== filters.status.value) return false;
    if (q) {
      const hay = `${row.cliente} ${row.codigo} ${row.vendedor} ${row.estado_asignacion} ${row.zona} ${row.tipo_cliente} ${row.segmento}`.toUpperCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function aggregate(rows, key) {
  const map = new Map();
  rows.forEach(row => {
    const k = normalizeLabel(row[key]);
    if (!map.has(k)) {
      map.set(k, { name: k, clientes: 0, activos: 0, inactivos: 0, nunca: 0, confirmados: 0, vacantes: 0, venta: 0, saldo: 0, vencido: 0 });
    }
    const item = map.get(k);
    item.clientes += 1;
    item.venta += Number(row.venta_total) || 0;
    item.saldo += Number(row.saldo_total) || 0;
    item.vencido += Number(row.saldo_vencido) || 0;
    if (row.estado_facturacion === "ACTIVO") item.activos += 1;
    else item.inactivos += 1;
    if (row.segmento === "NUNCA FACTURADO") item.nunca += 1;
    if (row.estado_asignacion === "VACANTE") item.vacantes += 1;
    else item.confirmados += 1;
  });
  return [...map.values()].sort((a, b) => b.clientes - a.clientes || a.name.localeCompare(b.name));
}

function totals(rows) {
  const active = rows.filter(r => classifyCustomer(r) === "ACTIVO 0-30 DIAS").length;
  const risk = rows.filter(r => ["RIESGO 31-60 DIAS", "INACTIVO 61-90 DIAS"].includes(classifyCustomer(r))).length;
  const critical = rows.filter(r => ["DORMIDO 91-180 DIAS", "PERDIDO MAS DE 180 DIAS"].includes(classifyCustomer(r))).length;
  const never = rows.filter(r => classifyCustomer(r) === "NUNCA FACTURADO").length;
  const billed = rows.filter(r => r.ultima_factura).length;
  const overdue = rows.reduce((s, r) => s + toNumber(r.saldo_vencido), 0);
  const avgTicket = rows.length ? rows.reduce((s, r) => s + toNumber(r.venta_total), 0) / rows.length : 0;
  const withoutSeller = rows.filter(r => !String(r.vendedor || "").trim() || /NO TIENE|SIN ASIGN/.test(String(r.vendedor || "").toUpperCase())).length;
  const vacant = rows.filter(r => r.estado_asignacion === "VACANTE").length;
  const confirmed = rows.filter(r => r.estado_asignacion === "CONFIRMADO").length;
  return {
    total: rows.length,
    active,
    inactive: rows.length - active,
    risk,
    critical,
    never,
    billed,
    sales: rows.reduce((s, r) => s + toNumber(r.venta_total), 0),
    balance: rows.reduce((s, r) => s + toNumber(r.saldo_total), 0),
    overdue,
    avgTicket,
    withoutSeller,
    vacant,
    confirmed,
  };
}

function render() {
  if (!data || !detail.length) return;
  const sendMode = window.location.hash === "#enviar";
  const finalMode = window.location.hash === "#resumen-final";
  const articleMode = window.location.hash === "#articulos";
  document.getElementById("periodText").textContent = `${data.start} a ${data.cutoff}`;
  const rows = currentRows();
  const t = totals(rows);
  renderKpis(t);
  renderHighlightStrip(rows, t);
  renderOpportunityGrid(rows);
  renderDataFeedback();
  updateFilterSummary();
  renderExecutiveSummary(t, rows);
  renderExecutiveText(t, rows);
  renderBars("sellerBars", aggregate(rows, "vendedor").slice(0, 12), true, r => `${fmt.format(r.activos)} compran / ${fmt.format(r.clientes)} · ${fmt.format(r.vacantes)} vacantes`);
  renderAssignmentBars(rows);
  renderSegmentBars(rows);
  renderMonthBars(rows);
  renderTable("zoneTable", aggregate(rows, "zona").slice(0, 30));
  renderTable("typeTable", aggregate(rows, "tipo_cliente").slice(0, 30));
  const sortedClients = rows.slice().sort((a, b) => daysWithoutPurchase(b) - daysWithoutPurchase(a));
  // Cuando se analiza un vendedor, su cartera debe verse completa y no limitada
  // por el corte general de la tabla.
  renderClientTable(filters.seller.value ? sortedClients : sortedClients.slice(0, 500));
  if (sendMode) renderSellerMessages(detail);
  if (finalMode) renderFinalSummary();
  if (articleMode) renderArticlesSummary();
  renderDetailPanel(rows);
  bindTooltipTargets();
  applyViewMode(false);
}

function applyViewMode(renderMessages = true) {
  const mode = window.location.hash === "#enviar" ? "send" : window.location.hash === "#resumen-final" ? "final" : window.location.hash === "#articulos" ? "articles" : "dashboard";
  document.body.classList.toggle("sendMode", mode === "send");
  document.body.classList.toggle("finalMode", mode === "final");
  document.body.classList.toggle("articleMode", mode === "articles");
  document.body.classList.toggle("dashboardMode", mode === "dashboard");
  document.querySelectorAll("[data-view-link]").forEach(link => {
    link.classList.toggle("active", link.dataset.viewLink === mode);
  });
  // La vista de mensajes es pesada porque prepara una lista para cada vendedor.
  // Se crea solo cuando el usuario abre esa vista, no al cargar el dashboard.
  if (mode === "send" && renderMessages && data && detail.length) renderSellerMessages(detail);
  if (mode === "final" && renderMessages && data && detail.length) renderFinalSummary();
  if (mode === "articles" && renderMessages && data && detail.length) renderArticlesSummary();
}

function renderKpis(t) {
  const kpis = [
    ["Clientes analizados", fmt.format(t.total), "Base del filtro actual"],
    ["Vendedor confirmado", fmt.format(t.confirmed), t.total ? pct(t.confirmed / t.total) : "0.0%"],
    ["Vacantes por confirmar", fmt.format(t.vacant), t.total ? pct(t.vacant / t.total) : "0.0%"],
    ["Activos 0-30 días", fmt.format(t.active), t.total ? pct(t.active / t.total) : "0.0%"],
    ["Riesgo 31-90 días", fmt.format(t.risk), t.total ? pct(t.risk / t.total) : "0.0%"],
    ["Críticos +91 días", fmt.format(t.critical), t.total ? pct(t.critical / t.total) : "0.0%"],
    ["Saldo vencido", money.format(t.overdue), "Monto por recuperar"],
    ["Ticket promedio", money.format(t.avgTicket), "Venta por cliente visible"],
  ];
  document.getElementById("kpis").innerHTML = kpis.map(([label, value, sub], index) => {
    const tooltipText = [
      "Total de clientes visibles según los filtros actuales. Esta base es la referencia para todas las métricas del tablero.",
      "Clientes que en la hoja CLIENTES aparecen con vendedor confirmado.",
      "Clientes que en la hoja CLIENTES aparecen como vacantes o con vendedor por confirmar.",
      "Clientes con compra reciente dentro de los últimos 30 días. Son la cartera activa y de menor riesgo.",
      "Clientes con compra entre 31 y 90 días, indicando riesgo de desactivación y necesidad de seguimiento comercial.",
      "Clientes con más de 90 días sin compra, prioridad alta para reactivación o recuperación del negocio.",
      "Monto total vencido entre los clientes visibles. Es el riesgo financiero más inmediato de la cartera.",
      "Promedio de ventas por cliente dentro del filtro. Sirve para valorar el peso económico de la cartera."
    ][index] || "Indicador del tablero.";
    return `
      <article class="kpi" tabindex="0" data-tooltip="${escapeHtml(tooltipText)}"><span>${label}</span><strong>${value}</strong><small>${sub}</small></article>
    `;
  }).join("");
}

function renderHighlightStrip(rows, t) {
  const topSeller = aggregate(rows, "vendedor")[0];
  const topZone = aggregate(rows, "zona")[0];
  const risk = rows.filter(r => ["RIESGO 31-60 DIAS", "INACTIVO 61-90 DIAS", "DORMIDO 91-180 DIAS", "PERDIDO MAS DE 180 DIAS"].includes(r.segmento)).length;
  const highPriority = rows.filter(r => daysWithoutPurchase(r) > 90).length;

  const cards = [
    ["Mayor carga", topSeller?.name || "Sin vendedor", `${fmt.format(topSeller?.clientes || 0)} clientes`],
    ["Vacantes", fmt.format(t.vacant), "Vendedor por confirmar"],
    ["Zona más activa", topZone?.name || "Sin zona", `${fmt.format(topZone?.clientes || 0)} clientes`],
    ["Clientes en riesgo", fmt.format(risk), "Más de 30 días sin comprar"],
    ["Prioridad alta", fmt.format(highPriority), "Más de 90 días sin compra"]
  ];

  document.getElementById("highlightStrip").innerHTML = cards.map(([label, value, sub], index) => {
    const tooltipText = [
      "Vendedor con mayor volumen de clientes dentro del filtro actual, útil para detectar concentración comercial.",
      "Clientes marcados como VACANTE o con vendedor por confirmar en la hoja CLIENTES.",
      "Zona con mayor cantidad de clientes visibles, útil para ubicar la actividad por territorio.",
      "Clientes que ya tienen más de 30 días sin compra y están en riesgo de retraso o pérdida.",
      "Clientes con más de 90 días sin compra, priorizados para seguimiento agresivo o recuperación."
    ][index] || "Resumen ejecutivo del filtro actual.";
    return `
      <article class="insightCard" tabindex="0" data-tooltip="${escapeHtml(tooltipText)}">
        <span>${label}</span>
        <strong>${value}</strong>
        <small>${sub}</small>
      </article>
    `;
  }).join("");
}

function renderOpportunityGrid(rows) {
  const rangeBuckets = [
    { label: "31-60 días", value: rows.filter(r => daysWithoutPurchase(r) >= 31 && daysWithoutPurchase(r) <= 60).length },
    { label: "61-90 días", value: rows.filter(r => daysWithoutPurchase(r) >= 61 && daysWithoutPurchase(r) <= 90).length },
    { label: "91-180 días", value: rows.filter(r => daysWithoutPurchase(r) >= 91 && daysWithoutPurchase(r) <= 180).length },
    { label: "+180 días", value: rows.filter(r => daysWithoutPurchase(r) > 180).length },
  ];

  const totalBalance = rows.reduce((sum, row) => sum + Number(row.saldo_vencido || 0), 0);
  const avgSale = rows.length ? rows.reduce((sum, row) => sum + Number(row.venta_total || 0), 0) / rows.length : 0;

  const cards = [
    ["Saldo vencido", money.format(totalBalance), "Monto pendiente por recuperar"],
    ["Venta promedio", money.format(avgSale), "Promedio por cliente visible"],
    ...rangeBuckets.map(bucket => [bucket.label, fmt.format(bucket.value), "Clientes en ese rango"]),
  ];

  document.getElementById("opportunityGrid").innerHTML = cards.map(([label, value, sub], index) => {
    const tooltipText = [
      "Monto total vencido para los clientes visibles. Es la base de la recuperación de cartera.",
      "Valor promedio de venta por cliente en el filtro actual. Ayuda a valorar el impacto comercial.",
      "Clientes que llevan entre 31 y 60 días sin comprar; empiezan a requerir seguimiento directo.",
      "Clientes con 61 a 90 días sin compra; ya requieren gestión activa de recuperación.",
      "Clientes con 91 a 180 días sin compra; representan una prioridad alta para contacto comercial.",
      "Clientes con más de 180 días sin compra; riesgo más crítico y potencial de pérdida de cartera."
    ][index] || "Métrica de oportunidad comercial.";

    return `
      <article class="opportunityCard" tabindex="0" data-tooltip="${escapeHtml(tooltipText)}">
        <span>${label}</span>
        <strong>${value}</strong>
        <small>${sub}</small>
      </article>
    `;
  }).join("");
}

function renderDataFeedback() {
  const unmatched = Array.isArray(data.unmatched) ? data.unmatched : [];
  const feedback = document.getElementById("dataFeedback");
  if (!feedback) return;

  if (!unmatched.length) {
    feedback.innerHTML = `
      <div class="feedbackCard ok">
        <div>
          <span class="panelTag">Control de cruce</span>
          <h2>Todos los clientes facturados cruzan con la hoja CLIENTES</h2>
          <p>La asignación de vendedor se toma desde CLIENTES. FACTURACION se usa para fechas, compras, documentos y montos.</p>
        </div>
        <strong>0 sin cruce</strong>
      </div>`;
    return;
  }

  const totalSales = unmatched.reduce((sum, row) => sum + Number(row.venta_total || 0), 0);
  feedback.innerHTML = `
    <div class="feedbackCard warning">
      <div>
        <span class="panelTag">Control de cruce</span>
        <h2>${fmt.format(unmatched.length)} clientes aparecen en FACTURACION pero no están en CLIENTES</h2>
        <p>Estos registros sí tienen facturación, pero el portal no puede asignarles vendedor desde CLIENTES hasta corregir el nombre o agregarlos al maestro.</p>
      </div>
      <strong>${money.format(totalSales)}</strong>
    </div>
    <div class="feedbackList">
      ${unmatched.slice(0, 8).map(row => `
        <div>
          <span>${escapeHtml(shorten(row.cliente_facturacion, 62))}</span>
          <small>${fmt.format(row.documentos)} documentos · última factura ${row.ultima_factura || "-"}</small>
        </div>`).join("")}
      ${unmatched.length > 8 ? `<div><span>Y ${fmt.format(unmatched.length - 8)} clientes más sin cruce.</span><small>Revise esos nombres en FACTURACION o agréguelos a CLIENTES.</small></div>` : ""}
    </div>`;
}

function updateFilterSummary() {
  const chips = [];
  if (filters.seller.value) chips.push({ label: `Vendedor: ${filters.seller.value}`, filter: "seller", value: filters.seller.value });
  if (filters.assignment.value) chips.push({ label: `Asignación: ${filters.assignment.value === "VACANTE" ? "Vacante / por confirmar" : "Confirmado"}`, filter: "assignment", value: filters.assignment.value });
  if (filters.zone.value) chips.push({ label: `Zona: ${filters.zone.value}`, filter: "zone", value: filters.zone.value });
  if (filters.type.value) chips.push({ label: `Tipo: ${filters.type.value}`, filter: "type", value: filters.type.value });
  if (filters.segment.value) chips.push({ label: `Segmento: ${filters.segment.value}`, filter: "segment", value: filters.segment.value });
  if (filters.status.value) chips.push({ label: `Situación: ${filters.status.value}`, filter: "status", value: filters.status.value });
  const dayMin = Number(daysRange.min.value);
  const dayMax = Number(daysRange.max.value);
  if (dayMin !== 0 || dayMax !== 365) {
    chips.push({ label: `Sin compra: ${dayMin} - ${dayMax === 365 ? "365+" : dayMax} días`, filter: "daysRange", value: `${dayMin}-${dayMax}` });
  }
  if (filters.search.value.trim()) chips.push({ label: `Texto: ${filters.search.value.trim()}`, filter: "search", value: filters.search.value.trim() });

  activeFilterContainer.innerHTML = chips.length
    ? chips.map(chip => `<button class="filterChip" type="button" data-clear-filter="true" data-filter="${chip.filter}" data-value="${escapeHtml(chip.value)}">${escapeHtml(chip.label)} ×</button>`).join("")
    : `<span class="filterChip neutral">Sin filtros activos</span>`;
}

function renderExecutiveSummary(t, rows) {
  const bestSeller = aggregate(rows, "vendedor")[0];
  const bestZone = aggregate(rows, "zona")[0];
  const activeRate = t.total ? (t.active / t.total) * 100 : 0;
  const riskRate = t.total ? ((rows.filter(r => ["RIESGO 31-60 DIAS", "INACTIVO 61-90 DIAS", "DORMIDO 91-180 DIAS", "PERDIDO MAS DE 180 DIAS"].includes(r.segmento)).length) / t.total) * 100 : 0;
  const neverRate = t.total ? (t.never / t.total) * 100 : 0;
  const vacantRate = t.total ? (t.vacant / t.total) * 100 : 0;

  document.getElementById("executiveHeadline").textContent =
    `${bestSeller?.name || "Sin vendedor"} lidera la cartera y hay ${fmt.format(t.vacant)} clientes vacantes o por confirmar en el filtro actual.`;

  setDonut("donutActiveChart", "donutActiveValue", activeRate, "#138a52", "Porcentaje de clientes que compraron recientemente dentro del periodo analizado.");
  setDonut("donutRiskChart", "donutRiskValue", riskRate, "#b7791f", "Porcentaje de clientes con riesgo de inactividad o sin compra al menos 30 días.");
  setDonut("donutAssignChart", "donutAssignValue", vacantRate, "#c2410c", "Porcentaje de clientes vacantes o con vendedor por confirmar según la hoja CLIENTES.");
}

function setDonut(chartId, valueId, percent, color, tooltipText) {
  const chart = document.getElementById(chartId);
  const valueLabel = document.getElementById(valueId);
  const safePercent = Math.min(Math.max(percent, 0), 100);

  chart.style.background = `conic-gradient(${color} 0 ${safePercent}%, #eaf0f7 ${safePercent}% 100%)`;
  valueLabel.textContent = `${safePercent.toFixed(1)}%`;
  chart.setAttribute("data-tooltip", tooltipText);
  chart.setAttribute("tabindex", "0");
}

function renderExecutiveText(t, rows) {
  const bestSeller = aggregate(rows, "vendedor")[0];
  const bestZone = aggregate(rows, "zona")[0];
  const activeRate = t.total ? pct(t.active / t.total) : "0.0%";
  const riskRate = t.total ? pct((t.risk + t.critical) / t.total) : "0.0%";
  const premium = rows.filter(r => toNumber(r.venta_total) >= 1000).length;
  const vacantText = t.vacant ? `${fmt.format(t.vacant)} clientes están vacantes o con vendedor por confirmar.` : "Todos los clientes visibles tienen vendedor confirmado.";
  document.getElementById("executiveText").textContent =
    `Con los filtros actuales estás viendo ${fmt.format(t.total)} clientes. De ellos, ${fmt.format(t.active)} están activos (${activeRate}), mientras que ${fmt.format(t.risk + t.critical)} muestran riesgo o inactividad crítica (${riskRate}). ` +
    `${fmt.format(t.never)} clientes nunca registraron compra en el período analizado, y ${vacantText} Además, ${fmt.format(premium)} clientes tienen un valor de compra superior a 1.000 unidades, lo que indica mayor potencial de recuperación o expansión. ` +
    `La mayor carga de clientes está en ${bestSeller?.name || "sin vendedor"} y la zona con más clientes filtrados es ${bestZone?.name || "sin zona"}.`;
}

function renderBars(id, rows, stacked, valueFormatter) {
  const max = Math.max(1, ...rows.map(r => r.clientes));
  document.getElementById(id).innerHTML = rows.map(r => {
    const activeWidth = stacked ? (r.activos / r.clientes) * 100 : (r.clientes / max) * 100;
    const inactiveWidth = stacked ? (r.inactivos / r.clientes) * 100 : 0;
    const label = normalizeLabel(r.name);
    const tooltipText = stacked
      ? `${escapeHtml(label)}. De ${fmt.format(r.clientes)} clientes, ${fmt.format(r.activos)} compran recientemente y ${fmt.format(r.inactivos)} no compran recientemente.`
      : `${escapeHtml(label)}: ${fmt.format(r.clientes)} clientes.`;
    const valueText = valueFormatter
      ? valueFormatter(r)
      : stacked
        ? `${fmt.format(r.activos)} compran / ${fmt.format(r.clientes)}`
        : `${fmt.format(r.clientes)} clientes`;
    return `
      <div class="barRow" tabindex="0" data-tooltip="${tooltipText}">
        <strong title="${escapeHtml(r.name)}">${escapeHtml(shorten(r.name, 22))}</strong>
        <div class="track">
          <span class="${stacked ? "activeBar" : "singleBar"}" style="width:${activeWidth}%"></span>
          ${stacked ? `<span class="inactiveBar" style="width:${inactiveWidth}%"></span>` : ""}
        </div>
        <span class="barValue">${valueText}</span>
      </div>`;
  }).join("");
}

function renderSegmentBars(rows) {
  const agg = aggregate(rows, "segmento");
  renderBars("segmentBars", agg, false, r => `${fmt.format(r.clientes)} clientes en este rango`);
}

function renderAssignmentBars(rows) {
  const assignmentRows = [
    {
      name: "Vendedor confirmado",
      clientes: rows.filter(r => r.estado_asignacion === "CONFIRMADO").length,
      activos: rows.filter(r => r.estado_asignacion === "CONFIRMADO" && r.estado_facturacion === "ACTIVO").length,
      inactivos: rows.filter(r => r.estado_asignacion === "CONFIRMADO" && r.estado_facturacion !== "ACTIVO").length,
    },
    {
      name: "Vacante / por confirmar",
      clientes: rows.filter(r => r.estado_asignacion === "VACANTE").length,
      activos: rows.filter(r => r.estado_asignacion === "VACANTE" && r.estado_facturacion === "ACTIVO").length,
      inactivos: rows.filter(r => r.estado_asignacion === "VACANTE" && r.estado_facturacion !== "ACTIVO").length,
    },
  ].filter(r => r.clientes);
  renderBars("assignmentBars", assignmentRows, false, r => `${fmt.format(r.clientes)} clientes`);
}

function renderMonthBars(rows) {
  const byMonth = new Map(data.months.map(m => [m.mes, { name: m.mes, clientes: 0, activos: 0, inactivos: 0 }]));
  rows.forEach(row => {
    if (!row.ultima_factura) return;
    const month = row.ultima_factura.slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, { name: month, clientes: 0, activos: 0, inactivos: 0 });
    byMonth.get(month).clientes += 1;
  });
  renderBars(
    "monthBars",
    [...byMonth.values()]
      .filter(r => r.clientes)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(r => ({ ...r, name: monthName(r.name) })),
    false,
    r => `${fmt.format(r.clientes)} clientes compraron`
  );
}

function monthName(monthKey) {
  const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  const monthNumber = Number(String(monthKey).split("-")[1]);
  return monthNames[monthNumber - 1] || monthKey;
}

function monthFullName(monthKey) {
  const year = String(monthKey).split("-")[0] || "";
  return `${monthName(monthKey)} ${year}`.trim();
}

function availableMonths() {
  const months = new Set((data?.months || []).map(item => item.mes).filter(Boolean));
  detail.forEach(row => {
    (row.historial_mensual || []).forEach(item => {
      if (item.mes) months.add(item.mes);
    });
  });
  return [...months].sort();
}

function selectedFinalMonths() {
  const selected = [...state.selectedFinalMonths].filter(month => availableMonths().includes(month)).sort();
  return selected.length ? selected : availableMonths();
}

function hasClientMonthlyHistory() {
  return detail.some(row => Array.isArray(row.historial_mensual) && row.historial_mensual.length);
}

function monthlyTotalsFor(months) {
  const monthSet = new Set(months);
  const monthlyRows = (data?.months || []).filter(item => monthSet.has(item.mes));
  return {
    sales: monthlyRows.reduce((sum, item) => sum + toNumber(item.venta_total), 0),
    clients: monthlyRows.reduce((sum, item) => sum + toNumber(item.clientes_unicos), 0),
    documents: monthlyRows.reduce((sum, item) => sum + toNumber(item.documentos), 0),
    activeZones: 0
  };
}

function monthEntries(row, months) {
  const history = Array.isArray(row.historial_mensual) ? row.historial_mensual : [];
  if (history.length) {
    return history.filter(item => months.includes(item.mes) && toNumber(item.venta_total) > 0);
  }
  return [];
}

function finalPeriodRows() {
  const months = selectedFinalMonths();
  return detail.map(row => {
    const entries = monthEntries(row, months);
    const sale = entries.reduce((sum, item) => sum + toNumber(item.venta_total), 0);
    const documents = entries.reduce((sum, item) => sum + toNumber(item.documentos), 0);
    const lastDate = entries.map(item => item.ultima_factura).filter(Boolean).sort().pop() || "";
    const firstMonth = entries.map(item => item.mes).filter(Boolean).sort()[0] || "";
    return {
      ...row,
      periodo_venta_total: sale,
      periodo_documentos: documents,
      periodo_ultima_factura: lastDate,
      periodo_primer_mes: firstMonth,
      periodo_meses: entries.length
    };
  }).filter(row => row.periodo_venta_total > 0);
}

function aggregateFinal(rows, key) {
  const map = new Map();
  rows.forEach(row => {
    const name = normalizeLabel(row[key]);
    if (!map.has(name)) map.set(name, { name, clientes: 0, documentos: 0, venta: 0, promedio: 0 });
    const item = map.get(name);
    item.clientes += 1;
    item.documentos += toNumber(row.periodo_documentos);
    item.venta += toNumber(row.periodo_venta_total);
  });
  return [...map.values()].map(item => ({
    ...item,
    promedio: item.clientes ? item.venta / item.clientes : 0
  })).sort((a, b) => b.venta - a.venta || b.clientes - a.clientes || a.name.localeCompare(b.name));
}

function renderFinalMonthOptions(months) {
  if (!finalMonthOptions) return;
  finalMonthOptions.innerHTML = months.map(month => `
    <label class="monthOption">
      <input type="checkbox" value="${escapeHtml(month)}" data-final-month ${state.selectedFinalMonths.has(month) ? "checked" : ""}>
      <span>${escapeHtml(monthFullName(month))}</span>
    </label>
  `).join("");
}

function renderFinalSummary() {
  if (!data || !detail.length) return;
  const months = availableMonths();
  renderFinalMonthOptions(months);
  const selected = selectedFinalMonths();
  const preciseClientHistory = hasClientMonthlyHistory();
  const rows = finalPeriodRows();
  const totalClients = detail.length || 1;
  const monthTotals = monthlyTotalsFor(selected);
  const clientsWithSale = preciseClientHistory ? rows.length : monthTotals.clients;
  const clientsWithoutSale = Math.max(0, totalClients - clientsWithSale);
  const totalSales = preciseClientHistory ? rows.reduce((sum, row) => sum + toNumber(row.periodo_venta_total), 0) : monthTotals.sales;
  const totalDocs = preciseClientHistory ? rows.reduce((sum, row) => sum + toNumber(row.periodo_documentos), 0) : monthTotals.documents;
  const avgTicket = totalDocs ? totalSales / totalDocs : 0;
  const avgClient = clientsWithSale ? totalSales / clientsWithSale : 0;
  const selectedLabel = state.selectedFinalMonths.size
    ? selected.map(monthFullName).join(", ")
    : "Todo el periodo";
  const summary = document.getElementById("finalSummary");
  if (summary) summary.textContent = `Resumen final: ${selectedLabel}`;

  document.getElementById("finalKpis").innerHTML = [
    ["Meses revisados", fmt.format(selected.length), selectedLabel],
    ["Clientes con compra", fmt.format(clientsWithSale), `${pct(clientsWithSale / totalClients)} de la cartera`],
    ["Clientes sin venta", fmt.format(clientsWithoutSale), "No aparecen facturados en el rango"],
    ["Venta total", money.format(totalSales), "Facturación del periodo"],
    ["Facturas válidas", fmt.format(totalDocs), "Documentos agregados"],
    ["Ticket promedio", money.format(avgTicket), "Promedio por factura"],
    ["Promedio por cliente", money.format(avgClient), "Venta promedio por cliente facturado"],
    ["Zonas activas", preciseClientHistory ? fmt.format(aggregateFinal(rows, "zona").length) : "-", preciseClientHistory ? "Zonas con movimiento" : "Disponible al actualizar el puente de datos"]
  ].map(([label, value, sub]) => `<article class="kpi finalKpi"><span>${label}</span><strong>${value}</strong><small>${escapeHtml(sub)}</small></article>`).join("");

  const topSeller = aggregateFinal(rows, "vendedor")[0];
  const topZone = aggregateFinal(rows, "zona")[0];
  const topClient = rows.slice().sort((a, b) => b.periodo_venta_total - a.periodo_venta_total)[0];
  document.getElementById("finalInsight").innerHTML = `
    <article>
      <span>Lectura rápida</span>
      <strong>${preciseClientHistory ? `${escapeHtml(topSeller?.name || "Sin vendedor destacado")} lidera el periodo con ${topSeller ? money.format(topSeller.venta) : money.format(0)}.` : `El periodo seleccionado suma ${money.format(totalSales)} en facturación registrada.`}</strong>
      <p>${preciseClientHistory ? `La zona con mayor movimiento fue ${escapeHtml(topZone?.name || "sin zona")} y el cliente de mayor facturación fue ${escapeHtml(shorten(topClient?.cliente || "sin cliente destacado", 70))}.` : "Para ver el desglose exacto por vendedor, zona y cliente dentro de cada mes, publique la versión actualizada del Apps Script. El total mensual ya se muestra desde el resumen mensual disponible."} Esta vista sirve para cerrar el mes, comparar rangos y detectar dónde se concentró realmente la venta.</p>
    </article>`;

  renderFinalMonthBars(rows, selected);
  renderFinalRankTable("finalSellerTable", preciseClientHistory ? aggregateFinal(rows, "vendedor").slice(0, 20) : [], "Vendedor", preciseClientHistory ? "" : "Actualice el Apps Script para ver vendedores por mes.");
  renderFinalRankTable("finalZoneTable", preciseClientHistory ? aggregateFinal(rows, "zona").slice(0, 20) : [], "Zona", preciseClientHistory ? "" : "Actualice el Apps Script para ver zonas por mes.");
  renderFinalClientTable(preciseClientHistory ? rows : [], preciseClientHistory ? "" : "Actualice el Apps Script para ver clientes por mes.");
  bindTooltipTargets();
}

function renderFinalMonthBars(rows, months) {
  if (!hasClientMonthlyHistory()) {
    const values = (data?.months || [])
      .filter(item => months.includes(item.mes))
      .sort((a, b) => a.mes.localeCompare(b.mes))
      .map(item => ({ name: monthFullName(item.mes), clientes: toNumber(item.clientes_unicos), venta: toNumber(item.venta_total), documentos: toNumber(item.documentos), activos: toNumber(item.clientes_unicos), inactivos: 0 }));
    renderBars("finalMonthBars", values, false, item => `${fmt.format(item.clientes)} clientes · ${money.format(item.venta || 0)}`);
    return;
  }
  const map = new Map(months.map(month => [month, { name: month, clientes: 0, venta: 0, documentos: 0 }]));
  rows.forEach(row => {
    monthEntries(row, months).forEach(item => {
      if (!map.has(item.mes)) map.set(item.mes, { name: item.mes, clientes: 0, venta: 0, documentos: 0 });
      const month = map.get(item.mes);
      month.clientes += 1;
      month.venta += toNumber(item.venta_total);
      month.documentos += toNumber(item.documentos);
    });
  });
  const values = [...map.values()].filter(item => item.clientes || item.venta).sort((a, b) => a.name.localeCompare(b.name));
  renderBars("finalMonthBars", values.map(item => ({
    ...item,
    name: monthFullName(item.name),
    clientes: item.clientes,
    activos: item.clientes,
    inactivos: 0
  })), false, item => `${fmt.format(item.clientes)} clientes · ${money.format(item.venta || 0)}`);
}

function renderFinalRankTable(id, rows, label, emptyMessage = "No hay registros para este periodo.") {
  const element = document.getElementById(id);
  if (!element) return;
  element.innerHTML = `
    <thead><tr><th>${label}</th><th class="num">Clientes</th><th class="num">Facturas</th><th class="num">Venta</th><th class="num">Promedio cliente</th></tr></thead>
    <tbody>${rows.map(row => `
      <tr>
        <td>${escapeHtml(row.name)}</td>
        <td class="num">${fmt.format(row.clientes)}</td>
        <td class="num">${fmt.format(row.documentos)}</td>
        <td class="num">${money.format(row.venta)}</td>
        <td class="num">${money.format(row.promedio)}</td>
      </tr>`).join("") || `<tr><td colspan="5">${escapeHtml(emptyMessage)}</td></tr>`}</tbody>`;
}

function renderFinalClientTable(rows, emptyMessage = "No hay clientes facturados en este rango.") {
  const element = document.getElementById("finalClientTable");
  if (!element) return;
  const sorted = rows.slice().sort((a, b) => b.periodo_venta_total - a.periodo_venta_total).slice(0, 600);
  element.innerHTML = `
    <thead><tr><th>Cliente</th><th>Vendedor</th><th>Zona</th><th class="num">Venta periodo</th><th class="num">Facturas</th><th>Última compra del rango</th><th class="num">Promedio factura</th></tr></thead>
    <tbody>${sorted.map(row => `
      <tr>
        <td>${escapeHtml(shorten(row.cliente, 52))}</td>
        <td>${escapeHtml(normalizeLabel(row.vendedor))}</td>
        <td>${escapeHtml(normalizeLabel(row.zona))}</td>
        <td class="num">${money.format(row.periodo_venta_total)}</td>
        <td class="num">${fmt.format(row.periodo_documentos)}</td>
        <td>${escapeHtml(row.periodo_ultima_factura || "-")}</td>
        <td class="num">${money.format(row.periodo_documentos ? row.periodo_venta_total / row.periodo_documentos : 0)}</td>
      </tr>`).join("") || `<tr><td colspan="7">${escapeHtml(emptyMessage)}</td></tr>`}</tbody>`;
}

function articlesData() {
  return Array.isArray(data?.articulos) ? data.articulos : [];
}

function articleAvailableMonths() {
  const months = new Set();
  articlesData().forEach(article => {
    (article.historial_mensual || []).forEach(item => {
      if (item.mes) months.add(item.mes);
    });
  });
  if (!months.size) (data?.months || []).forEach(item => item.mes && months.add(item.mes));
  return [...months].sort();
}

function selectedArticleMonths() {
  const months = articleAvailableMonths();
  const selected = [...state.selectedArticleMonths].filter(month => months.includes(month)).sort();
  return selected.length ? selected : months;
}

function articleMonthStats(article, months) {
  const history = Array.isArray(article.historial_mensual) ? article.historial_mensual : [];
  if (!history.length) {
    return {
      venta_total: toNumber(article.venta_total),
      unidades: toNumber(article.unidades || article.total_articulo),
      peso_total: toNumber(article.peso_total),
      documentos: toNumber(article.documentos),
      clientes_unicos: toNumber(article.clientes_unicos)
    };
  }
  const set = new Set(months);
  const selected = history.filter(item => set.has(item.mes));
  return {
    venta_total: selected.reduce((sum, item) => sum + toNumber(item.venta_total), 0),
    unidades: selected.reduce((sum, item) => sum + toNumber(item.unidades), 0),
    peso_total: selected.reduce((sum, item) => sum + toNumber(item.peso_total), 0),
    documentos: selected.reduce((sum, item) => sum + toNumber(item.documentos), 0),
    clientes_unicos: selected.reduce((sum, item) => sum + toNumber(item.clientes_unicos), 0)
  };
}

function currentArticles() {
  const months = selectedArticleMonths();
  const query = searchKey(state.articleSearch || "");
  return articlesData().map(article => {
    const stats = articleMonthStats(article, months);
    return {
      ...article,
      periodo_venta_total: stats.venta_total,
      periodo_unidades: stats.unidades,
      periodo_peso_total: stats.peso_total,
      periodo_documentos: stats.documentos,
      periodo_clientes: stats.clientes_unicos,
      periodo_venta_por_peso: stats.peso_total ? stats.venta_total / stats.peso_total : 0,
      periodo_precio_promedio: stats.unidades ? stats.venta_total / stats.unidades : 0
    };
  }).filter(article => {
    if (article.periodo_venta_total <= 0 && article.periodo_unidades <= 0 && article.periodo_peso_total <= 0) return false;
    if (!query) return true;
    return searchKey(`${article.codigo} ${article.producto} ${article.unidad}`).includes(query);
  });
}

function formatWeight(value) {
  const amount = toNumber(value);
  return `${new Intl.NumberFormat("es-VE", { maximumFractionDigits: 2 }).format(amount)} peso`;
}

function renderArticleMonthOptions(months) {
  if (!articleMonthOptions) return;
  articleMonthOptions.innerHTML = months.map(month => `
    <label class="monthOption">
      <input type="checkbox" value="${escapeHtml(month)}" data-article-month ${state.selectedArticleMonths.has(month) ? "checked" : ""}>
      <span>${escapeHtml(monthFullName(month))}</span>
    </label>
  `).join("");
}

function renderArticlesSummary() {
  const articles = articlesData();
  const emptyState = document.getElementById("articleEmptyState");
  const contentIds = ["articleKpis", "articleWeightBars", "articleSalesBars", "articleUnitBars", "articleWeightValueBars", "articleTable"];
  const months = articleAvailableMonths();
  renderArticleMonthOptions(months);
  if (!articles.length) {
    if (emptyState) emptyState.innerHTML = `<div class="feedbackCard warning"><div><span class="panelTag">Datos de artículos</span><h2>Falta publicar el Apps Script actualizado</h2><p>La vista ya está lista, pero necesita que el puente envíe la información de productos, unidades, venta y peso desde FACTURACION.</p></div><strong>Sin artículos</strong></div>`;
    contentIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = "";
    });
    return;
  }
  if (emptyState) emptyState.innerHTML = "";
  const rows = currentArticles();
  const totalSales = rows.reduce((sum, row) => sum + toNumber(row.periodo_venta_total), 0);
  const totalUnits = rows.reduce((sum, row) => sum + toNumber(row.periodo_unidades), 0);
  const totalWeight = rows.reduce((sum, row) => sum + toNumber(row.periodo_peso_total), 0);
  const totalDocs = rows.reduce((sum, row) => sum + toNumber(row.periodo_documentos), 0);
  const totalClients = rows.reduce((sum, row) => sum + toNumber(row.periodo_clientes), 0);
  const selectedLabel = state.selectedArticleMonths.size ? selectedArticleMonths().map(monthFullName).join(", ") : "Todo el periodo";
  const summary = document.getElementById("articleSummary");
  if (summary) summary.textContent = `Artículos analizados: ${fmt.format(rows.length)} · ${selectedLabel}`;

  document.getElementById("articleKpis").innerHTML = [
    ["Artículos con movimiento", fmt.format(rows.length), "Productos vendidos en el rango"],
    ["Venta total", money.format(totalSales), "Facturación de artículos"],
    ["Unidades", fmt.format(totalUnits), "Cantidad total registrada"],
    ["Peso total", formatWeight(totalWeight), "Peso acumulado"],
    ["Venta por peso", totalWeight ? money.format(totalSales / totalWeight) : "-", "Ingreso por unidad de peso"],
    ["Facturas", fmt.format(totalDocs), "Documentos donde aparecen productos"],
    ["Clientes compradores", fmt.format(totalClients), "Clientes acumulados por artículo"],
    ["Precio promedio", totalUnits ? money.format(totalSales / totalUnits) : "-", "Venta por unidad"]
  ].map(([label, value, sub]) => `<article class="kpi articleKpi"><span>${label}</span><strong>${value}</strong><small>${escapeHtml(sub)}</small></article>`).join("");

  renderArticleBars("articleWeightBars", rows.slice().sort((a, b) => b.periodo_peso_total - a.periodo_peso_total).slice(0, 12), "periodo_peso_total", row => formatWeight(row.periodo_peso_total));
  renderArticleBars("articleSalesBars", rows.slice().sort((a, b) => b.periodo_venta_total - a.periodo_venta_total).slice(0, 12), "periodo_venta_total", row => money.format(row.periodo_venta_total));
  renderArticleBars("articleUnitBars", rows.slice().sort((a, b) => b.periodo_unidades - a.periodo_unidades).slice(0, 12), "periodo_unidades", row => `${fmt.format(row.periodo_unidades)} unidades`);
  renderArticleBars("articleWeightValueBars", rows.slice().filter(row => row.periodo_venta_por_peso > 0).sort((a, b) => b.periodo_venta_por_peso - a.periodo_venta_por_peso).slice(0, 12), "periodo_venta_por_peso", row => `${money.format(row.periodo_venta_por_peso)} por peso`);
  renderArticleTable(rows);
  bindTooltipTargets();
}

function renderArticleBars(id, rows, valueKey, valueFormatter) {
  const max = Math.max(1, ...rows.map(row => toNumber(row[valueKey])));
  const element = document.getElementById(id);
  if (!element) return;
  element.innerHTML = rows.map(row => {
    const value = toNumber(row[valueKey]);
    return `
      <div class="barRow" tabindex="0" data-tooltip="${escapeHtml(row.producto)}">
        <strong title="${escapeHtml(row.producto)}">${escapeHtml(shorten(row.producto, 28))}</strong>
        <div class="track"><span class="singleBar" style="width:${Math.max((value / max) * 100, value ? 3 : 0)}%"></span></div>
        <span class="barValue">${valueFormatter(row)}</span>
      </div>`;
  }).join("") || `<p class="panelIntro">No hay datos para mostrar.</p>`;
}

function renderArticleTable(rows) {
  const element = document.getElementById("articleTable");
  if (!element) return;
  const sorted = rows.slice().sort((a, b) => b.periodo_venta_total - a.periodo_venta_total).slice(0, 800);
  element.innerHTML = `
    <thead><tr><th>Artículo</th><th>Código</th><th>Unidad</th><th class="num">Venta</th><th class="num">Unidades</th><th class="num">Peso</th><th class="num">Venta por peso</th><th class="num">Clientes</th><th class="num">Facturas</th></tr></thead>
    <tbody>${sorted.map(row => `
      <tr>
        <td>${escapeHtml(shorten(row.producto, 58))}</td>
        <td>${escapeHtml(row.codigo || "-")}</td>
        <td>${escapeHtml(row.unidad || "-")}</td>
        <td class="num">${money.format(row.periodo_venta_total)}</td>
        <td class="num">${fmt.format(row.periodo_unidades)}</td>
        <td class="num">${formatWeight(row.periodo_peso_total)}</td>
        <td class="num">${row.periodo_peso_total ? money.format(row.periodo_venta_por_peso) : "-"}</td>
        <td class="num">${fmt.format(row.periodo_clientes)}</td>
        <td class="num">${fmt.format(row.periodo_documentos)}</td>
      </tr>`).join("") || `<tr><td colspan="9">No hay artículos para este filtro.</td></tr>`}</tbody>`;
}

function renderTable(id, rows) {
  const total = rows.reduce((s, r) => s + r.clientes, 0) || 1;
  document.getElementById(id).innerHTML = `
    <thead><tr><th>Nombre</th><th class="num">Clientes</th><th class="num">Confirmados</th><th class="num">Vacantes</th><th class="num">Compraron reciente</th><th class="num">% que compra</th><th class="num">Nunca compraron</th><th class="num">Venta</th></tr></thead>
    <tbody>${rows.map(r => `
      <tr>
        <td>${escapeHtml(normalizeLabel(r.name))}</td>
        <td class="num">${fmt.format(r.clientes)}</td>
        <td class="num">${fmt.format(r.confirmados)}</td>
        <td class="num">${fmt.format(r.vacantes)}</td>
        <td class="num">${fmt.format(r.activos)}</td>
        <td class="num">${pct(r.activos / r.clientes)}</td>
        <td class="num">${fmt.format(r.nunca)}</td>
        <td class="num">${money.format(r.venta)}</td>
      </tr>`).join("")}</tbody>`;
}

function renderClientTable(rows) {
  const selectedSeller = filters.seller.value;
  const zones = [...new Set(rows.map(row => normalizeLabel(row.zona)).filter(Boolean))];
  const zoneText = zones.length
    ? ` Zonas de esta cartera: ${zones.join(", ")}.`
    : "";
  document.getElementById("detailCaption").textContent = selectedSeller
    ? `Cartera completa de ${selectedSeller}: ${fmt.format(rows.length)} clientes en ${fmt.format(zones.length)} zonas.${zoneText}`
    : `Mostrando ${fmt.format(rows.length)} clientes. Esta tabla sirve para decidir a quién llamar, visitar o reasignar.`;
  clientTableEl.innerHTML = `
    <thead><tr><th>Cliente</th><th>Vendedor</th><th>Asignación</th><th>Zona</th><th>Tipo</th><th>Situación</th><th>Tiempo sin compra</th><th class="num">Días sin comprar</th><th>Última compra</th><th class="num">Monto última factura</th><th class="num">Promedio por compra</th><th class="num"><span data-tooltip="Total de compras del cliente durante el año o período analizado. Si está inactivo, corresponde a lo que compró antes de su última factura.">Histórico anual ⓘ</span></th></tr></thead>
    <tbody>${rows.map(r => `
      <tr class="clientRow ${state.selectedClient === r.codigo ? "selected" : ""}" data-client-code="${escapeHtml(r.codigo)}">
        <td>${escapeHtml(shorten(r.cliente, 44))}</td>
        <td>${escapeHtml(normalizeLabel(r.vendedor))}</td>
        <td><span class="assignmentPill ${r.estado_asignacion === "VACANTE" ? "vacant" : "confirmed"}">${r.estado_asignacion === "VACANTE" ? "VACANTE / POR CONFIRMAR" : "CONFIRMADO"}</span></td>
        <td>${escapeHtml(normalizeLabel(r.zona))}</td>
        <td>${escapeHtml(shorten(normalizeLabel(r.tipo_cliente), 30))}</td>
        <td class="${r.estado_facturacion === "ACTIVO" ? "statusActive" : "statusInactive"}">${r.estado_facturacion === "ACTIVO" ? "COMPRA RECIENTE" : "SIN COMPRA RECIENTE"}</td>
        <td>${escapeHtml(simpleSegment(r.segmento))}</td>
        <td class="num">${formatDaysWithoutPurchase(r)}</td>
        <td>${r.ultima_factura || "-"}</td>
        <td class="num">${r.ultima_factura ? money.format(Number(r.monto_ultima_factura) || 0) : "-"}</td>
        <td class="num">${r.documentos ? money.format(Number(r.promedio_compra) || 0) : "-"}</td>
        <td class="num">${money.format(Number(r.venta_total) || 0)}</td>
      </tr>`).join("")}</tbody>`;
}

function activationRows(rows) {
  return rows
    .filter(row => row.estado_asignacion === "CONFIRMADO")
    .filter(row => row.vendedor && !["VACANTE", "SIN VENDEDOR", "SIN DATO", "SIN ASIGNACIÓN"].includes(normalizeLabel(row.vendedor).toUpperCase()))
    .filter(row => row.estado_facturacion !== "ACTIVO")
    .sort((a, b) => {
      if (a.segmento === "NUNCA FACTURADO" && b.segmento !== "NUNCA FACTURADO") return -1;
      if (a.segmento !== "NUNCA FACTURADO" && b.segmento === "NUNCA FACTURADO") return 1;
      return daysWithoutPurchase(b) - daysWithoutPurchase(a);
    });
}

function sellerMessageGroups(rows) {
  const groups = new Map();
  const eligibleRows = rows
    .filter(row => row.estado_asignacion === "CONFIRMADO")
    .filter(row => row.vendedor && !["VACANTE", "SIN VENDEDOR", "SIN DATO", "SIN ASIGNACIÓN"].includes(normalizeLabel(row.vendedor).toUpperCase()));
  eligibleRows.forEach(row => {
    const seller = normalizeLabel(row.vendedor);
    if (!groups.has(seller)) groups.set(seller, { seller, portfolio: [], pending: [] });
    const group = groups.get(seller);
    group.portfolio.push(row);
    if (row.estado_facturacion !== "ACTIVO") group.pending.push(row);
  });
  return [...groups.values()]
    .map(group => ({
      ...group,
      pending: group.pending.sort((a, b) => {
        if (a.segmento === "NUNCA FACTURADO" && b.segmento !== "NUNCA FACTURADO") return -1;
        if (a.segmento !== "NUNCA FACTURADO" && b.segmento === "NUNCA FACTURADO") return 1;
        return daysWithoutPurchase(b) - daysWithoutPurchase(a);
      })
    }))
    .filter(group => group.pending.length)
    .sort((a, b) => b.pending.length - a.pending.length || a.seller.localeCompare(b.seller));
}

function selectedSellerZones() {
  return [...state.selectedSellerZones];
}

function zoneFilteredSellerRows(rows) {
  const selectedZones = selectedSellerZones();
  if (!selectedZones.length) return rows;
  const zoneSet = new Set(selectedZones);
  return rows.filter(row => zoneSet.has(normalizeLabel(row.zona)));
}

function buildSellerMessage(group) {
  const activeThisMonth = group.portfolio.filter(row => row.estado_facturacion === "ACTIVO").length;
  const pendingRows = uniqueCustomerRows(group.pending);
  const pendingCount = pendingRows.length;
  const recoveryPotential = recoveryPotentialOf(pendingRows);
  const topCustomers = topInactiveCustomers(pendingRows);
  const lines = pendingRows.map((row, index) => {
    return `${index + 1}. ${row.cliente} | ${normalizeLabel(row.zona)} | ${sellerPurchaseMetrics(row)}`;
  });
  const topLines = topCustomers.map((row, index) => {
    return `${index + 1}. ${row.cliente} | ${sellerPurchaseMetrics(row)}`;
  });

  return [
    `Buen día, ${group.seller}.`,
    "",
    "Se comparte la cartera de clientes pendientes por activar durante el mes.",
    "Cada reactivación representa una oportunidad real para sumar al resultado comercial.",
    `Total cartera de clientes: ${fmt.format(group.portfolio.length)}.`,
    `Clientes activos en el mes: ${fmt.format(activeThisMonth)}.`,
    `Clientes pendientes por activar: ${fmt.format(pendingCount)}.`,
    `Oportunidad de próxima venta en total: ${money.format(recoveryPotential)}.`,
    "Referencia comercial: promedio habitual de compra de los clientes pendientes con historial.",
    "",
    "Top 10 oportunidades por promedio de compra:",
    ...topLines,
    "",
    "Clientes para activar:",
    ...lines,
    "",
    "Favor realizar gestión comercial y reportar novedades o posibilidad de pedido.",
    "Cada cliente recuperado suma al resultado del mes. Gracias por el compromiso y seguimiento."
  ].filter(line => line !== "").join("\n");
}

function recoveryPotentialOf(rows) {
  return uniqueCustomerRows(rows).reduce((total, row) => total + toNumber(row.promedio_compra), 0);
}

function hasMaximumPurchase(row) {
  return row && Object.prototype.hasOwnProperty.call(row, "monto_maximo_factura") && Number.isFinite(Number(row.monto_maximo_factura));
}

function maximumPurchaseText(row) {
  if (!toNumber(row?.documentos)) return "sin historial";
  if (!hasMaximumPurchase(row)) return "pendiente de actualizar fuente";
  return money.format(toNumber(row.monto_maximo_factura));
}

function purchaseDateText(row) {
  const value = String(row?.ultima_factura || "").trim();
  if (!value) return "Sin compra registrada";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function sellerPurchaseMetrics(row) {
  if (!toNumber(row?.documentos)) return "última compra: sin compra registrada | sin historial de facturación";
  return `última compra ${purchaseDateText(row)} | promedio por factura ${money.format(toNumber(row.promedio_compra))} | mayor compra ${maximumPurchaseText(row)} | ${fmt.format(toNumber(row.documentos))} facturas válidas`;
}

function uniqueCustomerRows(rows) {
  const customers = new Map();
  rows.forEach(row => {
    const key = String(row.codigo || normalizeLabel(row.cliente) || "").trim();
    if (!key) return;
    const existing = customers.get(key);
    if (!existing || toNumber(row.venta_total) > toNumber(existing.venta_total)) customers.set(key, row);
  });
  return [...customers.values()];
}

function topInactiveCustomers(rows, limit = 10) {
  return uniqueCustomerRows(rows)
    .filter(row => toNumber(row.promedio_compra) > 0)
    .sort((a, b) => toNumber(b.promedio_compra) - toNumber(a.promedio_compra) || toNumber(b.documentos) - toNumber(a.documentos) || daysWithoutPurchase(b) - daysWithoutPurchase(a))
    .slice(0, limit);
}

function renderSellerMessages(rows) {
  const container = document.getElementById("sellerMessages");
  const summary = document.getElementById("sendSummary");
  if (!container || !summary) return;

  syncSellerZoneFilter(rows);
  const selectedZones = selectedSellerZones();
  const filteredRows = zoneFilteredSellerRows(rows);
  const groups = sellerMessageGroups(filteredRows);
  syncSellerMessageFilter(groups);
  const selectedSeller = sellerMessageFilter?.value || "";
  const visibleGroups = selectedSeller ? groups.filter(group => group.seller === selectedSeller) : groups;
  const totalClients = visibleGroups.reduce((sum, group) => sum + uniqueCustomerRows(group.pending).length, 0);
  const zoneText = selectedZones.length ? ` · ${fmt.format(selectedZones.length)} zona${selectedZones.length === 1 ? "" : "s"} seleccionada${selectedZones.length === 1 ? "" : "s"}` : " · todas las zonas";
  summary.textContent = `${fmt.format(totalClients)} clientes para activación mensual distribuidos en ${fmt.format(visibleGroups.length)} vendedores${zoneText}`;

  if (!visibleGroups.length) {
    container.innerHTML = `<article class="sellerMessage empty"><h3>No hay clientes para activación mensual con los filtros actuales.</h3><p>Pruebe cambiar las zonas seleccionadas o revisar vendedores confirmados.</p></article>`;
    return;
  }

  container.innerHTML = visibleGroups.map(group => {
    const message = buildSellerMessage(group);
    const activeThisMonth = group.portfolio.filter(row => row.estado_facturacion === "ACTIVO").length;
    const pendingRows = uniqueCustomerRows(group.pending);
    const recoveryPotential = recoveryPotentialOf(pendingRows);
    const topCustomers = topInactiveCustomers(pendingRows);
    const missingMaximum = pendingRows.some(row => toNumber(row.documentos) > 0 && !hasMaximumPurchase(row));
    const preview = topCustomers.map((row, index) => `<li><b>${index + 1}</b><span>${escapeHtml(shorten(row.cliente, 42))}</span><em>${money.format(toNumber(row.promedio_compra))}</em></li>`).join("");
    return `
      <article class="sellerMessage">
        <div class="sellerMessageHead">
          <div><span class="panelTag">WhatsApp</span><h3>${escapeHtml(group.seller)}</h3><p>Cartera ${fmt.format(group.portfolio.length)} · activos ${fmt.format(activeThisMonth)} · faltan ${fmt.format(pendingRows.length)}</p><div class="recoveryPotential"><span>Oportunidad de próxima venta en total</span><strong>${money.format(recoveryPotential)}</strong><small>Estimación: suma de promedios por factura</small></div></div>
          <div class="sellerActions">
            <button class="copyButton" type="button" data-copy-seller="${escapeHtml(group.seller)}">Copiar mensaje</button>
            <button class="pdfButton" type="button" data-pdf-seller="${escapeHtml(group.seller)}">Descargar PDF</button>
          </div>
        </div>
        ${missingMaximum ? `<div class="dataWarning"><strong>Falta actualizar Apps Script</strong><span>El promedio está disponible, pero la mayor compra aún no llegó desde la fuente. Publique la nueva versión del script y pulse “Actualizar datos ahora”.</span></div>` : ""}
        <div class="sellerTop"><strong>Top 10 oportunidades por promedio de compra</strong><small>Clientes inactivos ordenados por lo que normalmente compran en una factura.</small><ol>${preview || "<li><span>No hay promedios de compra para mostrar.</span></li>"}</ol></div>
        <textarea readonly>${escapeHtml(message)}</textarea>
      </article>`;
  }).join("");
}

function syncSellerZoneFilter(rows) {
  if (!zoneOptions || !zonePickerLabel || !selectedZoneChips) return;
  const zones = [...new Set(rows.map(row => normalizeLabel(row.zona)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const validZones = new Set(zones);
  [...state.selectedSellerZones].forEach(zone => {
    if (!validZones.has(zone)) state.selectedSellerZones.delete(zone);
  });
  const selected = selectedSellerZones();
  const search = searchKey(state.zoneSearch);
  const visibleZones = search
    ? zones.filter(zone => searchKey(zone).includes(search))
    : zones;

  if (zoneSearchInput && zoneSearchInput.value !== state.zoneSearch) {
    zoneSearchInput.value = state.zoneSearch;
  }
  zonePickerLabel.textContent = selected.length ? `${fmt.format(selected.length)} zona${selected.length === 1 ? "" : "s"} seleccionada${selected.length === 1 ? "" : "s"}` : "Todas las zonas";
  zoneOptions.innerHTML = visibleZones.length
    ? visibleZones.map(zone => `
      <label class="zoneOption">
        <input type="checkbox" data-zone-option value="${escapeHtml(zone)}" ${state.selectedSellerZones.has(zone) ? "checked" : ""}>
        <span>${escapeHtml(zone)}</span>
      </label>`)
      .join("")
    : `<div class="zoneNoResults">No se encontró esa zona.</div>`;
  selectedZoneChips.innerHTML = selected.length
    ? selected
      .sort((a, b) => a.localeCompare(b))
      .map(zone => `<button type="button" data-remove-zone="${escapeHtml(zone)}">${escapeHtml(shorten(zone, 22))} ×</button>`)
      .join("")
    : `<span>Todas las zonas incluidas</span>`;
}

function toggleZonePicker() {
  if (!zonePickerPanel || !zonePickerButton) return;
  const nextOpen = zonePickerPanel.hidden;
  zonePickerPanel.hidden = !nextOpen;
  zonePickerButton.setAttribute("aria-expanded", String(nextOpen));
  if (nextOpen) {
    zoneSearchInput?.focus();
  }
}

function closeZonePicker() {
  if (!zonePickerPanel || !zonePickerButton) return;
  zonePickerPanel.hidden = true;
  zonePickerButton.setAttribute("aria-expanded", "false");
}

function syncSellerMessageFilter(groups) {
  if (!sellerMessageFilter) return;
  const currentValue = sellerMessageFilter.value;
  sellerMessageFilter.innerHTML = `<option value="">Todos los vendedores</option>` + groups
    .map(group => `<option value="${escapeHtml(group.seller)}">${escapeHtml(group.seller)} (${fmt.format(group.pending.length)})</option>`)
    .join("");
  if ([...sellerMessageFilter.options].some(option => option.value === currentValue)) {
    sellerMessageFilter.value = currentValue;
  }
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    if (button) {
      const previous = button.textContent;
      button.textContent = "Copiado";
      setTimeout(() => { button.textContent = previous; }, 1400);
    }
  } catch (error) {
    window.prompt("Copie el mensaje:", text);
  }
}

function copySellerMessage(seller) {
  const group = sellerMessageGroups(zoneFilteredSellerRows(detail)).find(item => item.seller === seller);
  if (!group) return;
  const button = document.querySelector(`[data-copy-seller="${CSS.escape(seller)}"]`);
  copyText(buildSellerMessage(group), button);
}

function copyAllSellerMessages() {
  const selectedSeller = sellerMessageFilter?.value || "";
  const groups = sellerMessageGroups(zoneFilteredSellerRows(detail)).filter(group => !selectedSeller || group.seller === selectedSeller);
  const text = groups.map(group => buildSellerMessage(group)).join("\n\n-----------------------------\n\n");
  copyText(text, document.getElementById("copyAllSellerMessages"));
}

function sellerPdfHtml(group) {
  const selectedZones = selectedSellerZones();
  const activeThisMonth = group.portfolio.filter(row => row.estado_facturacion === "ACTIVO").length;
  const pendingRows = uniqueCustomerRows(group.pending).sort((a, b) => toNumber(b.promedio_compra) - toNumber(a.promedio_compra) || daysWithoutPurchase(b) - daysWithoutPurchase(a));
  const pendingCount = pendingRows.length;
  const recoveryPotential = recoveryPotentialOf(pendingRows);
  const customersWithHistory = pendingRows.filter(row => toNumber(row.documentos) > 0);
  const averagePotential = customersWithHistory.length ? recoveryPotential / customersWithHistory.length : 0;
  const topCustomers = topInactiveCustomers(pendingRows);
  const zoneLabel = selectedZones.length ? selectedZones.join(", ") : "Todas las zonas";
  const generatedAt = new Date().toLocaleString("es-VE");
  const topCards = topCustomers.map((row, index) => {
    return `<article class="topCard"><div class="topRank">${index + 1}</div><div class="clientFacts"><p>Nombre del cliente: <strong>${escapeHtml(row.cliente)}</strong></p><p>Zona: <strong>${escapeHtml(normalizeLabel(row.zona) || "Sin zona")}</strong></p><p>Última compra: <strong>${escapeHtml(purchaseDateText(row))}</strong></p><p>Días sin comprar: <strong>${row.dias_sin_facturar === "" || row.dias_sin_facturar == null ? "Sin compra registrada" : fmt.format(daysWithoutPurchase(row))}</strong></p><p>Promedio por factura: <strong>${money.format(toNumber(row.promedio_compra))}</strong></p><p>Compra máxima: <strong>${escapeHtml(maximumPurchaseText(row))}</strong></p></div></article>`;
  }).join("") || `<p class="emptyState">No hay clientes con historial de facturación dentro de los filtros elegidos.</p>`;
  const directoryRows = [...pendingRows].sort((a, b) => normalizeLabel(a.zona).localeCompare(normalizeLabel(b.zona)) || daysWithoutPurchase(b) - daysWithoutPurchase(a) || a.cliente.localeCompare(b.cliente));
  const clientCards = directoryRows.map((row, index) => {
    const days = daysWithoutPurchase(row);
    const urgency = !row.ultima_factura ? "neutral" : days <= 60 ? "green" : days <= 90 ? "yellow" : days <= 180 ? "orange" : "red";
    const average = toNumber(row.documentos) ? money.format(toNumber(row.promedio_compra)) : "Sin historial";
    return `<article class="directoryItem ${urgency}"><i></i><span class="directoryNumber">${index + 1}</span><div class="clientFacts"><p>Nombre del cliente: <strong>${escapeHtml(row.cliente)}</strong></p><p>Zona: <strong>${escapeHtml(normalizeLabel(row.zona) || "Sin zona")}</strong></p><p>Última compra: <strong>${escapeHtml(purchaseDateText(row))}</strong></p><p>Días sin comprar: <strong>${row.dias_sin_facturar === "" || row.dias_sin_facturar == null ? "Sin compra registrada" : fmt.format(daysWithoutPurchase(row))}</strong></p><p>Promedio por factura: <strong>${average}</strong></p><p>Compra máxima: <strong>${escapeHtml(maximumPurchaseText(row))}</strong></p></div></article>`;
  }).join("");

  return `<!doctype html>
  <html lang="es">
  <head>
    <meta charset="utf-8">
    <title>Plan de reactivación · ${escapeHtml(group.seller)}</title>
    <style>
      *{box-sizing:border-box}body{margin:0;padding:24px;color:#10231c;font-family:Arial,Helvetica,sans-serif;background:#edf2ed}.page{max-width:1120px;margin:0 auto 24px;background:#fff;border:1px solid #dfe7e2;border-radius:24px;overflow:hidden}.hero{padding:28px 34px;background:radial-gradient(circle at 84% 15%,#315f42 0,transparent 27%),linear-gradient(135deg,#061a13,#0c4230);color:#fff}.eyebrow{margin:0 0 8px;color:#b7f45d;font-size:9px;font-weight:800;letter-spacing:.16em;text-transform:uppercase}.hero h1{margin:0;font-size:32px;line-height:1.03;letter-spacing:-.045em}.hero p{max-width:720px;margin:9px 0 0;color:#c9d8d2;font-size:13px;line-height:1.4}.meta{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;padding:13px 24px;background:#f8faf7;border-bottom:1px solid #dfe7e2}.card{min-height:66px;padding:11px;border:1px solid #dfe7e2;border-radius:12px;background:#fff}.card.potential{border-color:#9ddc63;background:#f2ffe5}.card span{display:block;color:#66766f;font-size:8px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}.card strong{display:block;margin-top:5px;font-size:16px;letter-spacing:-.035em}.content{padding:20px 24px}.note{margin:0 0 15px;padding:10px 13px;border-left:3px solid #9cdf45;border-radius:10px;background:#f2f8ed;color:#184130;font-size:10px;line-height:1.38}.sectionTag{margin:0;color:#16965d;font-size:8px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}.sectionTitle{margin:4px 0;font-size:20px;letter-spacing:-.04em}.sectionSub{margin:0 0 10px;color:#66766f;font-size:10px}.topGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 9px}.topCard{display:flex;align-items:center;gap:8px;min-height:43px;padding:8px 9px;border:1px solid #e0e8e2;border-radius:10px;background:#fbfdf9;break-inside:avoid}.topRank{display:grid;place-items:center;flex:0 0 23px;height:23px;border-radius:7px;background:#0d3a2b;color:#b7f45d;font-weight:800;font-size:10px}.topMain{min-width:0;flex:1}.topMain strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px}.topMain span{display:block;margin-top:2px;color:#66766f;font-size:8px}.bar{height:3px;margin-top:5px;overflow:hidden;border-radius:999px;background:#e5eee6}.bar i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#2abd72,#9cdf45)}.topValue{text-align:right;white-space:nowrap}.topValue b{display:block;font-size:10px}.topValue span,.topValue small{display:block;color:#66766f;font-size:7px}.topValue small{margin-top:2px}.detailBreak{page-break-before:always}.detailHeader{display:flex;justify-content:space-between;gap:12px;align-items:end;margin-bottom:5px}.detailHeader h2{margin:2px 0 0;font-size:17px;letter-spacing:-.035em}.detailHeader p{margin:0;color:#66766f;font-size:7px;text-align:right}.directoryLegend{display:flex;gap:9px;align-items:center;margin:0 0 4px;padding:4px 7px;border-radius:5px;background:#f7f9f6;color:#66766f;font-size:6.5px}.directoryLegend span{display:flex;gap:3px;align-items:center}.directoryLegend i{width:5px;height:5px;border-radius:50%}.directoryLegend .g{background:#22a96b}.directoryLegend .y{background:#d3a218}.directoryLegend .o{background:#ea7b24}.directoryLegend .r{background:#d9473f}.directoryLegend .n{background:#8b9891}.directoryGrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));column-gap:8px;row-gap:0}.directoryItem{position:relative;display:grid;grid-template-columns:2px 15px minmax(0,1fr) auto;gap:4px;align-items:center;min-height:27px;padding:3px 2px;border:0;border-bottom:1px solid #e6ece8;border-radius:0;background:#fff;break-inside:avoid;page-break-inside:avoid}.directoryItem:nth-child(8n+1),.directoryItem:nth-child(8n+2),.directoryItem:nth-child(8n+3),.directoryItem:nth-child(8n+4){background:#fafcf9}.directoryItem>i{align-self:stretch;border-radius:99px;background:#8b9891}.directoryItem.green>i{background:#22a96b}.directoryItem.yellow>i{background:#d3a218}.directoryItem.orange>i{background:#ea7b24}.directoryItem.red>i{background:#d9473f}.directoryNumber{color:#728078;font-size:6px;text-align:center}.directoryMain{min-width:0}.directoryMain strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:7.2px;line-height:1.12}.directoryMain small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px;color:#66766f;font-size:6.1px;line-height:1.1}.directoryValue{text-align:right;white-space:nowrap}.directoryValue b{display:block;font-size:7px}.directoryValue small{display:block;color:#718078;font-size:5.3px}.emptyState{color:#66766f;font-size:11px}.footer{padding:5px 24px;color:#66766f;font-size:6.5px;border-top:1px solid #dfe7e2}@page{size:A4 landscape;margin:5mm}@media(max-width:720px){body{padding:0}.page{border-radius:0}.meta,.topGrid,.directoryGrid{grid-template-columns:1fr}.hero,.content{padding:20px}.meta{padding:14px}.detailHeader{display:block}.detailHeader p{text-align:left;margin-top:5px}}@media print{body{padding:0;background:#fff}.page{border:0;border-radius:0;box-shadow:none;max-width:none;margin:0;overflow:visible}.coverPage{page-break-after:always}.directoryPage .content{padding:8px 10px}.hero{-webkit-print-color-adjust:exact;print-color-adjust:exact}.meta,.card,.topCard,.directoryItem,.note,.directoryLegend{-webkit-print-color-adjust:exact;print-color-adjust:exact}.detailBreak{page-break-before:always}.directoryGrid{grid-template-columns:repeat(4,minmax(0,1fr))}button{display:none}}
      /* Directorio legible: equilibrio entre cantidad de páginas y lectura rápida. */
      .directoryGrid{grid-template-columns:repeat(3,minmax(0,1fr));column-gap:11px;row-gap:2px}
      .directoryItem{grid-template-columns:3px 19px minmax(0,1fr) auto;gap:6px;min-height:34px;padding:4px 5px 4px 2px;border-bottom-color:#dfe7e2}
      .directoryItem:nth-child(8n+1),.directoryItem:nth-child(8n+2),.directoryItem:nth-child(8n+3),.directoryItem:nth-child(8n+4){background:#fff}
      .directoryItem:nth-child(6n+1),.directoryItem:nth-child(6n+2),.directoryItem:nth-child(6n+3){background:#f9fbf8}
      .directoryNumber{font-size:7.5px;font-weight:700}
      .directoryMain strong{font-size:9px;line-height:1.18}
      .directoryMain small{margin-top:2px;font-size:7.4px;line-height:1.12}
      .directoryValue b{font-size:8.5px}
      .directoryValue small{font-size:6.5px}
      .topGrid{grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
      .topCard{display:grid;grid-template-columns:30px minmax(0,1fr);align-items:start;min-height:0;padding:13px;border-color:#e4e9e5;border-radius:12px;background:#fff}
      .directoryGrid{column-gap:13px;row-gap:7px}
      .directoryItem{grid-template-columns:3px 23px minmax(0,1fr);align-items:start;min-height:0;padding:10px 8px 10px 3px;border:1px solid #e4e9e5;border-radius:9px;background:#fff}
      .directoryItem:nth-child(6n+1),.directoryItem:nth-child(6n+2),.directoryItem:nth-child(6n+3){background:#fff}
      .clientFacts{min-width:0}
      .clientFacts p{margin:0 0 4px;color:#66746d;font-size:10.2px;font-weight:400;line-height:1.32}
      .clientFacts p:last-child{margin-bottom:0}
      .clientFacts strong{color:#3f4a45;font-size:10.6px;font-weight:800}
      .topRank{width:26px;height:26px;font-size:11.5px}
      .directoryNumber{padding-top:2px;font-size:9.5px}
      @media print{
        .meta{grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;padding:11px 16px}
        .card{min-height:58px;padding:9px 10px}
        .topGrid{grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}
        .topCard{min-height:0;padding:12px}
        .clientFacts p{font-size:10px;line-height:1.3}
        .clientFacts strong{font-size:10.4px}
        .directoryGrid{grid-template-columns:repeat(3,minmax(0,1fr))}
      }
    </style>
  </head>
  <body>
    <section class="page coverPage">
      <div class="hero">
        <p class="eyebrow">BIPA Cartera Inteligente · Plan de activación mensual</p>
        <h1>${escapeHtml(group.seller)}</h1>
        <p>Una guía comercial para enfocar clientes que, en promedio, realizan compras de mayor valor cuando se reactivan.</p>
      </div>
      <div class="meta">
        <div class="card"><span>Total cartera</span><strong>${fmt.format(group.portfolio.length)}</strong></div>
        <div class="card"><span>Activos en el mes</span><strong>${fmt.format(activeThisMonth)}</strong></div>
        <div class="card"><span>Pendientes</span><strong>${fmt.format(pendingCount)}</strong></div>
        <div class="card potential"><span>Oportunidad de venta total</span><strong>${money.format(recoveryPotential)}</strong></div>
        <div class="card"><span>Zonas filtradas</span><strong>${selectedZones.length ? fmt.format(selectedZones.length) : "Todas"}</strong></div>
      </div>
      <div class="content">
        <p class="note"><strong>Oportunidad de próxima venta en total:</strong> ${money.format(recoveryPotential)}.<br><strong>Promedio por cliente con historial:</strong> ${money.format(averagePotential)}.<br><strong>Zonas incluidas:</strong> ${escapeHtml(zoneLabel)}.</p>
        <p class="sectionTag">Oportunidades prioritarias</p>
        <h2 class="sectionTitle">Top 10 oportunidades por promedio de compra</h2>
        <p class="sectionSub">Ordenados por el valor promedio de una factura, no por el histórico acumulado.</p>
        <div class="topGrid">${topCards}</div>
      </div>
    </section>
    <section class="page directoryPage">
      <div class="content">
        <div class="detailHeader"><div><p class="sectionTag">Directorio comercial</p><h2>Todos los clientes por reactivar</h2></div><p>${fmt.format(pendingCount)} clientes únicos · Ordenados por zona y antigüedad</p></div>
        <div class="directoryLegend"><strong>Tiempo sin comprar:</strong><span><i class="g"></i>Hasta 60 días</span><span><i class="y"></i>61–90</span><span><i class="o"></i>91–180</span><span><i class="r"></i>Más de 180</span><span><i class="n"></i>Sin historial</span></div>
        <div class="directoryGrid">${clientCards}</div>
      </div>
      <div class="footer">BIPA Cartera Inteligente · Plan de activación comercial · Actualizado el ${escapeHtml(generatedAt)}.</div>
    </section>
    <script>window.addEventListener("load",()=>setTimeout(()=>window.print(),250));<\/script>
  </body>
  </html>`;
}

function downloadSellerPdf(seller) {
  const group = sellerMessageGroups(zoneFilteredSellerRows(detail)).find(item => item.seller === seller);
  if (!group) return;
  const popup = window.open("", "_blank");
  if (!popup) {
    window.alert("El navegador bloqueó la ventana del PDF. Permita ventanas emergentes para descargarlo.");
    return;
  }
  popup.document.open();
  popup.document.write(sellerPdfHtml(group));
  popup.document.close();
}

function renderDetailPanel(rows) {
  const selectedRow = rows.find(r => r.codigo === state.selectedClient);

  if (!selectedRow) {
    detailPanel.classList.remove("visible");
    detailClientTitle.textContent = "Selecciona un cliente para revisar su situación.";
    detailClientContent.innerHTML = "";
    return;
  }

  detailPanel.classList.add("visible");
  detailClientTitle.textContent = `${selectedRow.cliente}`;
  detailClientContent.innerHTML = `
    <div class="detailHeader">
      <span class="statusPill ${selectedRow.estado_facturacion === "ACTIVO" ? "active" : "inactive"}">${selectedRow.estado_facturacion === "ACTIVO" ? "ACTIVO" : "INACTIVO"}</span>
      <span class="assignmentPill ${selectedRow.estado_asignacion === "VACANTE" ? "vacant" : "confirmed"}">${selectedRow.estado_asignacion === "VACANTE" ? "VACANTE / POR CONFIRMAR" : "VENDEDOR CONFIRMADO"}</span>
      <span class="segmentPill">${escapeHtml(simpleSegment(selectedRow.segmento))}</span>
    </div>
    <div class="detailMetrics">
      <div><label>Vendedor</label><strong>${escapeHtml(normalizeLabel(selectedRow.vendedor) || "-")}</strong></div>
      <div><label>Asignación</label><strong>${selectedRow.estado_asignacion === "VACANTE" ? "Vacante / por confirmar" : "Vendedor confirmado"}</strong></div>
      <div><label>Zona</label><strong>${escapeHtml(normalizeLabel(selectedRow.zona) || "-")}</strong></div>
      <div><label>Tipo</label><strong>${escapeHtml(normalizeLabel(selectedRow.tipo_cliente) || "-")}</strong></div>
      <div><label>Última compra</label><strong>${selectedRow.ultima_factura || "-"}</strong></div>
      <div><label>Monto última factura</label><strong>${selectedRow.ultima_factura ? money.format(Number(selectedRow.monto_ultima_factura) || 0) : "-"}</strong></div>
      <div><label>Promedio por compra</label><strong>${selectedRow.documentos ? money.format(Number(selectedRow.promedio_compra) || 0) : "-"}</strong></div>
      <div><label>Mayor compra registrada</label><strong>${escapeHtml(maximumPurchaseText(selectedRow))}</strong></div>
      <div><label>Días sin comprar</label><strong>${formatDaysWithoutPurchase(selectedRow)}</strong></div>
      <div><label>Histórico anual</label><strong>${money.format(Number(selectedRow.venta_total) || 0)}</strong></div>
      <div><label>Saldo total</label><strong>${money.format(Number(selectedRow.saldo_total) || 0)}</strong></div>
      <div><label>Saldo vencido</label><strong>${money.format(Number(selectedRow.saldo_vencido) || 0)}</strong></div>
    </div>
    <div class="detailAdvice">
      <h3>Recomendación operativa</h3>
      <p>${selectedRow.estado_asignacion === "VACANTE" ? "Primero confirmar vendedor responsable. Luego revisar seguimiento comercial y activación." : selectedRow.estado_facturacion === "ACTIVO" ? "Cliente con movimiento reciente. Mantener relación y reforzar venta complementaria." : selectedRow.segmento === "NUNCA FACTURADO" ? "Cliente sin facturación en el periodo. Priorizar activación con contacto comercial y revisión de cartera." : "Cliente con historial previo pero sin movimiento reciente. Enviar seguimiento y evaluar posible reactivación."}</p>
    </div>
  `;
}

function downloadCSV() {
  const rows = currentRows();
  const headers = ["codigo","cliente","vendedor","estado_asignacion","activo_hoja_clientes","zona","tipo_cliente","estado_facturacion","segmento","primera_factura","ultima_factura","dias_sin_facturar","monto_ultima_factura","promedio_compra","monto_maximo_factura","documentos","lineas_duplicadas_omitidas","venta_total","saldo_total"];
  const csv = [headers.join(",")].concat(rows.map(row => headers.map(h => {
    const value = h === "dias_sin_facturar" ? formatDaysWithoutPurchase(row) : row[h] ?? "";
    return `"${String(value).replaceAll('"', '""')}"`;
  }).join(","))).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "clientes_filtrados.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function shorten(text, n) {
  text = String(text || "");
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
}

function simpleSegment(segment) {
  const labels = {
    "NUNCA FACTURADO": "Nunca compró en el periodo",
    "ACTIVO 0-30 DIAS": "Compró hace 0-30 días",
    "RIESGO 31-60 DIAS": "Sin compra hace 31-60 días",
    "INACTIVO 61-90 DIAS": "Sin compra hace 61-90 días",
    "DORMIDO 91-180 DIAS": "Sin compra hace 91-180 días",
    "PERDIDO MAS DE 180 DIAS": "Sin compra hace más de 180 días",
  };
  return labels[segment] || segment;
}

function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function showDataLoadMessage(title, message) {
  const headline = document.getElementById("executiveHeadline");
  const text = document.getElementById("executiveText");
  const period = document.getElementById("periodText");
  if (headline) headline.textContent = title;
  if (text) text.textContent = message;
  if (period) period.textContent = "Sin datos cargados";
  setLiveStatus("error", "Sin conexion a Google Sheets", message || "No se pudo leer la informacion en vivo.");
}

function setLiveStatus(kind, label, detailText = "") {
  const badge = document.getElementById("liveBadge");
  const badgeText = document.getElementById("liveBadgeText");
  const updated = document.getElementById("dataUpdatedAt");
  if (badge) badge.className = `liveBadge ${kind}`;
  if (badgeText) badgeText.textContent = label;
  if (updated && detailText) updated.textContent = detailText;
}

function validateRemotePayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Google Sheets no devolvio un paquete de datos valido.");
  }
  if (!Array.isArray(payload.detail) || !payload.detail.length) {
    throw new Error("Google Sheets respondio, pero no envio clientes para analizar.");
  }
  return payload;
}

function applyData(payload, source = "remote") {
  if (!payload || !Array.isArray(payload.detail) || !payload.detail.length) return false;
  data = payload;
  detail = payload.detail || [];
  const generated = payload.generated_at ? new Date(payload.generated_at) : null;
  if (source === "remote") {
    const generatedText = generated && !Number.isNaN(generated.getTime())
      ? `Lectura en vivo: ${generated.toLocaleString("es-VE", { dateStyle: "short", timeStyle: "short" })}`
      : "Lectura en vivo desde Google Sheets";
    setLiveStatus("live", "Conectado a Google Sheets", generatedText);
  }
  refreshFilterOptions();
  render();
  return true;
}

async function fetchJsonWithTimeout(url, timeout = 6500, forceRefresh = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const separator = url.includes("?") ? "&" : "?";
    const forceParam = forceRefresh ? "&force=1" : "";
    const response = await fetch(`${url}${separator}t=${Date.now()}${forceParam}`, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`Respuesta ${response.status}`);
    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();
    if (contentType.includes("text/html") || text.trim().startsWith("<!DOCTYPE html") || text.trim().startsWith("<html")) {
      throw new Error("El enlace de Apps Script devolvio una pagina de Google, no datos. Revise permisos y despliegue.");
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

function loadJsonpWithTimeout(url, timeout = 8500, forceRefresh = false) {
  return new Promise((resolve, reject) => {
    const callbackName = `bipaData_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const separator = url.includes("?") ? "&" : "?";
    const script = document.createElement("script");
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Tiempo de espera agotado leyendo Google Sheets"));
    }, timeout);

    function cleanup() {
      clearTimeout(timer);
      delete window[callbackName];
      script.remove();
    }

    window[callbackName] = payload => {
      cleanup();
      resolve(payload);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("El enlace de Apps Script no pudo cargarse como datos publicos."));
    };
    const forceParam = forceRefresh ? "&force=1" : "";
    script.src = `${url}${separator}callback=${encodeURIComponent(callbackName)}&t=${Date.now()}${forceParam}`;
    document.head.appendChild(script);
  });
}

async function readRemotePayload(forceRefresh = false) {
  try {
    return validateRemotePayload(await loadJsonpWithTimeout(REMOTE_DATA_URL, REMOTE_REQUEST_TIMEOUT_MS, forceRefresh));
  } catch (jsonpError) {
    try {
      return validateRemotePayload(await fetchJsonWithTimeout(REMOTE_DATA_URL, REMOTE_REQUEST_TIMEOUT_MS, forceRefresh));
    } catch (jsonError) {
      const message = jsonpError?.message || jsonError?.message || "No se pudo leer Google Sheets.";
      throw new Error(message);
    }
  }
}

async function refreshFromRemote(forceRefresh = false) {
  if (!REMOTE_DATA_URL || isRefreshingRemote) return false;
  isRefreshingRemote = true;
  try {
    const payload = await readRemotePayload(forceRefresh);
    return applyData(payload, "remote");
  } catch (error) {
    console.warn("No se pudo actualizar desde Google Sheets.", error);
    window.BIPA_LAST_REMOTE_ERROR = error?.message || String(error);
    setLiveStatus("error", "Sin conexion a Google Sheets", window.BIPA_LAST_REMOTE_ERROR);
    return false;
  } finally {
    isRefreshingRemote = false;
  }
}

async function boot() {
  const refreshButton = document.getElementById("dataRefreshButton");
  if (refreshButton) refreshButton.addEventListener("click", async () => {
    refreshButton.disabled = true;
    refreshButton.textContent = "Actualizando…";
    setLiveStatus("loading", "Consultando Google Sheets…", "Espere un momento mientras se lee la hoja.");
    const ok = await refreshFromRemote(true);
    if (!ok) setLiveStatus("error", "No se pudo actualizar", window.BIPA_LAST_REMOTE_ERROR || "Revise la publicacion del Apps Script y vuelva a intentar.");
    refreshButton.disabled = false;
    refreshButton.textContent = "Actualizar datos ahora";
  });
  setLiveStatus("loading", "Conectando con Google Sheets", "Leyendo toda la cartera y facturacion. La primera lectura puede tardar hasta 2 minutos.");
  const remoteLoadedFirst = await refreshFromRemote();
  if (!remoteLoadedFirst) {
    data = { start: "", cutoff: "", detail: [] };
    detail = [];
    refreshFilterOptions();
    showDataLoadMessage(
      "No se pudo conectar con Google Sheets.",
      window.BIPA_LAST_REMOTE_ERROR || "Revise que el Apps Script este publicado como Web App para cualquier persona."
    );
  }
  window.setInterval(() => {
    refreshFromRemote();
  }, LIVE_REFRESH_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshFromRemote();
  });
}

applyViewMode(false);
boot();
