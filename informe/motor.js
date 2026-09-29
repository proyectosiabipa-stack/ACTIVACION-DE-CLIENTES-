/* BIPA · Informe gerencial — motor de cálculo.
   Recibe el mismo paquete de datos que usa el portal (data.enc descifrado) y las
   opciones elegidas, y devuelve un modelo con cifras, tablas, conclusiones y acciones.
   La vista previa, el PDF y el texto para WhatsApp se construyen a partir de este modelo,
   así los tres siempre dicen lo mismo. */
(function (global) {
  "use strict";

  const num = (v) => {
    const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  };
  const sum = (arr, fn) => arr.reduce((a, x) => a + num(fn(x)), 0);
  const pct = (a, b) => (b ? (a / b) * 100 : null);
  const change = (now, before) => (before > 0 ? ((now - before) / before) * 100 : null);
  const norm = (s) => String(s ?? "").trim();
  const isFreight = (name) => /\bFLETE/i.test(String(name || ""));

  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const MESES_CORTOS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  const monthName = (m) => { const [y, mo] = m.split("-").map(Number); return `${MESES[mo - 1]} de ${y}`; };
  const monthShort = (m) => { const [y, mo] = m.split("-").map(Number); return `${MESES_CORTOS[mo - 1]} ${String(y).slice(2)}`; };
  const addMonths = (m, k) => { const [y, mo] = m.split("-").map(Number); const d = new Date(Date.UTC(y, mo - 1 + k, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
  const monthRange = (from, to) => { const out = []; let m = from; while (m <= to && out.length < 240) { out.push(m); m = addMonths(m, 1); } return out; };
  const daysInMonth = (m) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo, 0)).getUTCDate(); };

  function periodLabel(months) {
    if (!months.length) return "Sin periodo";
    if (months.length === 1) return capitalize(monthName(months[0]));
    const [a, b] = [months[0], months[months.length - 1]];
    const [ya] = a.split("-"); const [yb] = b.split("-");
    if (ya === yb) return capitalize(`${MESES[+a.split("-")[1] - 1]} a ${MESES[+b.split("-")[1] - 1]} de ${yb}`);
    return capitalize(`${monthName(a)} a ${monthName(b)}`);
  }
  const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  /* Meses disponibles y fecha de corte */
  function describeData(data) {
    const set = new Set();
    (data.months || []).forEach((m) => m.mes && set.add(m.mes));
    (data.detail || []).forEach((c) => (c.historial_mensual || []).forEach((h) => h.mes && set.add(h.mes)));
    const months = [...set].sort();
    const cut = data.generated_at ? new Date(data.generated_at) : null;
    const cutOk = cut && !Number.isNaN(cut.getTime()) ? cut : null;
    const last = months[months.length - 1] || null;
    let lastIsPartial = false;
    if (last && cutOk) {
      const cutMonth = `${cutOk.getFullYear()}-${String(cutOk.getMonth() + 1).padStart(2, "0")}`;
      lastIsPartial = cutMonth === last && cutOk.getDate() < daysInMonth(last);
    }
    const values = (key) => [...new Set((data.detail || []).map((c) => norm(c[key])).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
    return { months, cut: cutOk, last, lastIsPartial, sellers: values("vendedor"), zones: values("zona"), types: values("tipo_cliente") };
  }

  /* Rango de meses según el atajo de periodo */
  function resolvePeriod(info, opts) {
    const { months, last, lastIsPartial } = info;
    if (!months.length) return [];
    const lastFull = lastIsPartial && months.length > 1 ? months[months.length - 2] : last;
    switch (opts.period) {
      case "actual": return [last];
      case "trimestre": return monthRange(addMonths(lastFull, -2), lastFull).filter((m) => m >= months[0]);
      case "anio": return monthRange(`${lastFull.slice(0, 4)}-01`, last).filter((m) => m >= months[0]);
      case "todo": return months.slice();
      case "rango": {
        let a = opts.from || months[0], b = opts.to || last;
        if (a > b) [a, b] = [b, a];
        return monthRange(a, b);
      }
      case "ultimo":
      default: return [lastFull];
    }
  }

  function clientMonthSales(c, monthsSet) {
    let v = 0, docs = 0;
    (c.historial_mensual || []).forEach((h) => { if (monthsSet.has(h.mes)) { v += num(h.venta_total); docs += num(h.documentos); } });
    return { v, docs };
  }

  function groupBy(rows, key) {
    const map = new Map();
    rows.forEach((r) => { const k = norm(r[key]) || "Sin dato"; if (!map.has(k)) map.set(k, []); map.get(k).push(r); });
    return map;
  }

  const SEGMENTS = [
    { key: "ACTIVO 0-30 DIAS", label: "Activos (0 a 30 días)", tone: "good" },
    { key: "RIESGO 31-60 DIAS", label: "En riesgo (31 a 60 días)", tone: "warn" },
    { key: "INACTIVO 61-90 DIAS", label: "Inactivos (61 a 90 días)", tone: "orange" },
    { key: "DORMIDO 91-180 DIAS", label: "Dormidos (91 a 180 días)", tone: "bad" },
    { key: "OTRO", label: "Perdidos (más de 180 días)", tone: "bad" },
    { key: "NUNCA FACTURADO", label: "Nunca facturados", tone: "neutral" },
  ];
  const segmentOf = (c) => { const s = norm(c.segmento).toUpperCase(); return SEGMENTS.some((x) => x.key === s) ? s : (c.ultima_factura ? "OTRO" : "NUNCA FACTURADO"); };

  const AUDIENCES = {
    general: { label: "Gerencia general", sections: ["ventas", "cartera", "cobranza", "vendedores", "zonas", "productos"] },
    ventas: { label: "Gerencia de ventas", sections: ["ventas", "cartera", "vendedores", "zonas", "productos"] },
    cobranza: { label: "Cobranza", sections: ["cobranza", "vendedores"] },
    vendedor: { label: "Vendedor", sections: ["ventas", "cartera", "cobranza"] },
  };

  function build(data, opts, fmt) {
    const info = describeData(data);
    const o = Object.assign({ audience: "general", period: "ultimo", depth: "estandar", dropAlert: 10, riskDays: 30, topN: 10, freight: false }, opts || {});
    if (o.audience === "vendedor" && !o.seller) o.seller = info.sellers[0] || "";
    const topN = o.depth === "completo" ? Math.max(o.topN, 25) : o.depth === "ejecutivo" ? Math.min(o.topN, 5) : o.topN;

    const P = resolvePeriod(info, o);
    const C = P.length ? monthRange(addMonths(P[0], -P.length), addMonths(P[0], -1)).filter((m) => info.months.includes(m)) : [];
    const hasC = C.length === P.length && C.length > 0;
    const Pset = new Set(P), Cset = new Set(C);

    /* Recorte de la cartera */
    const filters = [];
    let rows = (data.detail || []).slice();
    if (o.seller) { rows = rows.filter((c) => norm(c.vendedor) === o.seller); filters.push(`Vendedor: ${o.seller}`); }
    if (o.zone) { rows = rows.filter((c) => norm(c.zona) === o.zone); filters.push(`Zona: ${o.zone}`); }
    if (o.type) { rows = rows.filter((c) => norm(c.tipo_cliente) === o.type); filters.push(`Tipo de cliente: ${o.type}`); }
    if (o.assignment) { rows = rows.filter((c) => c.estado_asignacion === o.assignment); filters.push(o.assignment === "VACANTE" ? "Asignación: vacantes" : "Asignación: vendedor confirmado"); }
    const filtered = filters.length > 0;
    const withHistory = rows.some((c) => Array.isArray(c.historial_mensual) && c.historial_mensual.length);

    /* Venta mensual (total del sitio cuando no hay recorte, suma de clientes cuando lo hay) */
    const monthTotals = new Map();
    if (!filtered && (data.months || []).length) {
      data.months.forEach((m) => monthTotals.set(m.mes, { v: num(m.venta_total), docs: num(m.documentos) }));
    } else {
      rows.forEach((c) => (c.historial_mensual || []).forEach((h) => {
        const t = monthTotals.get(h.mes) || { v: 0, docs: 0 };
        t.v += num(h.venta_total); t.docs += num(h.documentos); monthTotals.set(h.mes, t);
      }));
    }
    const totalIn = (ms) => ms.reduce((a, m) => { const t = monthTotals.get(m); return { v: a.v + (t ? t.v : 0), docs: a.docs + (t ? t.docs : 0) }; }, { v: 0, docs: 0 });
    const salesP = totalIn(P), salesC = totalIn(C);

    /* Por cliente */
    const clients = rows.map((c) => {
      const p = clientMonthSales(c, Pset), q = clientMonthSales(c, Cset);
      const hist = (c.historial_mensual || []).filter((h) => num(h.venta_total) > 0);
      const before = hist.filter((h) => h.mes < (P[0] || ""));
      // Venta mensual promedio desde su primera compra hasta el último mes con datos
      const first = hist.map((h) => h.mes).sort()[0];
      const span = first && info.last ? monthRange(first, info.last).length : 0;
      const avgMonthly = span ? sum(hist, (h) => h.venta_total) / span : 0;
      return { c, vP: p.v, docsP: p.docs, vC: q.v, boughtP: p.v > 0, boughtC: q.v > 0, boughtBefore: before.length > 0, avgMonthly, buyMonths: hist.length, seg: segmentOf(c) };
    });
    const buyersP = clients.filter((x) => x.boughtP);
    const buyersC = clients.filter((x) => x.boughtC);
    const newClients = buyersP.filter((x) => !x.boughtBefore);
    const lost = hasC && !(info.lastIsPartial && Pset.has(info.last)) ? clients.filter((x) => x.boughtC && !x.boughtP) : [];
    const lostMonthly = hasC ? sum(lost, (x) => x.vC) / C.length : 0;
    const carteraSize = rows.length;
    const effectiveness = pct(buyersP.length, carteraSize);
    const ticket = salesP.docs ? salesP.v / salesP.docs : 0;
    const ticketC = salesC.docs ? salesC.v / salesC.docs : 0;

    /* Concentración 80/20 */
    const sortedBuyers = buyersP.slice().sort((a, b) => b.vP - a.vP);
    const buyersTotal = sum(sortedBuyers, (x) => x.vP);
    let acc = 0, n80 = 0;
    for (const x of sortedBuyers) { acc += x.vP; n80++; if (acc >= buyersTotal * 0.8) break; }

    /* Segmentos de la cartera (estado a la fecha de corte) */
    const segments = SEGMENTS.map((s) => {
      const list = clients.filter((x) => x.seg === s.key);
      return { ...s, count: list.length, share: pct(list.length, carteraSize), sales: sum(list, (x) => x.c.venta_total) };
    }).filter((s) => s.count > 0);

    /* Clientes clave a recuperar */
    const riskDays = num(o.riskDays) || 30;
    const recover = clients
      .filter((x) => x.buyMonths >= 2 && x.avgMonthly > 0 && num(x.c.dias_sin_facturar) > riskDays)
      .sort((a, b) => b.avgMonthly - a.avgMonthly);
    const recoverTop = recover.slice(0, topN);
    const recoverValue = sum(recoverTop, (x) => x.avgMonthly);
    const riskWindow = clients.filter((x) => x.seg === "RIESGO 31-60 DIAS");

    /* Cobranza (saldo a la fecha de corte) */
    const saldo = sum(rows, (c) => c.saldo_total);
    const vencido = sum(rows, (c) => c.saldo_vencido);
    const debtors = rows.filter((c) => num(c.saldo_vencido) > 0).sort((a, b) => num(b.saldo_vencido) - num(a.saldo_vencido));

    /* Vendedores y zonas */
    const groupTable = (key) => [...groupBy(clients.map((x) => ({ ...x, [key]: x.c[key] })), key)].map(([name, list]) => {
      const vP = sum(list, (x) => x.vP), vC = sum(list, (x) => x.vC);
      const buyers = list.filter((x) => x.boughtP).length;
      return { name, cartera: list.length, buyers, eff: pct(buyers, list.length), vP, vC, delta: vP - vC, change: hasC ? change(vP, vC) : null, share: pct(vP, sum(clients, (x) => x.vP)), vencido: sum(list, (x) => x.c.saldo_vencido), saldo: sum(list, (x) => x.c.saldo_total) };
    }).sort((a, b) => b.vP - a.vP);
    const sellers = groupTable("vendedor");
    const zones = groupTable("zona");

    /* Productos (sin recorte por vendedor o zona: el paquete no los vincula) */
    const arts = (Array.isArray(data.articulos) ? data.articulos : []).filter((a) => o.freight || !isFreight(a.producto));
    const artRows = arts.map((a) => {
      const h = Array.isArray(a.historial_mensual) ? a.historial_mensual : [];
      const pick = (set, k) => sum(h.filter((x) => set.has(x.mes)), (x) => x[k]);
      return { name: norm(a.producto) || "Sin nombre", vP: pick(Pset, "venta_total"), vC: pick(Cset, "venta_total"), kgP: pick(Pset, "peso_total"), kgC: pick(Cset, "peso_total"), uP: pick(Pset, "unidades") };
    }).filter((a) => a.vP > 0 || a.vC > 0);
    const artTotal = sum(artRows, (a) => a.vP);
    const products = artRows.filter((a) => a.vP > 0).sort((a, b) => b.vP - a.vP).map((a) => ({ ...a, share: pct(a.vP, artTotal), change: hasC ? change(a.vP, a.vC) : null }));
    const kgP = sum(artRows, (a) => a.kgP), kgC = sum(artRows, (a) => a.kgC);
    const productDrops = hasC ? artRows.filter((a) => a.vC > 0).map((a) => ({ ...a, delta: a.vP - a.vC })).sort((a, b) => a.delta - b.delta) : [];

    /* Tendencia (hasta 12 meses que terminan en el periodo) */
    const trendMonths = info.months.filter((m) => m <= P[P.length - 1]).slice(-12);
    const trend = trendMonths.map((m) => ({ mes: m, label: monthShort(m), v: (monthTotals.get(m) || { v: 0 }).v, inP: Pset.has(m), inC: Cset.has(m) }));

    /* Proyección de cierre del mes en curso */
    let projection = null;
    if (info.lastIsPartial && Pset.has(info.last) && info.cut) {
      const day = info.cut.getDate(), dim = daysInMonth(info.last);
      const done = (monthTotals.get(info.last) || { v: 0 }).v;
      const prev = monthTotals.get(addMonths(info.last, -1));
      projection = { month: info.last, day, dim, done, value: (done / day) * dim, prev: prev ? prev.v : null };
    }

    // Mes en curso: comparar un mes incompleto contra uno completo engaña, se usa la proyección
    const partial = !!projection;
    const salesChange = hasC && !partial ? change(salesP.v, salesC.v) : null;
    const m = {
      options: o, info, P, C, hasC, partial, filters, filtered, withHistory, topN,
      audience: AUDIENCES[o.audience] || AUDIENCES.general,
      periodLabel: periodLabel(P), compareLabel: hasC ? periodLabel(C) : null,
      kpis: {
        sales: salesP.v, salesC: salesC.v, salesChange,
        buyers: buyersP.length, buyersC: buyersC.length, buyersChange: hasC && !partial ? change(buyersP.length, buyersC.length) : null,
        cartera: carteraSize, effectiveness,
        ticket, ticketChange: hasC ? change(ticket, ticketC) : null, docs: salesP.docs,
        saldo, vencido, vencidoShare: pct(vencido, saldo),
        newClients: newClients.length, lost: lost.length, lostMonthly,
        n80, buyersTotalCount: sortedBuyers.length,
        kgP, kgChange: hasC ? change(kgP, kgC) : null,
      },
      trend, segments, sellers, zones, products, productDrops, projection,
      recover, recoverTop, recoverValue, riskWindow, debtors, lostList: lost.sort((a, b) => b.vC - a.vC),
    };
    m.conclusions = conclude(m, fmt);
    m.actions = recommend(m, fmt);
    return m;
  }

  /* Conclusiones automáticas: frases armadas a partir de las cifras */
  function conclude(m, f) {
    const k = m.kpis, out = [];
    const alert = num(m.options.dropAlert) || 10;
    if (m.partial) {
      const p = m.projection;
      out.push({ tone: "neutral", text: `${capitalize(monthName(p.month))} está en curso: van ${f.money(p.done)} facturados en ${p.day} de ${p.dim} días. Las comparaciones de clientes y venta contra el periodo anterior se muestran cuando el mes cierre.` });
    } else if (m.hasC && k.salesChange != null) {
      const down = k.salesChange <= -alert, up = k.salesChange >= alert;
      let s = `La venta de ${m.periodLabel.toLowerCase()} fue de ${f.money(k.sales)}, ${k.salesChange >= 0 ? "un aumento" : "una caída"} de ${f.pct(Math.abs(k.salesChange))} frente a ${m.compareLabel.toLowerCase()} (${f.money(k.salesC)}).`;
      if (down) {
        const z = m.zones.filter((x) => x.delta < 0).sort((a, b) => a.delta - b.delta)[0];
        const v = m.sellers.filter((x) => x.delta < 0).sort((a, b) => a.delta - b.delta)[0];
        const drop = k.salesC - k.sales;
        const parts = [];
        if (z && drop > 0) parts.push(`la zona ${z.name} explica ${f.pct(Math.min(100, (-z.delta / drop) * 100))} de la baja`);
        if (v && drop > 0 && !m.options.seller) parts.push(`la cartera de ${v.name} bajó ${f.money(-v.delta)}`);
        if (parts.length) s += ` Por dónde se fue: ${parts.join("; ")}.`;
      }
      out.push({ tone: down ? "bad" : up ? "good" : "neutral", text: s });
    } else {
      out.push({ tone: "neutral", text: `La venta de ${m.periodLabel.toLowerCase()} fue de ${f.money(k.sales)} en ${f.int(k.docs)} facturas. No hay un periodo anterior equivalente en los datos para comparar.` });
    }
    if (m.projection) {
      const p = m.projection;
      const vs = p.prev ? change(p.value, p.prev) : null;
      out.push({ tone: vs != null && vs <= -alert ? "bad" : "neutral", text: `Al ritmo actual (${f.money(p.done)} en ${p.day} de ${p.dim} días), ${monthName(p.month)} cerraría cerca de ${f.money(p.value)}${vs != null ? `, ${vs >= 0 ? "por encima" : "por debajo"} del mes anterior en ${f.pct(Math.abs(vs))}` : ""}.` });
    }
    if (m.hasC && !m.partial && k.lost > 0) {
      out.push({ tone: k.lostMonthly > k.salesC / Math.max(1, m.C.length) * 0.05 ? "bad" : "warn", text: `${f.int(k.lost)} clientes que compraron en ${m.compareLabel.toLowerCase()} no volvieron a comprar en ${m.periodLabel.toLowerCase()}. Representan ${f.money(k.lostMonthly)} de venta al mes.` });
    }
    if (k.buyersTotalCount > 5) {
      out.push({ tone: "neutral", text: `${f.int(k.n80)} clientes, el ${f.pct(pct(k.n80, k.buyersTotalCount))} de los que compraron, generan el 80% de la venta del periodo. Perder uno de ellos se nota en el mes.` });
    }
    if (k.effectiveness != null && k.cartera > 0) {
      const weak = m.sellers.filter((s) => s.cartera >= 10 && s.name !== "Sin dato").sort((a, b) => (a.eff ?? 0) - (b.eff ?? 0))[0];
      let s = `Compró el ${f.pct(k.effectiveness)} de la cartera (${f.int(k.buyers)} de ${f.int(k.cartera)} clientes).`;
      if (weak && !m.options.seller && m.sellers.length > 1) s += ` La cartera con menor activación es la de ${weak.name}, con ${f.pct(weak.eff)}.`;
      out.push({ tone: k.effectiveness < 25 ? "warn" : "neutral", text: s });
    }
    if (k.saldo > 0) {
      const topDebt = m.sellers.slice().sort((a, b) => b.vencido - a.vencido)[0];
      let s = `El ${f.pct(k.vencidoShare)} del saldo por cobrar está vencido: ${f.money(k.vencido)} de ${f.money(k.saldo)}.`;
      if (topDebt && topDebt.vencido > 0 && !m.options.seller && m.sellers.length > 1) s += ` La mayor parte está en la cartera de ${topDebt.name} (${f.money(topDebt.vencido)}).`;
      out.push({ tone: k.vencidoShare >= 30 ? "bad" : k.vencidoShare >= 15 ? "warn" : "good", text: s });
    }
    if (m.riskWindow.length) {
      out.push({ tone: "warn", text: `${f.int(m.riskWindow.length)} clientes llevan entre 31 y 60 días sin comprar. Es el mejor momento para recuperarlos, antes de que pasen a inactivos.` });
    }
    if (m.products.length) {
      const top = m.products[0];
      let s = `El producto más vendido fue ${top.name}, con ${f.money(top.vP)} (${f.pct(top.share)} de la venta de productos).`;
      const d = m.productDrops[0];
      if (d && d.delta < 0) s += ` La mayor baja la tuvo ${d.name}: ${f.money(-d.delta)} menos que en el periodo anterior.`;
      out.push({ tone: "neutral", text: s });
    }
    return out;
  }

  /* Plan de acción con el dinero en juego */
  function recommend(m, f) {
    const out = [];
    if (m.recoverTop.length) out.push({ who: m.options.seller || "Vendedores", text: `Contactar a los ${f.int(m.recoverTop.length)} clientes clave sin compra desde hace más de ${m.options.riskDays} días.`, value: m.recoverValue, valueLabel: "venta mensual en juego" });
    if (m.debtors.length) {
      const top = m.debtors.slice(0, 10);
      out.push({ who: "Cobranza", text: `Gestionar el cobro de los ${f.int(top.length)} saldos vencidos más altos.`, value: sum(top, (c) => c.saldo_vencido), valueLabel: "por cobrar" });
    }
    if (m.riskWindow.length) out.push({ who: m.options.seller || "Vendedores", text: `Llamar a los ${f.int(m.riskWindow.length)} clientes en riesgo (31 a 60 días) antes de que se enfríen.`, value: sum(m.riskWindow, (x) => x.avgMonthly), valueLabel: "venta mensual habitual" });
    const weak = m.sellers.filter((s) => s.cartera >= 10 && s.name !== "Sin dato").sort((a, b) => (a.eff ?? 0) - (b.eff ?? 0))[0];
    if (weak && !m.options.seller && m.sellers.length > 1) out.push({ who: "Gerencia de ventas", text: `Acompañar a ${weak.name}: solo compró el ${f.pct(weak.eff)} de su cartera en el periodo.`, value: null });
    const zoneDrop = m.zones.filter((z) => z.delta < 0).sort((a, b) => a.delta - b.delta)[0];
    if (m.hasC && !m.partial && zoneDrop && !m.options.zone) out.push({ who: "Gerencia de ventas", text: `Revisar la zona ${zoneDrop.name}, la de mayor caída frente al periodo anterior.`, value: -zoneDrop.delta, valueLabel: "de venta perdida" });
    return out;
  }

  global.BipaInforme = { build, describeData, SEGMENTS, AUDIENCES, monthName, monthShort, periodLabel, num };
})(window);
