/* BIPA · Asistente — prueba de precisión.
   Arma preguntas cuya respuesta correcta se calcula en el navegador con las mismas
   herramientas (verdad conocida), se las hace al agente y revisa si su respuesta trae
   la cifra o el nombre correcto. Así se mide el agente con los datos de hoy, sin
   guardar respuestas en ningún archivo. */
(function (global) {
  "use strict";
  const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
  const money = (v) => v.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Con los datos del portal (mensuales): solo preguntas que esas herramientas responden.
  function buildBasic(T) {
    const info = T.run("info_datos", {});
    const ult = T.run("resumen_general", { periodo: "ultimo" });
    const k = ult.indicadores, mesTxt = ult.periodo.toLowerCase();
    const top = (dim) => (T.run("ventas_por", { dimension: dim, periodo: "ultimo", limite: 1 }).filas || [])[0];
    const prod = top("producto"), seller = top("vendedor"), zone = top("zona"), client = top("cliente");
    const debt = T.run("listas", { lista: "deudores", limite: 1 });
    const trim = seller ? (T.run("ventas_por", { dimension: "vendedor", periodo: "trimestre", vendedor: seller.nombre, limite: 1 }).filas || [])[0] : null;
    const serie = T.run("serie_mensual", {}).meses || [];
    const prev = serie.length > 2 ? serie[serie.length - (info.mes_en_curso_incompleto ? 3 : 2)] : null;
    return [
      { q: `¿Cuánto vendimos en total en ${mesTxt}?`, n: k.venta },
      { q: `¿Cuántos clientes compraron en ${mesTxt}?`, i: k.clientes_que_compraron },
      { q: `¿Cuántas facturas se emitieron en ${mesTxt}?`, i: k.facturas },
      { q: `¿Cuál fue el ticket promedio por factura en ${mesTxt}?`, n: k.ticket_por_factura },
      { q: "¿Cuál es el saldo vencido total hoy?", n: k.saldo_vencido },
      { q: "¿Cuánto es el saldo total por cobrar?", n: k.saldo_por_cobrar },
      prod && { q: `¿Cuál fue el producto más vendido en ${mesTxt}?`, t: prod.nombre },
      seller && { q: `¿Qué vendedor vendió más en ${mesTxt}?`, t: seller.nombre },
      zone && { q: `¿Qué zona tuvo más venta en ${mesTxt}?`, t: zone.nombre },
      client && { q: `¿Cuánto le vendimos a ${client.cliente} en ${mesTxt}?`, n: client.venta },
      debt.resultado && debt.resultado[0] && { q: "¿Qué cliente tiene el mayor saldo vencido?", t: debt.resultado[0].cliente },
      trim && { q: `¿Cuánto vendió ${trim.nombre} en el último trimestre cerrado?`, n: trim.venta },
      prev && { q: `¿Cuánto vendimos en ${global.BipaInforme2.monthName(prev.mes)}?`, n: prev.venta },
      k.dejaron_de_comprar != null && { q: `¿Cuántos clientes que compraban el mes anterior no compraron en ${mesTxt}?`, i: k.dejaron_de_comprar },
      { q: `¿Cuántos clientes nuevos hubo en ${mesTxt}?`, i: k.clientes_nuevos },
      info.datos_al && { q: "¿Cuál es la fecha de corte de los datos?", t: info.datos_al, alt: [info.datos_al.split("-").reverse().join("/")] },
    ].filter(Boolean);
  }

  function build(T) {
    if (T.mode === "basico") return buildBasic(T);
    const info = T.run("info_datos", {});
    const ult = T.run("resumen_general", { periodo: "ultimo" });
    const act = T.run("resumen_general", { periodo: "actual" });
    const k = ult.indicadores;
    const prods = T.run("ventas_por", { dimension: "producto", periodo: "ultimo", limite: 1 }).filas;
    const sellers = T.run("ventas_por", { dimension: "vendedor", periodo: "ultimo", limite: 1 }).filas;
    const zones = T.run("ventas_por", { dimension: "zona", periodo: "ultimo", limite: 1 }).filas;
    const clients = T.run("ventas_por", { dimension: "cliente", periodo: "ultimo", limite: 1 }).filas;
    const debt = T.run("listas", { lista: "deudores", limite: 1 });
    const emps = ult.empresas;
    const lastMonth = info.meses[info.meses.length - (info.mes_en_curso_incompleto ? 2 : 1)];
    const prevMonth = info.meses[Math.max(0, info.meses.indexOf(lastMonth) - 2)];
    const smallEmp = emps.length ? emps[emps.length - 1].nombre : null;
    const empPrev = smallEmp ? T.run("consulta", { empresa: smallEmp, desde: prevMonth, hasta: prevMonth }).total.venta : null;
    const days = T.run("consulta", { desde: lastMonth, hasta: lastMonth, agrupar_por: ["dia"], orden: "venta", limite: 1 }).grupos;
    const bestDay = days && days[0];
    const trim = sellers && sellers[0] ? T.run("ventas_por", { dimension: "vendedor", periodo: "trimestre", vendedor: sellers[0].nombre, limite: 1 }).filas[0] : null;
    const mesTxt = ult.periodo.toLowerCase();

    const q = [
      { q: `¿Cuánto vendimos en total en ${mesTxt}?`, n: k.venta },
      emps[0] && { q: `¿Cuánto vendió ${emps[0].nombre} en ${mesTxt}?`, n: emps[0].venta },
      { q: "¿Cuánto llevamos vendido en el mes en curso?", n: act.indicadores.venta },
      { q: `¿Cuántos clientes compraron en ${mesTxt}?`, i: k.clientes_que_compraron },
      { q: "¿Cuál es el saldo vencido total hoy?", n: k.saldo_vencido },
      { q: "¿Cuánto saldo tiene más de 90 días de vencido?", n: k.vencido_mas_de_90_dias },
      prods[0] && { q: `¿Cuál fue el producto más vendido en ${mesTxt}?`, t: prods[0].nombre },
      sellers[0] && { q: `¿Qué vendedor vendió más en ${mesTxt}?`, t: sellers[0].nombre },
      zones[0] && { q: `¿Qué zona tuvo más venta en ${mesTxt}?`, t: zones[0].nombre },
      { q: `¿Cuántas facturas se emitieron en ${mesTxt}?`, i: k.facturas },
      { q: `¿Cuál fue el ticket promedio por factura en ${mesTxt}?`, n: k.ticket_por_factura },
      k.dejaron_de_comprar != null && { q: `¿Cuántos clientes que compraban el mes anterior no compraron en ${mesTxt}?`, i: k.dejaron_de_comprar },
      clients && clients[0] && { q: `¿Cuánto le vendimos a ${clients[0].cliente} en ${mesTxt}?`, n: clients[0].venta },
      smallEmp && { q: `¿Cuánto vendió ${smallEmp} en ${global.BipaInforme2.monthName(prevMonth)}?`, n: empPrev },
      bestDay && { q: `¿Cuánto se vendió en total el día ${bestDay.grupo.split("-").reverse().join("/")}?`, n: bestDay.venta },
      debt.resultado && debt.resultado[0] && { q: "¿Qué cliente tiene el mayor saldo vencido?", t: debt.resultado[0].cliente },
      trim && { q: `¿Cuánto vendió ${trim.nombre} en el último trimestre cerrado?`, n: trim.venta },
      { q: "¿Los datos cargados cuadran con el Excel de facturación?", n: T.run("cuadre", {}).venta_cargada },
      { q: `¿Cuántos clientes nuevos hubo en ${mesTxt}?`, i: k.clientes_nuevos },
      { q: "¿Cuál es la fecha de corte de los datos?", t: info.datos_al, alt: [info.datos_al.split("-").reverse().join("/")] },
    ].filter(Boolean);
    return q;
  }

  // Extrae números del texto aceptando 12.345,67 y 12,345.67
  function numbers(text) {
    const out = [];
    for (const m of String(text).matchAll(/\d[\d.,]*/g)) {
      const s = m[0].replace(/[.,]$/, "");
      const cands = new Set();
      cands.add(parseFloat(s.replace(/\./g, "").replace(",", ".")));
      cands.add(parseFloat(s.replace(/,/g, "")));
      cands.forEach((v) => Number.isFinite(v) && out.push(v));
    }
    return out;
  }
  function check(answer, t) {
    if (t.n != null) {
      const ns = numbers(answer);
      if (ns.some((v) => Math.abs(v - t.n) < 0.005)) return { ok: true, level: "exacto", expected: `$${money(t.n)}` };
      if (ns.some((v) => Math.abs(v - t.n) <= 1)) return { ok: true, level: "redondeado", expected: `$${money(t.n)}` };
      return { ok: false, expected: `$${money(t.n)}` };
    }
    if (t.i != null) {
      const ns = numbers(answer);
      return { ok: ns.some((v) => v === t.i), level: "exacto", expected: String(t.i) };
    }
    const a = norm(answer);
    const ok = [t.t, ...(t.alt || [])].some((x) => a.includes(norm(x)));
    return { ok, level: "exacto", expected: t.t };
  }

  global.BipaPrueba = { build, check };
})(typeof window !== "undefined" ? window : globalThis);
