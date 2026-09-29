/* BIPA · Asistente — chat con Gemini.
   Abre los datos cifrados con la clave del equipo, conversa con el modelo y le da
   herramientas para consultar los datos en el navegador. La llave de Gemini la pega
   cada usuario y queda solo en su navegador (nunca se publica en la página). */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const te = new TextEncoder();
  const MODULE = "activacion";
  const DATA2_URL = "../informe/datos2.enc";
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
  let bytes = null;
  async function openData(key) {
    if (!bytes) {
      const r = await fetch(`${DATA2_URL}?t=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) throw Object.assign(new Error("nodata"), { nodata: true });
      bytes = new Uint8Array(await r.arrayBuffer());
    }
    return BipaDatos.open(bytes, key);
  }

  let DS = null, TOOLS = null, HISTORY = [], BUSY = false;
  const privacy = () => store.get(K_PRIV) || "nombres";

  async function start() {
    const saved = store.get("bipa:key");
    if (saved) {
      try {
        const key = await crypto.subtle.importKey("raw", b64(saved), "AES-GCM", true, ["encrypt", "decrypt"]);
        DS = await openData(key);
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
        DS = await openData(key);
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

  /* ---------- Chat ---------- */
  function ready() {
    $("#loading").hidden = true; $("#chat").hidden = false;
    TOOLS = BipaHerramientas.create(() => DS, privacy);
    const info = BipaInforme2.describe(DS);
    $("#cutText").textContent = `Datos al ${info.cut.toLocaleDateString("es-VE", { timeZone: "UTC" })} · ${info.empresas.length} empresas · ${info.lines.toLocaleString("es-VE")} líneas`;
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
    $("#newChat").addEventListener("click", () => { HISTORY = []; $("#log").innerHTML = ""; $("#welcome").hidden = false; $("#askInput").focus(); });
    $("#askInput").focus();
  }
  function openSettings(show) { $("#settings").hidden = !show; if (show) $("#fKey").focus(); }
  function saveSettings() {
    const k = $("#fKey").value.trim(), m = $("#fModel").value.trim() || DEFAULT_MODEL;
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
      const { answer: raw, used } = await agentTurn(HISTORY, text, key, (label) => { pending.querySelector(".typing").textContent = `Consultando ${label}…`; });
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
      const content = await callGemini(key, history);
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

  async function callGemini(key, history) {
    const info = BipaInforme2.describe(DS);
    const system = BipaContexto({
      empresas: info.empresas, cut: info.cut.toISOString().slice(0, 10), first: BipaInforme2.dayToDate(info.minDay).toISOString().slice(0, 10),
      partial: info.partial, clients: info.clientsCount, lines: info.lines, today: new Date().toISOString().slice(0, 10), privacy: privacy(),
    });
    const model = store.get(K_MODEL) || DEFAULT_MODEL;
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
      e.userMessage = res.status === 429 ? "Se alcanzó el límite gratuito de Gemini por ahora. Espere un minuto e intente de nuevo."
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
