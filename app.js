const REMOTE_DATA_URL = "";

let data = window.ACTIVATION_DATA || null;
let detail = data ? data.detail || [] : [];
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
const state = { selectedClient: null };

const fmt = new Intl.NumberFormat("es-VE", { maximumFractionDigits: 0 });
const money = new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

function unique(field) {
  return [...new Set(detail.map(row => normalizeLabel(row[field])).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function fillSelect(select, values) {
  select.innerHTML = `<option value="">Todos</option>` + values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
}

fillSelect(filters.seller, unique("vendedor"));
fillSelect(filters.zone, unique("zona"));
fillSelect(filters.type, unique("tipo_cliente"));
fillSelect(filters.segment, unique("segmento"));

Object.values(filters).forEach(el => el.addEventListener("input", render));
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
  renderClientTable(rows.slice().sort((a, b) => daysWithoutPurchase(b) - daysWithoutPurchase(a)).slice(0, 500));
  renderDetailPanel(rows);
  bindTooltipTargets();
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
    [...byMonth.values()].filter(r => r.clientes).sort((a, b) => a.name.localeCompare(b.name)),
    false,
    r => `${fmt.format(r.clientes)} clientes compraron`
  );
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
  document.getElementById("detailCaption").textContent = `Mostrando ${fmt.format(rows.length)} clientes. Esta tabla sirve para decidir a quién llamar, visitar o reasignar.`;
  clientTableEl.innerHTML = `
    <thead><tr><th>Cliente</th><th>Vendedor</th><th>Asignación</th><th>Zona</th><th>Tipo</th><th>Situación</th><th>Tiempo sin compra</th><th class="num">Días sin comprar</th><th>Última compra</th><th class="num">Venta</th></tr></thead>
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
        <td class="num">${money.format(Number(r.venta_total) || 0)}</td>
      </tr>`).join("")}</tbody>`;
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
      <div><label>Días sin comprar</label><strong>${formatDaysWithoutPurchase(selectedRow)}</strong></div>
      <div><label>Venta total</label><strong>${money.format(Number(selectedRow.venta_total) || 0)}</strong></div>
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
  const headers = ["codigo","cliente","vendedor","estado_asignacion","activo_hoja_clientes","zona","tipo_cliente","estado_facturacion","segmento","primera_factura","ultima_factura","dias_sin_facturar","venta_total","saldo_total"];
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

async function loadData() {
  if (window.ACTIVATION_DATA) {
    data = window.ACTIVATION_DATA;
    detail = data.detail || [];
    return;
  }

  const candidates = [
    ...(REMOTE_DATA_URL ? [REMOTE_DATA_URL] : []),
    "data.json",
    "./data.json",
  ];

  for (const url of candidates) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) continue;
      const payload = await response.json();
      if (payload && Array.isArray(payload.detail)) {
        data = payload;
        detail = payload.detail || [];
        return;
      }
    } catch (error) {
      console.warn(`No se pudo cargar ${url}:`, error);
    }
  }

  console.error("Fallo al cargar datos del portal. Se usará una vista vacía.");
  data = { start: "", cutoff: "", detail: [] };
  detail = [];
}

async function boot() {
  await loadData();
  render();
}

boot();
