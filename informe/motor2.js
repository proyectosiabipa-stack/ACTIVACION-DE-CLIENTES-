/* BIPA · Informe gerencial 2.0 — motor de análisis.
   Trabaja sobre el paquete de datos 2.0 (una fila por línea de factura, con empresa,
   producto, cliente, fechas y saldos) y devuelve un modelo completo: indicadores con
   semáforo, puente de variación, capítulos por empresa, productos, clientes,
   vendedores, zonas y cobranza, más alertas y plan de acción. La vista previa, el PDF,
   el texto para WhatsApp y el Excel de respaldo salen de este mismo modelo. */
(function (global) {
  "use strict";

  /* ---------- Fechas (días seriales de Excel: días desde 1899-12-30) ---------- */
  const EPOCH = Date.UTC(1899, 11, 30);
  const dayToDate = (d) => new Date(EPOCH + d * 86400000);
  const ymd = (y, m, d) => Math.round((Date.UTC(y, m, d) - EPOCH) / 86400000);
  const monthOf = (d) => { const x = dayToDate(d); return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}`; };
  const mStart = (m) => ymd(+m.slice(0, 4), +m.slice(5) - 1, 1);
  const mEnd = (m) => ymd(+m.slice(0, 4), +m.slice(5), 0);
  const addMonths = (m, k) => { const d = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5) - 1 + k, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
  const monthRange = (a, b) => { const out = []; let m = a; while (m <= b && out.length < 240) { out.push(m); m = addMonths(m, 1); } return out; };
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const CORTOS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  const monthName = (m) => `${MESES[+m.slice(5) - 1]} de ${m.slice(0, 4)}`;
  const monthShort = (m) => `${CORTOS[+m.slice(5) - 1]} ${m.slice(2, 4)}`;
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const dayLabel = (d) => { const x = dayToDate(d); return `${x.getUTCDate()} de ${MESES[x.getUTCMonth()]}`; };

  const change = (now, before) => (before > 0 ? ((now - before) / before) * 100 : null);
  const share = (a, b) => (b ? (a / b) * 100 : 0);
  const isFreight = (name) => /^\s*FLETE/i.test(String(name || ""));
  const byDesc = (k) => (a, b) => b[k] - a[k];

  /* ---------- Descripción del paquete (filtros disponibles, meses, corte) ---------- */
  const cache = new WeakMap();
  function describe(ds) {
    if (cache.has(ds)) return cache.get(ds);
    const L = ds.lines, n = L.d.length;
    let min = Infinity;
    for (let i = 0; i < n; i++) if (L.d[i] < min) min = L.d[i];
    const cut = ds.cut_day;
    const last = monthOf(cut);
    const months = monthRange(monthOf(min), last);
    const uniq = (col) => [...new Set(ds.clients.map((c) => c[col]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
    const info = {
      v: 2, minDay: min, cutDay: cut, cut: dayToDate(cut), months, last,
      partial: cut < mEnd(last), lastFull: cut < mEnd(last) ? addMonths(last, -1) : last,
      empresas: ds.dict.empresas.slice(), sellers: uniq(4), zones: uniq(2), types: uniq(3),
      lines: n, clientsCount: ds.nsheet || ds.clients.length,
    };
    cache.set(ds, info);
    return info;
  }

  /* ---------- Periodo del informe y de comparación ---------- */
  function resolvePeriod(info, o) {
    const { months, last, lastFull, partial, cutDay, minDay } = info;
    let P, C = null, label, compareLabel = "", fair = false;
    const monthsP = (a, b) => ({ from: mStart(a), to: Math.min(mEnd(b), cutDay), months: monthRange(a, b) });
    const prevN = (a, n) => ({ from: mStart(addMonths(a, -n)), to: mEnd(addMonths(a, -1)), months: monthRange(addMonths(a, -n), addMonths(a, -1)) });
    switch (o.period) {
      case "actual": {
        P = { from: mStart(last), to: cutDay, months: [last] };
        const prev = addMonths(last, -1), span = cutDay - mStart(last);
        C = { from: mStart(prev), to: Math.min(mStart(prev) + span, mEnd(prev)), months: [prev] };
        label = partial ? `${cap(monthName(last))} (al ${dayLabel(cutDay)})` : cap(monthName(last));
        compareLabel = partial ? `del 1 al ${dayToDate(C.to).getUTCDate()} de ${MESES[+prev.slice(5) - 1]}` : cap(monthName(prev));
        fair = partial;
        break;
      }
      case "trimestre": {
        const a = addMonths(lastFull, -2);
        P = monthsP(a, lastFull); C = prevN(a, 3);
        label = rangeLabel(P.months); compareLabel = rangeLabel(C.months);
        break;
      }
      case "anio": {
        const y = +last.slice(0, 4);
        P = { from: ymd(y, 0, 1), to: cutDay, months: monthRange(`${y}-01`, last) };
        C = { from: ymd(y - 1, 0, 1), to: cutDay - 365, months: monthRange(`${y - 1}-01`, addMonths(last, -12)) };
        label = `Año ${y} a la fecha`; compareLabel = `mismo tramo de ${y - 1}`;
        break;
      }
      case "todo":
        P = { from: minDay, to: cutDay, months: months.slice() };
        label = `Todo el historial (${monthShort(months[0])} a ${monthShort(last)})`;
        break;
      case "rango": {
        let a = o.from || months[0], b = o.to || last;
        if (a > b) [a, b] = [b, a];
        P = monthsP(a, b); C = prevN(a, P.months.length);
        label = rangeLabel(P.months); compareLabel = rangeLabel(C.months);
        break;
      }
      case "ultimo":
      default:
        P = monthsP(lastFull, lastFull); C = prevN(lastFull, 1);
        label = cap(monthName(lastFull)); compareLabel = cap(monthName(C.months[0]));
    }
    if (C && C.from < minDay) C = null; // no hay historia suficiente para comparar
    const partialP = P.to < mEnd(P.months[P.months.length - 1]);
    return { P, C, label, compareLabel: C ? compareLabel : "", fair, partialP };
  }
  function rangeLabel(ms) {
    if (!ms.length) return "";
    if (ms.length === 1) return cap(monthName(ms[0]));
    const a = ms[0], b = ms[ms.length - 1];
    return a.slice(0, 4) === b.slice(0, 4) ? cap(`${MESES[+a.slice(5) - 1]} a ${MESES[+b.slice(5) - 1]} de ${b.slice(0, 4)}`) : cap(`${monthName(a)} a ${monthName(b)}`);
  }

  /* ---------- Acumuladores ---------- */
  const G = () => new Map();
  function slot(map, key, extra) {
    let s = map.get(key);
    if (!s) { s = { key, p: 0, c: 0, up: 0, uc: 0, kg: 0, kgC: 0, buyersP: new Set(), buyersC: new Set(), docsP: new Set(), docsC: new Set(), ...(extra || {}) }; map.set(key, s); }
    return s;
  }

  const AUDIENCES = {
    general: { label: "Gerencia general" },
    ventas: { label: "Gerencia de ventas" },
    cobranza: { label: "Cobranza" },
    vendedor: { label: "Vendedor" },
  };

  /* ---------- Modelo ---------- */
  function build(ds, o, fmt) {
    const info = describe(ds);
    const L = ds.lines, D = ds.dict, CL = ds.clients, n = L.d.length;
    const per = resolvePeriod(info, o);
    const { P, C } = per;
    const cut = info.cutDay, riskDays = o.riskDays || 30, topN = o.topN || 10;
    const hasC = !!C;

    /* Filtros */
    const empSel = (o.empresas || []).filter((e) => D.empresas.includes(e));
    const empSet = empSel.length && empSel.length < D.empresas.length ? new Set(empSel.map((e) => D.empresas.indexOf(e))) : null;
    const cOK = new Uint8Array(CL.length);
    for (let c = 0; c < CL.length; c++) {
      const r = CL[c];
      cOK[c] = (!o.seller || r[4] === o.seller) && (!o.zone || r[2] === o.zone) && (!o.type || r[3] === o.type) &&
        (!o.assignment || (o.assignment === "VACANTE" ? r[6] === 1 : r[6] === 0)) ? 1 : 0;
    }
    const freightIdx = new Set(D.productos.map((p, i) => (isFreight(p) ? i : -1)).filter((i) => i >= 0));
    const filters = [];
    if (empSet) filters.push(`Empresa: ${empSel.join(", ")}`);
    if (o.seller) filters.push(`Vendedor: ${o.seller}`);
    if (o.zone) filters.push(`Zona: ${o.zone}`);
    if (o.type) filters.push(`Tipo: ${o.type}`);
    if (o.assignment) filters.push(o.assignment === "VACANTE" ? "Solo vacantes" : "Solo con vendedor confirmado");

    /* Recorrido único de las líneas */
    const emp = G(), prod = G(), sell = G(), zone = G(), empProd = G(), empZone = G(), empSell = G(), zoneEmp = G();
    const cli = new Map(); // cliente -> estado
    const monthly = new Map(); // mes -> {v, e:[por empresa], buyers:Set}
    const prodMonthly = new Map(); // producto -> Map(mes -> venta)
    const invoicesP = new Map(); // factura -> Set(productos) (para pares)
    const aging = [0, 0, 0, 0, 0]; // por vencer, 1-30, 31-60, 61-90, >90
    const empDebt = new Map(), empFreight = new Map();
    let sales = 0, salesC = 0, kgP = 0, kgC = 0, freightP = 0, saldo = 0, vencido = 0;
    const docsP = new Set(), docsC = new Set(), buyersP = new Set(), buyersC = new Set();
    const anyLast = new Map(); // cliente -> última compra en cualquier empresa (ignora filtro de empresa)
    const lastByEmp = new Map(); // cliente -> [última compra por empresa]
    const histByEmp = new Map(); // cliente -> [venta total por empresa]
    const firstByEmp = new Map();

    const ne = D.empresas.length;
    for (let i = 0; i < n; i++) {
      const c = L.c[i];
      if (!cOK[c]) continue;
      const d = L.d[i], e = L.e[i], t = L.t[i];
      // historia por empresa (para "dejó una empresa pero compra otras")
      if (!(anyLast.get(c) >= d)) anyLast.set(c, d);
      let le = lastByEmp.get(c); if (!le) { le = new Array(ne).fill(0); lastByEmp.set(c, le); histByEmp.set(c, new Array(ne).fill(0)); firstByEmp.set(c, new Array(ne).fill(0)); }
      if (d > le[e]) le[e] = d;
      histByEmp.get(c)[e] += t;
      const fe = firstByEmp.get(c); if (!fe[e] || d < fe[e]) fe[e] = d;
      if (empSet && !empSet.has(e)) continue;

      const p = L.p[i], u = L.u[i], kg = L.kg[i], doc = e * 1e7 + L.doc[i];
      const r = CL[c], m = monthOf(d);
      const inP = d >= P.from && d <= P.to, inC = hasC && d >= C.from && d <= C.to;

      // cliente
      let k = cli.get(c);
      if (!k) { k = { c, p: 0, cc: 0, docsP: new Set(), empP: new Set(), empC: new Set(), first: d, last: d, total: 0, months: new Set(), days: new Set(), docs: new Set(), saldo: 0, venc: 0, oldest: 0, lastBuy: 0 }; cli.set(c, k); }
      if (d <= cut) {
        k.total += t; k.months.add(m); k.days.add(d); k.docs.add(doc);
        if (d < k.first) k.first = d; if (d > k.last) k.last = d;
      }
      // mensual
      let mm = monthly.get(m); if (!mm) { mm = { v: 0, e: new Array(ne).fill(0), buyers: new Set(), docs: new Set(), kg: 0 }; monthly.set(m, mm); }
      mm.v += t; mm.e[e] += t; mm.buyers.add(c); mm.docs.add(doc); mm.kg += kg;
      if (!freightIdx.has(p) || o.freight) { let pm = prodMonthly.get(p); if (!pm) { pm = new Map(); prodMonthly.set(p, pm); } pm.set(m, (pm.get(m) || 0) + t); }

      // deuda (estado al corte, no depende del periodo)
      if (L.s[i] > 0) {
        const s = L.s[i], late = cut - L.v[i];
        saldo += s; k.saldo += s;
        let ed = empDebt.get(e); if (!ed) { ed = { s: 0, v: 0 }; empDebt.set(e, ed); } ed.s += s;
        if (late > 0) { vencido += s; k.venc += s; ed.v += s; if (late > k.oldest) k.oldest = late; }
        aging[late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4] += s;
      }

      if (!inP && !inC) continue;
      const keys = [[emp, e], [sell, r[4]], [zone, r[2]], [empZone, `${e}|${r[2]}`], [empSell, `${e}|${r[4]}`], [zoneEmp, `${r[2]}|${e}`]];
      const pKeys = !freightIdx.has(p) || o.freight ? [[prod, p], [empProd, `${e}|${p}`]] : [];
      if (inP) {
        sales += t; kgP += kg; docsP.add(doc); buyersP.add(c);
        if (freightIdx.has(p)) { freightP += t; empFreight.set(e, (empFreight.get(e) || 0) + t); }
        k.p += t; k.docsP.add(doc); k.empP.add(e);
        for (const [map, key] of keys) { const s = slot(map, key); s.p += t; s.kg += kg; s.buyersP.add(c); s.docsP.add(doc); }
        for (const [map, key] of pKeys) {
          const s = slot(map, key, { minPr: Infinity, maxPr: 0, lines: 0 });
          s.p += t; s.up += u; s.kg += kg; s.buyersP.add(c); s.docsP.add(doc); s.lines++;
          const pr = u ? t / u : 0; if (pr > 0) { if (pr < s.minPr) s.minPr = pr; if (pr > s.maxPr) s.maxPr = pr; }
        }
        if (!freightIdx.has(p)) { let inv = invoicesP.get(doc); if (!inv) { inv = new Set(); invoicesP.set(doc, inv); } inv.add(p); }
      } else {
        salesC += t; kgC += kg; docsC.add(doc); buyersC.add(c);
        k.cc += t; k.empC.add(e);
        for (const [map, key] of keys) { const s = slot(map, key); s.c += t; s.kgC += kg; s.buyersC.add(c); s.docsC.add(doc); }
        for (const [map, key] of pKeys) { const s = slot(map, key, { minPr: Infinity, maxPr: 0, lines: 0 }); s.c += t; s.uc += u; s.kgC += kg; s.buyersC.add(c); }
      }
    }

    /* Cartera: clientes de la hoja CLIENTES dentro del recorte */
    const nsheet = ds.nsheet || CL.length;
    let cartera = 0;
    const carteraBySeller = new Map();
    for (let c = 0; c < nsheet; c++) if (cOK[c]) { cartera++; carteraBySeller.set(CL[c][4], (carteraBySeller.get(CL[c][4]) || 0) + 1); }

    /* ---------- Indicadores ---------- */
    const pDays = P.to - P.from + 1;
    const lastM = P.months[P.months.length - 1];
    const projection = per.partialP && P.months.length === 1 ? { value: (sales / Math.max(1, P.to - mStart(lastM) + 1)) * (mEnd(lastM) - mStart(lastM) + 1), days: P.to - mStart(lastM) + 1, total: mEnd(lastM) - mStart(lastM) + 1 } : null;
    // promedio de los 3 meses completos anteriores al periodo (referencia mensual)
    const ref3 = monthRange(addMonths(P.months[0], -3), addMonths(P.months[0], -1));
    const avg3 = ref3[0] >= info.months[0] ? ref3.reduce((a, m) => a + (monthly.get(m)?.v || 0), 0) / 3 : null;
    const monthlyEquivalent = P.months.length ? sales / P.months.length : sales;

    const newClients = [], lostClients = [];
    for (const k of cli.values()) {
      if (k.p > 0 && k.first >= P.from && P.from > info.minDay + 60) newClients.push(k);
      if (hasC && k.cc > 0 && k.p === 0) lostClients.push(k);
    }
    const lostValue = lostClients.reduce((a, k) => a + k.cc, 0);
    const kpis = {
      sales, salesC, salesChange: hasC ? change(sales, salesC) : null, avg3, vsAvg3: avg3 && P.months.length === 1 && !per.partialP ? change(sales, avg3) : null,
      buyers: buyersP.size, buyersC: buyersC.size, buyersChange: hasC ? change(buyersP.size, buyersC.size) : null,
      cartera, activation: share(buyersP.size, cartera), activationC: hasC ? share(buyersC.size, cartera) : null,
      docs: docsP.size, docsC: docsC.size, ticket: docsP.size ? sales / docsP.size : 0, ticketC: docsC.size ? salesC / docsC.size : 0,
      kg: kgP, kgC, kgChange: hasC ? change(kgP, kgC) : null, pricePerKg: kgP ? sales / kgP : 0,
      freight: freightP, freightShare: share(freightP, sales),
      saldo, vencido, vencidoShare: share(vencido, saldo), aging,
      newClients: newClients.length, newValue: newClients.reduce((a, k) => a + k.p, 0),
      lost: lostClients.length, lostValue, pDays, projection, monthlyEquivalent,
    };
    kpis.ticketChange = hasC ? change(kpis.ticket, kpis.ticketC) : null;
    const alert = o.dropAlert || 10;
    const tone = (chg, invert) => (chg == null ? "neutral" : (invert ? -chg : chg) <= -alert ? "bad" : (invert ? -chg : chg) < 0 ? "warn" : "good");
    const kpiCards = [
      { id: "sales", label: "Venta", value: fmt.moneyShort(sales), sub: per.fair ? "vs. mismos días del mes anterior" : hasC ? `vs. ${per.compareLabel.toLowerCase()}` : "sin comparación", chg: kpis.salesChange, tone: tone(kpis.salesChange) },
      { id: "buyers", label: "Clientes que compraron", value: fmt.int(kpis.buyers), sub: `${fmt.pct(kpis.activation)} de ${fmt.int(cartera)} en cartera`, chg: kpis.buyersChange, tone: tone(kpis.buyersChange) },
      { id: "ticket", label: "Ticket por factura", value: fmt.money(kpis.ticket), sub: `${fmt.int(kpis.docs)} facturas`, chg: kpis.ticketChange, tone: tone(kpis.ticketChange) },
      { id: "kg", label: "Peso despachado", value: fmt.peso(kgP), sub: kgP ? `${fmt.money(kpis.pricePerKg)} de venta por kg` : "", chg: kpis.kgChange, tone: tone(kpis.kgChange) },
      { id: "new", label: "Clientes nuevos", value: fmt.int(kpis.newClients), sub: `${fmt.moneyShort(kpis.newValue)} en compras`, chg: null, tone: kpis.newClients ? "good" : "neutral" },
      { id: "lost", label: "Dejaron de comprar", value: hasC ? fmt.int(kpis.lost) : "-", sub: hasC ? `${fmt.moneyShort(lostValue)} que compraban antes` : "sin comparación", chg: null, tone: hasC && kpis.lost ? (lostValue > sales * 0.1 ? "bad" : "warn") : "neutral" },
      { id: "vencido", label: "Saldo vencido", value: fmt.moneyShort(vencido), sub: `${fmt.pct(kpis.vencidoShare)} de ${fmt.moneyShort(saldo)} por cobrar`, chg: null, tone: kpis.vencidoShare >= 40 ? "bad" : kpis.vencidoShare >= 25 ? "warn" : "good" },
      { id: "over90", label: "Vencido más de 90 días", value: fmt.moneyShort(aging[4]), sub: `${fmt.pct(share(aging[4], saldo))} del saldo`, chg: null, tone: share(aging[4], saldo) >= 15 ? "bad" : aging[4] > 0 ? "warn" : "good" },
    ];

    /* ---------- Puente de variación (por qué subió o bajó la venta) ---------- */
    let bridge = null;
    if (hasC) {
      const b = { start: salesC, lost: 0, fresh: 0, up: 0, down: 0, end: sales, nLost: 0, nNew: 0, nUp: 0, nDown: 0 };
      for (const k of cli.values()) {
        if (k.cc > 0 && k.p === 0) { b.lost -= k.cc; b.nLost++; }
        else if (k.cc === 0 && k.p > 0) { b.fresh += k.p; b.nNew++; }
        else if (k.p > k.cc) { b.up += k.p - k.cc; b.nUp++; }
        else if (k.p < k.cc) { b.down += k.p - k.cc; b.nDown++; }
      }
      // efecto precio y volumen en productos que se vendieron en ambos periodos
      let priceFx = 0, volFx = 0, mixFx = 0;
      for (const s of prod.values()) {
        if (s.up > 0 && s.uc > 0) { const pp = s.p / s.up, pc = s.c / s.uc; priceFx += (pp - pc) * s.up; volFx += (s.up - s.uc) * pc; }
        else mixFx += s.p - s.c;
      }
      b.priceFx = priceFx; b.volFx = volFx; b.mixFx = mixFx;
      bridge = b;
    }

    /* ---------- Tendencia mensual ---------- */
    const trend = info.months.map((m) => {
      const x = monthly.get(m);
      return { m, label: monthShort(m), v: x ? x.v : 0, e: x ? x.e.slice() : new Array(ne).fill(0), buyers: x ? x.buyers.size : 0, docs: x ? x.docs.size : 0, kg: x ? x.kg : 0, inP: P.months.includes(m), inC: hasC && C.months.includes(m), partial: m === info.last && info.partial };
    });

    /* ---------- Filas genéricas ---------- */
    const row = (s, name) => ({
      name, p: s.p, c: s.c, chg: hasC ? change(s.p, s.c) : null, diff: s.p - s.c, share: share(s.p, sales), buyers: s.buyersP.size, buyersC: s.buyersC.size,
      docs: s.docsP.size, ticket: s.docsP.size ? s.p / s.docsP.size : 0, kg: s.kg, units: s.up, unitsC: s.uc,
      price: s.up ? s.p / s.up : 0, priceC: s.uc ? s.c / s.uc : 0, minPr: s.minPr, maxPr: s.maxPr,
    });
    const empName = (e) => D.empresas[e];
    const prodName = (p) => D.productos[p];

    /* ---------- Productos ---------- */
    const products = [...prod.values()].map((s) => ({ ...row(s, prodName(s.key)), idx: s.key, code: D.codigos[s.key] || "" })).filter((x) => x.p > 0 || x.c > 0);
    const prodSold = products.filter((x) => x.p > 0).sort(byDesc("p"));
    const prodTotal = prodSold.reduce((a, x) => a + x.p, 0);
    let acc = 0;
    const abc = { A: { n: 0, v: 0 }, B: { n: 0, v: 0 }, C: { n: 0, v: 0 } };
    prodSold.forEach((x) => { acc += x.p; x.abc = acc / prodTotal <= 0.8 || x === prodSold[0] ? "A" : acc / prodTotal <= 0.95 ? "B" : "C"; abc[x.abc].n++; abc[x.abc].v += x.p; });
    const avgShare = prodSold.length ? 100 / prodSold.length : 0;
    const quad = { estrella: [], vaca: [], promesa: [], alerta: [] };
    prodSold.forEach((x) => {
      const big = x.share >= avgShare, grow = x.chg == null || x.chg >= 0;
      x.quad = big ? (grow ? "estrella" : "vaca") : grow ? "promesa" : "alerta";
      quad[x.quad].push(x);
    });
    const newProducts = prodSold.filter((x) => x.c === 0 && hasC).slice(0, topN);
    const noSale = products.filter((x) => x.p === 0 && x.c > 0).sort(byDesc("c")).slice(0, topN);
    const risers = hasC ? products.filter((x) => x.p > 0 && x.c > 0 && x.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, topN) : [];
    const fallers = hasC ? products.filter((x) => x.c > 0 && x.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, topN) : [];
    // tres meses seguidos a la baja (meses completos hasta el cierre)
    const last3 = monthRange(addMonths(info.lastFull, -3), info.lastFull);
    const declining3 = [];
    for (const [p, pm] of prodMonthly) {
      const v = last3.map((m) => pm.get(m) || 0);
      if (v[0] > 0 && v[1] < v[0] && v[2] < v[1] && v[3] < v[2]) declining3.push({ name: prodName(p), v, drop: change(v[3], v[0]) });
    }
    declining3.sort((a, b) => (b.v[0] - b.v[3]) - (a.v[0] - a.v[3]));
    const priceSpread = prodSold.filter((x) => x.lines >= 0 && x.minPr > 0 && x.maxPr / x.minPr >= 1.25 && x.p >= prodTotal * 0.002)
      .map((x) => ({ ...x, spread: (x.maxPr / x.minPr - 1) * 100 })).sort((a, b) => b.p - a.p).slice(0, topN);
    const priceMoves = hasC ? products.filter((x) => x.units > 0 && x.unitsC > 0 && x.p >= prodTotal * 0.003).map((x) => ({ ...x, priceChg: change(x.price, x.priceC) }))
      .filter((x) => Math.abs(x.priceChg) >= 3).sort((a, b) => Math.abs(b.priceChg) * b.p - Math.abs(a.priceChg) * a.p).slice(0, topN) : [];
    // pares que se compran juntos en la misma factura
    const pairCount = new Map(), single = new Map();
    let invN = 0;
    for (const set of invoicesP.values()) {
      const arr = [...set];
      invN++;
      arr.forEach((p) => single.set(p, (single.get(p) || 0) + 1));
      if (arr.length > 40) continue;
      for (let a = 0; a < arr.length; a++) for (let b = a + 1; b < arr.length; b++) {
        const key = arr[a] < arr[b] ? `${arr[a]}|${arr[b]}` : `${arr[b]}|${arr[a]}`;
        pairCount.set(key, (pairCount.get(key) || 0) + 1);
      }
    }
    const pairs = [...pairCount].filter(([, v]) => v >= 3).map(([k, v]) => {
      const [a, b] = k.split("|").map(Number);
      const lift = invN ? (v / invN) / ((single.get(a) / invN) * (single.get(b) / invN)) : 0;
      return { a: prodName(a), b: prodName(b), n: v, pct: share(v, invN), conf: share(v, Math.min(single.get(a), single.get(b))), lift };
    }).sort((x, y) => y.n - x.n).slice(0, topN);
    const topKg = prodSold.filter((x) => x.kg > 0).sort(byDesc("kg")).slice(0, topN);

    /* ---------- Empresas ---------- */
    const empRows = [...emp.values()].map((s) => {
      const r = row(s, empName(s.key));
      const debt = empDebt.get(s.key) || { s: 0, v: 0 };
      return { ...r, idx: s.key, activation: share(r.buyers, cartera), saldo: debt.s, vencido: debt.v };
    }).sort(byDesc("p"));
    const empresas = empRows.map((er) => {
      const e = er.idx;
      const pick = (map) => [...map.values()].filter((s) => +String(s.key).split("|")[0] === e);
      const eProducts = pick(empProd).map((s) => ({ ...row(s, prodName(+s.key.split("|")[1])) })).map((x) => ({ ...x, share: share(x.p, er.p) }));
      const eZones = pick(empZone).map((s) => ({ ...row(s, s.key.split("|").slice(1).join("|")), share: share(s.p, er.p) })).sort(byDesc("p"));
      const eSellers = pick(empSell).map((s) => ({ ...row(s, s.key.split("|").slice(1).join("|")), share: share(s.p, er.p) })).sort(byDesc("p"));
      const freightE = empFreight.get(e) || 0;
      // clientes que dejaron esta empresa pero siguen comprando otras
      const left = [];
      for (const [c, le] of lastByEmp) {
        const k = cli.get(c);
        if (!le[e] || cut - le[e] <= riskDays) continue;
        const other = le.some((d, j) => j !== e && d && cut - d <= riskDays);
        if (!other) continue;
        const months = Math.max(1, (cut - firstByEmp.get(c)[e]) / 30.4);
        const monthlyV = histByEmp.get(c)[e] / months;
        const others = le.map((d, j) => (j !== e && d && cut - d <= riskDays ? D.empresas[j] : null)).filter(Boolean);
        left.push({ name: CL[c][0], seller: CL[c][4], zone: CL[c][2], days: cut - le[e], monthly: monthlyV, others: others.join(", "), phone: CL[c][5], k });
      }
      left.sort(byDesc("monthly"));
      const eTrend = trend.map((t) => ({ label: t.label, v: t.e[e], inP: t.inP, inC: t.inC, partial: t.partial }));
      const soldProds = eProducts.filter((x) => x.p > 0).sort(byDesc("p"));
      return {
        ...er, trend: eTrend, freight: freightE, salesNoFreight: er.p - freightE,
        products: soldProds.slice(0, Math.max(15, topN)), productsCount: soldProds.length,
        risers: hasC ? eProducts.filter((x) => x.c > 0 && x.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, 5) : [],
        fallers: hasC ? eProducts.filter((x) => x.c > 0 && x.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, 5) : [],
        zones: eZones.slice(0, topN), sellers: eSellers.slice(0, topN),
        left: left.slice(0, topN), leftCount: left.length, leftValue: left.reduce((a, x) => a + x.monthly, 0),
        top3Share: soldProds.slice(0, 3).reduce((a, x) => a + x.share, 0),
      };
    });

    /* ---------- Clientes ---------- */
    const clientsAll = [...cli.values()].filter((k) => k.total > 0);
    const valueRank = clientsAll.map((k) => k.total).sort((a, b) => b - a);
    const top20Cut = valueRank[Math.max(0, Math.floor(valueRank.length * 0.2) - 1)] || 0;
    const SEG = [
      { id: "campeones", label: "Campeones", note: "Compraron hace poco, seguido y por montos altos." },
      { id: "leales", label: "Leales", note: "Compran con frecuencia y siguen activos." },
      { id: "nuevos", label: "Nuevos", note: "Primera compra en los últimos 60 días." },
      { id: "riesgo", label: "En riesgo", note: "Compraban con frecuencia y llevan de 31 a 90 días sin comprar." },
      { id: "ocasionales", label: "Ocasionales", note: "Compras esporádicas o de bajo monto." },
      { id: "dormidos", label: "Dormidos", note: "Más de 90 días sin comprar." },
    ];
    const segMap = new Map(SEG.map((s) => [s.id, { ...s, n: 0, v: 0, vP: 0, rec: 0, clients: [] }]));
    clientsAll.forEach((k) => {
      const R = cut - k.last, F = k.months.size;
      k.recency = R; k.freq = F;
      k.seg = cut - k.first <= 60 ? "nuevos" : R > 90 ? "dormidos" : R <= 30 && k.total >= top20Cut && F >= 3 ? "campeones" : R <= 45 && F >= 4 ? "leales" : R > 30 && F >= 3 ? "riesgo" : "ocasionales";
      const s = segMap.get(k.seg); s.n++; s.v += k.total; s.vP += k.p; s.rec += R; s.clients.push(k);
    });
    const totalHist = clientsAll.reduce((a, k) => a + k.total, 0);
    const segments = [...segMap.values()].map((s) => ({ ...s, share: share(s.v, totalHist), avgRec: s.n ? s.rec / s.n : 0, clients: undefined }));
    const cInfo = (k) => ({ name: CL[k.c][0], seller: CL[k.c][4], zone: CL[k.c][2], type: CL[k.c][3], phone: CL[k.c][5], code: CL[k.c][1] });
    // ritmo de compra: clientes con compras regulares que ya se pasaron de su fecha habitual
    const overdue = [];
    clientsAll.forEach((k) => {
      if (k.days.size < 3) return;
      const days = [...k.days].sort((a, b) => a - b);
      const gaps = []; for (let j = 1; j < days.length; j++) gaps.push(days[j] - days[j - 1]);
      gaps.sort((a, b) => a - b);
      const med = gaps[Math.floor(gaps.length / 2)];
      const since = cut - k.last;
      k.rhythm = med;
      if (med >= 3 && since > Math.max(med * 1.5, med + 7) && since <= 180) {
        const span = Math.max(1, (cut - k.first) / 30.4);
        overdue.push({ ...cInfo(k), rhythm: med, since, late: since - med, expected: dayToDate(k.last + med), monthly: k.total / Math.max(1, span), ticket: k.total / k.docs.size, k });
      }
    });
    overdue.sort((a, b) => b.monthly - a.monthly);
    const topClients = clientsAll.filter((k) => k.p > 0).sort((a, b) => b.p - a.p).slice(0, Math.max(20, topN))
      .map((k) => ({ ...cInfo(k), p: k.p, c: k.cc, chg: hasC ? change(k.p, k.cc) : null, share: share(k.p, sales), empresas: k.empP.size, last: dayToDate(k.last), seg: segMap.get(k.seg).label, venc: k.venc }));
    const decliningClients = hasC ? clientsAll.filter((k) => k.cc > 0 && k.p > 0 && k.p < k.cc * 0.7).sort((a, b) => (a.p - a.cc) - (b.p - b.cc)).slice(0, topN)
      .map((k) => ({ ...cInfo(k), p: k.p, c: k.cc, diff: k.p - k.cc, chg: change(k.p, k.cc) })) : [];
    const lostList = lostClients.sort((a, b) => b.cc - a.cc).slice(0, topN).map((k) => ({ ...cInfo(k), c: k.cc, last: dayToDate(k.last), days: cut - k.last, empresas: [...k.empC].map(empName).join(", ") }));
    const newList = newClients.sort((a, b) => b.p - a.p).slice(0, topN).map((k) => ({ ...cInfo(k), p: k.p, first: dayToDate(k.first), empresas: [...k.empP].map(empName).join(", ") }));
    // cohortes: de los que compraron por primera vez en cada mes, cuántos volvieron a comprar
    const cohortMonths = info.months.slice(-8);
    const cohorts = cohortMonths.map((m) => {
      const members = clientsAll.filter((k) => monthOf(k.first) === m);
      const cells = [];
      for (let j = 0; j < 7; j++) {
        const mm = addMonths(m, j);
        if (mm > info.last) break;
        cells.push(members.length ? share(members.filter((k) => k.months.has(mm)).length, members.length) : null);
      }
      return { m, label: monthShort(m), n: members.length, cells };
    }).filter((x) => x.n > 0);
    // mapa de empresas por cliente (en el periodo)
    const combo = new Map();
    let multi = 0;
    for (const k of cli.values()) {
      if (!k.empP.size) continue;
      if (k.empP.size > 1) multi++;
      const key = [...k.empP].map(empName).sort().join(" + ");
      const x = combo.get(key) || { name: key, n: 0, v: 0, count: k.empP.size }; x.n++; x.v += k.p; combo.set(key, x);
    }
    const combos = [...combo.values()].sort(byDesc("n"));
    const crossSell = [];
    if (D.empresas.length > 1) {
      D.empresas.forEach((name, e) => {
        if (empSet && !empSet.has(e)) return;
        const buyersE = [...cli.values()].filter((k) => k.empP.has(e));
        const others = D.empresas.map((nm, j) => ({ nm, j })).filter((x) => x.j !== e && (!empSet || empSet.has(x.j)));
        others.forEach(({ nm, j }) => {
          const without = buyersE.filter((k) => !k.empP.has(j));
          if (buyersE.length) crossSell.push({ from: name, to: nm, n: without.length, of: buyersE.length, pct: share(without.length, buyersE.length) });
        });
      });
    }

    /* ---------- Vendedores ---------- */
    const debtBySeller = new Map();
    for (const k of cli.values()) { const s = CL[k.c][4]; const x = debtBySeller.get(s) || { s: 0, v: 0, v90: 0 }; x.s += k.saldo; x.v += k.venc; if (k.oldest > 90) x.v90 += k.venc; debtBySeller.set(s, x); }
    const overdueBySeller = new Map(); overdue.forEach((x) => overdueBySeller.set(x.seller, (overdueBySeller.get(x.seller) || 0) + 1));
    const newBySeller = new Map(); newClients.forEach((k) => newBySeller.set(CL[k.c][4], (newBySeller.get(CL[k.c][4]) || 0) + 1));
    const lostBySeller = new Map(); lostClients.forEach((k) => lostBySeller.set(CL[k.c][4], (lostBySeller.get(CL[k.c][4]) || 0) + 1));
    let sellers = [...sell.values()].map((s) => {
      const r = row(s, s.key);
      const cart = carteraBySeller.get(s.key) || 0;
      const debt = debtBySeller.get(s.key) || { s: 0, v: 0, v90: 0 };
      return { ...r, cartera: cart, activation: cart ? share(r.buyers, cart) : null, newC: newBySeller.get(s.key) || 0, lost: lostBySeller.get(s.key) || 0, saldo: debt.s, vencido: debt.v, vencidoShare: share(debt.v, debt.s), overdue: overdueBySeller.get(s.key) || 0 };
    }).filter((x) => x.p > 0 || x.c > 0);
    const maxAct = Math.max(1, ...sellers.map((x) => x.activation || 0));
    sellers.forEach((x) => {
      const act = (x.activation || 0) / maxAct;
      const grow = x.chg == null ? 0.5 : Math.max(0, Math.min(1, 0.5 + x.chg / 100));
      const coll = 1 - Math.min(1, x.vencidoShare / 100);
      x.score = Math.round((act * 0.4 + grow * 0.3 + coll * 0.3) * 100);
    });
    sellers.sort(byDesc("p"));

    /* ---------- Zonas ---------- */
    const zones = [...zone.values()].map((s) => row(s, s.key)).filter((x) => x.p > 0 || x.c > 0).sort(byDesc("p"));
    const matrixZones = zones.slice(0, Math.max(12, topN));
    const zoneMatrix = {
      empresas: empRows.map((x) => x.name),
      rows: matrixZones.map((z) => ({ name: z.name, total: z.p, chg: z.chg, cells: empRows.map((er) => (zoneEmp.get(`${z.name}|${er.idx}`) || { p: 0 }).p) })),
    };

    /* ---------- Cobranza ---------- */
    const debtorsAll = [...cli.values()].filter((k) => k.saldo > 0.5).sort((a, b) => b.venc - a.venc || b.saldo - a.saldo)
      .map((k) => ({ ...cInfo(k), saldo: k.saldo, venc: k.venc, oldest: k.oldest, buying: anyLast.get(k.c) >= cut - riskDays, lastBuy: dayToDate(k.last) }));
    const debtors = debtorsAll.slice(0, Math.max(15, topN));
    const stillBuying = [...cli.values()].filter((k) => k.venc > 0 && anyLast.get(k.c) >= cut - riskDays).sort((a, b) => b.venc - a.venc);
    const stillBuyingValue = stillBuying.reduce((a, k) => a + k.venc, 0);
    const debtSellers = sellers.filter((x) => x.saldo > 0).sort((a, b) => b.vencido - a.vencido).slice(0, topN);
    const agingRows = ["Por vencer", "1 a 30 días", "31 a 60 días", "61 a 90 días", "Más de 90 días"].map((label, j) => ({ label, v: aging[j], share: share(aging[j], saldo) }));

    /* ---------- Recuperación (clientes que compraban y ya no) ---------- */
    const recover = overdue.slice(0, Math.max(15, topN));
    const recoverValue = overdue.reduce((a, x) => a + x.monthly, 0);

    /* ---------- Conclusiones ---------- */
    const conclusions = [];
    const say = (tone, text, weight) => conclusions.push({ tone, text, weight: weight || 1 });
    if (hasC && kpis.salesChange != null) {
      const up = kpis.salesChange >= 0;
      const main = bridge ? [["clientes que dejaron de comprar", bridge.lost], ["clientes nuevos o que volvieron", bridge.fresh], ["clientes que compraron más", bridge.up], ["clientes que compraron menos", bridge.down]].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0] : null;
      say(up ? "good" : kpis.salesChange <= -alert ? "bad" : "warn",
        `La venta ${per.fair ? "del mes en curso " : ""}fue de ${fmt.money(sales)}, ${up ? "un aumento" : "una caída"} de ${fmt.pct(Math.abs(kpis.salesChange))} frente a ${per.fair ? "los mismos días del mes anterior" : per.compareLabel.toLowerCase()}${main ? `; el factor que más pesó fueron los ${main[0]} (${main[1] >= 0 ? "+" : "-"}${fmt.moneyShort(Math.abs(main[1]))})` : ""}.`, 5);
    } else say("neutral", `La venta del periodo fue de ${fmt.money(sales)} en ${fmt.int(kpis.docs)} facturas.`, 5);
    if (projection) say("neutral", `Al ritmo actual, el mes cerraría cerca de ${fmt.money(projection.value)} (${projection.days} de ${projection.total} días transcurridos).`, 3);
    if (empresas.length > 1) {
      const e0 = empresas[0], grow = empresas.filter((x) => x.chg != null).sort((a, b) => b.chg - a.chg);
      say("neutral", `${e0.name} concentra el ${fmt.pct(e0.share)} de la venta${grow.length > 1 ? `; la de mejor evolución fue ${grow[0].name} (${fmt.signedPct(grow[0].chg)}) y la de peor evolución ${grow[grow.length - 1].name} (${fmt.signedPct(grow[grow.length - 1].chg)})` : ""}.`, 4);
    }
    if (bridge && hasC && (bridge.priceFx || bridge.volFx)) {
      const pf = bridge.priceFx, vf = bridge.volFx;
      say(pf + vf >= 0 ? "good" : "warn", `En los productos que se vendieron en ambos periodos, el cambio de precios aportó ${fmt.signedMoney(pf)} y el cambio de volumen ${fmt.signedMoney(vf)}.`, 3);
    }
    say(kpis.activation >= 50 ? "good" : kpis.activation >= 30 ? "warn" : "bad", `Compró el ${fmt.pct(kpis.activation)} de la cartera (${fmt.int(kpis.buyers)} de ${fmt.int(cartera)} clientes)${hasC && kpis.activationC != null ? `, frente a ${fmt.pct(kpis.activationC)} en el periodo anterior` : ""}.`, 4);
    if (hasC && kpis.lost) say(lostValue > sales * 0.1 ? "bad" : "warn", `${fmt.int(kpis.lost)} clientes que compraban en el periodo anterior no han vuelto a comprar; representaban ${fmt.money(lostValue)}.`, 4);
    if (overdue.length) say("warn", `${fmt.int(overdue.length)} clientes con compra regular ya pasaron su fecha habitual de pedido; juntos compran unos ${fmt.money(recoverValue)} al mes.`, 4);
    if (vencido > 0) say(kpis.vencidoShare >= 40 ? "bad" : kpis.vencidoShare >= 25 ? "warn" : "good", `El saldo vencido es ${fmt.money(vencido)} (${fmt.pct(kpis.vencidoShare)} de lo que está por cobrar); ${fmt.money(aging[4])} tiene más de 90 días.`, 4);
    if (stillBuying.length) say("warn", `${fmt.int(stillBuying.length)} clientes con saldo vencido siguen comprando (${fmt.money(stillBuyingValue)} vencidos); conviene condicionar nuevos despachos.`, 3);
    if (abc.A.n) say("neutral", `${fmt.int(abc.A.n)} productos (${fmt.pct(share(abc.A.n, prodSold.length))} del catálogo vendido) generan el 80% de la venta de productos.`, 2);
    if (declining3.length) say("warn", `${fmt.int(declining3.length)} productos llevan tres meses seguidos de caída; el más afectado es ${declining3[0].name}.`, 2);
    const leftTot = empresas.reduce((a, x) => a + x.leftCount, 0);
    if (leftTot) say("warn", `${fmt.int(leftTot)} clientes dejaron de comprar a una empresa del grupo pero siguen comprando a otra: son la recuperación más fácil.`, 3);
    if (sellers.length > 1) {
      const best = [...sellers].filter((x) => x.cartera >= 20 && !/^(VACANTE|SIN VENDEDOR|OFICINA|INTERNO)$/i.test(x.name)).sort((a, b) => b.score - a.score);
      if (best.length > 1) say("neutral", `Mejor desempeño integral: ${best[0].name} (${best[0].score} puntos); el más rezagado es ${best[best.length - 1].name} (${best[best.length - 1].score} puntos).`, 2);
    }
    conclusions.sort((a, b) => b.weight - a.weight);

    /* ---------- Alertas y plan de acción ---------- */
    const actions = [];
    const act = (priority, who, text, value, valueLabel) => actions.push({ priority, who, text, value, valueLabel });
    const bySellerSum = (list, f) => { const m = new Map(); list.forEach((x) => { const s = m.get(x.seller) || { n: 0, v: 0 }; s.n++; s.v += f(x); m.set(x.seller, s); }); return [...m].sort((a, b) => b[1].v - a[1].v); };
    bySellerSum(overdue, (x) => x.monthly).slice(0, 3).forEach(([s, x]) => act(1, s, `Llamar a ${fmt.int(x.n)} clientes que ya pasaron su fecha habitual de compra.`, x.v, "al mes"));
    if (stillBuying.length) act(1, "Cobranza", `Condicionar despachos a ${fmt.int(stillBuying.length)} clientes que compran con saldo vencido.`, stillBuyingValue, "vencido");
    if (aging[4] > 0) act(1, "Cobranza", `Gestionar el saldo con más de 90 días de vencido.`, aging[4], "vencido");
    empresas.filter((x) => x.leftCount).sort((a, b) => b.leftValue - a.leftValue).slice(0, 2).forEach((x) => act(2, `Ventas ${x.name}`, `Ofrecer ${x.name} a ${fmt.int(x.leftCount)} clientes que la dejaron pero compran otras empresas.`, x.leftValue, "al mes"));
    if (hasC && kpis.lost) act(2, "Gerencia de ventas", `Revisar con cada vendedor los ${fmt.int(kpis.lost)} clientes que no repitieron compra.`, lostValue, "periodo anterior");
    if (declining3.length) act(3, "Gerencia comercial", `Revisar precio, inventario y competencia de ${fmt.int(declining3.length)} productos en caída sostenida.`, null);
    if (priceSpread.length) act(3, "Gerencia comercial", `Unificar precios: ${fmt.int(priceSpread.length)} productos se vendieron con diferencias de precio de 25% o más.`, null);
    if (crossSell.length) { const cs = [...crossSell].sort((a, b) => b.n - a.n)[0]; if (cs.n) act(3, "Ventas", `Venta cruzada: ${fmt.int(cs.n)} clientes compran ${cs.from} pero no ${cs.to}.`, null); }
    actions.sort((a, b) => a.priority - b.priority || (b.value || 0) - (a.value || 0));

    return {
      v: 2, options: o, info, P, C, hasC, per, periodLabel: per.label, compareLabel: per.compareLabel, fair: per.fair, partial: per.partialP,
      audience: AUDIENCES[o.audience] || AUDIENCES.general, filters, empSel: empSet ? empSel : [],
      kpis, kpiCards, bridge, trend, empresas, empRows,
      products: { sold: prodSold, count: prodSold.length, abc, quad, newProducts, noSale, risers, fallers, declining3: declining3.slice(0, topN), declining3Count: declining3.length, priceSpread, priceMoves, pairs, invN, topKg, last3 },
      clients: { segments, overdue: recover, overdueAll: overdue, overdueCount: overdue.length, recoverValue, top: topClients, declining: decliningClients, lost: lostList, fresh: newList, cohorts, combos, multi, crossSell, total: clientsAll.length },
      sellers, zones, zoneMatrix,
      cobranza: { saldo, vencido, share: kpis.vencidoShare, aging: agingRows, debtors, debtorsAll, stillBuying: stillBuying.length, stillBuyingValue, bySeller: debtSellers, byEmpresa: empRows.map((x) => ({ name: x.name, saldo: x.saldo, vencido: x.vencido, share: share(x.vencido, x.saldo) })) },
      conclusions, actions,
    };
  }

  global.BipaInforme2 = { build, describe, monthName, monthShort, dayToDate, AUDIENCES };
})(typeof window !== "undefined" ? window : globalThis);
