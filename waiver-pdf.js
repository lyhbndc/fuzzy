// Builds a signed-waiver PDF in the browser. Shared by index.html (client copy) and admin.html.
// Usage: await FuzzyPDF.download(waiver, logoSrc)
//   waiver: { id?, created_at, full_name, dob:'YYYY-MM-DD', phone, contact_method, email, instagram,
//             concerns, agreements:[{tag,text,agreed}], signature, signature_strokes:{w,h,strokes} }
//   logoSrc: data URL or same-origin image URL (optional; skipped if it can't be loaded)
(() => {
  const JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
  let loading = null;
  function loadJsPDF() {
    if (window.jspdf) return Promise.resolve();
    return loading ||= new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = JSPDF_URL; s.onload = res;
      s.onerror = () => { loading = null; rej(new Error('Couldn’t load the PDF tool. Check your connection.')); };
      document.head.appendChild(s);
    });
  }

  async function toDataUrl(src) {
    if (!src) return null;
    if (src.startsWith('data:')) return src;
    try {
      const blob = await (await fetch(src)).blob();
      return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.onerror = () => r(null); fr.readAsDataURL(blob); });
    } catch { return null; }
  }

  // Built-in PDF fonts only cover Latin-1, so normalise punctuation and drop anything else (e.g. emoji).
  const clean = s => String(s ?? '')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '');

  const fmtDateTime = d => new Date(d).toLocaleString('en-PH', { month:'long', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit' });
  const fmtDob = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d).toLocaleDateString('en-PH', { month:'long', day:'numeric', year:'numeric' }); };
  function ageAt(dob, at) {
    const [y,m,d] = dob.split('-').map(Number), t = new Date(at);
    let a = t.getFullYear() - y;
    if (t.getMonth()+1 < m || (t.getMonth()+1 === m && t.getDate() < d)) a--;
    return a;
  }

  const INK = [17, 17, 17], MUTED = [100, 100, 100], LINE = [220, 210, 214], ACCENT = [194, 24, 91], OK = [22, 101, 52];

  async function build(w, logoSrc) {
    await loadJsPDF();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:'mm', format:'a4', compress:true });
    const PW = 210, PH = 297, M = 18, CW = PW - M * 2, BOTTOM = PH - 20;
    let y = M;

    const color = c => doc.setTextColor(...c);
    const font = (style, size) => { doc.setFont('helvetica', style); doc.setFontSize(size); };
    const need = h => { if (y + h > BOTTOM) { doc.addPage(); y = M; } };
    const rule = (c = LINE, wdt = 0.3) => { doc.setDrawColor(...c); doc.setLineWidth(wdt); doc.line(M, y, PW - M, y); };

    // ---- header ----
    const logo = await toDataUrl(logoSrc);
    if (logo) { try { doc.addImage(logo, 'PNG', M, y - 2, 36, 20, 'logo', 'FAST'); } catch {} }
    font('bold', 18); color(INK);
    doc.text('Tattoo Waiver', PW - M, y + 6, { align:'right' });
    font('normal', 9.5); color(MUTED);
    doc.text(clean(`Signed ${fmtDateTime(w.created_at)}`), PW - M, y + 12, { align:'right' });
    if (w.id) doc.text(clean(`Waiver ID ${w.id}`), PW - M, y + 16.5, { align:'right' });
    y += 24;
    rule(ACCENT, 0.8); y += 8;

    // ---- client details ----
    const ig = w.instagram ? '@' + String(w.instagram).replace(/^@/, '') : '';
    const facts = [
      ['Full name', w.full_name],
      ['Date of birth', `${fmtDob(w.dob)} (${ageAt(w.dob, w.created_at)} years old at signing)`],
      ['Phone', w.phone],
      w.email ? ['Email', w.email] : null,
      ig ? ['Instagram', ig] : null,
      ['Preferred contact', w.contact_method],
    ].filter(Boolean);
    font('bold', 8.5); color(ACCENT); doc.text('CLIENT DETAILS', M, y); y += 5;
    for (const [k, v] of facts) {
      font('normal', 10); color(MUTED); doc.text(k, M, y);
      font('bold', 10); color(INK);
      const lines = doc.splitTextToSize(clean(v), CW - 42);
      doc.text(lines, M + 42, y);
      y += 5.6 * lines.length;
    }
    y += 2;

    // ---- health concerns ----
    font('bold', 8.5); color(ACCENT); need(14); y += 3; doc.text('ALLERGIES OR HEALTH CONCERNS', M, y); y += 5;
    font('normal', 10); color(INK);
    for (const line of doc.splitTextToSize(clean(w.concerns && w.concerns.trim() ? w.concerns : 'None stated'), CW)) { need(5); doc.text(line, M, y); y += 5; }
    y += 2;

    // ---- statements ----
    const groups = [];
    for (const a of w.agreements || []) {
      let g = groups.find(x => x.tag === a.tag);
      if (!g) groups.push(g = { tag: a.tag, items: [] });
      g.items.push(a);
    }
    const TX = M + 20;
    for (const g of groups) {
      need(16); y += 4;
      font('bold', 8.5); color(ACCENT); doc.text(clean(g.tag).toUpperCase(), M, y); y += 2.5;
      rule(); y += 5;
      for (const a of g.items) {
        font('normal', 10);
        const lines = doc.splitTextToSize(clean(a.text), PW - M - TX);
        need(lines.length * 4.8 + 3);
        font('bold', 8); color(a.agreed ? OK : ACCENT);
        doc.text(a.agreed ? 'AGREED' : 'SKIPPED', M, y);
        font('normal', 10); color(INK);
        doc.text(lines, TX, y);
        y += lines.length * 4.8 + 2.6;
      }
    }

    // ---- signature ----
    need(62); y += 6;
    font('bold', 8.5); color(ACCENT); doc.text('SIGNATURE', M, y); y += 3;
    font('normal', 9.5); color(MUTED);
    const decl = doc.splitTextToSize(clean(`By signing below, I, ${w.full_name}, confirm that I have read, understood, and agreed to all terms in this waiver.`), CW);
    doc.text(decl, M, y + 3); y += decl.length * 4.6 + 4;

    const boxW = 90, boxH = 32, bx = M, by = y;
    const sig = w.signature_strokes;
    const strokes = (sig && Array.isArray(sig.strokes) ? sig.strokes : [])
      .map(s => (Array.isArray(s) ? s : []).map(p => [Number(p?.[0]), Number(p?.[1])]).filter(p => isFinite(p[0]) && isFinite(p[1])))
      .filter(s => s.length);
    if (strokes.length) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const s of strokes) for (const [px, py] of s) { minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py); }
      const k = Math.min(boxW / Math.max(maxX - minX, 1), boxH / Math.max(maxY - minY, 1));
      const ox = bx + (boxW - (maxX - minX) * k) / 2, oy = by + (boxH - (maxY - minY) * k) / 2;
      const X = px => ox + (px - minX) * k, Y = py => oy + (py - minY) * k;
      doc.setDrawColor(...INK); doc.setLineWidth(0.5); doc.setLineCap('round'); doc.setLineJoin('round');
      for (const s of strokes) {
        if (s.length === 1) { doc.setFillColor(...INK); doc.circle(X(s[0][0]), Y(s[0][1]), 0.25, 'F'); continue; }
        for (let i = 1; i < s.length; i++) doc.line(X(s[i-1][0]), Y(s[i-1][1]), X(s[i][0]), Y(s[i][1]));
      }
    } else {
      font('italic', 20); color(INK); doc.text(clean(w.signature), bx, by + boxH - 6);
    }
    y = by + boxH + 3;
    doc.setDrawColor(...INK); doc.setLineWidth(0.3); doc.line(bx, y, bx + boxW, y); y += 5;
    font('bold', 10); color(INK); doc.text(clean(w.full_name), bx, y);
    font('normal', 9); color(MUTED); doc.text(clean(fmtDateTime(w.created_at)), bx, y + 4.6);

    // ---- footer on every page ----
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      font('normal', 8); color(MUTED);
      doc.text('Fuzzy Needle  ·  instagram.com/fuzzyneedle.ph', M, PH - 10);
      doc.text(`Page ${p} of ${pages}`, PW - M, PH - 10, { align:'right' });
    }
    return doc;
  }

  function fileName(w) {
    const name = clean(w.full_name).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'client';
    const d = new Date(w.created_at), pad = n => String(n).padStart(2, '0');
    return `Fuzzy-Needle-Waiver-${name}-${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}.pdf`;
  }

  async function download(w, logoSrc) {
    const doc = await build(w, logoSrc);
    doc.save(fileName(w));
  }

  window.FuzzyPDF = { build, download, fileName };
})();
