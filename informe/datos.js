/* BIPA · Informe gerencial — datos 2.0.
   Lee el Excel de facturación directamente en el navegador (sin subirlo a ningún
   lado), arma un paquete compacto con empresa, producto, cliente y fechas de cada
   línea, y lo cifra con la misma clave del portal para publicarlo como datos2.enc.
   Nada sale del dispositivo sin cifrar. */
(function (global) {
  "use strict";

  /* ---------- Lector mínimo de .xlsx (zip + XML) ---------- */
  async function unzip(buffer) {
    const u8 = new Uint8Array(buffer), dv = new DataView(buffer);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
    if (eocd < 0) throw new Error("El archivo no parece un Excel (.xlsx) válido.");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = new Map();
    const td = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = td.decode(u8.subarray(p + 46, p + 46 + nlen));
      files.set(name, { method, csize, local });
      p += 46 + nlen + elen + clen;
    }
    return {
      has: (name) => files.has(name),
      async text(name) {
        const f = files.get(name);
        if (!f) return null;
        const start = f.local + 30 + dv.getUint16(f.local + 26, true) + dv.getUint16(f.local + 28, true);
        const raw = u8.subarray(start, start + f.csize);
        if (f.method === 0) return td.decode(raw);
        const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        return new Response(stream).text();
      },
    };
  }

  const unescapeXml = (s) => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) => {
    const map = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
    if (map[e.toLowerCase()]) return map[e.toLowerCase()];
    return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });
  const colIndex = (ref) => { let n = 0; for (const ch of ref) { const c = ch.charCodeAt(0); if (c < 65 || c > 90) break; n = n * 26 + (c - 64); } return n - 1; };

  async function readWorkbook(buffer) {
    const zip = await unzip(buffer);
    const wbXml = await zip.text("xl/workbook.xml");
    const relXml = await zip.text("xl/_rels/workbook.xml.rels");
    if (!wbXml || !relXml) throw new Error("El archivo no parece un Excel (.xlsx) válido.");
    const rels = new Map();
    for (const m of relXml.matchAll(/<Relationship\b[^>]*>/g)) {
      const id = /Id="([^"]+)"/.exec(m[0]), target = /Target="([^"]+)"/.exec(m[0]);
      if (id && target) rels.set(id[1], target[1].replace(/^\/?xl\//, "").replace(/^\//, ""));
    }
    const sheets = [];
    for (const m of wbXml.matchAll(/<sheet\b[^>]*>/g)) {
      const name = /name="([^"]*)"/.exec(m[0]), rid = /r:id="([^"]+)"/.exec(m[0]);
      if (name && rid && rels.has(rid[1])) sheets.push({ name: unescapeXml(name[1]), path: `xl/${rels.get(rid[1])}` });
    }
    const sstXml = (await zip.text("xl/sharedStrings.xml")) || "";
    const strings = [];
    for (const m of sstXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      let t = "";
      for (const x of m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) t += x[1];
      strings.push(unescapeXml(t));
    }
    return {
      names: sheets.map((s) => s.name),
      async rows(sheetName) {
        const s = sheets.find((x) => x.name === sheetName);
        if (!s) return [];
        const xml = await zip.text(s.path);
        const out = [];
        for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
          const row = [];
          for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
            const attrs = c[1], ref = /r="([A-Z]+)\d+"/.exec(attrs), type = /t="([^"]+)"/.exec(attrs);
            let v = "";
            if (c[2]) {
              if (type && type[1] === "inlineStr") { const t = /<t[^>]*>([\s\S]*?)<\/t>/.exec(c[2]); v = t ? unescapeXml(t[1]) : ""; }
              else { const vv = /<v>([\s\S]*?)<\/v>/.exec(c[2]); v = vv ? vv[1] : ""; if (type && type[1] === "s" && v !== "") v = strings[+v] ?? ""; else if (type && type[1] === "str") v = unescapeXml(v); }
            }
            row[ref ? colIndex(ref[1]) : row.length] = typeof v === "string" ? v.trim() : v;
          }
          out.push(row);
        }
        return out;
      },
    };
  }

  /* ---------- Del Excel al paquete 2.0 ---------- */
  const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
  const numOf = (v) => { const n = parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
  const serialDay = (v) => { const n = numOf(v); return n > 20000 && n < 80000 ? Math.floor(n) : 0; }; // días desde 1899-12-30
  const round2 = (n) => Math.round(n * 100) / 100;

  function headerMap(row, wanted) {
    const idx = {};
    const h = row.map(norm);
    for (const [key, names] of Object.entries(wanted)) {
      idx[key] = h.findIndex((x) => names.some((n) => x === n));
      if (idx[key] < 0) idx[key] = h.findIndex((x) => names.some((n) => x.startsWith(n)));
    }
    return idx;
  }

  async function buildFromExcel(buffer, onStep, opts) {
    const step = onStep || (() => {});
    const minDay = (opts && opts.minDay) || 0; // recorta facturas anteriores a este día (serie de Excel)
    step("Abriendo el Excel…");
    const wb = await readWorkbook(buffer);
    const factName = wb.names.find((n) => norm(n).startsWith("FACTURACION"));
    if (!factName) throw new Error('No encontré la hoja "FACTURACION" en el Excel.');
    const cliName = wb.names.find((n) => norm(n) === "CLIENTES") || wb.names.find((n) => norm(n).startsWith("CLIENTES"));

    /* Clientes */
    step("Leyendo clientes…");
    const clients = [], byName = new Map();
    if (cliName) {
      const rows = await wb.rows(cliName);
      const hi = rows.findIndex((r) => r.some((x) => norm(x) === "CLIENTE"));
      const H = headerMap(rows[hi] || [], { codigo: ["CODIGO", "CODIG"], cliente: ["CLIENTE"], telefono: ["TELEFONO"], zona: ["ZONA"], tipo: ["TIPO CLIENTE"], vendedor: ["VENDEDOR"], activo: ["ACTIVO"] });
      for (const r of rows.slice(hi + 1)) {
        const name = String(r[H.cliente] ?? "").trim();
        if (!name) continue;
        const key = norm(name);
        if (byName.has(key)) continue;
        const vend = String(r[H.vendedor] ?? "").trim();
        const act = norm(r[H.activo]);
        const vacante = act === "VACANTE" || norm(vend) === "VACANTE" || /CONFIRMAR/.test(norm(vend));
        const code = numOf(r[H.codigo]) ? String(Math.round(numOf(r[H.codigo]))) : String(r[H.codigo] ?? "").trim();
        let tel = numOf(r[H.telefono]) ? String(Math.round(numOf(r[H.telefono]))) : String(r[H.telefono] ?? "").trim();
        if (tel.startsWith("#") || tel.replace(/\D/g, "").length < 7) tel = ""; // errores de fórmula o números incompletos
        byName.set(key, clients.length);
        clients.push([name, code, String(r[H.zona] ?? "").trim() || "Sin zona", String(r[H.tipo] ?? "").trim() || "Sin tipo", vend.replace(/\s*CONFIRMAR$/i, "") || (vacante ? "VACANTE" : "Sin vendedor"), tel, vacante ? 1 : 0]);
      }
    }

    const nsheet = clients.length;

    /* Facturación: una fila por línea de producto */
    step("Leyendo la facturación…");
    const rows = await wb.rows(factName);
    const hi = rows.findIndex((r) => r.some((x) => norm(x) === "PRODUCTO"));
    if (hi < 0) throw new Error("La hoja de facturación no tiene la columna PRODUCTO.");
    const H = headerMap(rows[hi], { empresa: ["EMPRESA"], emision: ["EMISION"], vence: ["VENCE"], doc: ["NROPROFIT", "NRO"], cliente: ["CLIENTE"], pcode: ["CODIGO"], producto: ["PRODUCTO"], unidades: ["UND", "TOTAL ARTICULO"], precio: ["PRECIO VENTA", "PRECIO"], total: ["TOTAL VENTA"], saldo: ["SALDO"], vencido: ["SALDO VENCIDO"], peso: ["PESO"] });
    if (H.saldo === H.vencido) H.saldo = rows[hi].map(norm).findIndex((x) => x === "SALDO");
    const missing = ["empresa", "emision", "cliente", "producto", "total"].filter((k) => H[k] < 0);
    if (missing.length) throw new Error(`A la hoja de facturación le faltan columnas: ${missing.join(", ")}.`);

    const dict = { empresas: [], productos: [], codigos: [], docs: [] };
    const idxOf = (list, map, v) => { let i = map.get(v); if (i === undefined) { i = list.length; list.push(v); map.set(v, i); } return i; };
    const mE = new Map(), mP = new Map(), mD = new Map();
    const L = { e: [], d: [], v: [], doc: [], c: [], p: [], u: [], pr: [], t: [], s: [], sv: [], kg: [] };
    let maxDay = 0, skipped = 0;
    const control = { lines: 0, venta_cent: 0, saldo_cent: 0, vencido_cent: 0 }; // totales del Excel en centavos, para el cuadre
    for (const r of rows.slice(hi + 1)) {
      const cname = String(r[H.cliente] ?? "").trim(), prod = String(r[H.producto] ?? "").trim();
      const day = serialDay(r[H.emision]);
      if (!cname || !prod || !day) { if (r.some((x) => x !== undefined && x !== "")) skipped++; continue; }
      if (day < minDay) continue;
      let ci = byName.get(norm(cname));
      if (ci === undefined) { ci = clients.length; byName.set(norm(cname), ci); clients.push([cname, "", "Sin zona", "Sin tipo", "Sin vendedor", "", 0]); }
      const pi = idxOf(dict.productos, mP, prod);
      if (dict.codigos[pi] === undefined) dict.codigos[pi] = String(r[H.pcode] ?? "").trim();
      L.e.push(idxOf(dict.empresas, mE, String(r[H.empresa] ?? "").trim() || "Sin empresa"));
      L.d.push(day); L.v.push(serialDay(r[H.vence]) || day);
      L.doc.push(idxOf(dict.docs, mD, String(r[H.doc] ?? "").trim()));
      L.c.push(ci); L.p.push(pi);
      L.u.push(round2(numOf(r[H.unidades]))); L.pr.push(round2(numOf(r[H.precio]))); L.t.push(round2(numOf(r[H.total])));
      L.s.push(H.saldo >= 0 ? round2(numOf(r[H.saldo])) : 0); L.sv.push(H.vencido >= 0 ? round2(numOf(r[H.vencido])) : 0);
      L.kg.push(H.peso >= 0 ? Math.round(numOf(r[H.peso]) * 1000) / 1000 : 0); // gramos del Excel
      if (day > maxDay) maxDay = day;
      control.lines++; control.venta_cent += Math.round(numOf(r[H.total]) * 100);
      if (H.saldo >= 0) control.saldo_cent += Math.round(numOf(r[H.saldo]) * 100);
      if (H.vencido >= 0) control.vencido_cent += Math.round(numOf(r[H.vencido]) * 100);
    }
    if (!L.d.length) throw new Error("La hoja de facturación no trae líneas con fecha de emisión.");
    step(`Listo: ${L.d.length.toLocaleString("es-VE")} líneas, ${clients.length.toLocaleString("es-VE")} clientes.`);
    return { v: 2, created_at: new Date().toISOString(), cut_day: maxDay, skipped, nsheet, control, clients, dict, lines: L };
  }

  /* ---------- Cifrado (mismo esquema del portal) ---------- */
  async function gzip(text) { return new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer()); }
  async function gunzip(bytes) { return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text(); }
  async function seal(dataset, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, await gzip(JSON.stringify(dataset))));
    const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
    return out;
  }
  async function open(bytes, key) {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12) }, key, bytes.subarray(12));
    const data = JSON.parse(await gunzip(new Uint8Array(plain)));
    if (!data || data.v !== 2 || !data.lines) throw new Error("El archivo de datos 2.0 no es válido.");
    return data;
  }

  global.BipaDatos = { buildFromExcel, seal, open, dayToDate: (d) => new Date(Date.UTC(1899, 11, 30) + d * 86400000) };
})(window);
