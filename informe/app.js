/* BIPA · Informe gerencial — interfaz.
   Abre el mismo data.enc del portal con la misma clave (si el portal ya está
   desbloqueado en este dispositivo, reutiliza su llave), arma el informe con los
   filtros elegidos y lo entrega como vista previa, PDF o texto para WhatsApp. */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const te = new TextEncoder();
  const DATA_URL = "../data.enc";
  const MODULE = "activacion";
  const PREFS = "bipa:informe";

  /* ---------- Formatos ---------- */
  const nf0 = new Intl.NumberFormat("es-VE", { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat("es-VE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nf2 = new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt = {
    money: (v) => `$${nf2.format(v || 0)}`,
    moneyShort: (v) => { const a = Math.abs(v || 0); return a >= 1e6 ? `$${nf1.format(v / 1e6)} M` : a >= 1e4 ? `$${nf1.format(v / 1e3)} k` : `$${nf0.format(v || 0)}`; },
    int: (v) => nf0.format(v || 0),
    pct: (v) => (v == null || !Number.isFinite(v) ? "-" : `${nf1.format(v)}%`),
    kg: (v) => `${nf0.format(v || 0)} kg`,
    date: (d) => d.toLocaleDateString("es-VE", { day: "2-digit", month: "2-digit", year: "numeric" }),
    dateTime: (d) => `${d.toLocaleDateString("es-VE", { day: "2-digit", month: "2-digit", year: "numeric" })} ${d.toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" })}`,
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
  };

  /* ---------- Cifrado (mismo esquema que el portal) ---------- */
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const toB64 = (buf) => { const u = new Uint8Array(buf); let s = ""; for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode(...u.subarray(i, i + 32768)); return btoa(s); };
  async function deriveKey(pass) {
    const salt = new Uint8Array(await crypto.subtle.digest("SHA-256", te.encode(`bipa-workspace:${MODULE}`))).slice(0, 16);
    const base = await crypto.subtle.importKey("raw", te.encode(String(pass).normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 310000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  }
  let packageBytes = null;
  async function fetchPackage() {
    if (packageBytes) return packageBytes;
    const r = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`No se pudo descargar el paquete de datos (${r.status}).`);
    packageBytes = new Uint8Array(await r.arrayBuffer());
    return packageBytes;
  }
  async function openPackage(key) {
    const bytes = await fetchPackage();
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12) }, key, bytes.subarray(12));
    const text = await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.detail) || !data.detail.length) throw new Error("El paquete de datos no trae clientes para analizar.");
    return data;
  }

  /* ---------- Estado ---------- */
  let DATA = null, INFO = null, MODEL = null, LOGO = null;

  async function start() {
    const saved = store.get("bipa:key");
    if (saved) {
      try {
        const key = await crypto.subtle.importKey("raw", b64(saved), "AES-GCM", true, ["encrypt", "decrypt"]);
        DATA = await openPackage(key);
        return ready();
      } catch (e) { /* la llave guardada no abre estos datos: pedir la clave */ }
    }
    showLock();
  }

  function showLock() {
    $("#loading").hidden = true;
    $("#lock").hidden = false;
    $("#lockPass").focus();
    $("#lockForm").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const btn = $("#lockBtn"), msg = $("#lockMsg");
      const pass = $("#lockPass").value;
      if (!pass) return;
      btn.disabled = true; btn.textContent = "Abriendo…"; msg.textContent = "";
      try {
        const key = await deriveKey(pass);
        DATA = await openPackage(key);
        store.set("bipa:key", toB64(await crypto.subtle.exportKey("raw", key)));
        $("#lock").hidden = true;
        ready();
      } catch (e) {
        msg.textContent = e && e.name === "OperationError" ? "La clave no es correcta." : (e.message || "No se pudieron abrir los datos.");
        btn.disabled = false; btn.textContent = "Entrar";
        $("#lockPass").select();
      }
    });
  }

  /* ---------- Formulario ---------- */
  function fillSelect(sel, values, all) {
    sel.innerHTML = `<option value="">${esc(all)}</option>` + values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
  }
  function readOptions() {
    const v = (id) => $(id).value;
    return {
      audience: v("#fAudience"), seller: v("#fSeller"), zone: v("#fZone"), type: v("#fType"), assignment: v("#fAssign"),
      period: v("#fPeriod"), from: v("#fFrom"), to: v("#fTo"), depth: document.querySelector("input[name=depth]:checked").value,
      dropAlert: +v("#fDrop") || 10, riskDays: +v("#fRisk") || 30, topN: +v("#fTop") || 10, freight: $("#fFreight").checked,
    };
  }
  function applyPrefs() {
    let p = {};
    try { p = JSON.parse(store.get(PREFS) || "{}"); } catch { p = {}; }
    const set = (id, val) => { if (val != null && $(id)) $(id).value = val; };
    set("#fAudience", p.audience); set("#fPeriod", p.period); set("#fDrop", p.dropAlert); set("#fRisk", p.riskDays); set("#fTop", p.topN);
    if (p.depth) { const r = document.querySelector(`input[name=depth][value=${p.depth}]`); if (r) r.checked = true; }
  }
  function savePrefs(o) { store.set(PREFS, JSON.stringify({ audience: o.audience, period: o.period, depth: o.depth, dropAlert: o.dropAlert, riskDays: o.riskDays, topN: o.topN })); }

  function ready() {
    INFO = BipaInforme.describeData(DATA);
    $("#loading").hidden = true; $("#app").hidden = false;
    $("#cutText").textContent = INFO.cut ? `Datos al ${fmt.date(INFO.cut)}` : "Datos sin fecha de corte";
    fillSelect($("#fSeller"), INFO.sellers, "Todos los vendedores");
    fillSelect($("#fZone"), INFO.zones, "Todas las zonas");
    fillSelect($("#fType"), INFO.types, "Todos los tipos");
    const monthOpts = INFO.months.map((m) => `<option value="${m}">${esc(BipaInforme.monthShort(m))}</option>`).join("");
    $("#fFrom").innerHTML = monthOpts; $("#fTo").innerHTML = monthOpts;
    $("#fFrom").value = INFO.months[Math.max(0, INFO.months.length - 3)] || ""; $("#fTo").value = INFO.last || "";
    applyPrefs();
    $("#form").addEventListener("input", refresh);
    $("#form").addEventListener("change", refresh);
    $("#form").addEventListener("submit", (e) => e.preventDefault());
    $("#pdfBtn").addEventListener("click", makePdf);
    $("#waBtn").addEventListener("click", copyWhatsapp);
    refresh();
    loadLogo();
  }

  function refresh() {
    const o = readOptions();
    const isSeller = o.audience === "vendedor";
    $("#fSeller").closest(".field").classList.toggle("highlight", isSeller);
    if (isSeller && !o.seller && INFO.sellers.length) { $("#fSeller").value = INFO.sellers[0]; o.seller = INFO.sellers[0]; }
    $("#rangeFields").hidden = o.period !== "rango";
    savePrefs(o);
    MODEL = BipaInforme.build(DATA, o, fmt);
    renderPreview(MODEL);
  }

  /* ---------- Vista previa ---------- */
  function renderPreview(m) {
    const k = m.kpis;
    const chg = (c) => (c == null ? `<span class="muted">sin comparación</span>` : `<span class="${c <= -m.options.dropAlert ? "down" : c >= m.options.dropAlert ? "up" : "muted"}">${c >= 0 ? "▲" : "▼"} ${fmt.pct(Math.abs(c))}</span>`);
    $("#pvTitle").textContent = m.periodLabel;
    $("#pvMeta").textContent = [`Para: ${m.audience.label}${m.options.seller ? ` · ${m.options.seller}` : ""}`, m.filters.length ? m.filters.join(" · ") : "Toda la cartera", m.compareLabel ? `Compara con ${m.compareLabel.toLowerCase()}` : "Sin periodo anterior para comparar"].join("  ·  ");
    $("#pvKpis").innerHTML = [
      ["Venta", fmt.moneyShort(k.sales), m.partial ? `<span class="muted">proyección ${fmt.moneyShort(m.projection.value)}</span>` : chg(k.salesChange)],
      ["Compraron", fmt.int(k.buyers), `<span class="muted">${fmt.pct(k.effectiveness)} de ${fmt.int(k.cartera)}</span>`],
      ["Saldo vencido", fmt.moneyShort(k.vencido), `<span class="${k.vencidoShare >= 30 ? "down" : "muted"}">${fmt.pct(k.vencidoShare)} del saldo</span>`],
      ["Ticket promedio", fmt.money(k.ticket), chg(k.ticketChange)],
    ].map(([l, v, s]) => `<div class="kpi"><span>${l}</span><strong>${v}</strong><small>${s}</small></div>`).join("");
    const max = Math.max(1, ...m.trend.map((t) => t.v));
    $("#pvChart").innerHTML = m.trend.map((t) => `<div class="bar ${t.inP ? "p" : t.inC ? "c" : ""}" title="${esc(t.label)}: ${esc(fmt.money(t.v))}"><i style="height:${Math.max(2, (t.v / max) * 100)}%"></i><em>${esc(t.label)}</em></div>`).join("");
    $("#pvConclusions").innerHTML = m.conclusions.map((c) => `<li class="t-${c.tone}">${esc(c.text)}</li>`).join("");
    $("#pvActions").innerHTML = m.actions.length
      ? m.actions.map((a) => `<li><div><b>${esc(a.who)}</b><p>${esc(a.text)}</p></div>${a.value != null ? `<strong>${esc(fmt.moneyShort(a.value))}<small>${esc(a.valueLabel || "")}</small></strong>` : ""}</li>`).join("")
      : `<li><p>No hay acciones urgentes con estos filtros.</p></li>`;
    const pages = m.options.depth === "ejecutivo" ? "1 página" : m.options.depth === "completo" ? "informe completo con anexos" : "informe estándar";
    $("#pdfHint").textContent = `Se generará un ${pages} con las cifras que ve aquí.`;
  }

  /* ---------- Logo para el PDF ---------- */
  function loadLogo() {
    const img = new Image();
    img.onload = () => {
      try {
        const w = 120, h = Math.round((img.naturalHeight / img.naturalWidth) * w) || 60;
        const cv = document.createElement("canvas"); cv.width = w * 3; cv.height = h * 3;
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        LOGO = { data: cv.toDataURL("image/png"), w, h };
      } catch { LOGO = null; }
    };
    img.src = "../logo.svg";
  }

  /* ---------- PDF ---------- */
  function makePdf() {
    const btn = $("#pdfBtn");
    btn.disabled = true; const label = btn.innerHTML; btn.textContent = "Generando…";
    setTimeout(() => {
      try {
        const doc = BipaInformePdf.makePdf(MODEL, fmt, LOGO);
        const slug = MODEL.P.length ? `${MODEL.P[0]}${MODEL.P.length > 1 ? `_a_${MODEL.P[MODEL.P.length - 1]}` : ""}` : "periodo";
        const who = MODEL.options.seller ? `_${MODEL.options.seller.split(/\s+/)[0].toLowerCase()}` : "";
        doc.save(`BIPA_informe_gerencial_${slug}${who}.pdf`);
        toast("Informe descargado");
      } catch (e) {
        console.error(e); toast("No se pudo generar el PDF. Recargue la página e intente de nuevo.", true);
      } finally { btn.disabled = false; btn.innerHTML = label; }
    }, 30);
  }

  /* ---------- Resumen para WhatsApp ---------- */
  function whatsappText(m) {
    const k = m.kpis;
    const c = (v) => (v == null ? "" : ` (${v >= 0 ? "+" : "-"}${fmt.pct(Math.abs(v))})`);
    const lines = [
      `*BIPA · Resumen gerencial*`,
      `${m.periodLabel}${m.filters.length ? ` · ${m.filters.join(" · ")}` : ""}`,
      ``,
      `• Venta: ${fmt.money(k.sales)}${c(k.salesChange)}`,
      `• Compraron: ${fmt.int(k.buyers)} de ${fmt.int(k.cartera)} clientes (${fmt.pct(k.effectiveness)})`,
      `• Saldo vencido: ${fmt.money(k.vencido)} (${fmt.pct(k.vencidoShare)} del saldo)`,
    ];
    if (m.hasC && k.lost) lines.push(`• Dejaron de comprar: ${fmt.int(k.lost)} clientes (${fmt.money(k.lostMonthly)}/mes)`);
    if (m.actions.length) { lines.push("", "*Acciones:*"); m.actions.slice(0, 3).forEach((a) => lines.push(`- ${a.text}${a.value != null ? ` (${fmt.moneyShort(a.value)})` : ""}`)); }
    lines.push("", INFO.cut ? `_Datos al ${fmt.date(INFO.cut)}_` : "");
    return lines.join("\n").trim();
  }
  async function copyWhatsapp() {
    const text = whatsappText(MODEL);
    try { await navigator.clipboard.writeText(text); toast("Resumen copiado. Péguelo en WhatsApp."); }
    catch { const ta = $("#waFallback"); ta.hidden = false; ta.value = text; ta.select(); toast("Seleccione el texto y cópielo.", true); }
  }

  let toastTimer = null;
  function toast(text, warn) {
    const t = $("#toast"); t.textContent = text; t.className = warn ? "toast warn" : "toast"; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  window.addEventListener("error", () => { const l = $("#loading"); if (l && !l.hidden) l.textContent = "No se pudo cargar el informe. Recargue la página."; });
  start().catch((e) => { $("#loading").textContent = e.message || "No se pudieron abrir los datos."; });
})();
