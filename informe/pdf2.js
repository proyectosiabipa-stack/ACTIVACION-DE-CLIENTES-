/* BIPA · Informe gerencial 2.0 — PDF por capítulos con formato APA 7 corporativo.
   Portada, índice automático, resumen ejecutivo con semáforo, un capítulo por empresa,
   productos, clientes, vendedores, zonas, cobranza, plan de acción y anexos.
   Carta, márgenes de 2,54 cm, Times; tablas y figuras numeradas con nota. */
(function (global) {
  "use strict";
  const GREEN = [22, 96, 63], INK = [27, 27, 27], GREY = [95, 105, 99], RED = [179, 55, 43], AMBER = [176, 112, 20], LIGHT = [184, 214, 196], RULE = [210, 214, 211];
  const EMP_COLORS = [[22, 96, 63], [196, 142, 52], [86, 120, 170], [150, 90, 140], [120, 170, 140], [120, 120, 120]];
  const M = 72;

  function makePdf(model, f, logoPng) {
    const { jsPDF } = global.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "letter", compress: true });
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), CW = W - 2 * M;
    const k = model.kpis, o = model.options, topN = o.topN || 10;
    const depth = o.depth || "estandar", detailed = depth !== "ejecutivo", full = depth === "completo";
    const clean = (s) => String(s ?? "").replace(/[  ]/g, " ").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, "-").replace(/[▲▼]/g, "");
    const cut = f.date(model.info.cut);
    const filtersText = model.filters.length ? model.filters.join(" · ") : "Todas las empresas y toda la cartera";
    const chg = (c) => (c == null ? "-" : f.signedPct(c));
    const empColor = (i) => EMP_COLORS[i % EMP_COLORS.length];
    let y = M, table = 0, figure = 0;
    const toc = [];

    doc.setProperties({ title: `Informe gerencial 2.0 · ${model.periodLabel}`, subject: "BIPA Cartera Inteligente", author: "BIPA", creator: "BIPA Cartera Inteligente" });

    /* ---------- Primitivas de texto ---------- */
    const font = (style = "normal", size = 11, color = INK) => { doc.setFont("times", style); doc.setFontSize(size); doc.setTextColor(...color); };
    const newPage = () => { doc.addPage(); y = M; };
    const ensure = (h) => { if (y + h > H - M) newPage(); };
    const para = (text, opts = {}) => {
      const size = opts.size || 11;
      font(opts.style || "normal", size, opts.color || INK);
      const lines = doc.splitTextToSize(clean(text), opts.width || CW);
      lines.forEach((ln) => { ensure(size * 1.45); doc.text(ln, opts.x || M, y + size); y += size * 1.45; });
      y += opts.after ?? 6;
    };
    const chapter = (title) => {
      if (detailed && y > M + 4) newPage();
      ensure(60);
      toc.push({ title, page: doc.getNumberOfPages(), level: 1 });
      y += 4; font("bold", 14); doc.text(clean(title), W / 2, y + 14, { align: "center" }); y += 32;
    };
    const h2 = (title, inToc) => {
      ensure(90); y += 4;
      if (inToc) toc.push({ title, page: doc.getNumberOfPages(), level: 2 });
      font("bold", 12); doc.text(clean(title), M, y + 12); y += 22;
    };
    const caption = (kind, n, title) => {
      font("bold", 11); doc.text(`${kind} ${n}`, M, y + 11); y += 16;
      font("italic", 11); doc.splitTextToSize(clean(title), CW).forEach((ln) => { doc.text(ln, M, y + 11); y += 15; }); y += 3;
    };
    const note = (text) => {
      if (!text) { y += 10; return; }
      ensure(26); font("italic", 9, GREY); const w = doc.getTextWidth("Nota. "); doc.text("Nota.", M, y + 10); font("normal", 9, GREY);
      doc.splitTextToSize(clean(text), CW - w).forEach((ln, i) => { ensure(12); doc.text(ln, M + (i === 0 ? w : 0), y + 10); y += 12.5; });
      y += 10;
    };
    const bullets = (items, size) => {
      items.forEach((it) => {
        const t = typeof it === "string" ? it : it.text, tone = typeof it === "string" ? null : it.tone;
        font("normal", size || 11); const lines = doc.splitTextToSize(clean(t), CW - 16);
        ensure(16);
        const col = tone === "bad" ? RED : tone === "warn" ? AMBER : tone === "good" ? GREEN : GREY;
        doc.setFillColor(...col); doc.circle(M + 4, y + (size || 11) - 3.5, 2.4, "F");
        lines.forEach((ln) => { ensure(16); font("normal", size || 11); doc.text(ln, M + 16, y + (size || 11)); y += (size || 11) * 1.42; });
        y += 3;
      });
      y += 4;
    };

    /* ---------- Tablas APA ---------- */
    const apaTable = (title, head, body, noteText, colStyles, opts = {}) => {
      if (!body.length) { ensure(40); para(`${title}: sin datos con los filtros elegidos.`, { style: "italic", color: GREY, size: 10 }); return; }
      ensure(90);
      table++; caption("Tabla", table, title);
      doc.autoTable({
        startY: y, head: [head.map(clean)], body: body.map((r) => r.map(clean)), margin: { left: M, right: M, top: M + 10, bottom: M },
        theme: "plain", styles: { font: "times", fontSize: opts.size || 9, textColor: INK, cellPadding: { top: 2.6, bottom: 2.6, left: 3.5, right: 3.5 }, overflow: "linebreak", valign: "middle" },
        headStyles: { fontStyle: "bold" }, columnStyles: colStyles || {}, rowPageBreak: "avoid",
        didParseCell: opts.cell || undefined,
        didDrawCell: (d) => {
          if (d.section === "head" && d.row.index === 0) { doc.setDrawColor(...INK); doc.setLineWidth(0.9); doc.line(d.cell.x, d.cell.y, d.cell.x + d.cell.width, d.cell.y); doc.setLineWidth(0.5); doc.line(d.cell.x, d.cell.y + d.cell.height, d.cell.x + d.cell.width, d.cell.y + d.cell.height); }
          if (d.section === "body" && d.row.index === d.table.body.length - 1) { doc.setDrawColor(...INK); doc.setLineWidth(0.9); doc.line(d.cell.x, d.cell.y + d.cell.height, d.cell.x + d.cell.width, d.cell.y + d.cell.height); }
        },
      });
      y = doc.lastAutoTable.finalY + 5;
      note(noteText);
    };
    const R = (...idx) => { const s = {}; idx.forEach((i) => { s[i] = { halign: "right" }; }); return s; };
    const toneCell = (col) => (d) => {
      if (d.section !== "body" || d.column.index !== col) return;
      const t = String(d.cell.raw || "");
      if (t.startsWith("-") && t !== "-") d.cell.styles.textColor = RED; else if (t.startsWith("+")) d.cell.styles.textColor = GREEN;
    };

    /* ---------- Figuras ---------- */
    const figureStart = (title, h) => { ensure(h + 70); figure++; caption("Figura", figure, title); };
    const axis = (x0, x1, top, base, max, fmtV) => {
      font("normal", 7.5, GREY); doc.setDrawColor(...RULE); doc.setLineWidth(0.4);
      [0, 0.5, 1].forEach((t) => { const yy = base - (base - top) * t; doc.line(x0, yy, x1, yy); doc.text(fmtV(max * t), x0 - 5, yy + 3, { align: "right" }); });
    };
    // barras apiladas por empresa (o simples si hay una sola serie)
    const stackedChart = (title, trend, names, noteText, height) => {
      const h = height || 150; figureStart(title, h + 20);
      const max = Math.max(1, ...trend.map((t) => t.v));
      const x0 = M + 44, x1 = M + CW, base = y + h - 18, top = y + 8;
      axis(x0, x1, top, base, max, f.moneyShort);
      const bw = (x1 - x0) / trend.length;
      trend.forEach((t, i) => {
        const bx = x0 + i * bw + bw * 0.16, w = bw * 0.68;
        let acc = 0;
        const parts = names.length > 1 && t.e ? model.empRows.map((er) => t.e[er.idx]) : [t.v];
        parts.forEach((v, j) => {
          const bh = ((base - top) * v) / max;
          const c = names.length > 1 ? empColor(j) : GREEN;
          const faded = !t.inP;
          doc.setFillColor(...(faded ? c.map((x) => Math.round(x + (255 - x) * 0.5)) : c));
          doc.rect(bx, base - acc - bh, w, bh, "F"); acc += bh;
        });
        font("normal", 7.5, GREY); doc.text(clean(t.label + (t.partial ? "*" : "")), bx + w / 2, base + 10, { align: "center" });
        if (t.inP || t.inC) { font(t.inP ? "bold" : "normal", 7.2, t.inP ? INK : GREY); doc.text(f.moneyShort(t.v), bx + w / 2, base - acc - 3, { align: "center" }); }
      });
      doc.setDrawColor(...INK); doc.setLineWidth(0.7); doc.line(x0, base, x1, base);
      y += h;
      if (names.length > 1) {
        let lx = M + 44; font("normal", 8, INK);
        names.forEach((n, j) => { doc.setFillColor(...empColor(j)); doc.rect(lx, y - 2, 8, 8, "F"); doc.text(clean(n), lx + 11, y + 5); lx += doc.getTextWidth(clean(n)) + 26; });
        y += 14;
      }
      note(noteText);
    };
    const hbar = (title, items, valueFmt, noteText, valueW) => {
      const rowH = 16, h = items.length * rowH + 4; figureStart(title, h);
      const max = Math.max(1, ...items.map((s) => Math.abs(s.v)));
      const labelW = 150, x0 = M + labelW, x1 = M + CW - (valueW || 70);
      items.forEach((s, i) => {
        const yy = y + i * rowH, bw = ((x1 - x0) * Math.abs(s.v)) / max;
        font("normal", 8.8, INK); doc.text(doc.splitTextToSize(clean(s.label), labelW - 8)[0], M, yy + 11);
        doc.setFillColor(...(s.color || GREEN)); doc.rect(x0, yy + 3, Math.max(0.5, bw), rowH - 7, "F");
        font("normal", 8.8, GREY); doc.text(clean(valueFmt(s)), x0 + bw + 5, yy + 11);
      });
      y += h + 2; note(noteText);
    };
    // cascada: de la venta anterior a la actual
    const waterfall = (title, b, noteText) => {
      const h = 170; figureStart(title, h);
      const steps = [
        { label: "Periodo anterior", v: b.start, total: true },
        { label: `Dejaron de comprar (${f.int(b.nLost)})`, v: b.lost },
        { label: `Compraron menos (${f.int(b.nDown)})`, v: b.down },
        { label: `Compraron más (${f.int(b.nUp)})`, v: b.up },
        { label: `Nuevos o de regreso (${f.int(b.nNew)})`, v: b.fresh },
        { label: "Periodo actual", v: b.end, total: true },
      ];
      let run = 0, maxV = 0;
      steps.forEach((s) => { if (s.total) { run = s.v; maxV = Math.max(maxV, s.v); } else { run += s.v; maxV = Math.max(maxV, run, run - s.v); } });
      const x0 = M + 44, x1 = M + CW, base = y + h - 30, top = y + 10;
      axis(x0, x1, top, base, maxV, f.moneyShort);
      const bw = (x1 - x0) / steps.length, sc = (v) => ((base - top) * v) / maxV;
      run = 0;
      steps.forEach((s, i) => {
        const bx = x0 + i * bw + bw * 0.18, w = bw * 0.64;
        let from, to;
        if (s.total) { from = 0; to = s.v; run = s.v; } else { from = run; to = run + s.v; run = to; }
        const lo = Math.min(from, to), hi = Math.max(from, to);
        doc.setFillColor(...(s.total ? GREEN : s.v < 0 ? RED : [90, 160, 120]));
        doc.rect(bx, base - sc(hi), w, Math.max(0.8, sc(hi) - sc(lo)), "F");
        font("bold", 7.5, INK); doc.text(s.total ? f.moneyShort(s.v) : f.signedMoney(s.v), bx + w / 2, base - sc(hi) - 3, { align: "center" });
        font("normal", 7.3, GREY); doc.splitTextToSize(clean(s.label), bw - 4).slice(0, 2).forEach((ln, j) => doc.text(ln, bx + w / 2, base + 10 + j * 9, { align: "center" }));
      });
      doc.setDrawColor(...INK); doc.setLineWidth(0.7); doc.line(x0, base, x1, base);
      y += h + 2; note(noteText);
    };
    // matriz participación vs. crecimiento
    const scatter = (title, items, noteText) => {
      const h = 230; figureStart(title, h);
      const x0 = M + 40, x1 = M + CW - 10, top = y + 6, base = y + h - 24;
      const xs = items.map((p) => Math.max(0.05, p.share)), gs = items.map((p) => Math.max(-100, Math.min(150, p.chg ?? 0)));
      const xmax = Math.max(1, ...xs) * 1.1, gmin = Math.min(-20, ...gs) * 1.1, gmax = Math.max(20, ...gs) * 1.1;
      const lx = (v) => x0 + ((x1 - x0) * Math.log10(1 + v * 10)) / Math.log10(1 + xmax * 10);
      const ly = (g) => base - ((base - top) * (g - gmin)) / (gmax - gmin);
      doc.setDrawColor(...RULE); doc.setLineWidth(0.4); doc.rect(x0, top, x1 - x0, base - top);
      const avgX = lx(items.length ? 100 / Math.max(1, model.products.count) : 1);
      doc.setDrawColor(...GREY); doc.setLineDashPattern([2, 2], 0); doc.line(avgX, top, avgX, base); doc.line(x0, ly(0), x1, ly(0)); doc.setLineDashPattern([], 0);
      font("bold", 8, GREY);
      doc.text("PROMESAS", x0 + 4, top + 10); doc.text("ESTRELLAS", x1 - 4, top + 10, { align: "right" });
      doc.text("EN ALERTA", x0 + 4, base - 4); doc.text("MADURAS EN CAÍDA", x1 - 4, base - 4, { align: "right" });
      font("normal", 7.5, GREY); doc.text("Participación en la venta (escala logarítmica)", (x0 + x1) / 2, base + 16, { align: "center" });
      doc.text("Crecimiento %", x0 - 6, top + 2, { align: "right" }); doc.text("0%", x0 - 4, ly(0) + 3, { align: "right" });
      const colors = { estrella: GREEN, vaca: AMBER, promesa: [86, 120, 170], alerta: RED };
      const boxes = [];
      items.forEach((p, i) => {
        const px = lx(Math.max(0.05, p.share)), py = ly(Math.max(-100, Math.min(150, p.chg ?? 0)));
        doc.setFillColor(...(colors[p.quad] || GREY)); doc.circle(px, py, i < 12 ? 3 : 2, "F");
        if (i < 12) {
          font("normal", 6.5, INK);
          const label = clean(p.name).slice(0, 30), w = doc.getTextWidth(label);
          const left = px + 4 + w > x1 ? px - 4 - w : px + 4;
          const box = [left, py - 9, left + w, py - 1];
          if (!boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) { boxes.push(box); doc.text(label, left, py - 3); }
        }
      });
      y += h + 2; note(noteText);
    };
    const kpiGrid = (cards) => {
      const cols = 4, gap = 8, w = (CW - gap * (cols - 1)) / cols, hh = 58;
      const rows = Math.ceil(cards.length / cols);
      ensure(rows * (hh + gap) + 6);
      cards.forEach((it, i) => {
        const x = M + (i % cols) * (w + gap), yy = y + Math.floor(i / cols) * (hh + gap);
        const col = it.tone === "bad" ? RED : it.tone === "warn" ? AMBER : it.tone === "good" ? GREEN : RULE;
        doc.setDrawColor(207, 216, 210); doc.setLineWidth(0.6); doc.rect(x, yy, w, hh);
        doc.setFillColor(...col); doc.rect(x, yy, 3, hh, "F");
        font("normal", 8, GREY); doc.text(clean(it.label), x + 9, yy + 12);
        font("bold", 13.5, INK); doc.text(clean(it.value), x + 9, yy + 30);
        if (it.chg != null) { font("bold", 8.5, it.chg >= 0 ? GREEN : RED); doc.text(f.signedPct(it.chg), x + w - 6, yy + 30, { align: "right" }); }
        font("normal", 7.3, GREY); doc.text(doc.splitTextToSize(clean(it.sub || ""), w - 14).slice(0, 2), x + 9, yy + 42);
      });
      y += rows * (hh + gap) + 4;
    };

    const empNames = model.empRows.map((x) => x.name);
    const trendAll = model.trend;
    const trendTitle = trendAll.length ? `${trendAll[0].label} a ${trendAll[trendAll.length - 1].label}` : "";
    const partialNote = model.info.partial ? ` *Mes en curso con datos hasta el ${cut}.` : "";

    /* ================= Portada ================= */
    if (detailed) {
      y = H * 0.24;
      if (logoPng) { try { doc.addImage(logoPng.data, "PNG", W / 2 - logoPng.w / 2, y - logoPng.h - 24, logoPng.w, logoPng.h); } catch (e) { /* sin logo */ } }
      font("bold", 20); doc.text("Informe Gerencial BIPA", W / 2, y, { align: "center" }); y += 24;
      font("normal", 13, GREY); doc.text("Ventas, empresas, productos, clientes y cobranza", W / 2, y, { align: "center" }); y += 40;
      font("bold", 13); doc.text(clean(model.periodLabel), W / 2, y, { align: "center" }); y += 20;
      font("normal", 11.5);
      [model.hasC ? `Comparado con ${model.fair ? "los mismos días del mes anterior" : model.compareLabel.toLowerCase()}` : "", `Preparado para: ${model.audience.label}${o.seller ? ` · ${o.seller}` : ""}`, filtersText, `Datos al ${cut}`]
        .filter(Boolean).forEach((t) => doc.splitTextToSize(clean(t), CW).forEach((ln) => { doc.text(ln, W / 2, y, { align: "center" }); y += 17; }));
      y += 26;
      // tarjetas de portada
      const big = [["Venta", f.moneyShort(k.sales), k.salesChange], ["Clientes", f.int(k.buyers), k.buyersChange], ["Vencido", f.moneyShort(k.vencido), null]];
      const bw = 130, gx = (CW - bw * 3) / 2;
      big.forEach(([l, v, c], i) => {
        const x = M + i * (bw + gx);
        doc.setDrawColor(...LIGHT); doc.setLineWidth(0.8); doc.rect(x, y, bw, 54);
        font("normal", 9, GREY); doc.text(l, x + bw / 2, y + 14, { align: "center" });
        font("bold", 16); doc.text(clean(v), x + bw / 2, y + 34, { align: "center" });
        if (c != null) { font("bold", 8.5, c >= 0 ? GREEN : RED); doc.text(f.signedPct(c), x + bw / 2, y + 47, { align: "center" }); }
      });
      y += 90; font("normal", 10.5, GREY);
      doc.text("BIPA · Buenas ideas puestas en acción", W / 2, y, { align: "center" }); y += 15;
      doc.text(`Generado el ${f.dateTime(new Date())}`, W / 2, y, { align: "center" });
      font("bold", 10, RED); doc.text("CONFIDENCIAL · USO INTERNO", W / 2, H - M - 10, { align: "center" });
      newPage();
    }

    /* ================= Capítulos ================= */
    const chapters = {
      resumen() {
        chapter("Resumen Ejecutivo");
        if (!detailed) {
          font("normal", 10, GREY);
          doc.splitTextToSize(clean(`${model.periodLabel}${model.hasC ? ` vs. ${model.fair ? "mismos días del mes anterior" : model.compareLabel.toLowerCase()}` : ""} · ${filtersText} · Datos al ${cut}`), CW).forEach((ln) => { doc.text(ln, W / 2, y - 8, { align: "center" }); y += 12; });
          y += 4;
        }
        kpiGrid(model.kpiCards);
        h2("Conclusiones clave");
        bullets(model.conclusions.slice(0, detailed ? 8 : 3), detailed ? 10.5 : 10);
        if (model.empresas.length) {
          apaTable("Resultado por empresa", ["Empresa", "Venta", "Var.", "Particip.", "Clientes", "Ticket", "Vencido"],
            model.empresas.map((e) => [e.name, f.money(e.p), chg(e.chg), f.pct(e.share), f.int(e.buyers), f.money(e.ticket), f.money(e.vencido)]),
            model.hasC ? `Var.: frente a ${model.fair ? "los mismos días del mes anterior" : model.compareLabel.toLowerCase()}. Vencido: saldo vencido a la fecha de corte.` : "Vencido: saldo vencido a la fecha de corte.",
            { ...R(1, 2, 3, 4, 5, 6), 0: { cellWidth: 130 } }, { cell: toneCell(2) });
        }
        if (detailed) h2("Plan de acción prioritario");
        apaTable("Acciones con mayor impacto", ["Prioridad", "Responsable", "Acción", "Monto"],
          model.actions.slice(0, detailed ? 8 : 3).map((a) => [["", "Alta", "Media", "Normal"][a.priority] || "", a.who, a.text, a.value != null ? `${f.money(a.value)} ${a.valueLabel || ""}` : "-"]),
          detailed ? "Montos estimados con la historia de compra de cada cliente. El plan completo está en el capítulo final." : "Montos estimados con la historia de compra de cada cliente.", { 0: { cellWidth: 48 }, 1: { cellWidth: 92 }, 3: { cellWidth: 92, halign: "right" } });
        if (!detailed && y + 185 <= H - M) stackedChart(`Venta mensual por empresa en USD, ${trendTitle}`, trendAll, empNames, `Tonos intensos: periodo del informe.${partialNote}`, 88);
      },

      ventas() {
        chapter("Ventas y Variación");
        para(`En ${model.periodLabel.toLowerCase()} se facturaron ${f.money(k.sales)} en ${f.int(k.docs)} facturas a ${f.int(k.buyers)} clientes, con un ticket de ${f.money(k.ticket)} por factura.${model.hasC ? ` En ${model.fair ? "los mismos días del mes anterior" : model.compareLabel.toLowerCase()} la venta fue de ${f.money(k.salesC)} (${f.signedPct(k.salesChange)}).` : ""}${k.vsAvg3 != null ? ` Frente al promedio de los tres meses previos (${f.money(k.avg3)}) la variación es ${f.signedPct(k.vsAvg3)}.` : ""}`);
        if (model.fair) para("Como el mes está en curso, la comparación se hace contra los mismos días del mes anterior, para no comparar un mes incompleto con uno completo.", { style: "italic", size: 10, color: GREY });
        stackedChart(`Venta mensual por empresa en USD, ${trendTitle}`, trendAll, empNames, `Tonos intensos: periodo del informe; tonos claros: resto del historial.${partialNote}`);
        if (k.projection) {
          h2("Proyección de cierre del mes");
          para(`Con ${f.money(k.sales)} facturados en ${k.projection.days} de ${k.projection.total} días, el mes cerraría cerca de ${f.money(k.projection.value)} si se mantiene el ritmo diario.`);
        }
        if (model.bridge) {
          h2("¿Por qué cambió la venta?", true);
          const b = model.bridge;
          para(`La diferencia de ${f.signedMoney(b.end - b.start)} se explica por el comportamiento de los clientes: los que dejaron de comprar restaron ${f.money(Math.abs(b.lost))}, los que compraron menos restaron ${f.money(Math.abs(b.down))}, los que compraron más sumaron ${f.money(b.up)} y los nuevos o que regresaron sumaron ${f.money(b.fresh)}.`);
          waterfall("Puente de variación de la venta por tipo de cliente, en USD", b, "Entre paréntesis, número de clientes en cada grupo.");
          apaTable("Efecto precio y efecto volumen", ["Componente", "Monto", "Lectura"], [
            ["Efecto precio", f.signedMoney(b.priceFx), "Cambio del precio promedio en productos vendidos en ambos periodos."],
            ["Efecto volumen", f.signedMoney(b.volFx), "Cambio de unidades vendidas a precio del periodo anterior."],
            ["Productos nuevos o sin venta", f.signedMoney(b.mixFx), "Productos que solo se vendieron en uno de los dos periodos."],
          ], `Cálculo sobre productos${o.freight ? "" : " sin fletes"}; la suma puede diferir de la variación total por los fletes.`, { 0: { cellWidth: 150 }, 1: { cellWidth: 80, halign: "right" } }, { cell: toneCell(1) });
        }
      },

      empresas() {
        model.empresas.forEach((e, i) => {
          chapter(`Empresa: ${e.name}`);
          kpiGrid([
            { label: "Venta", value: f.moneyShort(e.p), sub: `${f.pct(e.share)} del total`, chg: e.chg, tone: e.chg == null ? "neutral" : e.chg < -(o.dropAlert || 10) ? "bad" : e.chg < 0 ? "warn" : "good" },
            { label: "Clientes que compraron", value: f.int(e.buyers), sub: `${f.pct(e.activation)} de la cartera`, chg: model.hasC ? (e.buyersC ? ((e.buyers - e.buyersC) / e.buyersC) * 100 : null) : null, tone: "neutral" },
            { label: "Ticket por factura", value: f.money(e.ticket), sub: `${f.int(e.docs)} facturas`, chg: null, tone: "neutral" },
            { label: "Saldo vencido", value: f.moneyShort(e.vencido), sub: `${f.pct(e.saldo ? (e.vencido / e.saldo) * 100 : 0)} de ${f.moneyShort(e.saldo)}`, chg: null, tone: e.saldo && e.vencido / e.saldo > 0.4 ? "bad" : "neutral" },
          ]);
          para(`${e.name} vendió ${f.money(e.p)}${e.chg != null ? ` (${f.signedPct(e.chg)})` : ""}${e.freight ? `, de los cuales ${f.money(e.freight)} son fletes (${f.money(e.salesNoFreight)} sin fletes)` : ""}. Vendió ${f.int(e.productsCount)} productos distintos; los tres principales concentran el ${f.pct(e.top3Share)} de su venta.`);
          stackedChart(`Venta mensual de ${e.name} en USD`, e.trend.map((t) => ({ ...t, e: null })), [e.name], `Barras intensas: periodo del informe.${partialNote}`, 110);
          apaTable(`Productos más vendidos de ${e.name}`, ["Producto", "Venta", "Particip.", "Var.", "Unidades", "Precio prom."],
            e.products.slice(0, full ? 20 : 15).map((x) => [x.name, f.money(x.p), f.pct(x.share), chg(x.chg), f.int(x.units), f.money(x.price)]),
            `Particip.: sobre la venta de la empresa${o.freight ? "" : " (sin fletes)"}. Precio prom.: venta entre unidades.`, { ...R(1, 2, 3, 4, 5), 0: { cellWidth: 200 } }, { cell: toneCell(3) });
          if (model.hasC && (e.risers.length || e.fallers.length)) {
            apaTable(`Productos que más subieron y bajaron en ${e.name}`, ["Producto", "Antes", "Ahora", "Diferencia"],
              [...e.risers.map((x) => [x.name, f.money(x.c), f.money(x.p), f.signedMoney(x.diff)]), ...e.fallers.map((x) => [x.name, f.money(x.c), f.money(x.p), f.signedMoney(x.diff)])],
              "Primero los cinco que más subieron, luego los cinco que más bajaron.", { ...R(1, 2, 3), 0: { cellWidth: 220 } }, { cell: toneCell(3) });
          }
          if (e.zones.length > 1) apaTable(`Zonas de ${e.name}`, ["Zona", "Venta", "Particip.", "Var.", "Clientes"],
            e.zones.slice(0, topN).map((x) => [x.name, f.money(x.p), f.pct(x.share), chg(x.chg), f.int(x.buyers)]), null, { ...R(1, 2, 3, 4), 0: { cellWidth: 170 } }, { cell: toneCell(3) });
          if (e.sellers.length > 1) apaTable(`Vendedores de ${e.name}`, ["Vendedor", "Venta", "Particip.", "Var.", "Clientes"],
            e.sellers.slice(0, topN).map((x) => [x.name, f.money(x.p), f.pct(x.share), chg(x.chg), f.int(x.buyers)]), null, { ...R(1, 2, 3, 4), 0: { cellWidth: 170 } }, { cell: toneCell(3) });
          if (e.leftCount) {
            h2(`Clientes que dejaron ${e.name} pero compran otras empresas`);
            para(`${f.int(e.leftCount)} clientes llevan más de ${o.riskDays || 30} días sin comprar a ${e.name} pero sí compraron a otra empresa del grupo en ese lapso. Su compra promedio en esta empresa era de ${f.money(e.leftValue)} al mes en conjunto.`);
            apaTable(`Recuperación dentro del grupo: ${e.name}`, ["Cliente", "Vendedor", "Días", "Compra/mes", "Sigue comprando a"],
              e.left.slice(0, topN).map((x) => [x.name, x.seller, f.int(x.days), f.money(x.monthly), x.others]), "Días: desde su última compra a esta empresa.", { ...R(2, 3), 0: { cellWidth: 150 } });
          }
        });
      },

      productos() {
        const P = model.products;
        chapter("Productos");
        para(`Se vendieron ${f.int(P.count)} productos distintos${o.freight ? "" : " (sin contar fletes)"}. ${f.int(P.abc.A.n)} productos generan el 80% de la venta (clase A), ${f.int(P.abc.B.n)} el siguiente 15% (clase B) y ${f.int(P.abc.C.n)} solo el 5% restante (clase C).`);
        apaTable("Clasificación ABC de productos", ["Clase", "Productos", "Venta", "Particip."],
          ["A", "B", "C"].map((c) => [c, f.int(P.abc[c].n), f.money(P.abc[c].v), f.pct(P.sold.length ? (P.abc[c].v / P.sold.reduce((a, x) => a + x.p, 0)) * 100 : 0)]),
          "Los productos clase C son candidatos a revisar: ocupan inventario y catálogo con poco aporte.", R(1, 2, 3));
        apaTable("Productos con mayor venta", ["Producto", "Clase", "Venta", "Particip.", "Var.", "Clientes"],
          P.sold.slice(0, full ? 25 : 15).map((x) => [x.name, x.abc, f.money(x.p), f.pct(x.share), chg(x.chg), f.int(x.buyers)]), null, { ...R(2, 3, 4, 5), 0: { cellWidth: 210 }, 1: { halign: "center" } }, { cell: toneCell(4) });
        if (model.hasC) {
          scatter("Matriz de productos: participación frente a crecimiento", P.sold.slice(0, 40),
            "Cada punto es un producto (los 40 de mayor venta). Línea vertical: participación promedio. Línea horizontal: sin crecimiento. Se rotulan los principales cuando hay espacio.");
          apaTable("Resumen de la matriz", ["Grupo", "Productos", "Venta", "Qué hacer"], [
            ["Estrellas", f.int(P.quad.estrella.length), f.money(P.quad.estrella.reduce((a, x) => a + x.p, 0)), "Asegurar inventario y exhibición."],
            ["Maduras en caída", f.int(P.quad.vaca.length), f.money(P.quad.vaca.reduce((a, x) => a + x.p, 0)), "Revisar precio y competencia: pesan mucho y caen."],
            ["Promesas", f.int(P.quad.promesa.length), f.money(P.quad.promesa.reduce((a, x) => a + x.p, 0)), "Impulsar con vendedores: crecen desde una base pequeña."],
            ["En alerta", f.int(P.quad.alerta.length), f.money(P.quad.alerta.reduce((a, x) => a + x.p, 0)), "Evaluar si se mantienen en el catálogo."],
          ], null, { ...R(1, 2), 3: { cellWidth: 210 } });
          apaTable("Productos que más subieron", ["Producto", "Antes", "Ahora", "Diferencia"], P.risers.map((x) => [x.name, f.money(x.c), f.money(x.p), f.signedMoney(x.diff)]), null, { ...R(1, 2, 3), 0: { cellWidth: 220 } }, { cell: toneCell(3) });
          apaTable("Productos que más bajaron", ["Producto", "Antes", "Ahora", "Diferencia"], P.fallers.map((x) => [x.name, f.money(x.c), f.money(x.p), f.signedMoney(x.diff)]), null, { ...R(1, 2, 3), 0: { cellWidth: 220 } }, { cell: toneCell(3) });
          if (P.noSale.length) apaTable("Productos que se vendían y no tuvieron venta en el periodo", ["Producto", "Venta anterior"], P.noSale.map((x) => [x.name, f.money(x.c)]), null, { 1: { halign: "right" } });
          if (P.newProducts.length) apaTable("Productos vendidos solo en este periodo", ["Producto", "Venta", "Clientes"], P.newProducts.map((x) => [x.name, f.money(x.p), f.int(x.buyers)]), null, R(1, 2));
        }
        if (P.declining3.length) {
          apaTable(`Productos con tres meses seguidos de caída (${P.last3.map((m) => global.BipaInforme2.monthShort(m)).join(", ")})`, ["Producto", ...P.last3.map((m) => global.BipaInforme2.monthShort(m)), "Var."],
            P.declining3.map((x) => [x.name, ...x.v.map((v) => f.moneyShort(v)), chg(x.drop)]), `Se muestran ${P.declining3.length} de ${P.declining3Count}.`, { ...R(1, 2, 3, 4, 5), 0: { cellWidth: 190 } }, { cell: toneCell(5) });
        }
        if (P.priceMoves.length) apaTable("Cambios de precio promedio", ["Producto", "Precio antes", "Precio ahora", "Var."], P.priceMoves.map((x) => [x.name, f.money(x.priceC), f.money(x.price), chg(x.priceChg)]),
          "Precio promedio = venta entre unidades. Solo productos con venta relevante en ambos periodos.", { ...R(1, 2, 3), 0: { cellWidth: 220 } }, { cell: toneCell(3) });
        if (P.priceSpread.length) apaTable("Productos vendidos a precios muy distintos", ["Producto", "Mínimo", "Máximo", "Diferencia"], P.priceSpread.map((x) => [x.name, f.money(x.minPr), f.money(x.maxPr), f.pct(x.spread)]),
          "Diferencia entre el precio unitario más bajo y el más alto facturado en el periodo. Puede reflejar listas de precio por tipo de cliente o descuentos no autorizados.", { ...R(1, 2, 3), 0: { cellWidth: 220 } });
        if (P.pairs.length) apaTable("Productos que se compran juntos", ["Producto A", "Producto B", "Facturas", "Afinidad"], P.pairs.map((x) => [x.a, x.b, f.int(x.n), `${f.pct(x.conf)}`]),
          `Facturas: veces que ambos aparecen en la misma factura (de ${f.int(P.invN)}). Afinidad: de las facturas con el producto menos frecuente del par, porcentaje que también lleva el otro. Útil para combos y para sugerir el segundo producto.`, { ...R(2, 3), 0: { cellWidth: 170 }, 1: { cellWidth: 170 } });
        if (P.topKg.length) apaTable("Productos con mayor peso despachado", ["Producto", "Peso", "Venta", "Venta por kg"], P.topKg.map((x) => [x.name, f.peso(x.kg), f.money(x.p), f.money(x.kg ? x.p / x.kg : 0)]),
          "Peso en kg según la columna PESO PARAFINA del Excel de facturación.", { ...R(1, 2, 3), 0: { cellWidth: 200 } });
      },

      clientes() {
        const C = model.clients;
        chapter("Clientes");
        para(`Con la historia de compra disponible se clasificaron ${f.int(C.total)} clientes según qué tan reciente, frecuente y alta es su compra.`);
        const segCol = { campeones: GREEN, leales: [90, 160, 120], nuevos: [86, 120, 170], riesgo: AMBER, ocasionales: [150, 158, 153], dormidos: RED };
        hbar("Clientes por segmento de comportamiento", C.segments.map((s) => ({ label: s.label, v: s.n, share: s.share, color: segCol[s.id] })), (s) => `${f.int(s.v)} clientes · ${f.pct(s.share)} de la venta`, null, 150);
        apaTable("Definición de segmentos", ["Segmento", "Clientes", "Venta del periodo", "Días prom. sin comprar", "Criterio"],
          C.segments.map((s) => [s.label, f.int(s.n), f.money(s.vP), f.int(s.avgRec), s.note]), null, { ...R(1, 2, 3), 4: { cellWidth: 170 } });
        h2("Clientes que ya deberían haber comprado", true);
        para(`${f.int(C.overdueCount)} clientes compran con un ritmo regular y ya pasaron su fecha habitual de pedido. En conjunto compran unos ${f.money(C.recoverValue)} al mes. Es la lista de llamadas más rentable.`);
        apaTable("Clientes con compra atrasada según su ritmo", ["Cliente", "Vendedor", "Compra cada", "Días sin comprar", "Compra/mes"],
          C.overdue.slice(0, full ? 30 : 15).map((x) => [x.name, x.seller, `${f.int(x.rhythm)} días`, f.int(x.since), f.money(x.monthly)]),
          "Compra cada: intervalo típico (mediana) entre sus compras. Compra/mes: venta total entre los meses desde su primera compra.", { ...R(2, 3, 4), 0: { cellWidth: 160 } });
        apaTable("Clientes con mayor compra en el periodo", ["Cliente", "Vendedor", "Venta", "Var.", "Empresas", "Segmento"],
          C.top.slice(0, full ? 30 : 20).map((x) => [x.name, x.seller, f.money(x.p), chg(x.chg), f.int(x.empresas), x.seg]), null, { ...R(2, 3, 4), 0: { cellWidth: 160 } }, { cell: toneCell(3) });
        if (C.declining.length) apaTable("Clientes que compraron mucho menos", ["Cliente", "Vendedor", "Antes", "Ahora", "Var."], C.declining.map((x) => [x.name, x.seller, f.money(x.c), f.money(x.p), chg(x.chg)]),
          "Clientes que siguieron comprando pero bajaron más de 30%.", { ...R(2, 3, 4), 0: { cellWidth: 160 } }, { cell: toneCell(4) });
        if (C.lost.length) apaTable("Clientes que no repitieron compra", ["Cliente", "Vendedor", "Compra anterior", "Días", "Empresas"], C.lost.map((x) => [x.name, x.seller, f.money(x.c), f.int(x.days), x.empresas]), null, { ...R(2, 3), 0: { cellWidth: 150 } });
        if (C.fresh.length) apaTable("Clientes nuevos del periodo", ["Cliente", "Vendedor", "Zona", "Compra", "Empresas"], C.fresh.map((x) => [x.name, x.seller, x.zone, f.money(x.p), x.empresas]), null, { 3: { halign: "right" }, 0: { cellWidth: 150 } });
        if (C.cohorts.length > 1) {
          const maxCols = Math.max(...C.cohorts.map((c) => c.cells.length));
          apaTable("Retención de clientes nuevos por mes de primera compra", ["Primera compra", "Clientes", ...Array.from({ length: maxCols - 1 }, (_, j) => `Mes ${j + 1}`)],
            C.cohorts.map((c) => [c.label, f.int(c.n), ...c.cells.slice(1).map((v) => (v == null ? "" : f.pct(v))), ...Array(maxCols - c.cells.length).fill("")]),
            "Porcentaje de los clientes de cada grupo que volvió a comprar en cada mes posterior. Una retención baja en el mes 1 indica que falta seguimiento después de la primera venta.",
            R(...Array.from({ length: maxCols + 1 }, (_, j) => j + 1)), {
              cell: (d) => { if (d.section === "body" && d.column.index >= 2) { const v = parseFloat(String(d.cell.raw).replace(",", ".")); if (Number.isFinite(v)) { const t = Math.min(1, v / 50); d.cell.styles.fillColor = [Math.round(255 - 70 * t), Math.round(255 - 40 * t), Math.round(255 - 60 * t)]; } } },
            });
        }
        if (C.combos.length && model.empRows.length > 1) {
          h2("Empresas por cliente", true);
          para(`${f.int(C.multi)} clientes compraron a más de una empresa del grupo en el periodo. Los clientes multiempresa suelen tener mayor compra y menor riesgo de abandono.`);
          apaTable("Combinaciones de empresas que compran los clientes", ["Empresas", "Clientes", "Venta", "Venta por cliente"], C.combos.map((x) => [x.name, f.int(x.n), f.money(x.v), f.money(x.n ? x.v / x.n : 0)]), null, { ...R(1, 2, 3), 0: { cellWidth: 230 } });
          const cs = C.crossSell.filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
          if (cs.length) apaTable("Oportunidades de venta cruzada", ["Compran a", "Pero no a", "Clientes", "Porcentaje"], cs.map((x) => [x.from, x.to, f.int(x.n), f.pct(x.pct)]), "Clientes activos en el periodo que compran a una empresa y no a la otra.", R(2, 3));
        }
      },

      vendedores() {
        if (model.sellers.length < 2) return;
        chapter("Vendedores");
        hbar("Venta del periodo por vendedor, en USD", model.sellers.slice(0, 14).map((s) => ({ label: s.name, v: s.p })), (s) => f.moneyShort(s.v), null);
        apaTable("Tablero de desempeño por vendedor", ["Vendedor", "Cartera", "Activ.", "Venta", "Var.", "Nuevos", "Perdidos", "Vencido", "Puntaje"],
          model.sellers.map((s) => [s.name, f.int(s.cartera), s.activation == null ? "-" : f.pct(s.activation), f.moneyShort(s.p), chg(s.chg), f.int(s.newC), f.int(s.lost), f.moneyShort(s.vencido), f.int(s.score)]),
          "Activ.: porcentaje de su cartera que compró. Puntaje de 0 a 100: 40% activación (relativa al mejor), 30% crecimiento y 30% cobranza (proporción del saldo que no está vencida).",
          { ...R(1, 2, 3, 4, 5, 6, 7, 8), 0: { cellWidth: 110 } }, { cell: toneCell(4), size: 8.5 });
        apaTable("Clientes por atender por vendedor", ["Vendedor", "Compra atrasada", "Perdidos", "Saldo vencido", "% vencido"],
          model.sellers.filter((s) => s.overdue || s.lost || s.vencido).map((s) => [s.name, f.int(s.overdue), f.int(s.lost), f.money(s.vencido), f.pct(s.vencidoShare)]), "Compra atrasada: clientes que pasaron su fecha habitual de pedido. % vencido: parte de su saldo por cobrar que ya venció.", { ...R(1, 2, 3, 4), 0: { cellWidth: 130 } });
      },

      zonas() {
        if (model.zones.length < 2) return;
        chapter("Zonas");
        const zm = model.zoneMatrix;
        const heads = ["Zona", ...zm.empresas.map((e) => e.split(" ").slice(0, 2).join(" ")), "Total", "Var."];
        apaTable("Venta por zona y empresa, en USD", heads,
          zm.rows.map((r) => [r.name, ...r.cells.map((v) => (v ? f.moneyShort(v) : "-")), f.moneyShort(r.total), chg(r.chg)]),
          `Se muestran las ${zm.rows.length} zonas con mayor venta de ${model.zones.length}. Las celdas vacías son oportunidades: la zona compra a otras empresas del grupo pero no a esa.`,
          R(...Array.from({ length: heads.length - 1 }, (_, j) => j + 1)), { cell: toneCell(heads.length - 1) });
        apaTable("Zonas con mayor caída", ["Zona", "Antes", "Ahora", "Var."],
          model.zones.filter((z) => z.c > 0 && z.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, topN).map((z) => [z.name, f.money(z.c), f.money(z.p), chg(z.chg)]), null, R(1, 2, 3), { cell: toneCell(3) });
      },

      cobranza() {
        const Cb = model.cobranza;
        chapter("Cobranza");
        para(`El saldo por cobrar suma ${f.money(Cb.saldo)}, de los cuales ${f.money(Cb.vencido)} (${f.pct(Cb.share)}) ya están vencidos. ${Cb.stillBuying ? `${f.int(Cb.stillBuying)} clientes con saldo vencido siguen comprando (${f.money(Cb.stillBuyingValue)} vencidos).` : ""}`);
        const agCol = [GREEN, [120, 170, 140], AMBER, [214, 110, 40], RED];
        hbar("Antigüedad del saldo por cobrar, en USD", Cb.aging.map((a, j) => ({ label: a.label, v: a.v, share: a.share, color: agCol[j] })), (s) => `${f.money(s.v)} (${f.pct(s.share)})`,
          "Días de atraso calculados con la fecha de vencimiento de cada factura frente a la fecha de corte.");
        if (Cb.byEmpresa.length > 1) apaTable("Saldo por empresa", ["Empresa", "Saldo", "Vencido", "% vencido"], Cb.byEmpresa.map((x) => [x.name, f.money(x.saldo), f.money(x.vencido), f.pct(x.share)]), null, R(1, 2, 3));
        apaTable("Clientes con mayor saldo vencido", ["Cliente", "Vendedor", "Saldo", "Vencido", "Días de atraso", "¿Sigue comprando?"],
          Cb.debtors.slice(0, full ? 30 : o.audience === "cobranza" ? 25 : 15).map((x) => [x.name, x.seller, f.money(x.saldo), f.money(x.venc), x.oldest ? f.int(x.oldest) : "-", x.buying ? "Sí" : "No"]),
          `Días de atraso: de la factura vencida más antigua. ¿Sigue comprando?: si compró en los últimos ${o.riskDays || 30} días.`, { ...R(2, 3, 4), 5: { halign: "center" }, 0: { cellWidth: 150 } });
        if (Cb.bySeller.length > 1) apaTable("Saldo vencido por vendedor", ["Vendedor", "Saldo", "Vencido", "% vencido"], Cb.bySeller.map((x) => [x.name, f.money(x.saldo), f.money(x.vencido), f.pct(x.vencidoShare)]), null, R(1, 2, 3));
      },

      plan() {
        chapter("Plan de Acción");
        para("Acciones ordenadas por prioridad y monto en juego. Cada responsable puede recibir su parte del informe filtrando por vendedor.");
        apaTable("Plan de acción completo", ["Prioridad", "Responsable", "Acción", "Monto"],
          model.actions.map((a) => [["", "Alta", "Media", "Normal"][a.priority] || "", a.who, a.text, a.value != null ? `${f.money(a.value)} ${a.valueLabel || ""}` : "-"]),
          null, { 0: { cellWidth: 48 }, 1: { cellWidth: 100 }, 3: { cellWidth: 92, halign: "right" } });
        h2("Conclusiones completas");
        bullets(model.conclusions, 10.5);
      },

      anexos() {
        chapter("Anexos");
        h2("A. Lista de llamadas: clientes con compra atrasada", true);
        apaTable("Clientes con compra atrasada, con teléfono", ["Cliente", "Vendedor", "Teléfono", "Zona", "Días", "Compra/mes"],
          model.clients.overdueAll.slice(0, 150).map((x) => [x.name, x.seller, x.phone || "-", x.zone, f.int(x.since), f.money(x.monthly)]),
          model.clients.overdueCount > 150 ? `Se listan 150 de ${model.clients.overdueCount}; la lista completa está en el Excel de respaldo.` : null, { ...R(4, 5), 0: { cellWidth: 140 } }, { size: 8.5 });
        h2("B. Definiciones y método", true);
        bullets([
          "Venta: total facturado (columna TOTAL VENTA) según la fecha de emisión de cada línea de factura.",
          "Comparación: periodo anterior de igual duración. En el mes en curso se compara contra los mismos días del mes anterior.",
          "Factura: combinación de empresa y número de documento. Ticket: venta entre facturas.",
          "Activación: clientes de la hoja CLIENTES que compraron en el periodo, sobre el total de la cartera filtrada.",
          "Puente de variación: la diferencia de venta repartida entre clientes que dejaron de comprar, compraron menos, compraron más y nuevos o que regresaron.",
          "Efecto precio: cambio del precio promedio por las unidades actuales. Efecto volumen: cambio de unidades al precio anterior.",
          "Clasificación ABC: productos ordenados por venta; A suma el 80%, B el siguiente 15% y C el 5% restante.",
          "Compra atrasada: clientes con al menos tres días de compra cuyo tiempo sin comprar supera 1,5 veces su intervalo típico.",
          "Antigüedad de saldo: días entre la fecha de vencimiento de cada factura con saldo y la fecha de corte.",
          "Todas las cifras se calculan en el navegador con el paquete de datos cifrado; ningún dato sale del dispositivo.",
        ], 10);
      },
    };

    const order = {
      general: ["resumen", "ventas", "empresas", "productos", "clientes", "vendedores", "zonas", "cobranza", "plan"],
      ventas: ["resumen", "ventas", "empresas", "clientes", "productos", "vendedores", "zonas", "cobranza", "plan"],
      cobranza: ["resumen", "cobranza", "clientes", "vendedores", "ventas", "empresas", "plan"],
      vendedor: ["resumen", "clientes", "cobranza", "empresas", "productos", "plan"],
    }[o.audience] || ["resumen"];
    const list = detailed ? order.concat(full ? ["anexos"] : []) : ["resumen"];
    list.forEach((c) => chapters[c]());

    /* ---------- Índice (página 2) ---------- */
    let offset = 0;
    if (detailed) {
      doc.insertPage(2); offset = 1;
      y = M; font("bold", 14); doc.text("Contenido", W / 2, y + 14, { align: "center" }); y += 40;
      toc.forEach((t) => {
        const indent = t.level === 2 ? 18 : 0;
        font(t.level === 1 ? "bold" : "normal", t.level === 1 ? 11.5 : 10.5);
        const label = clean(t.title), pg = String(t.page + offset);
        doc.text(label, M + indent, y + 11);
        const lw = doc.getTextWidth(label), pw = doc.getTextWidth(pg);
        font("normal", 10, GREY);
        const dotsFrom = M + indent + lw + 6, dotsTo = W - M - pw - 6;
        if (dotsTo > dotsFrom) { let dots = ""; while (doc.getTextWidth(dots + ".") < dotsTo - dotsFrom) dots += "."; doc.text(dots, dotsFrom, y + 11); }
        font(t.level === 1 ? "bold" : "normal", t.level === 1 ? 11.5 : 10.5); doc.text(pg, W - M, y + 11, { align: "right" });
        y += t.level === 1 ? 22 : 17;
      });
      y += 10; font("italic", 9.5, GREY);
      doc.splitTextToSize(clean(`Formato ${depth === "completo" ? "completo con anexos" : "estándar"}. ${filtersText}. Todas las cifras en dólares estadounidenses (USD) salvo indicación.`), CW).forEach((ln) => { doc.text(ln, M, y + 10); y += 13; });
    }

    /* ---------- Encabezado y pie ---------- */
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      if (detailed && i === 1) continue;
      font("bold", 8.5, GREEN); doc.text("BIPA · INFORME GERENCIAL", M, M - 30);
      font("normal", 10, INK); doc.text(String(i), W - M, M - 30, { align: "right" });
      doc.setDrawColor(...GREEN); doc.setLineWidth(1); doc.line(M, M - 24, W - M, M - 24);
      font("normal", 7.5, GREY);
      doc.text(clean(`Datos al ${cut} · ${model.periodLabel} · ${filtersText}`).slice(0, 125), M, H - M + 30);
      doc.text("Confidencial", W - M, H - M + 30, { align: "right" });
    }
    return doc;
  }

  global.BipaInformePdf2 = { makePdf };
})(typeof window !== "undefined" ? window : globalThis);
