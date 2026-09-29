/* BIPA · Informe gerencial — interfaz.
   Abre con la misma clave del portal el paquete 2.0 (datos2.enc: una fila por línea
   de factura, con empresa y producto) y el data.enc del portal. Si hay paquete 2.0 usa
   el motor y el PDF por capítulos; si no, el informe básico. También permite cargar el
   Excel de facturación en el navegador y descargar datos2.enc cifrado para publicarlo. */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const te = new TextEncoder();
  const DATA_URL = "../data.enc";
  const DATA2_URL = "./datos2.enc";
  const MODULE = "activacion";
  const PREFS = "bipa:informe";

  /* ---------- Formatos ---------- */
  const nf0 = new Intl.NumberFormat("es-VE", { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat("es-VE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nf2 = new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt = {
    money: (v) => `${v < 0 ? "-" : ""}$${nf2.format(Math.abs(v || 0))}`,
    moneyShort: (v) => { const a = Math.abs(v || 0), s = v < 0 ? "-" : ""; return a >= 1e6 ? `${s}$${nf1.format(a / 1e6)} M` : a >= 1e4 ? `${s}$${nf1.format(a / 1e3)} k` : `${s}$${nf0.format(a)}`; },
    signedMoney: (v) => `${v >= 0 ? "+" : "-"}$${nf0.format(Math.abs(v || 0))}`,
    signedPct: (v) => (v == null || !Number.isFinite(v) ? "-" : `${v >= 0 ? "+" : "-"}${nf1.format(Math.abs(v))}%`),
    peso: (v) => `${nf0.format(v || 0)} kg`,
    int: (v) => nf0.format(v || 0),
    pct: (v) => (v == null || !Number.isFinite(v) ? "-" : `${nf1.format(v)}%`),
    kg: (v) => `${nf0.format(v || 0)} kg`,
    date: (d) => d.toLocaleDateString("es-VE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: d.getUTCHours() === 0 && d.getUTCMinutes() === 0 ? "UTC" : undefined }),
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
  async function fetchBytes(url) {
    const r = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return null;
    return new Uint8Array(await r.arrayBuffer());
  }
  let bytesV1 = null, bytesV2 = null, fetched = false;
  async function fetchPackages() {
    if (fetched) return;
    [bytesV1, bytesV2] = await Promise.all([fetchBytes(DATA_URL).catch(() => null), fetchBytes(DATA2_URL).catch(() => null)]);
    fetched = true;
  }
  async function openV1(bytes, key) {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12) }, key, bytes.subarray(12));
    const text = await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.detail) || !data.detail.length) throw new Error("El paquete de datos no trae clientes para analizar.");
    return data;
  }
  // Abre los dos paquetes con la misma llave: datos2.enc (informe 2.0) y data.enc (portal).
  async function openPackages(key) {
    await fetchPackages();
    let ds = null, data = null, err = null;
    if (bytesV2) { try { ds = await BipaDatos.open(bytesV2, key); } catch (e) { err = e; } }
    if (bytesV1) { try { data = await openV1(bytesV1, key); } catch (e) { err = err || e; } }
    if (!ds && !data) throw err || new Error("No se encontró el paquete de datos.");
    return { ds, data };
  }

  /* ---------- Estado ---------- */
  let KEY = null, DATA = null, DS = null, MODE = "v1", INFO = null, MODEL = null, LOGO = null, LOCAL_XLS = false;

  async function start() {
    const saved = store.get("bipa:key");
    if (saved) {
      try {
        const key = await crypto.subtle.importKey("raw", b64(saved), "AES-GCM", true, ["encrypt", "decrypt"]);
        ({ ds: DS, data: DATA } = await openPackages(key));
        KEY = key;
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
        ({ ds: DS, data: DATA } = await openPackages(key));
        KEY = key;
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
    const keep = sel.value;
    sel.innerHTML = `<option value="">${esc(all)}</option>` + values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
    if (values.includes(keep)) sel.value = keep;
  }
  function readOptions() {
    const v = (id) => $(id).value;
    const boxes = [...document.querySelectorAll("#empList input")];
    const checked = boxes.filter((b) => b.checked).map((b) => b.value);
    return {
      audience: v("#fAudience"), seller: v("#fSeller"), zone: v("#fZone"), type: v("#fType"), assignment: v("#fAssign"),
      period: v("#fPeriod"), from: v("#fFrom"), to: v("#fTo"), depth: document.querySelector("input[name=depth]:checked").value,
      dropAlert: +v("#fDrop") || 10, riskDays: +v("#fRisk") || 30, topN: +v("#fTop") || 10, freight: $("#fFreight").checked,
      empresas: checked.length === boxes.length ? [] : checked,
    };
  }
  function loadPrefs() { try { return JSON.parse(store.get(PREFS) || "{}"); } catch { return {}; } }
  function applyPrefs() {
    const p = loadPrefs();
    const set = (id, val) => { if (val != null && $(id)) $(id).value = val; };
    set("#fAudience", p.audience); set("#fPeriod", p.period); set("#fDrop", p.dropAlert); set("#fRisk", p.riskDays); set("#fTop", p.topN);
    if (p.depth) { const r = document.querySelector(`input[name=depth][value=${p.depth}]`); if (r) r.checked = true; }
  }
  function savePrefs(o) { store.set(PREFS, JSON.stringify({ audience: o.audience, period: o.period, depth: o.depth, dropAlert: o.dropAlert, riskDays: o.riskDays, topN: o.topN, empresas: o.empresas })); }

  let wired = false;
  function ready() {
    $("#loading").hidden = true; $("#app").hidden = false;
    setMode(DS ? "v2" : "v1");
    applyPrefs();
    if (!wired) {
      wired = true;
      $("#form").addEventListener("input", refresh);
      $("#form").addEventListener("change", refresh);
      $("#form").addEventListener("submit", (e) => e.preventDefault());
      $("#pdfBtn").addEventListener("click", makePdf);
      $("#waBtn").addEventListener("click", copyWhatsapp);
      $("#xlsBtn").addEventListener("click", makeExcel);
      $("#xlsInput").addEventListener("change", onExcel);
      $("#sealBtn").addEventListener("click", downloadSealed);
      loadLogo();
    }
    refresh();
  }

  // Ajusta el formulario al paquete disponible: 2.0 (con empresas y productos) o el del portal.
  function setMode(mode) {
    MODE = mode;
    const v2 = mode === "v2";
    INFO = v2 ? BipaInforme2.describe(DS) : BipaInforme.describeData(DATA);
    document.body.classList.toggle("v2", v2);
    $("#empBox").hidden = !v2; $("#pvEmpCard").hidden = !v2; $("#xlsBtn").hidden = !v2;
    $("#cutText").textContent = INFO.cut ? `Datos al ${fmt.date(INFO.cut)}${v2 ? " · Informe 2.0" : ""}` : "Datos sin fecha de corte";
    $("#depthStd").textContent = v2 ? "Por capítulos" : "Por secciones";
    fillSelect($("#fSeller"), INFO.sellers, "Todos los vendedores");
    fillSelect($("#fZone"), INFO.zones, "Todas las zonas");
    fillSelect($("#fType"), INFO.types, "Todos los tipos");
    const months = INFO.months;
    const monthOpts = months.map((m) => `<option value="${m}">${esc((v2 ? BipaInforme2 : BipaInforme).monthShort(m))}</option>`).join("");
    const f0 = $("#fFrom").value, t0 = $("#fTo").value;
    $("#fFrom").innerHTML = monthOpts; $("#fTo").innerHTML = monthOpts;
    $("#fFrom").value = months.includes(f0) ? f0 : months[Math.max(0, months.length - 3)] || "";
    $("#fTo").value = months.includes(t0) ? t0 : INFO.last || "";
    if (v2) {
      const saved = loadPrefs().empresas || [];
      $("#empList").innerHTML = INFO.empresas.map((e) => `<label class="check"><input type="checkbox" value="${esc(e)}" ${!saved.length || saved.includes(e) ? "checked" : ""}> ${esc(e)}</label>`).join("");
    }
    renderDataBox();
  }

  function renderDataBox() {
    const st = $("#dataStatus"), hint = $("#dataHint");
    $("#sealBtn").hidden = !(MODE === "v2" && LOCAL_XLS);
    if (MODE === "v2") {
      const dsCut = fmt.date(INFO.cut);
      st.innerHTML = `<b>Informe 2.0 activo</b> · datos al ${esc(dsCut)} · ${esc(fmt.int(INFO.lines))} líneas de factura`;
      let h = LOCAL_XLS
        ? "El Excel se leyó solo en este navegador. Para que todo el equipo vea estos datos, descargue datos2.enc (va cifrado con la clave del equipo) y súbalo a la carpeta informe del repositorio."
        : "Para actualizar, cargue el Excel de facturación más reciente.";
      const portalCut = DATA && DATA.generated_at ? new Date(DATA.generated_at) : null;
      if (portalCut && !LOCAL_XLS && portalCut.getTime() - INFO.cut.getTime() > 3 * 86400000) h = `El portal tiene datos al ${fmt.date(portalCut)}, más recientes que este informe. Cargue el Excel nuevo para actualizarlo.`;
      hint.textContent = h;
    } else {
      st.innerHTML = "<b>Informe básico</b> con los datos del portal";
      hint.textContent = "Cargue el Excel de facturación para activar el informe 2.0: empresas, productos por empresa, precios, cobranza por antigüedad y más.";
    }
  }

  async function onExcel(ev) {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!file) return;
    const st = $("#dataStatus");
    try {
      st.textContent = "Leyendo el Excel…";
      const buf = await file.arrayBuffer();
      const ds = await BipaDatos.buildFromExcel(buf, (msg) => { st.textContent = msg; });
      DS = ds; LOCAL_XLS = true;
      setMode("v2"); refresh();
      toast("Excel cargado. El informe 2.0 ya usa estos datos.");
    } catch (e) {
      console.error(e); renderDataBox();
      toast(e.message || "No se pudo leer el Excel.", true);
    }
  }

  async function downloadSealed() {
    if (!DS || !KEY) return;
    const btn = $("#sealBtn"); btn.disabled = true;
    try {
      const bytes = await BipaDatos.seal(DS, KEY);
      // prueba de ida y vuelta antes de entregar el archivo
      await BipaDatos.open(bytes, KEY);
      downloadBlob(new Blob([bytes], { type: "application/octet-stream" }), "datos2.enc");
      toast("datos2.enc descargado. Súbalo a la carpeta informe del repositorio.");
    } catch (e) { console.error(e); toast("No se pudo cifrar el paquete.", true); }
    finally { btn.disabled = false; }
  }

  function downloadBlob(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function refresh() {
    const o = readOptions();
    const isSeller = o.audience === "vendedor";
    $("#fSeller").closest(".field").classList.toggle("highlight", isSeller);
    if (isSeller && !o.seller && INFO.sellers.length) { $("#fSeller").value = INFO.sellers[0]; o.seller = INFO.sellers[0]; }
    $("#rangeFields").hidden = o.period !== "rango";
    savePrefs(o);
    if (MODE === "v2") {
      if (!o.empresas.length && document.querySelectorAll("#empList input:checked").length === 0) o.empresas = [];
      MODEL = BipaInforme2.build(DS, o, fmt);
      renderPreview2(MODEL);
    } else {
      MODEL = BipaInforme.build(DATA, o, fmt);
      renderPreview(MODEL);
    }
  }

  /* ---------- Vista previa (paquete del portal) ---------- */
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
    $("#pvLegend").innerHTML = `<i class="lp"></i>Periodo del informe <i class="lc"></i>Periodo de comparación`;
    $("#pvConclusions").innerHTML = m.conclusions.map((c) => `<li class="t-${c.tone}">${esc(c.text)}</li>`).join("");
    renderActions(m.actions);
    const pages = m.options.depth === "ejecutivo" ? "1 página" : m.options.depth === "completo" ? "informe completo con anexos" : "informe estándar";
    $("#pdfHint").textContent = `Se generará un ${pages} con las cifras que ve aquí.`;
  }
  function renderActions(actions) {
    $("#pvActions").innerHTML = actions.length
      ? actions.slice(0, 8).map((a) => `<li><div><b>${esc(a.who)}</b><p>${esc(a.text)}</p></div>${a.value != null ? `<strong>${esc(fmt.moneyShort(a.value))}<small>${esc(a.valueLabel || "")}</small></strong>` : ""}</li>`).join("")
      : `<li><p>No hay acciones urgentes con estos filtros.</p></li>`;
  }

  /* ---------- Vista previa 2.0 ---------- */
  function renderPreview2(m) {
    const signed = (c) => (c == null ? "" : `<b class="${c < 0 ? "down" : "up"}">${esc(fmt.signedPct(c))}</b> `);
    $("#pvTitle").textContent = m.periodLabel;
    $("#pvMeta").textContent = [`Para: ${m.audience.label}${m.options.seller ? ` · ${m.options.seller}` : ""}`, m.filters.length ? m.filters.join(" · ") : "Todas las empresas y toda la cartera", m.hasC ? `Compara con ${m.fair ? "los mismos días del mes anterior" : m.compareLabel.toLowerCase()}` : "Sin periodo anterior para comparar"].join("  ·  ");
    $("#pvKpis").innerHTML = m.kpiCards.map((c) => `<div class="kpi tone-${c.tone}"><span>${esc(c.label)}</span><strong>${esc(c.value)}</strong><small>${signed(c.chg)}<span class="muted">${esc(c.sub)}</span></small></div>`).join("");
    const emps = m.empRows, max = Math.max(1, ...m.trend.map((t) => t.v));
    $("#pvChart").innerHTML = m.trend.map((t) => {
      const segs = emps.length > 1 ? emps.map((er, j) => `<i class="e${j}" style="height:${(t.e[er.idx] / max) * 100}%"></i>`).join("") : `<i class="e0" style="height:${Math.max(2, (t.v / max) * 100)}%"></i>`;
      return `<div class="bar stack ${t.inP ? "p" : ""}" title="${esc(t.label)}: ${esc(fmt.money(t.v))}"><span class="stackIn">${segs}</span><em>${esc(t.label)}${t.partial ? "*" : ""}</em></div>`;
    }).join("");
    $("#pvLegend").innerHTML = (emps.length > 1 ? emps.map((e, j) => `<i class="e${j}"></i>${esc(e.name)}`).join(" ") : "") + ` <span class="muted">· Resaltado: periodo del informe${m.info.partial ? " · *mes en curso" : ""}</span>`;
    $("#pvEmp").innerHTML = `<thead><tr><th>Empresa</th><th>Venta</th><th>Var.</th><th>Particip.</th><th>Clientes</th><th>Vencido</th></tr></thead><tbody>${m.empresas.map((e) => `<tr><td>${esc(e.name)}</td><td>${esc(fmt.money(e.p))}</td><td class="${e.chg == null ? "" : e.chg < 0 ? "down" : "up"}">${esc(e.chg == null ? "-" : fmt.signedPct(e.chg))}</td><td>${esc(fmt.pct(e.share))}</td><td>${esc(fmt.int(e.buyers))}</td><td>${esc(fmt.money(e.vencido))}</td></tr>`).join("")}</tbody>`;
    $("#pvConclusions").innerHTML = m.conclusions.slice(0, 6).map((c) => `<li class="t-${c.tone}">${esc(c.text)}</li>`).join("");
    renderActions(m.actions);
    const d = m.options.depth;
    $("#pdfHint").textContent = d === "ejecutivo" ? "Se generará un resumen de 1 página con las cifras que ve aquí."
      : `Se generará un informe por capítulos (portada, índice, ${m.empresas.length > 1 ? `un capítulo por cada una de las ${m.empresas.length} empresas, ` : ""}productos, clientes, vendedores, zonas, cobranza y plan de acción)${d === "completo" ? " con anexos y lista de llamadas" : ""}.`;
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

  /* ---------- PDF y Excel ---------- */
  function fileSlug(m) {
    const months = m.v === 2 ? m.P.months : m.P;
    const slug = months.length ? `${months[0]}${months.length > 1 ? `_a_${months[months.length - 1]}` : ""}` : "periodo";
    const emp = m.empSel && m.empSel.length === 1 ? `_${m.empSel[0].split(/\s+/)[0].toLowerCase()}` : "";
    const who = m.options.seller ? `_${m.options.seller.split(/\s+/)[0].toLowerCase()}` : "";
    return `${slug}${emp}${who}`;
  }
  function makePdf() {
    const btn = $("#pdfBtn");
    btn.disabled = true; const label = btn.innerHTML; btn.textContent = "Generando…";
    setTimeout(() => {
      try {
        const doc = MODE === "v2" ? BipaInformePdf2.makePdf(MODEL, fmt, LOGO) : BipaInformePdf.makePdf(MODEL, fmt, LOGO);
        doc.save(`BIPA_informe_gerencial_${fileSlug(MODEL)}.pdf`);
        toast(`Informe descargado (${doc.getNumberOfPages()} ${doc.getNumberOfPages() === 1 ? "página" : "páginas"})`);
      } catch (e) {
        console.error(e); toast("No se pudo generar el PDF. Recargue la página e intente de nuevo.", true);
      } finally { btn.disabled = false; btn.innerHTML = label; }
    }, 30);
  }
  function makeExcel() {
    if (MODE !== "v2") return;
    try { downloadBlob(BipaExcel.fromModel(MODEL), `BIPA_respaldo_${fileSlug(MODEL)}.xlsx`); toast("Excel de respaldo descargado"); }
    catch (e) { console.error(e); toast("No se pudo generar el Excel.", true); }
  }

  /* ---------- Resumen para WhatsApp ---------- */
  function whatsappText(m) {
    const k = m.kpis;
    const c = (v) => (v == null ? "" : ` (${v >= 0 ? "+" : "-"}${fmt.pct(Math.abs(v))})`);
    if (m.v === 2) {
      const lines = [
        `*BIPA · Resumen gerencial*`,
        `${m.periodLabel}${m.filters.length ? ` · ${m.filters.join(" · ")}` : ""}`,
        m.hasC ? `_Comparado con ${m.fair ? "los mismos días del mes anterior" : m.compareLabel.toLowerCase()}_` : "",
        ``,
        `• Venta: ${fmt.money(k.sales)}${c(k.salesChange)}`,
      ];
      if (m.empresas.length > 1) m.empresas.forEach((e) => lines.push(`   - ${e.name}: ${fmt.moneyShort(e.p)}${c(e.chg)}`));
      if (k.projection) lines.push(`• Proyección de cierre: ${fmt.money(k.projection.value)}`);
      lines.push(`• Compraron: ${fmt.int(k.buyers)} de ${fmt.int(k.cartera)} clientes (${fmt.pct(k.activation)})`);
      if (m.hasC) lines.push(`• Nuevos: ${fmt.int(k.newClients)} · Dejaron de comprar: ${fmt.int(k.lost)} (${fmt.moneyShort(k.lostValue)})`);
      lines.push(`• Vencido: ${fmt.money(k.vencido)} (${fmt.pct(k.vencidoShare)} del saldo); más de 90 días: ${fmt.moneyShort(k.aging[4])}`);
      if (m.clients.overdueCount) lines.push(`• Compra atrasada: ${fmt.int(m.clients.overdueCount)} clientes (${fmt.moneyShort(m.clients.recoverValue)}/mes)`);
      if (m.actions.length) { lines.push("", "*Acciones:*"); m.actions.slice(0, 4).forEach((a) => lines.push(`- ${a.who}: ${a.text}${a.value != null ? ` (${fmt.moneyShort(a.value)})` : ""}`)); }
      lines.push("", `_Datos al ${fmt.date(m.info.cut)}_`);
      return lines.filter((x, i, a) => !(x === "" && a[i - 1] === "")).join("\n").trim();
    }
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
