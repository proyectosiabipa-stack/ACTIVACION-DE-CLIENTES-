/* BIPA · Informe gerencial — PDF con formato APA 7 corporativo.
   Carta, márgenes de 2,54 cm, Times, encabezados por niveles, tablas y figuras
   numeradas con título en cursiva y nota. El verde de BIPA solo en el encabezado. */
(function (global) {
  "use strict";
  const GREEN = [22, 96, 63], INK = [27, 27, 27], GREY = [95, 105, 99], RED = [179, 55, 43], LIGHT = [184, 214, 196];
  const M = 72; // 1 pulgada

  function makePdf(model, f, logoPng) {
    const { jsPDF } = global.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "letter", compress: true });
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    const CW = W - 2 * M;
    const k = model.kpis;
    const clean = (s) => String(s ?? "").replace(/[  ]/g, " ").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, "-");
    let y = M, table = 0, figure = 0;

    doc.setProperties({ title: `Informe gerencial · ${model.periodLabel}`, subject: "BIPA Cartera Inteligente", author: "BIPA", creator: "BIPA Cartera Inteligente" });

    const font = (style = "normal", size = 11, color = INK) => { doc.setFont("times", style); doc.setFontSize(size); doc.setTextColor(...color); };
    const ensure = (h) => { if (y + h > H - M) { doc.addPage(); y = M; } };
    const para = (text, opts = {}) => {
      font(opts.style || "normal", opts.size || 11, opts.color || INK);
      const lines = doc.splitTextToSize(clean(text), opts.width || CW);
      const lh = (opts.size || 11) * 1.45;
      lines.forEach((ln) => { ensure(lh); doc.text(ln, opts.x || M, y + (opts.size || 11)); y += lh; });
      y += opts.after ?? 6;
    };
    const h1 = (text) => { ensure(60); y += 8; font("bold", 14); doc.text(clean(text), W / 2, y + 14, { align: "center" }); y += 30; };
    const h2 = (text) => { ensure(44); y += 4; font("bold", 12); doc.text(clean(text), M, y + 12); y += 24; };
    const caption = (kind, n, title) => {
      ensure(60); font("bold", 11); doc.text(`${kind} ${n}`, M, y + 11); y += 16;
      font("italic", 11); doc.splitTextToSize(clean(title), CW).forEach((ln) => { doc.text(ln, M, y + 11); y += 15; }); y += 4;
    };
    const note = (text) => { font("italic", 9.5, GREY); const w = doc.getTextWidth("Nota. "); doc.text("Nota.", M, y + 10); font("normal", 9.5, GREY); const lines = doc.splitTextToSize(clean(text), CW - w); lines.forEach((ln, i) => { ensure(13); doc.text(ln, M + (i === 0 ? w : 0), y + 10); y += 13; }); y += 10; };

    const apaTable = (title, head, body, noteText, colStyles) => {
      table++; caption("Tabla", table, title);
      doc.autoTable({
        startY: y, head: [head.map(clean)], body: body.map((r) => r.map(clean)), margin: { left: M, right: M, top: M + 10, bottom: M },
        theme: "plain", styles: { font: "times", fontSize: 9.5, textColor: INK, cellPadding: { top: 3, bottom: 3, left: 4, right: 4 }, overflow: "linebreak" },
        headStyles: { fontStyle: "bold" }, columnStyles: colStyles || {},
        didDrawCell: (d) => {
          if (d.section === "head" && d.row.index === 0) { doc.setDrawColor(...INK); doc.setLineWidth(0.9); doc.line(d.cell.x, d.cell.y, d.cell.x + d.cell.width, d.cell.y); doc.setLineWidth(0.5); doc.line(d.cell.x, d.cell.y + d.cell.height, d.cell.x + d.cell.width, d.cell.y + d.cell.height); }
          if (d.section === "body" && d.row.index === d.table.body.length - 1) { doc.setDrawColor(...INK); doc.setLineWidth(0.9); doc.line(d.cell.x, d.cell.y + d.cell.height, d.cell.x + d.cell.width, d.cell.y + d.cell.height); }
        },
      });
      y = doc.lastAutoTable.finalY + 6;
      if (noteText) note(noteText);
      else y += 8;
    };
    const right = (from, to) => { const s = {}; for (let i = from; i <= to; i++) s[i] = { halign: "right" }; return s; };

    /* Figura: barras verticales de venta mensual */
    const barChart = (title, series, noteText, height) => {
      figure++; caption("Figura", figure, title);
      const h = height || 150; ensure(h + 30);
      const max = Math.max(1, ...series.map((s) => s.v));
      const x0 = M + 44, x1 = M + CW, base = y + h - 18, top = y + 8;
      font("normal", 8, GREY); doc.setDrawColor(210, 214, 211); doc.setLineWidth(0.4);
      [0, 0.5, 1].forEach((t) => { const yy = base - (base - top) * t; doc.line(x0, yy, x1, yy); doc.text(f.moneyShort(max * t), x0 - 6, yy + 3, { align: "right" }); });
      const bw = (x1 - x0) / series.length;
      series.forEach((s, i) => {
        const bh = ((base - top) * s.v) / max, bx = x0 + i * bw + bw * 0.18;
        doc.setFillColor(...(s.inP ? GREEN : s.inC ? LIGHT : [214, 222, 217])); doc.rect(bx, base - bh, bw * 0.64, bh, "F");
        font("normal", 7.5, GREY); doc.text(clean(s.label), bx + bw * 0.32, base + 11, { align: "center" });
        if (s.inP) { font("bold", 7.5, INK); doc.text(f.moneyShort(s.v), bx + bw * 0.32, base - bh - 3, { align: "center" }); }
      });
      doc.setDrawColor(...INK); doc.setLineWidth(0.7); doc.line(x0, base, x1, base);
      y += h + 4; note(noteText);
    };

    /* Figura: barras horizontales (segmentos, vendedores) */
    const hbarChart = (title, items, valueFmt, noteText) => {
      figure++; caption("Figura", figure, title);
      const rowH = 17, h = items.length * rowH + 6; ensure(h + 20);
      const max = Math.max(1, ...items.map((s) => s.v));
      const labelW = 150, x0 = M + labelW, x1 = M + CW - 60;
      items.forEach((s, i) => {
        const yy = y + i * rowH;
        font("normal", 9, INK); doc.text(doc.splitTextToSize(clean(s.label), labelW - 8)[0], M, yy + 11);
        doc.setFillColor(...(s.color || GREEN)); doc.rect(x0, yy + 3, ((x1 - x0) * s.v) / max, rowH - 7, "F");
        font("normal", 9, GREY); doc.text(clean(valueFmt(s)), x0 + ((x1 - x0) * s.v) / max + 5, yy + 11);
      });
      y += h + 4; note(noteText);
    };

    const kpiRow = (items) => {
      ensure(62);
      const gap = 8, w = (CW - gap * (items.length - 1)) / items.length;
      items.forEach((it, i) => {
        const x = M + i * (w + gap);
        doc.setDrawColor(207, 216, 210); doc.setLineWidth(0.6); doc.rect(x, y, w, 56);
        font("normal", 8.5, GREY); doc.text(clean(it.label), x + w / 2, y + 13, { align: "center" });
        font("bold", 14, INK); doc.text(clean(it.value), x + w / 2, y + 31, { align: "center" });
        font("normal", 8.5, it.tone === "bad" ? RED : it.tone === "good" ? GREEN : GREY); doc.text(clean(it.sub || ""), x + w / 2, y + 46, { align: "center" });
      });
      y += 68;
    };

    const bullets = (items) => {
      items.forEach((t) => {
        font("normal", 11); const lines = doc.splitTextToSize(clean(t), CW - 14);
        lines.forEach((ln, i) => { ensure(16); if (i === 0) doc.text("•", M + 2, y + 11); doc.text(ln, M + 14, y + 11); y += 15.5; });
        y += 3;
      });
      y += 4;
    };

    const changeText = (c) => (c == null ? "sin comparación" : `${c >= 0 ? "+" : "-"}${f.pct(Math.abs(c))} vs. anterior`);
    const tone = (c) => (c == null ? "" : c <= -(model.options.dropAlert || 10) ? "bad" : c >= (model.options.dropAlert || 10) ? "good" : "");
    const cut = model.info.cut ? f.date(model.info.cut) : "sin fecha";
    const filtersText = model.filters.length ? model.filters.join(" · ") : "Toda la cartera";
    const sections = new Set(model.audience.sections);
    const detailed = model.options.depth !== "ejecutivo";

    /* ---------- Portada (informe estándar y completo) ---------- */
    if (detailed) {
      y = H * 0.26;
      if (logoPng) { try { doc.addImage(logoPng.data, "PNG", W / 2 - logoPng.w / 2, y - logoPng.h - 24, logoPng.w, logoPng.h); } catch (e) { /* sin logo */ } }
      font("bold", 18); doc.splitTextToSize("Informe Gerencial de Cartera y Ventas", CW).forEach((ln) => { doc.text(ln, W / 2, y, { align: "center" }); y += 24; });
      y += 10; font("normal", 12);
      [model.periodLabel, `Preparado para: ${model.audience.label}${model.options.seller ? ` · ${model.options.seller}` : ""}`, filtersText, `Datos al ${cut}`].forEach((t) => {
        doc.splitTextToSize(clean(t), CW).forEach((ln) => { doc.text(ln, W / 2, y, { align: "center" }); y += 18; });
      });
      y += 30; font("normal", 11, GREY);
      doc.text("BIPA · Buenas ideas puestas en acción", W / 2, y, { align: "center" }); y += 16;
      doc.text(`Generado el ${f.dateTime(new Date())}`, W / 2, y, { align: "center" });
      font("bold", 10, RED); doc.text("CONFIDENCIAL · USO INTERNO", W / 2, H - M - 10, { align: "center" });
      doc.addPage(); y = M;
    }

    /* ---------- Resumen ejecutivo ---------- */
    h1("Resumen Ejecutivo");
    if (!detailed) {
      font("normal", 10.5, GREY);
      doc.text(clean(`${model.periodLabel} · ${filtersText} · Datos al ${cut}`), W / 2, y - 6, { align: "center" }); y += 14;
    }
    kpiRow([
      { label: "Venta del periodo", value: f.moneyShort(k.sales), sub: model.partial ? `proyección ${f.moneyShort(model.projection.value)}` : changeText(k.salesChange), tone: tone(k.salesChange) },
      { label: "Clientes que compraron", value: f.int(k.buyers), sub: k.effectiveness != null ? `${f.pct(k.effectiveness)} de la cartera` : "", tone: "" },
      { label: "Saldo vencido", value: f.moneyShort(k.vencido), sub: k.saldo ? `${f.pct(k.vencidoShare)} del saldo` : "sin saldo", tone: k.vencidoShare >= 30 ? "bad" : "" },
      { label: "Ticket promedio", value: f.money(k.ticket), sub: changeText(k.ticketChange), tone: tone(k.ticketChange) },
    ]);
    h2("Conclusiones clave");
    bullets(model.conclusions.slice(0, detailed ? 6 : 3).map((c) => c.text));
    if (!detailed) {
      barChart(`Venta mensual en USD, ${model.trend.length ? `${model.trend[0].label} a ${model.trend[model.trend.length - 1].label}` : ""}`, model.trend, "Barras verdes: periodo del informe. Verde claro: periodo de comparación.", 110);
    }
    h2("Acciones recomendadas");
    apaTable("Plan de acción priorizado", ["Responsable", "Acción", "Monto en juego"],
      model.actions.slice(0, detailed ? 6 : 3).map((a) => [a.who, a.text, a.value != null ? `${f.money(a.value)} ${a.valueLabel || ""}` : "-"]),
      "Montos calculados con los datos del portal a la fecha de corte.", { 0: { cellWidth: 95 }, 2: { cellWidth: 110, halign: "right" } });

    if (detailed) {
      /* ---------- Ventas ---------- */
      if (sections.has("ventas")) {
        ensure(260);
        h1("Ventas");
        para(`En ${model.periodLabel.toLowerCase()} se facturaron ${f.money(k.sales)} en ${f.int(k.docs)} documentos, con un ticket promedio de ${f.money(k.ticket)}.${model.hasC ? ` En ${model.compareLabel.toLowerCase()} la venta fue de ${f.money(k.salesC)}.` : ""}`);
        barChart(`Venta mensual en USD, ${model.trend.length ? `${model.trend[0].label} a ${model.trend[model.trend.length - 1].label}` : ""}`, model.trend, `Barras verdes: periodo del informe. Verde claro: periodo de comparación.${model.filtered ? " Venta sumada de los clientes del recorte." : ""}`);
        if (model.projection) {
          const p = model.projection;
          h2("Proyección de cierre");
          para(`Con ${f.money(p.done)} facturados en los primeros ${p.day} días, ${global.BipaInforme.monthName(p.month)} cerraría cerca de ${f.money(p.value)} si se mantiene el ritmo diario.${p.prev ? ` El mes anterior cerró en ${f.money(p.prev)}.` : ""}`);
        }
      }

      /* ---------- Cartera ---------- */
      if (sections.has("cartera")) {
        ensure(300); if (y > M) y += 10;
        h1("Estado de la Cartera");
        para(`La cartera${model.filtered ? " seleccionada" : ""} tiene ${f.int(k.cartera)} clientes. En el periodo compraron ${f.int(k.buyers)}${model.hasC ? ` (${f.int(k.buyersC)} en el periodo anterior)` : ""}, ${f.int(k.newClients)} de ellos por primera vez.${model.hasC ? ` ${f.int(k.lost)} clientes dejaron de comprar respecto al periodo anterior.` : ""}`);
        const segColors = { good: GREEN, warn: [205, 150, 40], orange: [214, 110, 40], bad: RED, neutral: [150, 158, 153] };
        hbarChart("Clientes por tiempo sin compra a la fecha de corte", model.segments.map((s) => ({ label: s.label, v: s.count, share: s.share, color: segColors[s.tone] })), (s) => `${f.int(s.v)} (${f.pct(s.share)})`, "Estado calculado con la fecha de la última factura de cada cliente.");
        h2("Clientes clave a recuperar");
        para(`Clientes que compraron en al menos dos meses y llevan más de ${model.options.riskDays} días sin facturar, ordenados por su venta mensual promedio. En conjunto representan ${f.money(model.recoverValue)} al mes.`);
        apaTable("Clientes clave sin compra reciente", ["Cliente", "Vendedor", "Zona", "Días", "Venta/mes"],
          model.recoverTop.map((x) => [x.c.cliente, x.c.vendedor, x.c.zona, f.int(x.c.dias_sin_facturar), f.money(x.avgMonthly)]),
          "Venta/mes: venta total del cliente dividida entre los meses transcurridos desde su primera compra.", { ...right(3, 4), 0: { cellWidth: 150 } });
      }

      /* ---------- Cobranza ---------- */
      if (sections.has("cobranza")) {
        ensure(300); if (y > M) y += 10;
        h1("Cobranza");
        para(`El saldo por cobrar suma ${f.money(k.saldo)}, de los cuales ${f.money(k.vencido)} (${f.pct(k.vencidoShare)}) ya están vencidos.`);
        apaTable("Saldos vencidos más altos", ["Cliente", "Vendedor", "Saldo", "Vencido"],
          model.debtors.slice(0, model.options.audience === "cobranza" ? Math.max(20, model.topN) : model.topN).map((c) => [c.cliente, c.vendedor, f.money(c.saldo_total), f.money(c.saldo_vencido)]),
          "Saldo y vencido a la fecha de corte. El detalle por antigüedad de cada factura se incorporará en la próxima versión.", { ...right(2, 3), 0: { cellWidth: 170 } });
      }

      /* ---------- Vendedores ---------- */
      if (sections.has("vendedores") && model.sellers.length > 1) {
        ensure(300); if (y > M) y += 10;
        h1("Desempeño por Vendedor");
        hbarChart("Venta del periodo por vendedor en USD", model.sellers.slice(0, 12).map((s) => ({ label: s.name, v: s.vP })), (s) => f.moneyShort(s.v), "Doce vendedores con mayor venta en el periodo.");
        apaTable("Cartera, activación, venta y cobranza por vendedor", ["Vendedor", "Cartera", "Compraron", "Activación", "Venta", "Var.", "Vencido"],
          model.sellers.map((s) => [s.name, f.int(s.cartera), f.int(s.buyers), f.pct(s.eff), f.money(s.vP), s.change == null ? "-" : `${s.change >= 0 ? "+" : "-"}${f.pct(Math.abs(s.change))}`, f.money(s.vencido)]),
          "Activación: porcentaje de la cartera asignada que compró en el periodo. Var.: frente al periodo anterior equivalente.", { ...right(1, 6), 0: { cellWidth: 118 } });
      }

      /* ---------- Zonas ---------- */
      if (sections.has("zonas") && model.zones.length > 1) {
        ensure(300); if (y > M) y += 10;
        h1("Resultado por Zona");
        apaTable("Venta y participación por zona", ["Zona", "Cartera", "Compraron", "Venta", "Particip.", "Var."],
          model.zones.slice(0, model.topN + 5).map((z) => [z.name, f.int(z.cartera), f.int(z.buyers), f.money(z.vP), f.pct(z.share), z.change == null ? "-" : `${z.change >= 0 ? "+" : "-"}${f.pct(Math.abs(z.change))}`]),
          `Se muestran las ${Math.min(model.zones.length, model.topN + 5)} zonas con mayor venta de ${model.zones.length}.`, right(1, 5));
      }

      /* ---------- Productos ---------- */
      if (sections.has("productos") && model.products.length) {
        ensure(300); if (y > M) y += 10;
        h1("Productos");
        para(`Se movieron ${f.kg(k.kgP)} de peso registrado${k.kgChange != null ? ` (${k.kgChange >= 0 ? "+" : "-"}${f.pct(Math.abs(k.kgChange))} frente al periodo anterior)` : ""}.`);
        apaTable("Productos con mayor venta en el periodo", ["Producto", "Venta", "Particip.", "Peso", "Var."],
          model.products.slice(0, model.topN).map((a) => [a.name, f.money(a.vP), f.pct(a.share), f.kg(a.kgP), a.change == null ? "-" : `${a.change >= 0 ? "+" : "-"}${f.pct(Math.abs(a.change))}`]),
          `Cifras de toda la empresa: el paquete de datos no vincula productos con vendedor o zona.${model.options.freight ? "" : " Se excluyen los fletes."}`, { ...right(1, 4), 0: { cellWidth: 190 } });
      }

      /* ---------- Anexos (informe completo) ---------- */
      if (model.options.depth === "completo") {
        doc.addPage(); y = M;
        h1("Anexos");
        if (model.recover.length > model.recoverTop.length) {
          h2("A. Lista completa de clientes a recuperar");
          apaTable("Todos los clientes con compra habitual sin facturar", ["Cliente", "Vendedor", "Teléfono", "Días", "Venta/mes"],
            model.recover.slice(0, 150).map((x) => [x.c.cliente, x.c.vendedor, x.c.telefono || "-", f.int(x.c.dias_sin_facturar), f.money(x.avgMonthly)]),
            model.recover.length > 150 ? `Se listan 150 de ${model.recover.length} clientes.` : null, { ...right(3, 4), 0: { cellWidth: 150 } });
        }
        h2("B. Definiciones y método");
        bullets([
          "Venta: total facturado en los meses del periodo, según la fecha de emisión.",
          "Periodo de comparación: los meses inmediatamente anteriores, con la misma duración que el periodo del informe.",
          "Activación: clientes de la cartera que compraron al menos una vez en el periodo, sobre el total de la cartera.",
          "Clientes clave a recuperar: clientes que ya compraban y superan el umbral de días sin facturar elegido, ordenados por su venta mensual promedio.",
          "Tiempo sin compra: días entre la última factura del cliente y la fecha de corte de los datos.",
          "Todas las cifras se calculan en el navegador al generar el informe, con el mismo paquete de datos cifrado que usa el portal.",
        ]);
      }
    }

    /* ---------- Encabezado y pie en todas las páginas ---------- */
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      if (detailed && i === 1) continue;
      font("bold", 8.5, GREEN); doc.text("BIPA · INFORME GERENCIAL DE CARTERA", M, M - 30);
      font("normal", 10, INK); doc.text(String(i), W - M, M - 30, { align: "right" });
      doc.setDrawColor(...GREEN); doc.setLineWidth(1); doc.line(M, M - 24, W - M, M - 24);
      font("normal", 7.5, GREY);
      doc.text(clean(`Datos al ${cut} · ${model.periodLabel} · ${filtersText}`).slice(0, 120), M, H - M + 30);
      doc.text("Confidencial", W - M, H - M + 30, { align: "right" });
    }
    return doc;
  }

  global.BipaInformePdf = { makePdf };
})(window);
