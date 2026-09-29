/* BIPA · Asistente — chat con Gemini.
   Abre los datos cifrados con la clave del equipo, conversa con el modelo y le da
   herramientas para consultar los datos en el navegador. La llave de Gemini la pega
   cada usuario y queda solo en su navegador (nunca se publica en la página). */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const te = new TextEncoder();
  const MODULE = "activacion";
  const DATA2_URL = "../informe/datos2.enc", DATA1_URL = "../data.enc";
  const K_GEMINI = "bipa:gemini-key", K_MODEL = "bipa:gemini-model", K_PRIV = "bipa:asistente-privacidad";
  const DEFAULT_MODEL = "gemini-3.8-flash";
  const MAX_ROUNDS = 8;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* sin almacenamiento */ } },
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- Datos cifrados (mismo esquema del portal) ---------- */
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const toB64 = (buf) => { const u = new Uint8Array(buf); let s = ""; for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode(...u.subarray(i, i + 32768)); return btoa(s); };
  async function deriveKey(pass) {
    const salt = new Uint8Array(await crypto.subtle.digest("SHA-256", te.encode(`bipa-workspace:${MODULE}`))).slice(0, 16);
    const base = await crypto.subtle.importKey("raw", te.encode(String(pass).normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 310000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  }
  // Usa datos2.enc (informe 2.0, detalle por factura) si está publicado; si no, el
  // data.enc del portal (resolución mensual). Solo si no hay ninguno pide el Excel.
  let bytes2 = null, bytes1 = null, fetched = false;
  const fetchBytes = async (url) => { const r = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return new Uint8Array(await r.arrayBuffer()); };
  async function openV1(b, key) {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.subarray(0, 12) }, key, b.subarray(12));
    const text = await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.detail) || !data.detail.length) throw new Error("El paquete de datos no trae clientes para analizar.");
    return data;
  }
  async function openData(key) {
    if (!fetched) { [bytes2, bytes1] = await Promise.all([fetchBytes(DATA2_URL).catch(() => null), fetchBytes(DATA1_URL).catch(() => null)]); fetched = true; }
    if (!bytes2 && !bytes1) throw Object.assign(new Error("nodata"), { nodata: true });
    if (bytes2) DS = await BipaDatos.open(bytes2, key);
    else DATA1 = await openV1(bytes1, key);
  }

  let DS = null, DATA1 = null, TOOLS = null, HISTORY = [], BUSY = false, BOUND = false;
  const privacy = () => store.get(K_PRIV) || "nombres";

  async function start() {
    const saved = store.get("bipa:key");
    if (saved) {
      try {
        const key = await crypto.subtle.importKey("raw", b64(saved), "AES-GCM", true, ["encrypt", "decrypt"]);
        await openData(key);
        return ready();
      } catch (e) { if (e.nodata) return noData(); }
    }
    showLock();
  }
  function showLock() {
    $("#loading").hidden = true; $("#lock").hidden = false; $("#lockPass").focus();
    $("#lockForm").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const btn = $("#lockBtn"), msg = $("#lockMsg"), pass = $("#lockPass").value;
      if (!pass) return;
      btn.disabled = true; btn.textContent = "Abriendo…"; msg.textContent = "";
      try {
        const key = await deriveKey(pass);
        await openData(key);
        store.set("bipa:key", toB64(await crypto.subtle.exportKey("raw", key)));
        $("#lock").hidden = true; ready();
      } catch (e) {
        if (e.nodata) { $("#lock").hidden = true; return noData(); }
        msg.textContent = e && e.name === "OperationError" ? "La clave no es correcta." : (e.message || "No se pudieron abrir los datos.");
        btn.disabled = false; btn.textContent = "Entrar"; $("#lockPass").select();
      }
    });
  }
  function noData() {
    $("#loading").hidden = true; $("#noData").hidden = false;
    $("#xlsInput").addEventListener("change", async (ev) => {
      const f = ev.target.files && ev.target.files[0]; if (!f) return;
      const st = $("#noDataMsg");
      try { DS = await BipaDatos.buildFromExcel(await f.arrayBuffer(), (m) => { st.textContent = m; }); $("#noData").hidden = true; ready(); }
      catch (e) { st.textContent = e.message || "No se pudo leer el Excel."; }
    });
  }
  // En modo básico se puede cargar el Excel para pasar al detalle completo (solo en este navegador).
  async function loadExcel(ev) {
    const f = ev.target.files && ev.target.files[0]; if (!f) return;
    try {
      DS = await BipaDatos.buildFromExcel(await f.arrayBuffer(), (m) => toast(m));
      HISTORY = []; $("#log").innerHTML = ""; $("#welcome").hidden = false;
      ready(); toast("Excel cargado: el asistente ya tiene el detalle completo.");
    } catch (e) { toast(e.message || "No se pudo leer el Excel.", true); }
    ev.target.value = "";
  }

  /* ---------- Chat ---------- */
  function ready() {
    $("#loading").hidden = true; $("#chat").hidden = false;
    TOOLS = DS ? BipaHerramientas.create(() => DS, privacy) : BipaHerramientas.createBasic(() => DATA1, privacy);
    const c = context();
    $("#cutText").textContent = DS ? `Datos al ${fmtDate(c.cut)} · ${c.empresas.length} empresas · ${c.lines.toLocaleString("es-VE")} líneas`
      : `Datos del portal al ${fmtDate(c.cut)} · ${c.clients.toLocaleString("es-VE")} clientes · por mes`;
    $("#basicBar").hidden = !!DS;
    document.querySelectorAll(".chip[data-full]").forEach((b) => { b.hidden = !DS; });
    document.querySelectorAll(".chip[data-basic]").forEach((b) => { b.hidden = !!DS; });
    if (BOUND) return;
    BOUND = true;
    $("#fModel").value = store.get(K_MODEL) || DEFAULT_MODEL;
    $("#fPriv").value = privacy();
    $("#fKey").value = store.get(K_GEMINI) || "";
    if (!store.get(K_GEMINI)) openSettings(true);
    $("#askForm").addEventListener("submit", (e) => { e.preventDefault(); ask($("#askInput").value); });
    $("#askInput").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask($("#askInput").value); } });
    document.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => ask(c.textContent)));
    $("#settingsBtn").addEventListener("click", () => openSettings(!$("#settings").hidden ? false : true));
    $("#settings").addEventListener("submit", (e) => { e.preventDefault(); saveSettings(); });
    $("#forgetKey").addEventListener("click", () => { store.del(K_GEMINI); $("#fKey").value = ""; toast("Llave borrada de este navegador."); });
    $("#testBtn").addEventListener("click", runTest);
    $("#xlsMore").addEventListener("change", loadExcel);
    $("#newChat").addEventListener("click", () => { HISTORY = []; $("#log").innerHTML = ""; $("#welcome").hidden = false; $("#askInput").focus(); });
    $("#askInput").focus();
  }
  function openSettings(show) { $("#settings").hidden = !show; if (show) $("#fKey").focus(); }
  function saveSettings() {
    const k = $("#fKey").value.trim(), m = $("#fModel").value.trim() || DEFAULT_MODEL;
    ACTIVE_MODEL = null;
    if (k) store.set(K_GEMINI, k); store.set(K_MODEL, m); store.set(K_PRIV, $("#fPriv").value);
    openSettings(false); toast(k ? "Configuración guardada." : "Falta la llave de Gemini.", !k);
  }

  function addMsg(role, html, extra) {
    $("#welcome").hidden = true;
    const el = document.createElement("div");
    el.className = `msg ${role}`;
    el.innerHTML = `<div class="bubble">${html}</div>${extra || ""}`;
    $("#log").appendChild(el);
    el.scrollIntoView({ block: "end", behavior: "smooth" });
    return el;
  }

  const TOOL_LABELS = { info_datos: "datos disponibles", resumen_general: "resumen general", ventas_por: "ventas", serie_mensual: "serie mensual", listas: "listas", buscar_cliente: "ficha de cliente", buscar_producto: "ficha de producto", consulta: "consulta a medida", cuadre: "cuadre con el Excel" };

  async function ask(text) {
    text = String(text || "").trim();
    if (!text || BUSY) return;
    const key = store.get(K_GEMINI);
    if (!key) { openSettings(true); toast("Primero pegue su llave de Gemini.", true); return; }
    BUSY = true; $("#askBtn").disabled = true; $("#askInput").value = "";
    addMsg("user", esc(text));
    const pending = addMsg("bot", `<span class="typing">Consultando los datos…</span>`);
    const base = HISTORY.length;
    try {
      const { answer: raw, used } = await agentTurn(HISTORY, text, key, (label, raw) => { pending.querySelector(".typing").textContent = raw ? label : `Consultando ${label}…`; });
      let answer = raw;
      if (!answer) answer = "No logré completar la respuesta con los datos. Intente con una pregunta más concreta.";
      const tags = [...new Set(used)];
      pending.querySelector(".bubble").innerHTML = render(answer);
      if (tags.length) pending.insertAdjacentHTML("beforeend", `<div class="used">Consultó: ${tags.map(esc).join(" · ")}</div>`);
    } catch (e) {
      console.error(e);
      HISTORY.length = base; // la pregunta fallida no queda en la conversación
      pending.classList.add("error");
      pending.querySelector(".bubble").innerHTML = esc(e.userMessage || "No se pudo consultar a Gemini. Revise su conexión e intente de nuevo.");
    } finally {
      BUSY = false; $("#askBtn").disabled = false; $("#askInput").focus();
      pending.scrollIntoView({ block: "end", behavior: "smooth" });
    }
  }

  /* ---------- Prueba de precisión ---------- */
  let TESTING = false;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function runTest() {
    if (TESTING) { TESTING = false; return; }
    const key = store.get(K_GEMINI);
    if (!key) { toast("Primero pegue su llave de Gemini.", true); return; }
    if (BUSY) return;
    TESTING = true; BUSY = true; $("#askBtn").disabled = true;
    $("#testBtn").textContent = "Detener prueba"; openSettings(false);
    const tests = BipaPrueba.build(TOOLS);
    const box = addMsg("bot", `<p class="h">Prueba de precisión</p><p class="typing">Preparando ${tests.length} preguntas…</p><div class="tw"><table class="testTable"><tr><th>#</th><th>Pregunta</th><th>Correcto</th><th>Respondió</th><th></th></tr></table></div>`);
    const table = box.querySelector("table"), status = box.querySelector(".typing");
    let ok = 0, exact = 0, done = 0;
    for (let i = 0; i < tests.length && TESTING; i++) {
      const t = tests[i];
      status.textContent = `Pregunta ${i + 1} de ${tests.length}…`;
      let answer = "", used = [], err = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try { ({ answer, used } = await agentTurn([], t.q, key)); err = null; break; }
        catch (e) { err = e; if (/límite/.test(e.userMessage || "") && attempt === 0) { status.textContent = "Límite gratuito alcanzado; esperando 40 segundos…"; await sleep(40000); } else break; }
      }
      const r = err ? { ok: false, expected: BipaPrueba.check("", t).expected } : BipaPrueba.check(answer, t);
      done++; if (r.ok) ok++; if (r.ok && r.level === "exacto") exact++;
      const shown = err ? `Error: ${err.userMessage || err.message}` : answer.replace(/\s+/g, " ").slice(0, 220);
      table.insertAdjacentHTML("beforeend", `<tr><td>${i + 1}</td><td>${esc(t.q)}</td><td>${esc(r.expected)}</td><td>${esc(shown)}${used.length ? `<br><small class="muted">${esc([...new Set(used)].join(" · "))}</small>` : ""}</td><td class="${r.ok ? "ok" : "no"}">${r.ok ? (r.level === "redondeado" ? "≈" : "✓") : "✗"}</td></tr>`);
      if (i < tests.length - 1 && TESTING) await sleep(6000);
    }
    status.className = "";
    status.innerHTML = `<b>Resultado: ${ok} de ${done} correctas</b> (${exact} exactas al centavo${ok - exact ? `, ${ok - exact} redondeadas` : ""}). ✓ exacta · ≈ redondeada · ✗ incorrecta.`;
    TESTING = false; BUSY = false; $("#askBtn").disabled = false; $("#testBtn").textContent = "Probar precisión del agente";
  }

  // Un turno completo del agente: pregunta, llamadas a herramientas y respuesta final.
  // Modifica "history" (agrega la pregunta, las llamadas y la respuesta).
  async function agentTurn(history, text, key, onTool) {
    history.push({ role: "user", parts: [{ text }] });
    const used = [];
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const content = await callGemini(key, history, (m) => onTool && onTool(m, true));
      history.push(content);
      const calls = (content.parts || []).filter((p) => p.functionCall);
      if (!calls.length) return { answer: (content.parts || []).filter((p) => p.text && !p.thought).map((p) => p.text).join("").trim(), used };
      const responses = calls.map((p) => {
        const fc = p.functionCall, label = TOOL_LABELS[fc.name] || fc.name;
        used.push(label); if (onTool) onTool(label);
        const result = TOOLS.run(fc.name, fc.args);
        return { functionResponse: { name: fc.name, ...(fc.id ? { id: fc.id } : {}), response: { result } } };
      });
      history.push({ role: "user", parts: responses });
    }
    return { answer: "", used };
  }

  const fmtDate = (iso) => (iso ? iso.split("-").reverse().join("/") : "sin fecha");
  // Datos que el manual del agente necesita, según el paquete abierto
  function context() {
    const today = new Date().toISOString().slice(0, 10);
    if (DS) {
      const info = BipaInforme2.describe(DS);
      return { mode: "completo", empresas: info.empresas, cut: info.cut.toISOString().slice(0, 10), first: BipaInforme2.dayToDate(info.minDay).toISOString().slice(0, 10),
        partial: info.partial, clients: info.clientsCount, lines: info.lines, today, privacy: privacy() };
    }
    const I = BipaInforme.describeData(DATA1);
    return { mode: "basico", empresas: [], cut: I.cut ? I.cut.toISOString().slice(0, 10) : null, first: I.months[0] || null, lastMonth: I.last,
      partial: I.lastIsPartial, clients: DATA1.detail.length, products: (DATA1.articulos || []).length, today, privacy: privacy() };
  }

  // Gemini gratuito a veces responde "alta demanda" (503) o falla por un momento:
  // se reintenta solo, con esperas crecientes, antes de mostrar el error.
  // Si el modelo elegido sigue saturado, se prueba con otros modelos gratuitos de Gemini.
  const BACKUP_MODELS = ["gemini-3.7-flash", "gemini-3.5-flash", "gemini-3.1-flash-lite"];
  const RETRY_WAITS = [2000, 3000, 5000, 8000];
  let ACTIVE_MODEL = null; // modelo que respondió la última vez en esta sesión
  const busy = (res, msg) => res.status === 500 || res.status === 503 || /high demand|overloaded|unavailable/i.test(msg || "");
  async function callGemini(key, history, note) {
    for (let i = 0; ; i++) {
      const chosen = store.get(K_MODEL) || DEFAULT_MODEL;
      const chain = [...new Set([ACTIVE_MODEL || chosen, chosen, ...BACKUP_MODELS])];
      const model = chain[i % chain.length];
      try { const out = await callGeminiOnce(key, history, model); ACTIVE_MODEL = model; return out; }
      catch (e) {
        const skip = e.status === 404 && model !== chosen; // modelo de respaldo no disponible
        if (!(e.retry || skip) || i >= RETRY_WAITS.length) throw e;
        if (note) note(`Gemini está ocupado; probando con ${chain[(i + 1) % chain.length]}…`);
        await sleep(RETRY_WAITS[i]);
      }
    }
  }
  async function callGeminiOnce(key, history, model) {
    const system = BipaContexto(context());
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: history,
        tools: [{ functionDeclarations: TOOLS.declarations }],
        toolConfig: { functionCallingConfig: { mode: "AUTO" } },
        generationConfig: { temperature: 0.2 },
      }),
    });
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    if (!res.ok) {
      const msg = body && body.error && body.error.message ? body.error.message : `HTTP ${res.status}`;
      const e = new Error(msg);
      e.retry = busy(res, msg); e.status = res.status;
      e.userMessage = e.retry ? "Gemini está saturado en este momento (plan gratuito). Espere un minuto y vuelva a enviar la pregunta."
        : res.status === 429 ? "Se alcanzó el límite gratuito de Gemini por ahora. Espere un minuto e intente de nuevo."
        : res.status === 400 && /API key/i.test(msg) ? "La llave de Gemini no es válida. Revísela en Configuración."
        : res.status === 403 ? "La llave de Gemini no tiene permiso para este modelo. Revísela en Configuración."
        : res.status === 404 ? `El modelo "${model}" no existe o no está disponible. Cámbielo en Configuración.`
        : `Gemini respondió con un error: ${msg}`;
      throw e;
    }
    const cand = body && body.candidates && body.candidates[0];
    if (!cand || !cand.content) {
      const e = new Error("sin respuesta");
      e.userMessage = cand && cand.finishReason === "SAFETY" ? "Gemini no quiso responder esa pregunta." : "Gemini no devolvió respuesta. Intente de nuevo.";
      throw e;
    }
    return { role: "model", parts: cand.content.parts || [] };
  }

  /* ---------- Markdown mínimo (negritas, viñetas, tablas) ---------- */
  function render(md) {
    const lines = esc(md).split("\n"), out = [];
    let list = null, table = null;
    const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1<i>$2</i>").replace(/`(.+?)`/g, "<code>$1</code>");
    const flush = () => { if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`); list = null; } if (table) { out.push(`<div class="tw"><table>${table.map((r, i) => `<tr>${r.map((c) => (i === 0 ? `<th>${inline(c)}</th>` : `<td>${inline(c)}</td>`)).join("")}</tr>`).join("")}</table></div>`); table = null; } };
    for (const raw of lines) {
      const l = raw.trim();
      if (/^\|.*\|$/.test(l)) { if (list) flush(); if (/^\|[\s:|-]+\|$/.test(l)) continue; (table = table || []).push(l.slice(1, -1).split("|").map((c) => c.trim())); continue; }
      const ul = /^[-*•]\s+(.*)/.exec(l), ol = /^\d+[.)]\s+(.*)/.exec(l);
      if (ul || ol) { if (table) flush(); const tag = ul ? "ul" : "ol"; if (!list || list.tag !== tag) { flush(); list = { tag, items: [] }; } list.items.push((ul || ol)[1]); continue; }
      flush();
      if (!l) continue;
      const h = /^#{1,4}\s+(.*)/.exec(l);
      out.push(h ? `<p class="h">${inline(h[1])}</p>` : `<p>${inline(l)}</p>`);
    }
    flush();
    return out.join("");
  }

  let toastTimer = null;
  function toast(text, warn) {
    const t = $("#toast"); t.textContent = text; t.className = warn ? "toast warn" : "toast"; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  start().catch((e) => { console.error(e); $("#loading").textContent = "No se pudo abrir el asistente. Recargue la página."; });
})();
