/* BIPA · Asistente — herramientas de consulta.
   Son las únicas fuentes de cifras del agente: cada herramienta calcula sobre el paquete
   de datos 2.0 ya descifrado en el navegador (con el mismo motor del informe) y devuelve
   un resultado compacto. La privacidad se aplica aquí, antes de que nada salga del equipo:
   en modo "nombres" nunca se envían teléfonos ni códigos; en modo "cifras" no se envían
   nombres de clientes. */
(function (global) {
  "use strict";

  const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9Ñ ]+/g, " ").replace(/\s+/g, " ").trim();
  const r2 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);
  const r1 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, Math.round(+n || a)));
  const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);
  const monthOf = (d) => iso(global.BipaInforme2.dayToDate(d)).slice(0, 7);

  // Busca un valor en una lista tolerando mayúsculas, acentos y nombres parciales.
  function match(list, q) {
    const n = norm(q);
    if (!n) return null;
    const exact = list.find((x) => norm(x) === n);
    if (exact) return exact;
    const tokens = n.split(" ");
    const hits = list.filter((x) => { const v = norm(x); return tokens.every((t) => v.includes(t)); });
    if (hits.length) return hits.sort((a, b) => a.length - b.length)[0];
    return null;
  }
  function search(list, q, max) {
    const n = norm(q), tokens = n.split(" ").filter(Boolean);
    if (!tokens.length) return [];
    const scored = [];
    list.forEach((x, i) => {
      const v = norm(x);
      const hit = tokens.filter((t) => v.includes(t)).length;
      if (hit === tokens.length || (tokens.length > 2 && hit >= tokens.length - 1)) scored.push({ i, name: x, s: hit * 100 - v.length / 10 + (v === n ? 1000 : 0) + (v.startsWith(n) ? 200 : 0) });
    });
    return scored.sort((a, b) => b.s - a.s).slice(0, max || 8);
  }

  function create(getDS, getPrivacy) {
    const fmtStub = {
      money: (v) => `$${(Math.round((v || 0) * 100) / 100).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      moneyShort: (v) => `$${Math.round(v || 0).toLocaleString("es-VE")}`,
      signedMoney: (v) => `${v >= 0 ? "+" : "-"}$${Math.round(Math.abs(v || 0)).toLocaleString("es-VE")}`,
      int: (v) => Math.round(v || 0).toLocaleString("es-VE"),
      pct: (v) => (v == null || !Number.isFinite(v) ? "-" : `${(Math.round(v * 10) / 10).toLocaleString("es-VE")}%`),
      signedPct: (v) => (v == null || !Number.isFinite(v) ? "-" : `${v >= 0 ? "+" : "-"}${(Math.round(Math.abs(v) * 10) / 10).toLocaleString("es-VE")}%`),
      peso: (v) => `${Math.round(v || 0).toLocaleString("es-VE")} kg`,
      date: (d) => iso(d),
    };
    const info = () => global.BipaInforme2.describe(getDS());
    const priv = () => getPrivacy();
    // Datos de un cliente según el modo de privacidad.
    const person = (x) => {
      const p = priv();
      if (p === "cifras") return null;
      const o = { cliente: x.name, vendedor: x.seller, zona: x.zone };
      if (p === "todo") { o.telefono = x.phone || null; o.codigo = x.code || null; }
      return o;
    };
    const people = (list, extra) => (priv() === "cifras" ? { nota: "Modo solo cifras: no se comparten nombres de clientes.", cantidad: list.length } : list.map((x) => ({ ...person(x), ...extra(x) })));

    function options(a) {
      const I = info(), errors = [];
      const pick = (list, q, label) => { if (!q) return ""; const v = match(list, q); if (!v) errors.push(`No encontré ${label} "${q}". Opciones: ${list.slice(0, 40).join(", ")}`); return v || ""; };
      const o = {
        period: ["ultimo", "actual", "trimestre", "anio", "todo", "rango"].includes(a.periodo) ? a.periodo : "ultimo",
        from: a.desde, to: a.hasta, audience: "general", depth: "estandar",
        empresas: a.empresa ? [pick(I.empresas, a.empresa, "la empresa")].filter(Boolean) : [],
        seller: pick(I.sellers, a.vendedor, "el vendedor"), zone: pick(I.zones, a.zona, "la zona"), type: pick(I.types, a.tipo_cliente, "el tipo de cliente"),
        assignment: "", riskDays: clamp(a.dias_riesgo || 30, 7, 365), topN: clamp(a.limite || 10, 1, 60), dropAlert: 10, freight: !!a.incluir_fletes,
      };
      if (o.period === "rango" && (!/^\d{4}-\d{2}$/.test(o.from || "") || !/^\d{4}-\d{2}$/.test(o.to || ""))) errors.push('Para el periodo "rango" indique desde y hasta en formato AAAA-MM.');
      return { o, errors };
    }
    const header = (m) => ({ periodo: m.periodLabel, comparado_con: m.hasC ? (m.fair ? "mismos días del mes anterior" : m.compareLabel) : "sin comparación", filtros: m.filters.length ? m.filters : ["todas las empresas y toda la cartera"], datos_al: iso(m.info.cut) });
    const build = (a) => { const { o, errors } = options(a || {}); if (errors.length) return { error: errors.join(" ") }; return { m: global.BipaInforme2.build(getDS(), o, fmtStub), o }; };
    const row = (x) => ({ nombre: x.name, venta: r2(x.p), venta_anterior: r2(x.c), variacion_pct: r1(x.chg), participacion_pct: r1(x.share), clientes: x.buyers, facturas: x.docs, ticket: r2(x.ticket) });

    const tools = {
      info_datos: {
        description: "Describe los datos disponibles: fecha de corte, meses con datos, empresas, vendedores, zonas, tipos de cliente y cantidad de clientes y líneas. Úsela para saber qué nombres existen o qué fechas cubren los datos.",
        parameters: { type: "object", properties: {} },
        run() { const I = info(); return { datos_al: iso(I.cut), primer_dia: iso(global.BipaInforme2.dayToDate(I.minDay)), mes_en_curso_incompleto: I.partial, meses: I.months, empresas: I.empresas, vendedores: I.sellers, zonas_total: I.zones.length, zonas: I.zones.slice(0, 120), tipos_cliente: I.types, clientes_en_cartera: I.clientsCount, lineas_de_factura: I.lines, privacidad: priv() }; },
      },
      resumen_general: {
        description: "Resumen gerencial del periodo con filtros: venta, variación, clientes que compraron, activación, ticket, kg, clientes nuevos y perdidos, saldo y vencido, resultado por empresa, puente de variación (por qué cambió la venta), conclusiones y acciones recomendadas.",
        parameters: { type: "object", properties: filterProps() },
        run(a) {
          const b = build(a); if (b.error) return b; const m = b.m, k = m.kpis;
          return {
            ...header(m),
            indicadores: { venta: r2(k.sales), venta_anterior: m.hasC ? r2(k.salesC) : null, variacion_venta_pct: r1(k.salesChange), promedio_3_meses_previos: r2(k.avg3), proyeccion_cierre_mes: k.projection ? r2(k.projection.value) : null, clientes_que_compraron: k.buyers, clientes_en_cartera: k.cartera, activacion_pct: r1(k.activation), facturas: k.docs, ticket_por_factura: r2(k.ticket), kg: Math.round(k.kg), clientes_nuevos: k.newClients, dejaron_de_comprar: m.hasC ? k.lost : null, venta_anterior_de_los_que_dejaron: m.hasC ? r2(k.lostValue) : null, fletes: r2(k.freight), saldo_por_cobrar: r2(k.saldo), saldo_vencido: r2(k.vencido), vencido_pct: r1(k.vencidoShare), vencido_mas_de_90_dias: r2(k.aging[4]) },
            empresas: m.empresas.map((e) => ({ ...row(e), saldo: r2(e.saldo), vencido: r2(e.vencido) })),
            puente_variacion: m.bridge ? { dejaron_de_comprar: r2(m.bridge.lost), clientes_que_dejaron: m.bridge.nLost, compraron_menos: r2(m.bridge.down), compraron_mas: r2(m.bridge.up), nuevos_o_de_regreso: r2(m.bridge.fresh), efecto_precio: r2(m.bridge.priceFx), efecto_volumen: r2(m.bridge.volFx) } : null,
            conclusiones: m.conclusions.map((c) => c.text),
            acciones: m.actions.map((x) => ({ responsable: x.who, accion: x.text, monto: r2(x.value), referencia: x.valueLabel || null })),
          };
        },
      },
      ventas_por: {
        description: "Ranking de venta del periodo agrupado por empresa, producto, vendedor, zona o cliente, con venta anterior, variación, participación y clientes. Para productos también unidades, precio promedio y clasificación ABC; para vendedores también cartera, activación, vencido y puntaje.",
        parameters: { type: "object", properties: { dimension: { type: "string", enum: ["empresa", "producto", "vendedor", "zona", "cliente"] }, orden: { type: "string", enum: ["mayor_venta", "mayor_caida", "mayor_crecimiento"], description: "Por defecto mayor_venta." }, ...filterProps() }, required: ["dimension"] },
        run(a) {
          const b = build({ ...a, limite: Math.max(a.limite || 15, 15) }); if (b.error) return b; const m = b.m, lim = clamp(a.limite || 15, 1, 60);
          let rows;
          switch (a.dimension) {
            case "empresa": rows = m.empresas.map((e) => ({ ...row(e), productos_distintos: e.productsCount, fletes: r2(e.freight), saldo: r2(e.saldo), vencido: r2(e.vencido) })); break;
            case "producto": rows = m.products.sold.concat(a.orden === "mayor_caida" ? m.products.noSale : []).map((x) => ({ ...row(x), unidades: r2(x.units), precio_promedio: r2(x.price), precio_anterior: r2(x.priceC), kg: Math.round(x.kg), clase_abc: x.abc || null })); break;
            case "vendedor": rows = m.sellers.map((s) => ({ ...row(s), cartera: s.cartera, activacion_pct: r1(s.activation), nuevos: s.newC, perdidos: s.lost, saldo: r2(s.saldo), vencido: r2(s.vencido), puntaje: s.score })); break;
            case "zona": rows = m.zones.map(row); break;
            case "cliente": {
              if (priv() === "cifras") return { error: "Modo solo cifras: no se pueden listar clientes por nombre." };
              const b2 = build({ ...a, limite: 60 }); rows = b2.m.clients.top.map((x) => ({ ...person(x), venta: r2(x.p), venta_anterior: r2(x.c), variacion_pct: r1(x.chg), empresas: x.empresas, segmento: x.seg })); break;
            }
            default: return { error: "Dimensión no válida." };
          }
          if (a.orden === "mayor_caida") rows = rows.filter((x) => x.venta_anterior > 0).sort((x, y) => (x.venta - x.venta_anterior) - (y.venta - y.venta_anterior));
          else if (a.orden === "mayor_crecimiento") rows = rows.sort((x, y) => (y.venta - (y.venta_anterior || 0)) - (x.venta - (x.venta_anterior || 0)));
          return { ...header(m), total_venta: r2(m.kpis.sales), total_filas: rows.length, filas: rows.slice(0, lim) };
        },
      },
      serie_mensual: {
        description: "Venta mes a mes de todo el historial (con desglose por empresa, clientes, facturas y kg), con los filtros de empresa, vendedor, zona o tipo. Útil para tendencias y estacionalidad.",
        parameters: { type: "object", properties: filterProps(true) },
        run(a) {
          const b = build({ ...a, periodo: "todo" }); if (b.error) return b; const m = b.m;
          return { filtros: header(m).filtros, datos_al: iso(m.info.cut), meses: m.trend.map((t) => ({ mes: t.m, venta: r2(t.v), por_empresa: Object.fromEntries(m.empRows.map((er) => [er.name, r2(t.e[er.idx])])), clientes: t.buyers, facturas: t.docs, kg: Math.round(t.kg), incompleto: t.partial || undefined })) };
        },
      },
      listas: {
        description: "Listas de gestión: compra_atrasada (clientes que pasaron su fecha habitual de compra), perdidos (compraban en el periodo anterior y no en este), nuevos, deudores (mayor saldo vencido), bajaron (compraron mucho menos), dejaron_empresa (dejaron una empresa del grupo pero compran otra), productos_en_caida (3 meses seguidos), productos_sin_venta, productos_nuevos, cambios_de_precio, precios_dispares, se_compran_juntos, segmentos, retencion, venta_cruzada, combinaciones_empresas, abc, matriz_productos.",
        parameters: { type: "object", properties: { lista: { type: "string", enum: ["compra_atrasada", "perdidos", "nuevos", "deudores", "bajaron", "dejaron_empresa", "productos_en_caida", "productos_sin_venta", "productos_nuevos", "cambios_de_precio", "precios_dispares", "se_compran_juntos", "segmentos", "retencion", "venta_cruzada", "combinaciones_empresas", "abc", "matriz_productos"] }, ...filterProps() }, required: ["lista"] },
        run(a) {
          const lim = clamp(a.limite || 15, 1, 60);
          const b = build({ ...a, limite: Math.max(lim, 15) }); if (b.error) return b; const m = b.m, C = m.clients, P = m.products;
          const out = (data, extra) => ({ ...header(m), ...(extra || {}), resultado: data });
          switch (a.lista) {
            case "compra_atrasada": return out(people(C.overdueAll.slice(0, lim), (x) => ({ compra_cada_dias: x.rhythm, dias_sin_comprar: x.since, compra_mensual_promedio: r2(x.monthly), fecha_esperada: iso(x.expected) })), { total_clientes: C.overdueCount, compra_mensual_total: r2(C.recoverValue) });
            case "perdidos": return out(people(C.lost.slice(0, lim), (x) => ({ compra_periodo_anterior: r2(x.c), dias_sin_comprar: x.days, empresas: x.empresas })), { total_clientes: m.kpis.lost, valor_total: r2(m.kpis.lostValue) });
            case "nuevos": return out(people(C.fresh.slice(0, lim), (x) => ({ compra: r2(x.p), primera_compra: iso(x.first), empresas: x.empresas })), { total_clientes: m.kpis.newClients });
            case "deudores": return out(people(m.cobranza.debtorsAll.slice(0, lim), (x) => ({ saldo: r2(x.saldo), vencido: r2(x.venc), dias_de_atraso: x.oldest, sigue_comprando: x.buying })), { saldo_total: r2(m.cobranza.saldo), vencido_total: r2(m.cobranza.vencido), antiguedad: m.cobranza.aging.map((g) => ({ tramo: g.label, monto: r2(g.v), pct: r1(g.share) })), clientes_con_vencido_que_siguen_comprando: m.cobranza.stillBuying, vencido_de_esos_clientes: r2(m.cobranza.stillBuyingValue), por_empresa: m.cobranza.byEmpresa.map((x) => ({ empresa: x.name, saldo: r2(x.saldo), vencido: r2(x.vencido) })), por_vendedor: m.cobranza.bySeller.map((x) => ({ vendedor: x.name, saldo: r2(x.saldo), vencido: r2(x.vencido) })) });
            case "bajaron": return out(people(C.declining.slice(0, lim), (x) => ({ antes: r2(x.c), ahora: r2(x.p), variacion_pct: r1(x.chg) })));
            case "dejaron_empresa": return out(m.empresas.map((e) => ({ empresa: e.name, clientes: e.leftCount, compra_mensual_total: r2(e.leftValue), lista: people(e.left.slice(0, lim), (x) => ({ dias_sin_comprarle: x.days, compra_mensual: r2(x.monthly), sigue_comprando_a: x.others })) })));
            case "productos_en_caida": return out(P.declining3.map((x) => ({ producto: x.name, ventas_mensuales: Object.fromEntries(P.last3.map((mm, j) => [mm, r2(x.v[j])])), variacion_pct: r1(x.drop) })), { total: P.declining3Count });
            case "productos_sin_venta": return out(P.noSale.map((x) => ({ producto: x.name, venta_anterior: r2(x.c) })));
            case "productos_nuevos": return out(P.newProducts.map((x) => ({ producto: x.name, venta: r2(x.p), clientes: x.buyers })));
            case "cambios_de_precio": return out(P.priceMoves.map((x) => ({ producto: x.name, precio_antes: r2(x.priceC), precio_ahora: r2(x.price), variacion_pct: r1(x.priceChg) })));
            case "precios_dispares": return out(P.priceSpread.map((x) => ({ producto: x.name, precio_minimo: r2(x.minPr), precio_maximo: r2(x.maxPr), diferencia_pct: r1(x.spread) })));
            case "se_compran_juntos": return out(P.pairs.map((x) => ({ producto_a: x.a, producto_b: x.b, facturas_juntas: x.n, afinidad_pct: r1(x.conf) })), { facturas_analizadas: P.invN });
            case "segmentos": return out(C.segments.map((s) => ({ segmento: s.label, criterio: s.note, clientes: s.n, venta_historica_pct: r1(s.share), venta_del_periodo: r2(s.vP), dias_promedio_sin_comprar: Math.round(s.avgRec) })));
            case "retencion": return out(C.cohorts.map((c) => ({ mes_primera_compra: c.m, clientes: c.n, porcentaje_que_volvio_por_mes: c.cells.slice(1).map(r1) })));
            case "venta_cruzada": return out(C.crossSell.map((x) => ({ compran_a: x.from, pero_no_a: x.to, clientes: x.n, pct: r1(x.pct) })));
            case "combinaciones_empresas": return out(C.combos.map((x) => ({ empresas: x.name, clientes: x.n, venta: r2(x.v) })), { clientes_multiempresa: C.multi });
            case "abc": return out(["A", "B", "C"].map((k) => ({ clase: k, productos: P.abc[k].n, venta: r2(P.abc[k].v) })));
            case "matriz_productos": return out(Object.fromEntries(Object.entries(P.quad).map(([k, v]) => [{ estrella: "estrellas", vaca: "maduras_en_caida", promesa: "promesas", alerta: "en_alerta" }[k], { productos: v.length, venta: r2(v.reduce((s, x) => s + x.p, 0)), principales: v.slice(0, 5).map((x) => x.name) }])));
            default: return { error: "Lista no válida." };
          }
        },
      },
      buscar_cliente: {
        description: "Ficha completa de un cliente por nombre (acepta nombre parcial): vendedor, zona, tipo, primera y última compra, días sin comprar, venta total e historial mensual, venta por empresa, productos que más compra, facturas, ticket, ritmo de compra, saldo, vencido y días de atraso. Si hay varios parecidos devuelve las opciones.",
        parameters: { type: "object", properties: { nombre: { type: "string", description: "Nombre o parte del nombre del cliente." } }, required: ["nombre"] },
        run(a) {
          if (priv() === "cifras") return { error: "Modo solo cifras: no se consultan clientes por nombre." };
          const ds = getDS(), CL = ds.clients, L = ds.lines, D = ds.dict, I = info();
          const found = search(CL.map((c) => c[0]), a.nombre, 8);
          if (!found.length) return { error: `No encontré clientes con "${a.nombre}".` };
          if (found.length > 1 && norm(found[0].name) !== norm(a.nombre) && found[1].s >= found[0].s - 50) return { varios_resultados: found.map((f) => ({ cliente: CL[f.i][0], zona: CL[f.i][2], vendedor: CL[f.i][4] })), nota: "Pida al usuario que elija uno o use el nombre completo." };
          const ci = found[0].i, c = CL[ci];
          const byMonth = {}, byEmp = {}, byProd = {}, days = new Set(), docs = new Set();
          let total = 0, first = Infinity, last = 0, saldo = 0, venc = 0, oldest = 0;
          for (let i = 0; i < L.d.length; i++) {
            if (L.c[i] !== ci) continue;
            const d = L.d[i], t = L.t[i], e = D.empresas[L.e[i]], p = D.productos[L.p[i]];
            total += t; days.add(d); docs.add(`${L.e[i]}|${L.doc[i]}`); if (d < first) first = d; if (d > last) last = d;
            const mo = monthOf(d); byMonth[mo] = (byMonth[mo] || 0) + t; byEmp[e] = (byEmp[e] || 0) + t;
            const bp = byProd[p] || (byProd[p] = { v: 0, u: 0 }); bp.v += t; bp.u += L.u[i];
            if (L.s[i] > 0) { saldo += L.s[i]; const late = I.cutDay - L.v[i]; if (late > 0) { venc += L.s[i]; if (late > oldest) oldest = late; } }
          }
          const ficha = { cliente: c[0], vendedor: c[4], zona: c[2], tipo_cliente: c[3], vendedor_confirmado: !c[6] };
          if (priv() === "todo") { ficha.telefono = c[5] || null; ficha.codigo = c[1] || null; }
          if (!total) return { ...ficha, nota: "El cliente está en la cartera pero no tiene compras registradas en el Excel de facturación.", datos_al: iso(I.cut) };
          const sorted = [...days].sort((x, y) => x - y), gaps = [];
          for (let j = 1; j < sorted.length; j++) gaps.push(sorted[j] - sorted[j - 1]);
          gaps.sort((x, y) => x - y);
          return {
            ...ficha, datos_al: iso(I.cut), primera_compra: iso(global.BipaInforme2.dayToDate(first)), ultima_compra: iso(global.BipaInforme2.dayToDate(last)), dias_sin_comprar: I.cutDay - last,
            venta_total_historica: r2(total), facturas: docs.size, ticket_por_factura: r2(total / docs.size), dias_con_compra: days.size, compra_cada_dias_tipico: gaps.length ? gaps[Math.floor(gaps.length / 2)] : null,
            venta_por_mes: Object.fromEntries(I.months.map((mo) => [mo, r2(byMonth[mo] || 0)])), venta_por_empresa: Object.fromEntries(Object.entries(byEmp).map(([k, v]) => [k, r2(v)])),
            productos_que_mas_compra: Object.entries(byProd).sort((x, y) => y[1].v - x[1].v).slice(0, 12).map(([k, v]) => ({ producto: k, venta: r2(v.v), unidades: r2(v.u) })),
            saldo_por_cobrar: r2(saldo), saldo_vencido: r2(venc), dias_de_atraso_max: oldest || 0,
          };
        },
      },
      buscar_producto: {
        description: "Ficha de un producto por nombre (acepta nombre parcial): código, venta e unidades por mes, precio promedio por mes, venta por empresa, clientes que lo compran y última venta. Si hay varios parecidos devuelve las opciones.",
        parameters: { type: "object", properties: { nombre: { type: "string" } }, required: ["nombre"] },
        run(a) {
          const ds = getDS(), CL = ds.clients, L = ds.lines, D = ds.dict, I = info();
          const found = search(D.productos, a.nombre, 10);
          if (!found.length) return { error: `No encontré productos con "${a.nombre}".` };
          if (found.length > 1 && norm(found[0].name) !== norm(a.nombre) && found[1].s >= found[0].s - 50) return { varios_resultados: found.map((f) => f.name), nota: "Pida al usuario que elija uno o use el nombre completo." };
          const pi = found[0].i;
          const byMonth = {}, byEmp = {}, byCli = {};
          let total = 0, units = 0, last = 0;
          for (let i = 0; i < L.d.length; i++) {
            if (L.p[i] !== pi) continue;
            const mo = monthOf(L.d[i]), t = L.t[i];
            const bm = byMonth[mo] || (byMonth[mo] = { v: 0, u: 0 }); bm.v += t; bm.u += L.u[i];
            const e = D.empresas[L.e[i]]; byEmp[e] = (byEmp[e] || 0) + t;
            byCli[L.c[i]] = (byCli[L.c[i]] || 0) + t; total += t; units += L.u[i]; if (L.d[i] > last) last = L.d[i];
          }
          const top = Object.entries(byCli).sort((x, y) => y[1] - x[1]).slice(0, 10);
          return {
            producto: D.productos[pi], codigo: D.codigos[pi] || null, datos_al: iso(I.cut), venta_total: r2(total), unidades_total: r2(units), precio_promedio: r2(units ? total / units : 0), ultima_venta: last ? iso(global.BipaInforme2.dayToDate(last)) : null, clientes_distintos: Object.keys(byCli).length,
            por_mes: I.months.map((mo) => ({ mes: mo, venta: r2(byMonth[mo]?.v || 0), unidades: r2(byMonth[mo]?.u || 0), precio_promedio: byMonth[mo]?.u ? r2(byMonth[mo].v / byMonth[mo].u) : null })),
            por_empresa: Object.fromEntries(Object.entries(byEmp).map(([k, v]) => [k, r2(v)])),
            principales_clientes: priv() === "cifras" ? "no disponible en modo solo cifras" : top.map(([c, v]) => ({ cliente: CL[c][0], vendedor: CL[c][4], zona: CL[c][2], venta: r2(v) })),
          };
        },
      },
    };

    function filterProps(noPeriod) {
      const p = {
        empresa: { type: "string", description: "Nombre de una empresa del grupo (GRUPO ERAS, AREZ AROMATIC CANDLE, INDUSTRIA JMC). Vacío = todas." },
        vendedor: { type: "string" }, zona: { type: "string" }, tipo_cliente: { type: "string" },
        limite: { type: "integer", description: "Máximo de filas (por defecto 10 a 15)." },
        incluir_fletes: { type: "boolean", description: "Incluir FLETE como producto. Por defecto no." },
      };
      if (!noPeriod) Object.assign(p, {
        periodo: { type: "string", enum: ["ultimo", "actual", "trimestre", "anio", "todo", "rango"], description: "ultimo = último mes cerrado (por defecto); actual = mes en curso comparado con los mismos días del mes anterior; trimestre = últimos 3 meses cerrados; anio = año a la fecha; todo = todo el historial; rango = usar desde/hasta." },
        desde: { type: "string", description: "Mes inicial AAAA-MM (solo con periodo rango)." },
        hasta: { type: "string", description: "Mes final AAAA-MM (solo con periodo rango)." },
      });
      return p;
    }

    return {
      declarations: Object.entries(tools).map(([name, t]) => ({ name, description: t.description, parameters: t.parameters })),
      run(name, args) {
        const t = tools[name];
        if (!t) return { error: `Herramienta desconocida: ${name}` };
        try { return t.run(args || {}); } catch (e) { console.error(e); return { error: `Falló el cálculo: ${e.message}` }; }
      },
    };
  }

  global.BipaHerramientas = { create, norm, match };
})(typeof window !== "undefined" ? window : globalThis);
