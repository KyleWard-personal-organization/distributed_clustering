const pptxgen = require('/Users/Zhuanz1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pptxgenjs');
const { imageSize } = require('/Users/Zhuanz1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/image-size');
const fs = require('fs');
const path = require('path');

const pptx = new pptxgen();
pptx.layout = 'LAYOUT_WIDE';
pptx.defineLayout({ name: 'CUSTOM_WIDE', width: 20, height: 11.25 });
pptx.layout = 'CUSTOM_WIDE';
pptx.author = 'MSBD 5003 Project Team';
pptx.company = 'HKUST';
pptx.subject = 'Distributed HDBSCAN & DBSCAN with Apache Spark';
pptx.title = 'Distributed HDBSCAN & DBSCAN with Apache Spark';
pptx.lang = 'en-US';
pptx.theme = {
  headFontFace: 'Calibri Light',
  bodyFontFace: 'Calibri',
  lang: 'en-US'
};
pptx.margin = 0;

const W = 20;
const H = 11.25;
const C = {
  bg: 'F7F7F7',
  ink: '323232',
  muted: '777777',
  light: 'EDEDED',
  mid: 'CFCFCF',
  orange: 'FF9966',
  orange2: 'FFB088',
  green: '55A868',
  blue: '4C72B0',
  red: 'C44E52',
  purple: '8172B2',
  taxi: '1F77B4',
  white: 'FFFFFF'
};

const OUT = 'distributed_clustering_final_presentation.pptx';

function addBg(slide) {
  slide.background = { color: C.bg };
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color: C.bg }, line: { color: C.bg, transparency: 100 } });
}

function addTopRule(slide, section = '', page = '') {
  slide.addShape(pptx.ShapeType.line, { x: 0.75, y: 0.48, w: 18.5, h: 0, line: { color: C.orange, width: 1.5 } });
  if (section) {
    slide.addText(section.toUpperCase(), {
      x: 0.75, y: 0.15, w: 7.5, h: 0.25,
      fontFace: 'Calibri', fontSize: 10, color: C.muted, bold: true,
      margin: 0, breakLine: false, fit: 'shrink'
    });
  }
  if (page) {
    slide.addText(page, {
      x: 18.6, y: 0.15, w: 0.7, h: 0.25,
      fontFace: 'Calibri', fontSize: 10, color: C.muted, align: 'right',
      margin: 0
    });
  }
}

function title(slide, text, subtitle, section = '', page = '') {
  addBg(slide);
  addTopRule(slide, section, page);
  slide.addText(text, {
    x: 0.75, y: 0.85, w: 13.7, h: 0.7,
    fontFace: 'Calibri Light', fontSize: 33, color: C.ink,
    margin: 0, breakLine: false, fit: 'shrink'
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.78, y: 1.55, w: 12.5, h: 0.35,
      fontFace: 'Calibri', fontSize: 13, color: C.muted,
      margin: 0, breakLine: false, fit: 'shrink'
    });
  }
}

function note(slide, text) {
  slide.addNotes(text.trim().split('\n').map(s => s.trim()).filter(Boolean).join('\n'));
}

function addLabel(slide, text, x, y, w, h, opts = {}) {
  slide.addText(text, {
    x, y, w, h,
    fontFace: opts.fontFace || 'Calibri',
    fontSize: opts.size ? opts.size * 1.12 : 13.5,
    color: opts.color || C.ink,
    bold: opts.bold || false,
    align: opts.align || 'center',
    valign: opts.valign || 'mid',
    margin: opts.margin ?? 0.03,
    breakLine: false,
    fit: 'shrink',
    rotate: opts.rotate || 0
  });
}

function addPill(slide, text, x, y, w, color = C.orange, opts = {}) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x, y, w, h: opts.h || 0.42,
    rectRadius: 0.08,
    fill: { color, transparency: opts.transparency ?? 0 },
    line: { color, transparency: 100 }
  });
  addLabel(slide, text, x + 0.06, y + 0.08, w - 0.12, (opts.h || 0.42) - 0.14, {
    size: opts.size || 10.5, color: opts.textColor || C.white, bold: true
  });
}

function addSegment(slide, x1, y1, x2, y2, color = C.orange, width = 2, opts = {}) {
  const isH = Math.abs(y2 - y1) < 0.001;
  const isV = Math.abs(x2 - x1) < 0.001;
  const lineOpts = {
    color, width,
    transparency: opts.transparency ?? 0,
    dash: opts.dash,
    beginArrowType: opts.beginArrowType || 'none',
    endArrowType: opts.endArrowType || 'none'
  };
  if (isH) {
    const x = Math.min(x1, x2);
    const w = Math.abs(x2 - x1);
    const beginArrowType = x2 < x1 ? opts.endArrowType || 'none' : opts.beginArrowType || 'none';
    const endArrowType = x2 < x1 ? opts.beginArrowType || 'none' : opts.endArrowType || 'none';
    slide.addShape(pptx.ShapeType.line, {
      x, y: y1, w, h: 0,
      line: { ...lineOpts, beginArrowType, endArrowType }
    });
    return;
  }
  if (isV) {
    const y = Math.min(y1, y2);
    const h = Math.abs(y2 - y1);
    const beginArrowType = y2 < y1 ? opts.endArrowType || 'none' : opts.beginArrowType || 'none';
    const endArrowType = y2 < y1 ? opts.beginArrowType || 'none' : opts.endArrowType || 'none';
    slide.addShape(pptx.ShapeType.line, {
      x: x1, y, w: 0, h,
      line: { ...lineOpts, beginArrowType, endArrowType }
    });
    return;
  }
  // WPS can shift free diagonal line shapes in some decks. Use an orthogonal elbow
  // so the connection stays stable across WPS, PowerPoint, and Quick Look.
  addSegment(slide, x1, y1, x2, y1, color, width, { transparency: opts.transparency, dash: opts.dash });
  addSegment(slide, x2, y1, x2, y2, color, width, {
    transparency: opts.transparency,
    dash: opts.dash,
    beginArrowType: y2 < y1 ? opts.endArrowType : 'none',
    endArrowType: y2 >= y1 ? opts.endArrowType : 'none'
  });
}

function addArrow(slide, x1, y1, x2, y2, color = C.orange, width = 2) {
  addSegment(slide, x1, y1, x2, y2, color, width, { endArrowType: 'triangle' });
}

function addBeginArrow(slide, x1, y1, x2, y2, color = C.orange, width = 2) {
  addSegment(slide, x1, y1, x2, y2, color, width, { beginArrowType: 'triangle' });
}

function addPlainLine(slide, x1, y1, x2, y2, color = C.mid, width = 1, opts = {}) {
  addSegment(slide, x1, y1, x2, y2, color, width, opts);
}

function addNode(slide, text, x, y, w, h, opts = {}) {
  const fill = opts.fill || C.white;
  const line = opts.line || C.ink;
  slide.addShape(opts.shape || pptx.ShapeType.roundRect, {
    x, y, w, h,
    rectRadius: 0.08,
    fill: { color: fill, transparency: opts.transparency ?? 0 },
    line: { color: line, width: opts.lineWidth ?? 1.2, transparency: opts.lineTrans ?? 0 }
  });
  addLabel(slide, text, x + 0.1, y + 0.12, w - 0.2, h - 0.22, {
    size: opts.size || 13.5, color: opts.textColor || C.ink, bold: opts.bold ?? true
  });
}

function addImageContain(slide, imgPath, x, y, w, h, opts = {}) {
  const dim = imageSize(imgPath);
  const imgRatio = dim.width / dim.height;
  const boxRatio = w / h;
  let iw, ih, ix, iy;
  if (imgRatio > boxRatio) {
    iw = w; ih = w / imgRatio; ix = x; iy = y + (h - ih) / 2;
  } else {
    ih = h; iw = h * imgRatio; ix = x + (w - iw) / 2; iy = y;
  }
  if (opts.frame) {
    slide.addShape(pptx.ShapeType.rect, {
      x, y, w, h,
      fill: { color: C.white },
      line: { color: opts.frameColor || C.mid, width: 1 }
    });
  }
  slide.addImage({ path: imgPath, x: ix, y: iy, w: iw, h: ih });
}

function addImageCrop(slide, imgPath, x, y, w, h, opts = {}) {
  if (opts.frame) {
    slide.addShape(pptx.ShapeType.rect, {
      x, y, w, h,
      fill: { color: C.white },
      line: { color: opts.frameColor || C.mid, width: 1 }
    });
  }
  slide.addImage({ path: imgPath, x, y, w, h, sizing: { type: 'crop', x, y, w, h } });
}

function metric(slide, big, label, x, y, w, color = C.orange) {
  slide.addText(big, {
    x, y, w, h: 0.7, fontFace: 'Calibri Light', fontSize: 34,
    color, bold: false, margin: 0, align: 'center', fit: 'shrink'
  });
  slide.addText(label, {
    x, y: y + 0.7, w, h: 0.35, fontFace: 'Calibri', fontSize: 10.5,
    color: C.muted, align: 'center', margin: 0, fit: 'shrink'
  });
}

function sectionSlide(num, heading, sub, notesText) {
  const slide = pptx.addSlide();
  addBg(slide);
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 1.1, h: H, fill: { color: C.orange }, line: { color: C.orange } });
  slide.addText(String(num).padStart(2, '0'), {
    x: 1.65, y: 2.6, w: 3.2, h: 1.4,
    fontFace: 'Calibri Light', fontSize: 72, color: C.orange, margin: 0
  });
  slide.addText(heading, {
    x: 4.7, y: 3.0, w: 10.8, h: 0.85,
    fontFace: 'Calibri Light', fontSize: 40, color: C.ink, margin: 0
  });
  slide.addShape(pptx.ShapeType.line, { x: 4.72, y: 4.1, w: 8.2, h: 0, line: { color: C.ink, width: 1 } });
  slide.addText(sub, {
    x: 4.72, y: 4.45, w: 9.6, h: 0.6,
    fontFace: 'Calibri', fontSize: 17, color: C.muted, margin: 0, fit: 'shrink'
  });
  note(slide, notesText);
  return slide;
}

function tinyFooter(slide, text) {
  slide.addText(text, { x: 0.75, y: 10.75, w: 18.5, h: 0.25, fontFace: 'Calibri', fontSize: 8.5, color: '999999', margin: 0 });
}

// 1 Cover
{
  const slide = pptx.addSlide();
  addBg(slide);
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.95, h: H, fill: { color: C.orange }, line: { color: C.orange } });
  slide.addText('Distributed\nHDBSCAN & DBSCAN', {
    x: 1.55, y: 1.1, w: 10.8, h: 2.25,
    fontFace: 'Calibri Light', fontSize: 38, color: C.ink, margin: 0,
    breakLine: false, fit: 'shrink'
  });
  slide.addText('with Apache Spark', {
    x: 1.58, y: 3.45, w: 5.8, h: 0.45,
    fontFace: 'Calibri', fontSize: 16, color: C.muted, margin: 0
  });
  // Clean graph-compression motif: aligned nodes with a selected MST skeleton.
  const pts = [
    [12.15, 3.65], [13.65, 3.65], [15.15, 3.65], [16.65, 3.65],
    [12.15, 5.15], [13.65, 5.15], [15.15, 5.15], [16.65, 5.15],
    [12.15, 6.65], [13.65, 6.65], [15.15, 6.65], [16.65, 6.65]
  ];
  const paleEdges = [[0,1],[1,2],[2,3],[4,5],[5,6],[6,7],[8,9],[9,10],[10,11],[1,5],[5,9],[2,6],[6,10],[3,7],[7,11]];
  paleEdges.forEach(([a,b]) => {
    const p = pts[a], q = pts[b];
    addPlainLine(slide, p[0], p[1], q[0], q[1], C.mid, 0.9, { transparency: 48 });
  });
  const mstEdges = [[0,1],[1,5],[5,6],[6,2],[6,10],[10,11],[5,9],[9,8]];
  mstEdges.forEach(([a,b]) => {
    const p = pts[a], q = pts[b];
    addPlainLine(slide, p[0], p[1], q[0], q[1], C.orange, 2.2, { transparency: 0 });
  });
  pts.forEach((p,i) => {
    const selected = [0,1,2,5,6,8,9,10,11].includes(i);
    slide.addShape(pptx.ShapeType.ellipse, {
      x: p[0]-0.11, y: p[1]-0.11, w: 0.22, h: 0.22,
      fill: { color: selected ? (i % 3 === 0 ? C.orange : C.ink) : 'D8D8D8' },
      line: { color: C.bg, width: 0.7 }
    });
  });
  slide.addText('MSBD 5003 Deep Project', { x: 1.58, y: 9.5, w: 5.2, h: 0.35, fontFace: 'Calibri', fontSize: 11.5, color: C.muted, margin: 0 });
  slide.addText('Manual implementation · Spark RDDs · Density clustering · Graph compression', { x: 1.58, y: 9.95, w: 8.8, h: 0.3, fontFace: 'Calibri', fontSize: 10, color: C.muted, margin: 0 });
  note(slide, `
    Open by framing this as a deep project about both machine learning and distributed systems.
    The project implements distributed DBSCAN and an approximate distributed HDBSCAN-inspired pipeline from scratch in PySpark.
    The visual motif is a graph compressed into a tree-like structure, which is the central idea of the deck.
  `);
}

// 2 Roadmap
{
  const slide = pptx.addSlide();
  title(slide, 'Presentation roadmap', 'Five parts, one through-line: variable density meets distributed graph computation.', 'Overview', '02');
  const items = [
    ['01', 'Introduction', 'Why DBSCAN struggles'],
    ['02', 'Algorithm', 'From eps to hierarchy'],
    ['03', 'Spark Implementation', 'Partition · Local MST · Merge'],
    ['04', 'Experiments + Discussion', 'Quality, scaling, limitations'],
    ['05', 'Conclusion', 'What worked and what bottlenecked']
  ];
  items.forEach((it, i) => {
    const x = 1.4 + i * 3.55;
    slide.addShape(pptx.ShapeType.ellipse, { x, y: 4.0, w: 0.75, h: 0.75, fill: { color: i === 0 ? C.orange : C.white }, line: { color: C.orange, width: 1.5 } });
    addLabel(slide, it[0], x, 4.22, 0.75, 0.22, { size: 10, color: i === 0 ? C.white : C.orange, bold: true });
    if (i < items.length - 1) addArrow(slide, x + 0.9, 4.38, x + 3.28, 4.38, C.mid, 1.4);
    addLabel(slide, it[1], x - 0.8, 5.05, 2.35, 0.35, { size: 15, bold: true });
    addLabel(slide, it[2], x - 0.85, 5.5, 2.45, 0.3, { size: 10, color: C.muted });
  });
  note(slide, `
    The deck is intentionally organized in five parts, matching the report structure but not copying it.
    I will keep slide text light and use diagrams for the algorithm and Spark design.
    The detailed reasoning will be delivered verbally.
  `);
}

// 3 Section intro
sectionSlide(1, 'Introduction', 'The project starts from a simple tension: density clustering is useful, but global thresholds are brittle.', `
  This section motivates the problem.
  DBSCAN is attractive because it handles arbitrary shapes and noise, but it relies on a single global eps.
  HDBSCAN removes that global threshold, but introduces heavy graph computation.
`);

// 4 Problem tension
{
  const slide = pptx.addSlide();
  title(slide, 'Problem background', 'Density clustering is useful, but scaling it correctly is not trivial.', 'Introduction', '04');
  addLabel(slide, 'We study density clustering when both density and data scale change.', 1.0, 2.15, 12.8, 0.36, { size: 15.5, bold: true, align: 'left' });
  addLabel(slide, 'The algorithmic issue is variable density; the systems issue is how to distribute graph-heavy logic in Spark.', 1.0, 2.55, 14.2, 0.35, { size: 12.8, color: C.muted, align: 'left' });

  const cols = [
    [1.25, '1  Density clustering goal', 'discover arbitrary shapes\nand mark noise'],
    [7.0, '2  Fixed eps breaks', 'one global radius cannot fit\nboth dense and sparse areas'],
    [12.75, '3  Spark adds scale', 'neighbor and graph logic\ncross partition boundaries']
  ];
  cols.forEach(([x, head, sub], i) => {
    slide.addShape(pptx.ShapeType.line, { x, y: 3.35, w: 4.8, h: 0, line: { color: i === 2 ? C.orange : C.ink, width: 1.6 } });
    addLabel(slide, head, x, 3.62, 4.8, 0.34, { size: 14.5, bold: true, align: 'left' });
    addLabel(slide, sub, x, 4.05, 4.8, 0.62, { size: 12.2, color: C.muted, align: 'left' });
  });

  const densePts = [[2.0,5.35],[2.25,5.15],[2.55,5.28],[2.35,5.55],[2.7,5.62],[2.12,5.82]];
  const sparsePts = [[3.95,5.1],[4.55,5.35],[4.2,5.9],[5.0,5.75]];
  densePts.forEach(p => slide.addShape(pptx.ShapeType.ellipse, { x:p[0], y:p[1], w:0.16, h:0.16, fill:{color:C.blue}, line:{color:C.blue} }));
  sparsePts.forEach(p => slide.addShape(pptx.ShapeType.ellipse, { x:p[0], y:p[1], w:0.16, h:0.16, fill:{color:C.green}, line:{color:C.green} }));
  addLabel(slide, 'dense region', 1.7, 6.35, 1.8, 0.28, { size: 10.8, color: C.blue });
  addLabel(slide, 'sparse region', 4.0, 6.35, 1.8, 0.28, { size: 10.8, color: C.green });

  addNode(slide, 'small eps\nmisses sparse points', 7.25, 5.0, 2.2, 0.85, { fill: C.white, line: C.red, textColor: C.red, size: 12.2 });
  addNode(slide, 'large eps\nmerges regions', 9.7, 5.0, 2.2, 0.85, { fill: C.white, line: C.red, textColor: C.red, size: 12.2 });
  addPlainLine(slide, 9.48, 5.42, 9.68, 5.42, C.mid, 1.1);
  addLabel(slide, 'HDBSCAN replaces one eps\nwith a density hierarchy.', 7.52, 6.45, 4.05, 0.55, { size: 13.2, bold: true });

  for (let i = 0; i < 4; i++) {
    const x = 13.2 + (i % 2) * 2.0;
    const y = 5.0 + Math.floor(i / 2) * 1.05;
    slide.addShape(pptx.ShapeType.rect, { x, y, w: 1.5, h: 0.75, fill:{color:C.white}, line:{color:C.orange, width:1.4} });
    addLabel(slide, `P${i+1}`, x, y+0.25, 1.5, 0.2, { size: 11.5, bold: true, color: C.orange });
  }
  addPlainLine(slide, 14.7, 5.38, 15.2, 5.38, C.orange, 1.2);
  addPlainLine(slide, 14.7, 6.43, 15.2, 6.43, C.orange, 1.2);
  addLabel(slide, 'local work on workers', 12.95, 6.95, 2.65, 0.3, { size: 11.4, color: C.muted });
  addLabel(slide, 'global merge on driver', 15.0, 6.95, 2.65, 0.3, { size: 11.4, color: C.orange, bold: true });

  slide.addShape(pptx.ShapeType.line, { x: 1.0, y: 8.05, w: 17.9, h: 0, line: { color: C.orange, width: 1.5 } });
  addLabel(slide, 'Project focus: distributed DBSCAN baseline + HDBSCAN-inspired Spark pipeline + scalability analysis.', 1.25, 8.35, 17.5, 0.42, { size: 15.5, bold: true });
  note(slide, `
    This slide now gives the audience the problem background before the visual intuition.
    DBSCAN is useful because it handles arbitrary shapes and noise, but eps is a single global threshold.
    HDBSCAN helps by using density hierarchy, but the hard part is distributing its graph-heavy computation in Spark.
  `);
}

// 5 Project objective
{
  const slide = pptx.addSlide();
  title(slide, 'Project objective', 'Build the algorithmic internals, not a wrapper around a library.', 'Introduction', '05');
  addNode(slide, 'Distributed\nDBSCAN baseline', 1.6, 3.0, 3.3, 1.25, { fill: C.white, line: C.orange, size: 17 });
  addNode(slide, 'Distributed\nHDBSCAN-inspired pipeline', 8.0, 2.85, 4.0, 1.55, { fill: C.orange, line: C.orange, textColor: C.white, size: 17 });
  addNode(slide, 'Experimental\nscalability analysis', 15.0, 3.0, 3.3, 1.25, { fill: C.white, line: C.orange, size: 17 });
  addArrow(slide, 5.2, 3.8, 7.6, 3.8, C.ink, 1.4);
  addArrow(slide, 12.35, 3.8, 14.65, 3.8, C.ink, 1.4);
  const scope = [
    ['Baseline', 'grid partitioning · ghost points · local DBSCAN · Union-Find merge'],
    ['Main pipeline', 'KD-tree partitioning · local MRD · Local MST compression · global MST'],
    ['Evaluation', 'cluster quality · strong scaling · data scalability · real taxi data']
  ];
  scope.forEach((r, i) => {
    const x = [1.35, 7.05, 14.05][i];
    const y = 5.25;
    addLabel(slide, r[0], x, y, 3.9, 0.3, { size: 14.5, bold: true });
    addLabel(slide, r[1], x - 0.15, y + 0.42, 4.25, 0.65, { size: 11.3, color: C.muted });
  });
  const atoms = [
    ['No MLlib black box', 3.2, 6.2],
    ['Manual Union-Find + Kruskal', 7.0, 6.2],
    ['RDD transformations', 11.2, 6.2],
    ['Phase-level timing', 15.0, 6.2]
  ];
  atoms.forEach(([t,x,y]) => addPill(slide, t, x, y + 1.35, 2.6, C.ink, { h: 0.46, size: 10.5 }));
  note(slide, `
    The project has three objectives: implement a DBSCAN baseline, implement an HDBSCAN-inspired distributed pipeline, and evaluate the system experimentally.
    The important course requirement is that the internal algorithmic logic is implemented manually.
    This includes spatial partitioning, graph construction, MST, and hierarchy extraction.
  `);
}

// 6 Section algorithm
sectionSlide(2, 'Algorithm Overview', 'The algorithm story moves from fixed-radius density to graph-based density hierarchy.', `
  This section explains the algorithm visually.
  It covers DBSCAN, why fixed eps fails, and how HDBSCAN uses core distance, MRD, MST, and stability.
`);

// 7 DBSCAN mechanics
{
  const slide = pptx.addSlide();
  title(slide, 'Distributed DBSCAN baseline', 'Local DBSCAN is simple; boundary correctness requires partition-aware merging.', 'Algorithm', '07');
  addLabel(slide, 'Inside each Spark partition', 1.35, 2.25, 5.4, 0.35, { size: 14.5, bold: true, align: 'left' });
  addLabel(slide, 'DBSCAN still uses the classic eps / minPts rule.', 1.35, 2.63, 5.5, 0.35, { size: 12.5, color: C.muted, align: 'left' });
  const clusterPts = [[3.15,3.85],[3.55,3.65],[3.92,3.92],[3.42,4.35],[3.95,4.45],[4.35,4.15],[3.08,4.82],[4.22,4.82]];
  clusterPts.forEach((p,i) => slide.addShape(pptx.ShapeType.ellipse, { x:p[0], y:p[1], w:0.24, h:0.24, fill:{color:i===0?C.orange:C.blue}, line:{color:C.white,width:0.5} }));
  slide.addShape(pptx.ShapeType.arc, { x:2.55, y:3.22, w:2.45, h:2.45, line:{color:C.orange,width:2.2,transparency:12} });
  addLabel(slide, 'eps neighborhood', 2.75, 5.95, 2.8, 0.35, { size: 11.5, color:C.muted });
  addLabel(slide, 'core', 2.65, 3.25, 1.2, 0.3, { size: 11.5, color:C.orange, bold:true });
  addArrow(slide, 6.0,4.35,7.45,4.35,C.orange,2);
  const steps = [
    ['1', 'Find neighbors'],
    ['2', 'Classify core / border / noise'],
    ['3', 'Expand density-connected cluster']
  ];
  steps.forEach((s,i) => {
    const x = 7.9 + i*3.45;
    slide.addShape(pptx.ShapeType.ellipse, { x, y:3.72, w:0.82, h:0.82, fill:{color:C.orange}, line:{color:C.orange} });
    addLabel(slide, s[0], x, 3.97, 0.82, 0.2, { size:12, color:C.white, bold:true });
    addLabel(slide, s[1], x-0.9, 4.85, 2.65, 0.55, { size:14.2, bold:true });
  });
  slide.addShape(pptx.ShapeType.line, { x: 8.9, y: 4.13, w: 2.35, h: 0, line: { color: C.mid, width: 1.3, endArrowType: 'triangle' }});
  slide.addShape(pptx.ShapeType.line, { x: 12.35, y: 4.13, w: 2.35, h: 0, line: { color: C.mid, width: 1.3, endArrowType: 'triangle' }});
  slide.addShape(pptx.ShapeType.line, { x: 1.25, y: 6.45, w: 17.3, h: 0, line: { color: C.mid, width: 0.9, transparency: 35 } });
  addLabel(slide, 'Across Spark partitions', 1.35, 6.82, 5.4, 0.35, { size: 14.5, bold: true, align: 'left' });
  addLabel(slide, 'Local labels are only provisional until boundary components are merged.', 1.35, 7.2, 6.8, 0.35, { size: 12.5, color: C.muted, align: 'left' });
  const distFlow = [
    ['Grid partition', 8.1],
    ['Ghost points', 10.95],
    ['Local DBSCAN', 13.8],
    ['Union-Find merge', 16.65]
  ];
  distFlow.forEach(([t, x], i) => {
    addPill(slide, t, x, 6.9, 2.2, i === 2 ? C.orange : C.ink, { h: 0.5, size: 11.5 });
    if (i < distFlow.length - 1) addArrow(slide, x + 2.3, 7.15, x + 2.75, 7.15, C.mid, 1.1);
  });
  addLabel(slide, 'Distributed challenge: a neighbor may live in another partition, so labels must be reconciled globally.', 2.2, 8.62, 15.6, 0.42, { size: 16, bold: true });
  note(slide, `
    DBSCAN is based on a simple local rule: if a point has enough neighbors within eps, it is a core point.
    In this project, that rule is executed inside partitions, while ghost points protect boundary neighborhoods.
    The final Union-Find merge reconciles labels when density-connected components cross partition boundaries.
  `);
}

// 8 DBSCAN failure evidence
{
  const slide = pptx.addSlide();
  title(slide, 'Fixed eps creates opposite failure modes', 'The same algorithm fails differently depending on the radius.', 'Algorithm', '08');
  addImageContain(slide, 'imgs/test_data_2k_dbscan_results_eps0.3.png', 0.9, 2.0, 8.2, 6.2, { frame: true });
  addImageContain(slide, 'imgs/test_data_2k_dbscan_results_eps1.0.png', 10.9, 2.0, 8.2, 6.2, { frame: true });
  addPill(slide, 'eps = 0.3 → sparse clusters become noise', 1.55, 8.65, 6.9, C.red, { h: 0.46, size: 11 });
  addPill(slide, 'eps = 1.0 → 96.5% points merge into one cluster', 11.3, 8.65, 7.25, C.red, { h: 0.46, size: 11 });
  note(slide, `
    This slide uses the actual synthetic results.
    At eps 0.3, DBSCAN produces 31 clusters and 31.3% noise.
    At eps 1.0, the noise almost disappears, but 96.5% of points collapse into one giant cluster.
    This motivates replacing one global eps with a density hierarchy.
  `);
}

// 9 HDBSCAN ladder
{
  const slide = pptx.addSlide();
  title(slide, 'HDBSCAN replaces eps with density hierarchy', 'The key object is not a radius, but a stable tree of dense components.', 'Algorithm', '09');
  const steps = [
    ['Core distance', 'local density scale', C.blue],
    ['MRD graph', 'density-aware edge weights', C.green],
    ['Minimum spanning tree', 'keep essential connectivity', C.orange],
    ['Hierarchy', 'cut long edges over levels', C.purple],
    ['Stability', 'select persistent clusters', C.red]
  ];
  steps.forEach((s,i) => {
    const x = 1.05 + i*3.65;
    addNode(slide, s[0], x, 4.2, 2.6, 0.82, { fill: s[2], line:s[2], textColor:C.white, size:13 });
    addLabel(slide, s[1], x-0.15, 5.25, 2.9, 0.42, { size:10.5, color:C.muted });
    if (i<steps.length-1) addArrow(slide, x+2.75, 4.62, x+3.45, 4.62, C.ink, 1.2);
  });
  addLabel(slide, 'Single-machine view: global KNN, MRD graph, MST, hierarchy.', 1.45, 6.55, 7.1, 0.35, { size: 12.8, color: C.muted, bold: true, align: 'left' });
  addLabel(slide, 'Distributed view: local KNN/MRD + Local MST compression + driver merge.', 10.2, 6.55, 7.9, 0.35, { size: 12.8, color: C.orange, bold: true, align: 'left' });
  slide.addText('MRD(a,b) = max(core(a), core(b), dist(a,b))', {
    x: 4.8, y: 7.45, w: 10.5, h: 0.55,
    fontFace: 'Calibri Light', fontSize: 24, color: C.ink,
    align: 'center', margin: 0
  });
  note(slide, `
    HDBSCAN transforms the problem.
    Instead of asking whether two points are within one eps, it defines mutual reachability distance using core distances.
    The single-machine version is graph-heavy because KNN, MRD, and MST are global objects.
    The distributed implementation approximates this by building local MRD graphs and Local MSTs before driver-side merging.
  `);
}

// 10 Distributed pipeline
{
  const slide = pptx.addSlide();
  title(slide, 'Distributed HDBSCAN-inspired pipeline', 'Push local graph work to workers; merge compressed edges on the driver.', 'Algorithm', '10');
  const phases = [
    ['Phase 1', 'KD-tree partitioning\n+ ghost points', C.blue],
    ['Phase 2', 'Local MRD graph\n+ Local MST', C.green],
    ['Phase 3', 'Driver-side\nGlobal MST', C.orange],
    ['Phase 4', 'Condensed tree\n+ labels', C.purple]
  ];
  phases.forEach((p,i) => {
    const x = 1.35 + i*4.65;
    slide.addShape(pptx.ShapeType.rect, { x, y: 3.2, w: 3.35, h: 1.15, fill:{color:p[2]}, line:{color:p[2]} });
    addLabel(slide, p[0], x+0.15, 3.4, 0.9, 0.25, { size:10, color:C.white, bold:true });
    addLabel(slide, p[1], x+0.35, 3.65, 2.65, 0.5, { size:13, color:C.white, bold:true });
    const role = ['driver plans', 'worker-local', 'driver bottleneck', 'driver assigns'][i];
    addLabel(slide, role, x + 0.2, 4.62, 2.95, 0.28, { size: 10.8, color: i === 2 ? C.red : C.muted, bold: i === 2 });
    if (i<phases.length-1) addArrow(slide, x+3.55, 3.78, x+4.35, 3.78, C.ink, 1.3);
  });
  addLabel(slide, 'Design principle: keep expensive graph construction local; move only compressed connectivity evidence.', 2.6, 2.25, 14.7, 0.42, { size: 15, bold: true });
  // lower compression message
  slide.addShape(pptx.ShapeType.line, { x: 3.15, y: 6.45, w: 13.5, h: 0, line: { color: C.mid, width: 1.2 } });
  metric(slide, 'O(M²)', 'local complete graph', 4.1, 7.0, 2.4, C.red);
  addArrow(slide, 6.9, 7.42, 9.0, 7.42, C.orange, 2);
  metric(slide, 'O(M)', 'local MST skeleton', 9.25, 7.0, 2.4, C.green);
  addArrow(slide, 12.0, 7.42, 14.1, 7.42, C.orange, 2);
  metric(slide, 'N − 1', 'global MST edges', 14.3, 7.0, 2.4, C.orange);
  note(slide, `
    This is the central system design.
    Phase 2 is where the expensive local distance and graph work happens in parallel.
    The local complete graph is compressed into a Local MST before global merging.
    Phase 3 is still on the driver, which is why it becomes the bottleneck in scaling experiments.
  `);
}

// 11 Section Spark
sectionSlide(3, 'Spark Implementation', 'The implementation is a sequence of RDD transformations plus driver-side graph logic.', `
  This section turns the algorithm into Spark operations.
  The goal is to show driver-worker responsibilities and where data movement happens.
`);

// 12 System architecture
{
  const slide = pptx.addSlide();
  title(slide, 'System architecture', 'RDD pipeline with explicit driver / worker responsibilities.', 'Spark Implementation', '12');
  addLabel(slide, 'One driver coordinates; workers do partition-local graph work in parallel.', 1.0, 2.15, 12.0, 0.36, { size: 15.5, bold: true, align: 'left' });
  addLabel(slide, 'The only heavy movement is compressed connectivity evidence, not the full local MRD graph.', 1.0, 2.55, 13.6, 0.35, { size: 12.8, color: C.muted, align: 'left' });

  addLabel(slide, 'Driver setup', 1.25, 3.35, 3.2, 0.3, { size: 12.6, color: C.muted, bold: true });
  addNode(slide, 'sample data\nbuild partitions\nbroadcast rules', 1.15, 3.75, 3.3, 1.55, { fill:C.ink, line:C.ink, textColor:C.white, size:14.8 });

  addLabel(slide, 'Spark workers', 6.55, 3.35, 6.4, 0.3, { size: 12.6, color: C.muted, bold: true });
  for (let i=0; i<4; i++) {
    const x = 6.25 + (i%2)*3.2;
    const y = 3.72 + Math.floor(i/2)*1.55;
    addNode(slide, `Partition ${i+1}\nlocal MRD\nLocal MST`, x, y, 2.55, 1.05, { fill:C.white, line:C.orange, size:12.8 });
  }

  addLabel(slide, 'Driver merge', 15.1, 3.35, 3.2, 0.3, { size: 12.6, color: C.muted, bold: true });
  addNode(slide, 'collect edges\nglobal MST\nlabels', 15.0, 3.75, 3.3, 1.55, { fill:C.orange, line:C.orange, textColor:C.white, size:14.8 });

  addArrow(slide, 4.75, 4.55, 5.85, 4.55, C.orange, 1.8);
  addLabel(slide, 'broadcast rules', 4.55, 4.05, 1.6, 0.3, { size: 11.5, color:C.orange, bold:true });
  addArrow(slide, 12.15, 4.55, 14.65, 4.55, C.red, 1.8);
  addLabel(slide, 'collect Local MST edges', 12.2, 4.05, 2.4, 0.3, { size: 11.5, color:C.red, bold:true });

  slide.addShape(pptx.ShapeType.line, { x: 1.2, y: 6.85, w: 17.2, h: 0, line: { color: C.mid, width: 0.9, transparency: 35 } });
  addLabel(slide, 'RDD execution path', 1.25, 7.25, 3.2, 0.3, { size: 13.2, bold: true, align: 'left' });
  const ops = [
    ['flatMap', 'replicate ghost points', C.ink],
    ['groupByKey', 'assemble partitions', C.ink],
    ['persist + count', 'materialize timing', C.ink],
    ['collect', 'bring compressed edges', C.red],
    ['broadcast', 'send final labels', C.ink]
  ];
  ops.forEach((op,i)=> {
    const x = 1.55+i*3.45;
    addPill(slide, op[0], x, 8.0, 2.25, op[2], { h:0.5, size:11 });
    addLabel(slide, op[1], x-0.25, 8.62, 2.75, 0.35, { size: 10.8, color: C.muted });
    if (i < ops.length - 1) addArrow(slide, x + 2.38, 8.25, x + 3.1, 8.25, C.mid, 1.0);
  });
  note(slide, `
    This slide shows the Spark execution model.
    The driver samples data, builds partition rules, and later collects compressed candidate edges.
    Workers handle partition-local graph construction.
    The main RDD operations are flatMap for ghost point generation, groupByKey for local grouping, persist and count for phase timing, collect for global merge, and broadcast for label assignment.
  `);
}

// 13 Ghost points
{
  const slide = pptx.addSlide();
  title(slide, 'Soft boundary with ghost points', 'Boundary replication protects cross-partition density connectivity.', 'Spark Implementation', '13');
  addLabel(slide, 'A hard partition boundary can split one density-connected neighborhood.', 1.0, 2.15, 13.2, 0.36, { size: 15.5, bold: true, align: 'left' });
  addLabel(slide, 'Ghost points create a soft overlap band so each worker can see near-boundary neighbors.', 1.0, 2.55, 13.6, 0.35, { size: 12.8, color: C.muted, align: 'left' });

  slide.addShape(pptx.ShapeType.rect, { x: 2.0, y: 3.35, w: 14.7, h: 3.95, fill:{color:C.white, transparency: 100}, line:{color:C.mid, width:1.3} });
  slide.addShape(pptx.ShapeType.rect, { x: 8.38, y: 3.35, w: 1.95, h: 3.95, fill:{color:C.orange, transparency: 82}, line:{color:C.orange, transparency:100} });
  slide.addShape(pptx.ShapeType.line, { x: 9.35, y: 3.35, w: 0, h: 3.95, line:{color:C.orange, width:2.5} });
  addLabel(slide, 'Partition A', 4.1, 3.0, 2.0, 0.32, { size: 13, bold: true });
  addLabel(slide, 'soft overlap', 8.35, 3.0, 2.0, 0.32, { size: 12.2, color: C.orange, bold: true });
  addLabel(slide, 'Partition B', 12.5, 3.0, 2.0, 0.32, { size: 13, bold: true });

  const primaryA = [[3.1,4.25],[4.05,5.1],[5.25,4.55],[6.25,5.65],[8.55,5.0]];
  const primaryB = [[10.05,5.0],[11.2,4.28],[12.3,5.48],[13.6,4.75],[15.1,5.65]];
  primaryA.forEach(p=> slide.addShape(pptx.ShapeType.ellipse,{x:p[0],y:p[1],w:0.2,h:0.2,fill:{color:C.blue},line:{color:C.blue}}));
  primaryB.forEach(p=> slide.addShape(pptx.ShapeType.ellipse,{x:p[0],y:p[1],w:0.2,h:0.2,fill:{color:C.green},line:{color:C.green}}));
  slide.addShape(pptx.ShapeType.ellipse,{x:9.95,y:5.0,w:0.2,h:0.2,fill:{color:C.blue, transparency:45},line:{color:C.blue,width:1.2}});
  slide.addShape(pptx.ShapeType.ellipse,{x:8.55,y:5.0,w:0.2,h:0.2,fill:{color:C.green, transparency:45},line:{color:C.green,width:1.2}});
  addArrow(slide, 8.88, 5.1, 9.82, 5.1, C.orange, 2);
  addLabel(slide, 'same neighborhood,\nseen by both workers', 7.2, 5.75, 4.4, 0.6, { size: 13.2, bold: true });

  const steps = [
    ['1', 'assign primary points', C.blue],
    ['2', 'replicate boundary range', C.orange],
    ['3', 'run local DBSCAN / MRD graph', C.green]
  ];
  steps.forEach((s, i) => {
    const x = 2.0 + i * 5.2;
    slide.addShape(pptx.ShapeType.ellipse, { x, y: 8.05, w: 0.56, h: 0.56, fill:{color:s[2]}, line:{color:s[2]} });
    addLabel(slide, s[0], x, 8.23, 0.56, 0.16, { size: 10.5, color: C.white, bold: true });
    addLabel(slide, s[1], x + 0.72, 8.1, 4.0, 0.36, { size: 12.8, bold: true, align: 'left' });
  });
  addLabel(slide, 'DBSCAN uses eps; HDBSCAN-inspired uses max_dist as the overlap radius.', 3.0, 9.0, 13.8, 0.34, { size: 12.4, color:C.muted, bold:true });
  note(slide, `
    Partition boundaries are dangerous for density-based clustering.
    DBSCAN can use eps as the replication radius.
    HDBSCAN has no eps, so the project introduces max_dist as a soft boundary range.
    This helps preserve cross-partition connectivity but also creates boundary edge overhead.
  `);
}

// 14 Local MST compression
{
  const slide = pptx.addSlide();
  title(slide, 'Local MST compression', 'The local graph is dense; the tree keeps the essential skeleton.', 'Spark Implementation', '14');
  addLabel(slide, 'Each partition first builds a dense local MRD graph, then keeps only MST edges.', 1.0, 2.15, 13.6, 0.36, { size: 15.5, bold: true, align: 'left' });
  addLabel(slide, 'This is the main communication-saving step before driver-side global merging.', 1.0, 2.55, 12.5, 0.35, { size: 12.8, color: C.muted, align: 'left' });

  addLabel(slide, 'Before', 2.1, 3.35, 2.0, 0.3, { size: 12.5, color: C.muted, bold: true });
  addLabel(slide, 'local MRD graph', 2.1, 3.72, 3.4, 0.34, { size: 15, bold: true, align: 'left' });
  const leftNodes = [[2.55,4.55],[3.75,4.55],[4.95,4.55],[2.55,5.45],[3.75,5.45],[4.95,5.45],[2.55,6.35],[3.75,6.35],[4.95,6.35]];
  [[0,1],[1,2],[3,4],[4,5],[6,7],[7,8],[0,3],[3,6],[1,4],[4,7],[2,5],[5,8],[0,4],[1,5],[3,7],[4,8]].forEach(([a,b]) => {
    const p = leftNodes[a], q = leftNodes[b];
    addPlainLine(slide, p[0], p[1], q[0], q[1], C.mid, 0.8, { transparency: 32 });
  });
  leftNodes.forEach(p=> slide.addShape(pptx.ShapeType.ellipse,{x:p[0]-0.09,y:p[1]-0.09,w:0.18,h:0.18,fill:{color:C.blue},line:{color:C.white,width:0.4}}));

  slide.addShape(pptx.ShapeType.rightArrow, { x: 7.25, y: 5.0, w: 1.45, h: 0.75, fill:{color:C.orange}, line:{color:C.orange} });
  addLabel(slide, 'Kruskal\ninside partition', 6.75, 6.05, 2.5, 0.5, { size: 12.2, color:C.orange, bold:true });

  addLabel(slide, 'After', 11.0, 3.35, 2.0, 0.3, { size: 12.5, color: C.muted, bold: true });
  addLabel(slide, 'Local MST skeleton', 11.0, 3.72, 3.9, 0.34, { size: 15, bold: true, align: 'left' });
  const rightNodes = leftNodes.map(p => [p[0] + 9.15, p[1]]);
  [[0,1],[1,2],[1,4],[4,5],[4,7],[6,7],[7,8],[3,4]].forEach(([a,b]) => {
    const p = rightNodes[a], q = rightNodes[b];
    addPlainLine(slide, p[0], p[1], q[0], q[1], C.orange, 2.1);
  });
  rightNodes.forEach(p=> slide.addShape(pptx.ShapeType.ellipse,{x:p[0]-0.09,y:p[1]-0.09,w:0.18,h:0.18,fill:{color:C.blue},line:{color:C.white,width:0.4}}));

  metric(slide, 'O(M²)', 'candidate local edges', 2.45, 7.55, 2.8, C.red);
  metric(slide, 'M − 1', 'local primary edges', 11.6, 7.55, 2.8, C.green);
  addPill(slide, 'collect compressed edges only', 7.25, 8.65, 4.0, C.ink, { h: 0.52, size: 11.5 });
  note(slide, `
    This is the most important optimization.
    A complete local MRD graph can contain O(M squared) edges in one partition.
    The local MST reduces the primary-primary part to M minus one edges.
    Boundary edges are still retained separately for cross-partition connectivity.
  `);
}

// 15 Implementation summary
{
  const slide = pptx.addSlide();
  title(slide, 'Implementation map', 'Each code module owns one algorithmic responsibility.', 'Spark Implementation', '15');
  const rows = [
    ['core/partitioning.py', 'Grid + KD-tree partitioners, ghost points'],
    ['dbscan/local_dbscan.py', 'local distance matrix + BFS expansion'],
    ['dbscan/distributed.py', 'partition → local DBSCAN → Union-Find merge'],
    ['hdbscan/local_graph.py', 'core distance + MRD + Local MST'],
    ['hdbscan/distributed.py', '4-phase HDBSCAN pipeline'],
    ['hdbscan/tree_hierarchy.py', 'simplified condensation + stability labels']
  ];
  rows.forEach((r,i)=> {
    const y=2.25+i*1.05;
    slide.addShape(pptx.ShapeType.line,{x:1.7,y:y+0.72,w:16.6,h:0,line:{color:i===rows.length-1?C.bg:C.mid,width:0.8,transparency:40}});
    addLabel(slide,r[0],1.8,y,5.3,0.38,{size:13,bold:true,align:'left'});
    addLabel(slide,r[1],7.6,y,9.6,0.38,{size:12,color:C.muted,align:'left'});
  });
  addPill(slide, 'manual internals', 1.8, 9.0, 2.4, C.orange);
  addPill(slide, 'RDD-first', 4.55, 9.0, 1.7, C.ink);
  addPill(slide, 'phase timing', 6.6, 9.0, 2.0, C.ink);
  addPill(slide, 'WPS-editable shapes', 8.95, 9.0, 2.7, C.ink);
  note(slide, `
    This slide maps the implementation to the codebase.
    It helps the audience see that each part of the algorithm is implemented manually.
    The code is modular: partitioning, local DBSCAN, graph utilities, local HDBSCAN graph construction, distributed orchestration, and hierarchy extraction.
  `);
}

// 16 Section experiments
sectionSlide(4, 'Experiments + Discussion', 'The evidence tests both clustering quality and distributed scalability.', `
  This section combines the report's experimental section and discussion section.
  It covers synthetic correctness, strong scaling, data scalability, taxi real-world behavior, and the main limitations.
`);

// 17 Experiment setup
{
  const slide = pptx.addSlide();
  title(slide, 'Experimental setup', 'Four experiments, two types of evidence.', 'Experiments', '17');
  const exps = [
    ['E1', 'Synthetic quality', 'variable-density clustering'],
    ['E2', 'Strong scaling', 'cores: 1 / 2 / 4'],
    ['E3', 'Data scalability', 'N: 1k / 2k / 5k / 10k'],
    ['E4', 'NYC Taxi', 'real geographic density']
  ];
  exps.forEach((e,i)=> {
    const x = 1.4 + i*4.55;
    addNode(slide, e[0], x, 3.0, 1.0, 0.85, { fill:C.orange, line:C.orange, textColor:C.white, size:18 });
    addLabel(slide,e[1],x+1.25,3.0,2.5,0.35,{size:15,bold:true,align:'left'});
    addLabel(slide,e[2],x+1.25,3.43,2.75,0.35,{size:10.5,color:C.muted,align:'left'});
  });
  slide.addShape(pptx.ShapeType.line,{x:2.2,y:5.7,w:15.6,h:0,line:{color:C.mid,width:1.2}});
  addLabel(slide,'Visual quality',3.0,6.55,3.0,0.4,{size:18,bold:true});
  addLabel(slide,'cluster shape · noise · over-merging',2.45,7.1,4.2,0.35,{size:11,color:C.muted});
  addLabel(slide,'System scalability',13.8,6.55,3.4,0.4,{size:18,bold:true});
  addLabel(slide,'phase time · speedup · edge counts',13.15,7.1,4.4,0.35,{size:11,color:C.muted});
  note(slide, `
    The experiments are split into visual clustering quality and quantitative system scalability.
    Experiment 1 and 4 rely heavily on figures.
    Experiment 2 and 3 use phase-level timing and edge counts extracted from the plotting scripts.
  `);
}

// 18 Synthetic results three images
{
  const slide = pptx.addSlide();
  title(slide, 'Experiment 1: variable-density data', 'DBSCAN shows parameter sensitivity; HDBSCAN preserves more structure.', 'Experiments', '18');
  addImageContain(slide, 'imgs/test_data_2k_dbscan_results_eps0.3.png', 0.85, 2.0, 5.7, 4.55, { frame:true });
  addImageContain(slide, 'imgs/test_data_2k_dbscan_results_eps1.0.png', 7.15, 2.0, 5.7, 4.55, { frame:true });
  addImageContain(slide, 'imgs/test_data_2k_hdbscan_results.png', 13.45, 2.0, 5.7, 4.55, { frame:true });
  addPill(slide, '31.3% noise', 2.45, 6.9, 2.0, C.red);
  addPill(slide, '96.5% in one cluster', 8.75, 6.9, 2.7, C.red);
  addPill(slide, '42 clusters · 24.1% noise', 15.0, 6.9, 3.0, C.green);
  addLabel(slide,'small eps',2.55,7.55,1.8,0.3,{size:12,bold:true});
  addLabel(slide,'large eps',8.95,7.55,1.8,0.3,{size:12,bold:true});
  addLabel(slide,'hierarchy',15.55,7.55,1.8,0.3,{size:12,bold:true});
  note(slide, `
    The synthetic experiment demonstrates the main algorithmic argument.
    DBSCAN eps 0.3 fragments sparse clusters and creates 31.3 percent noise.
    DBSCAN eps 1.0 merges almost everything into one cluster, with 96.5 percent of points in the largest cluster.
    The HDBSCAN-inspired method preserves the main structures better, although it remains approximate.
  `);
}

// 19 Strong scaling
{
  const slide = pptx.addSlide();
  title(slide, 'Experiment 2: strong scaling', 'Parallel local work improves; driver merge does not.', 'Experiments', '19');
  addImageContain(slide, 'imgs/experiment2_strong_scaling_intel_core_i7.png', 0.9, 2.0, 8.9, 5.4, { frame:true });
  addImageContain(slide, 'imgs/experiment2_strong_scaling_apple_m1.png', 10.2, 2.0, 8.9, 5.4, { frame:true });
  metric(slide, '1.313×', 'i7 speedup at 4 cores', 3.0, 8.05, 2.7, C.orange);
  metric(slide, '1.524×', 'M1 speedup at 4 cores', 13.3, 8.05, 2.7, C.orange);
  addPill(slide, 'Amdahl bottleneck: Phase 3 Global MST', 7.2, 9.05, 5.6, C.red, { h:0.48, size:11 });
  note(slide, `
    The strong scaling experiment fixes 10k synthetic points and varies local cores.
    Phase 2, local MST construction, benefits from parallelism.
    Phase 3, global MST merging, runs on the driver and does not improve with more cores.
    The actual speedup is therefore far below ideal linear speedup.
  `);
}

// 20 Amdahl visual
{
  const slide = pptx.addSlide();
  title(slide, 'Why scaling flattens', 'The serial global merge becomes the floor under total runtime.', 'Experiments', '20');
  addLabel(slide, 'Strong scaling improves worker-local work, but cannot remove the driver-side merge floor.', 1.4, 2.1, 15.2, 0.36, { size: 15.2, bold: true, align: 'left' });
  const bars = [
    ['1 core', 9.4, 202.7, 118.8],
    ['2 cores', 6.4, 130.8, 119.9],
    ['4 cores', 4.4, 120.8, 126.7]
  ];
  const scale = 0.026;
  const startX = 4.45;
  const barH = 0.72;
  bars.forEach((b,i)=> {
    const y = 3.15 + i*1.35;
    addLabel(slide,b[0],2.3,y+0.22,1.55,0.3,{size:13.5,bold:true,align:'right'});
    let x=startX;
    const vals=[b[1],b[2],b[3]], colors=[C.blue,C.green,C.red], labs=['P1','P2','P3'];
    vals.forEach((v,j)=> {
      slide.addShape(pptx.ShapeType.rect,{x,y,w:v*scale,h:barH,fill:{color:colors[j]},line:{color:colors[j]}});
      if(v>30)addLabel(slide,`${labs[j]} ${v.toFixed(0)}s`,x+0.06,y+0.24,v*scale-0.12,0.18,{size:10.3,color:C.white,bold:true});
      x+=v*scale;
    });
  });
  addLabel(slide, 'i7 phase time breakdown on 10k points', 4.45, 2.72, 6.5, 0.3, { size: 12.5, color: C.muted, bold: true, align: 'left' });
  const p2Center = startX + 0.18 + (130.8 * scale) / 2;
  const p3Center = startX + (6.4 + 130.8) * scale + (119.9 * scale) / 2;
  addPlainLine(slide, p2Center, 6.95, p2Center, 7.58, C.green, 2);
  addPlainLine(slide, p3Center, 6.95, p3Center, 7.58, C.red, 2);
  addPill(slide, 'parallelizable worker phase', p2Center - 1.55, 7.72, 3.1, C.green, { h:0.5, size:11 });
  addPill(slide, 'serial driver phase', p3Center - 1.35, 7.72, 2.7, C.red, { h:0.5, size:11 });
  addLabel(slide,'Phase 2 drops as cores increase',p2Center - 2.0,8.45,4.0,0.35,{size:13.2,bold:true});
  addLabel(slide,'Phase 3 barely moves',p3Center - 1.7,8.45,3.4,0.35,{size:13.2,bold:true});
  addLabel(slide, 'Result: total speedup is capped even when local MST construction gets faster.', 3.4, 9.32, 13.0, 0.38, { size: 14.2, color: C.ink, bold: true });
  note(slide, `
    This slide re-expresses the i7 strong scaling data as a visual explanation.
    Phase 2 shrinks significantly from 1 to 2 cores, but Phase 3 remains almost constant.
    The serial part determines the speedup ceiling.
  `);
}

// 21 Data scalability
{
  const slide = pptx.addSlide();
  title(slide, 'Experiment 3: data scalability', 'The final MST is linear, but candidate edges still grow fast.', 'Experiments', '21');
  addImageContain(slide, 'imgs/experiment3_data_scalability_intel_core_i7.png', 0.85, 1.95, 9.3, 6.8, { frame:true });
  addImageContain(slide, 'imgs/experiment3_data_scalability_apple_m1.png', 10.45, 1.95, 8.7, 6.8, { frame:true });
  addPill(slide, '10k complete graph: 49,995,000 possible edges', 2.0, 9.35, 5.9, C.red, { h:0.46, size:10.5 });
  addPill(slide, 'Global MST: 9,999 edges', 8.3, 9.35, 3.2, C.green, { h:0.46, size:10.5 });
  addPill(slide, 'Phase 2 candidates: 24.52M', 12.0, 9.35, 3.8, C.orange, { h:0.46, size:10.5 });
  note(slide, `
    The scalability experiment fixes 4 cores and increases N from 1k to 10k.
    The final global MST has N minus one edges, which is the desired compressed structure.
    However, Phase 2 output candidate edges still reach 24.52 million at 10k because boundary edges grow.
    This explains why Phase 3 becomes expensive at larger scale.
  `);
}

// 22 Taxi 2000
{
  const slide = pptx.addSlide();
  title(slide, 'Experiment 4: NYC Taxi, n = 2,000', 'Real geography makes DBSCAN eps sensitivity visible.', 'Experiments', '22');
  addImageContain(slide, 'imgs/spark_sweep_2000.png', 0.85, 1.9, 9.1, 7.2, { frame:true });
  addImageContain(slide, 'imgs/spark_map_2000.png', 10.25, 1.9, 8.9, 7.2, { frame:true });
  addPill(slide, 'eps 0.0005: 89.0% noise', 1.1, 9.35, 3.1, C.red, { h:0.42, size:9.5 });
  addPill(slide, 'eps 0.02: 98.3% in largest cluster', 4.55, 9.35, 4.2, C.red, { h:0.42, size:9.5 });
  addPill(slide, 'HDBSCAN: many local structures', 12.35, 9.35, 3.7, C.green, { h:0.42, size:9.5 });
  note(slide, `
    Taxi 2000 shows DBSCAN's eps sensitivity in real geographic data.
    At a very small radius, almost all points are noise.
    At a very large radius, almost all points merge into one cluster.
    The HDBSCAN-inspired method avoids the largest over-merge, but it produces many small local clusters.
  `);
}

// 23 Taxi 10000 + limitation
{
  const slide = pptx.addSlide();
  title(slide, 'Taxi 10,000 reveals the approximation limit', 'The candidate graph can become a forest, not one clean MST.', 'Experiments', '23');
  addImageContain(slide, 'imgs/spark_sweep_10000.png', 0.85, 1.9, 9.4, 7.1, { frame:true });
  addLabel(slide, 'Observed limitation', 11.0, 2.0, 4.2, 0.36, { size:18, bold:true, align:'left' });
  addPill(slide, 'HDBSCAN-inspired: 9,998 / 10,000 noise', 11.0, 2.62, 5.55, C.red, { h:0.52, size:11.5 });
  addLabel(slide, 'This is a limitation of our approximation, not of HDBSCAN theory.', 11.0, 3.28, 6.6, 0.34, { size: 12.4, color: C.muted, bold: true, align: 'left' });

  addLabel(slide, 'Candidate graph after compression', 11.0, 4.05, 5.3, 0.3, { size: 13.2, bold: true, align: 'left' });
  const comps = [
    { pts: [[11.55,5.0],[12.35,4.6],[13.1,5.05],[12.25,5.55]], col: C.blue, label: 'component A' },
    { pts: [[15.0,4.65],[15.85,5.05],[16.65,4.62],[16.1,5.55]], col: C.green, label: 'component B' },
    { pts: [[13.4,6.95],[14.2,7.35],[15.0,6.95]], col: C.orange, label: 'component C' }
  ];
  comps.forEach((comp)=> {
    const pts = comp.pts;
    for(let i=0;i<pts.length-1;i++){
      const p=pts[i],q=pts[i+1];
      addPlainLine(slide, p[0], p[1], q[0], q[1], comp.col, 2.1);
    }
    pts.forEach(p=> slide.addShape(pptx.ShapeType.ellipse,{x:p[0]-0.11,y:p[1]-0.11,w:0.22,h:0.22,fill:{color:comp.col},line:{color:C.white,width:0.5}}));
  });
  addLabel(slide, 'No single-root tree', 12.15, 8.08, 4.6, 0.36, { size:16, bold:true });
  addLabel(slide, 'simplified hierarchy extraction expects one dominant connected structure', 11.05, 8.52, 6.9, 0.35, { size:11.8, color:C.muted });
  addPill(slide, 'forest → unstable labels / excessive noise', 11.55, 9.05, 5.45, C.ink, { h:0.5, size:11.2 });
  note(slide, `
    Taxi 10000 is where the limitations become visible.
    DBSCAN shows the expected density-chain over-merging at eps 0.001 and 0.002.
    The HDBSCAN-inspired implementation produces almost all noise.
    This is not a failure of HDBSCAN theory. It is a limitation of the current approximation: the global candidate graph can be disconnected, but the simplified hierarchy extraction mainly assumes a single-root tree.
  `);
}

// 24 Discussion summary
{
  const slide = pptx.addSlide();
  title(slide, 'What the experiments say', 'The design works, but the bottlenecks are visible.', 'Experiments', '24');
  const rows = [
    ['Algorithm', 'HDBSCAN-style hierarchy handles variable density better than fixed eps.'],
    ['Parallelism', 'Local MRD + MST construction benefits from more cores.'],
    ['Bottleneck', 'Driver-side Global MST limits strong scaling.'],
    ['Boundary cost', 'max_dist controls connectivity but can inflate candidate edges.'],
    ['Approximation', 'Local KNN + forest cases limit real-data robustness.']
  ];
  rows.forEach((r,i)=> {
    const y=2.35+i*1.25;
    slide.addShape(pptx.ShapeType.ellipse,{x:2.0,y:y+0.05,w:0.22,h:0.22,fill:{color:i<2?C.green:(i===2?C.red:C.orange)},line:{color:C.bg,width:0.4}});
    addLabel(slide,r[0],2.45,y,2.4,0.35,{size:15,bold:true,align:'left'});
    addLabel(slide,r[1],5.05,y,10.4,0.35,{size:13,color:C.muted,align:'left'});
  });
  note(slide, `
    This slide folds the report's discussion and limitations into the experiment section.
    The message is balanced: the design is meaningful and works on synthetic data, but the system bottlenecks are visible.
    This is important for a deep project because it shows both implementation and system-level understanding.
  `);
}

// 25 Section conclusion
sectionSlide(5, 'Conclusion', 'The project turns density clustering into a distributed graph-compression pipeline.', `
  This final section summarizes what was implemented, what the experiments proved, and the main takeaway.
`);

// 26 Final takeaway
{
  const slide = pptx.addSlide();
  title(slide, 'Final takeaway', 'A distributed HDBSCAN-style system is feasible when graph work is compressed early.', 'Conclusion', '26');
  addNode(slide, 'Implemented from scratch', 1.6, 3.0, 4.0, 1.0, { fill:C.orange, line:C.orange, textColor:C.white, size:16 });
  addNode(slide, 'Local MST compression', 8.0, 3.0, 4.0, 1.0, { fill:C.green, line:C.green, textColor:C.white, size:16 });
  addNode(slide, 'Scalability diagnosis', 14.4, 3.0, 4.0, 1.0, { fill:C.ink, line:C.ink, textColor:C.white, size:16 });
  addArrow(slide,5.85,3.5,7.65,3.5,C.orange,1.8);
  addArrow(slide,12.25,3.5,14.05,3.5,C.orange,1.8);
  slide.addText('DBSCAN baseline + HDBSCAN-inspired pipeline', { x:1.75, y:4.45, w:3.7, h:0.45, fontFace:'Calibri', fontSize:11, color:C.muted, align:'center', margin:0 });
  slide.addText('O(M²) local graph → MST skeleton', { x:8.15, y:4.45, w:3.7, h:0.45, fontFace:'Calibri', fontSize:11, color:C.muted, align:'center', margin:0 });
  slide.addText('Amdahl + boundary-edge bottlenecks', { x:14.55, y:4.45, w:3.7, h:0.45, fontFace:'Calibri', fontSize:11, color:C.muted, align:'center', margin:0 });
  slide.addShape(pptx.ShapeType.line,{x:3.0,y:7.2,w:14.0,h:0,line:{color:C.mid,width:1.2}});
  slide.addText('Main contribution', { x:2.9, y:7.65, w:3.0, h:0.4, fontFace:'Calibri', fontSize:14, bold:true, color:C.ink, margin:0 });
  slide.addText('Mapping HDBSCAN’s MRD + MST + hierarchy logic into a Spark/MapReduce-style execution plan.', {
    x:5.5, y:7.6, w:10.9, h:0.55, fontFace:'Calibri Light', fontSize:18, color:C.ink, margin:0, fit:'shrink'
  });
  note(slide, `
    The conclusion should be balanced.
    The implementation is meaningful because it maps a graph-heavy clustering algorithm into a distributed pipeline.
    Local MST compression is the central contribution.
    The experiments show both success and limitations: good synthetic behavior, interpretable scaling, and clear bottlenecks in global merging and boundary approximation.
  `);
}

// 27 Q&A
{
  const slide = pptx.addSlide();
  addBg(slide);
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.95, h: H, fill: { color: C.orange }, line: { color: C.orange } });
  slide.addText('Q&A', { x:1.6, y:3.35, w:5.0, h:1.2, fontFace:'Calibri Light', fontSize:60, color:C.ink, margin:0 });
  slide.addText('Distributed clustering · graph compression · Spark bottlenecks', { x:1.7, y:4.7, w:9.0, h:0.4, fontFace:'Calibri', fontSize:15, color:C.muted, margin:0 });
  // small aligned motif, matching the cover but quieter.
  const pts = [[13.1,4.2],[14.5,4.2],[15.9,4.2],[14.5,5.55],[15.9,5.55],[14.5,6.9]];
  [[0,1],[1,2],[1,3],[2,4],[3,5]].forEach(([a,b],i)=> {
    const p=pts[a],q=pts[b];
    addPlainLine(slide, p[0], p[1], q[0], q[1], i === 1 ? C.orange : (i % 2 ? C.mid : C.orange), i % 2 ? 1.4 : 2.1, { transparency: i % 2 ? 22 : 0 });
  });
  pts.forEach((p,i)=> slide.addShape(pptx.ShapeType.ellipse,{x:p[0]-0.11,y:p[1]-0.11,w:0.22,h:0.22,fill:{color:i%2?C.ink:C.orange},line:{color:C.bg,width:0.5}}));
  note(slide, `
    End by inviting questions.
    Good likely questions include: why not use MLlib, why HDBSCAN is approximate, why Phase 3 is the bottleneck, and what caused the taxi 10000 all-noise result.
  `);
}

async function main() {
  await pptx.writeFile({ fileName: OUT });
  console.log(`Wrote ${OUT}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
