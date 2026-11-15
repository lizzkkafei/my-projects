/* 理音 Liyin Studio · 五线谱渲染模块
 * ------------------------------------------------------------
 * 独立、零依赖、纯 Canvas 2D，挂到 window.Notation。
 * 只负责计算版面与绘制：不读写页面其它部分、不做动画、不注册定时器。
 *
 *   var size = Notation.measure(doc, { width: 900 });
 *   var info = Notation.render(canvas, doc, { width: 900, highlightBar: 12 });
 *
 * 版式：高音谱表在上、低音谱表在下，左侧依次为小节号、大谱表竖线、
 * 谱号、调号、拍号；右侧为可横向滚动的小节，每行 N 小节自动换行。
 * ------------------------------------------------------------
 */
(function (global) {
  "use strict";

  var VERSION = "1.0.0";

  /* ============================================================
   * 一、配色与字体
   * ========================================================== */

  var COLORS = {
    background: "#1a1b1f",
    staff: "#c9c7c0",          // 五线、谱号、小节线
    stem: "#c9c7c0",           // 符干、符尾、符杠、休止符
    notehead: "#e8e6e0",       // 符头
    chord: "#8fd8d2",          // 和弦符号
    chordActive: "#e5b566",
    section: "#8b8a90",        // 段落名
    barNumber: "#77767d",
    title: "#e8e6e0",
    subtitle: "#8b8a90",
    staffLine: "rgba(201, 199, 192, 0.78)",
    sectionRule: "rgba(139, 138, 144, 0.4)",
    highlightFill: "rgba(217, 160, 74, 0.16)",
    highlightEdge: "rgba(217, 160, 74, 0.62)"
  };

  var SANS =
    '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif';
  var SERIF =
    '"Times New Roman", Georgia, "Songti SC", "SimSun", serif';
  var MUSIC_FONT =
    '"Bravura", "Noto Music", "Apple Symbols", "Segoe UI Symbol", "Arial Unicode MS", "DejaVu Sans", serif';

  /* ============================================================
   * 二、通用小工具
   * ========================================================== */

  function num(v, d) {
    var n = typeof v === "number" ? v : parseFloat(v);
    return isFinite(n) ? n : d;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function setFont(ctx, size, weight, family) {
    ctx.font = (weight ? weight + " " : "") + Math.max(1, size).toFixed(2) + "px " + family;
  }

  // 兼容不支持 ctx.ellipse 的旧环境
  function ellipsePath(ctx, x, y, rx, ry, rot) {
    if (typeof ctx.ellipse === "function") {
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
      return;
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(rx, ry);
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.restore();
  }

  /* ============================================================
   * 三、音高换算
   * ------------------------------------------------------------
   * 五线谱纵向以「级」为单位：相邻两条线相差 2 级，
   * 线与相邻的间相差 1 级。级数 0 = 谱表最下面一条线。
   *   高音谱表：最下线 E4，中线 B4（4 级），上加一线 A5（10 级）
   *   低音谱表：最下线 G2，中线 D3（4 级），上加一线 C4（10 级）
   * ========================================================== */

  var LETTER_ORDER = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

  // 调号书写顺序
  var SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "B"];
  var FLAT_ORDER = ["B", "E", "A", "D", "G", "C", "F"];

  // 调号里每个升降号落在哪一级（高音谱表 / 低音谱表）
  var TREBLE_SHARP_STEPS = [8, 5, 9, 6, 3, 7, 4];
  var TREBLE_FLAT_STEPS = [4, 7, 3, 6, 2, 5, 1];
  var BASS_SHARP_STEPS = [6, 3, 7, 4, 1, 5, 2];
  var BASS_FLAT_STEPS = [2, 5, 1, 4, 0, 3, -1];

  // 十二个半音的不同拼写（升号体系 / 降号体系）
  var SHARP_SPELL = [
    ["C", 0], ["C", 1], ["D", 0], ["D", 1], ["E", 0], ["F", 0],
    ["F", 1], ["G", 0], ["G", 1], ["A", 0], ["A", 1], ["B", 0]
  ];
  var FLAT_SPELL = [
    ["C", 0], ["D", -1], ["D", 0], ["E", -1], ["E", 0], ["F", 0],
    ["G", -1], ["G", 0], ["A", -1], ["A", 0], ["B", -1], ["B", 0]
  ];

  var STAFF_BASE = { treble: 37, bass: 25 }; // E4 / G2 的自然音级编号

  function diatonicIndex(letter, octave) {
    return LETTER_ORDER[letter] + (octave + 1) * 7;
  }

  /**
   * MIDI 音高 -> 音名 / 升降 / 八度。
   * @param {number} pitch
   * @param {boolean} preferFlat 黑键优先写成降号
   */
  function spellPitch(pitch, preferFlat) {
    var p = Math.round(num(pitch, 60));
    var octave = Math.floor(p / 12) - 1;
    var pc = ((p % 12) + 12) % 12;
    var entry = (preferFlat ? FLAT_SPELL : SHARP_SPELL)[pc];
    return { letter: entry[0], accidental: entry[1], octave: octave, pitchClass: pc };
  }

  /**
   * 音高 -> 五线谱级数（相对谱表底线，每级 = 半个行距）。
   * 高音谱表 E4 = 0、C4 = -2、A4 = 5、B4 = 4、F5 = 8；
   * 低音谱表 G2 = 0、C3 = 3、C4 = 10。
   * 升降号不改变纵向位置。
   * @param {number} pitch MIDI 音高（60 = C4）
   * @param {string} clef "treble" | "bass"
   * @returns {number}
   */
  function pitchToStaffStep(pitch, clef) {
    var info = spellPitch(pitch, false);
    var base = clef === "bass" ? STAFF_BASE.bass : STAFF_BASE.treble;
    return diatonicIndex(info.letter, info.octave) - base;
  }

  /**
   * 解析调号，返回每个音名应有的升降，以及书写顺序信息。
   */
  function keyInfo(doc) {
    var ks = (doc && doc.keySignature) || {};
    var sharps = clamp(Math.floor(num(ks.sharps, 0)), 0, 7);
    var flats = clamp(Math.floor(num(ks.flats, 0)), 0, 7);
    if (sharps > 0) flats = 0;
    var map = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
    var i;
    if (sharps > 0) for (i = 0; i < sharps; i++) map[SHARP_ORDER[i]] = 1;
    if (flats > 0) for (i = 0; i < flats; i++) map[FLAT_ORDER[i]] = -1;
    return {
      sharps: sharps,
      flats: flats,
      count: sharps > 0 ? sharps : flats,
      preferFlat: flats > 0,
      letters: map
    };
  }

  /**
   * 该音相对调号是否需要临时记号。
   * @returns {number|string} 0 表示不需要，否则 "sharp" / "flat" / "natural"
   */
  function accidentalFor(pitch, key) {
    var info = spellPitch(pitch, key.preferFlat);
    var want = key.letters[info.letter] || 0;
    if (info.accidental === want) return 0;
    if (info.accidental === 0) return "natural";
    return info.accidental > 0 ? "sharp" : "flat";
  }

  /* ============================================================
   * 四、选项归一化
   * ========================================================== */

  var DEFAULTS = {
    width: 900,
    scale: 1,
    lineSpace: 8,
    showChords: true,
    showSections: true,
    showBarNumbers: true,
    highlightBar: 0,
    staffGap: 46,
    systemGap: 26,
    background: COLORS.background,
    dpr: 0,            // 0 = 自动取 devicePixelRatio
    barsPerSystem: 0,  // 0 = 自动
    clefMode: "auto"   // auto | glyph | vector
  };

  function resolveOpts(opts) {
    var o = {};
    var k;
    for (k in DEFAULTS) {
      if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) o[k] = DEFAULTS[k];
    }
    if (opts && typeof opts === "object") {
      for (k in opts) {
        if (Object.prototype.hasOwnProperty.call(opts, k) && opts[k] !== undefined) o[k] = opts[k];
      }
    }

    o.scale = clamp(num(o.scale, 1), 0.4, 4);
    o.width = Math.max(320, num(o.width, 900));
    o.lineSpace = clamp(num(o.lineSpace, 8), 5, 26) * o.scale;
    o.staffGap = clamp(num(o.staffGap, 46), 18, 160) * o.scale;
    o.systemGap = clamp(num(o.systemGap, 26), 6, 120) * o.scale;
    o.highlightBar = Math.max(0, Math.floor(num(o.highlightBar, 0)));
    o.barsPerSystem = Math.max(0, Math.floor(num(o.barsPerSystem, 0)));
    o.showChords = o.showChords !== false;
    o.showSections = o.showSections !== false;
    o.showBarNumbers = o.showBarNumbers !== false;
    return o;
  }

  /* ============================================================
   * 五、版面计算（measure 与 render 共用，保证高度一致）
   * ========================================================== */

  function computeLayout(doc, opts) {
    var o = resolveOpts(opts);
    var d = doc || {};
    var s = o.scale;
    var space = o.lineSpace;
    // 兼容把 per-system 小节数放在 doc 上的调用方式
    if (!o.barsPerSystem && d.barsPerSystem) {
      o.barsPerSystem = Math.max(0, Math.floor(num(d.barsPerSystem, 0)));
    }

    // 拍号
    var tsArr = d.timeSignature;
    if (typeof tsArr === "string") tsArr = tsArr.split("/");
    if (!Array.isArray(tsArr)) tsArr = [4, 4];
    var tsTop = clamp(Math.round(num(tsArr[0], 4)), 1, 32);
    var tsBot = clamp(Math.round(num(tsArr[1], 4)), 1, 32);
    var beatsPerBar = (tsTop * 4) / tsBot; // 一律换算成四分音符拍数

    var chordsArr = Array.isArray(d.chords) ? d.chords : [];
    var totalBars = Math.max(1, Math.floor(num(d.bars, chordsArr.length || 1)));

    var key = keyInfo(d);

    // —— 左侧宽度 ——
    var padLeft = 10 * s;
    var barNumW = o.showBarNumbers ? 20 * s : 0;
    var systemLeft = padLeft + barNumW;   // 大谱表竖线 / 五线起点
    var clefX = systemLeft + 7 * s;
    var clefW = 4.9 * space;
    var keyX = clefX + clefW;
    // 升降号之间约 0.95 行距，太挤会粘在一起
    var keyW = key.count > 0 ? key.count * 0.95 * space + 2 * s : 0;
    var timeX = keyX + keyW + (key.count > 0 ? 2 * s : 0);
    var timeW = 2.0 * space;
    var barsX = timeX + timeW + 9 * s;
    var rightPad = 14 * s;

    var width = Math.max(320, num(o.width, 900));
    var usable = Math.max(60, width - barsX - rightPad);

    // —— 每行小节数：优先 8 或 4，且一小节不能窄到音符互相压住 ——
    // 先看每小节里相邻音符的最小起拍间隔，换算出「最密的一小节要几个位置」，
    // 再乘以每个位置至少需要的宽度，得到一小节的最小宽度。
    var minGapBeats = beatsPerBar;
    var tracksForDensity = Array.isArray(d.tracks) ? d.tracks : [];
    tracksForDensity.forEach(function (t) {
      if (!t || !Array.isArray(t.notes)) return;
      var startsByBar = {};
      t.notes.forEach(function (nt) {
        if (!nt || typeof nt.pitch !== "number" || !isFinite(nt.pitch)) return;
        var st = num(nt.start, 0);
        var b = Math.floor(st / beatsPerBar + 1e-9);
        (startsByBar[b] || (startsByBar[b] = [])).push(st - b * beatsPerBar);
      });
      for (var bk in startsByBar) {
        var arr = startsByBar[bk].slice().sort(function (a, b) { return a - b; });
        for (var i2 = 1; i2 < arr.length; i2++) {
          var gap = arr[i2] - arr[i2 - 1];
          if (gap > 1e-4 && gap < minGapBeats) minGapBeats = gap;
        }
      }
    });
    var slots = Math.max(4, Math.min(24, Math.round(beatsPerBar / Math.max(0.125, minGapBeats))));
    // 每个位置至少 1.35 个行距，一小节再怎么也要 13 个行距
    var minBar = Math.max(13 * space, slots * 1.35 * space);

    var bps = o.barsPerSystem;
    if (bps <= 0) {
      var fit = Math.floor(usable / minBar);
      bps = fit >= 8 ? 8 : fit >= 4 ? 4 : Math.max(1, fit);
    }
    bps = clamp(bps, 1, 16);
    var barW = usable / bps;
    var systems = Math.ceil(totalBars / bps);

    // —— 纵向尺寸 ——
    var above = 22 * s + (o.showChords ? 19 * s : 0) + (o.showSections ? 17 * s : 0);
    var below = 26 * s;
    var staffH = 4 * space;
    var rowH = above + staffH + o.staffGap + staffH + below + o.systemGap;

    var hasHeader = !!(d.title || d.subtitle);
    var headerH = hasHeader ? 54 * s : 14 * s;
    var height = Math.round(headerH + systems * rowH - o.systemGap + 10 * s);

    var rows = [];
    for (var i = 0; i < systems; i++) {
      var top = headerH + i * rowH;
      var staff1Top = top + above;
      var staff1Bottom = staff1Top + staffH;
      var staff2Top = staff1Bottom + o.staffGap;
      var staff2Bottom = staff2Top + staffH;
      rows.push({
        index: i,
        startBar: i * bps,                                // 0 起
        count: Math.min(bps, totalBars - i * bps),
        top: top,
        staff1Top: staff1Top,
        staff1Bottom: staff1Bottom,
        staff2Top: staff2Top,
        staff2Bottom: staff2Bottom,
        chordY: staff1Top - 24 * s,                       // 和弦符号基线
        sectionY: staff1Top - (o.showChords ? 45 * s : 26 * s) // 段落名基线
      });
    }

    return {
      o: o,
      doc: d,
      s: s,
      space: space,
      width: width,
      height: height,
      systems: systems,
      barsPerSystem: bps,
      totalBars: totalBars,
      beatsPerBar: beatsPerBar,
      tsTop: tsTop,
      tsBot: tsBot,
      key: key,
      headerH: headerH,
      hasHeader: hasHeader,
      rows: rows,
      padLeft: padLeft,
      systemLeft: systemLeft,
      clefX: clefX,
      keyX: keyX,
      timeX: timeX,
      timeW: timeW,
      barsX: barsX,
      barW: barW,
      rightPad: rightPad,
      clefW: clefW,
      above: above,
      below: below,
      staffH: staffH,
      rowH: rowH
    };
  }

  /* ============================================================
   * 六、谱号字形（字体可用就用字体，否则用矢量造型）
   * ========================================================== */

  /*
   * 字体给不出可靠的字形边界，所以把谱号先在离屏画布上画一次，
   * 逐像素扫出真实墨迹范围，再据此缩放到目标高度。
   * 这样无论系统里是 Bravura 还是 Apple Symbols，谱号都能对准五线。
   */
  var GLYPH_PROBE_SIZE = 220;
  var inkCache = {};
  var inkCanvas = null;

  function measureGlyphInk(ch, family) {
    var cacheKey = ch + "|" + family;
    if (inkCache[cacheKey]) return inkCache[cacheKey];
    var result = null;
    try {
      if (!inkCanvas) {
        inkCanvas = document.createElement("canvas");
        inkCanvas.width = 360;
        inkCanvas.height = 360;
      }
      var c = inkCanvas.getContext("2d");
      var W = inkCanvas.width;
      var H = inkCanvas.height;
      var baseY = 250;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, W, H);
      c.font = GLYPH_PROBE_SIZE + "px " + family;
      c.fillStyle = "#fff";
      c.textAlign = "left";
      c.textBaseline = "alphabetic";
      c.fillText(ch, 40, baseY);
      var data = c.getImageData(0, 0, W, H).data;
      var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9, count = 0;
      for (var y = 0; y < H; y++) {
        var row = y * W * 4;
        for (var x = 0; x < W; x++) {
          if (data[row + x * 4 + 3] > 24) {
            count++;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (count > 20) {
        result = {
          size: GLYPH_PROBE_SIZE,
          left: minX - 40,          // 相对写入点
          top: minY - baseY,        // 相对基线（负）
          bottom: maxY - baseY,
          width: maxX - minX + 1,
          height: maxY - minY + 1,
          area: count
        };
      }
    } catch (e) {
      result = null; // 画布被污染或环境不支持时退回矢量谱号
    }
    inkCache[cacheKey] = result;
    return result;
  }

  /**
   * 用音乐字体画谱号：墨迹上沿对准 topY，按 targetHeight 等比缩放。
   * @returns {boolean} 是否绘制成功
   */
  function drawClefGlyph(ctx, ch, x, topY, targetHeight, color, maxWidth) {
    var ink = measureGlyphInk(ch, MUSIC_FONT);
    // 墨迹范围不可用，或宽高比明显是缺字的豆腐块时，视为失败
    if (!ink || ink.height < 8) return false;
    if (ink.width / ink.height > 0.95) return false; // 真谱号又窄又高
    var k = targetHeight / ink.height;
    // 宽度超预算时等比缩小，宁可矮一点也不能压到后面的调号、拍号
    if (maxWidth && ink.width * k > maxWidth) k = maxWidth / ink.width;
    var fs = GLYPH_PROBE_SIZE * k;
    var baseline = topY - ink.top * k;
    var drawX = x - ink.left * k;
    ctx.save();
    ctx.fillStyle = color;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    setFont(ctx, fs, "", MUSIC_FONT);
    ctx.fillText(ch, drawX, baseline);
    ctx.restore();
    return true;
  }

  // 风格化的高音谱号：螺旋中心落在 G 线（自下而上第 2 线）
  function drawTrebleClefVector(ctx, x, staffTop, space) {
    var u = space;
    var g = staffTop + 3 * u;
    ctx.save();
    ctx.strokeStyle = COLORS.staff;
    ctx.fillStyle = COLORS.staff;
    ctx.lineWidth = Math.max(1.4, 0.28 * u);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // 自下而上的主体曲线
    ctx.beginPath();
    ctx.moveTo(x + 0.45 * u, g + 3.55 * u);
    ctx.bezierCurveTo(x + 0.1 * u, g + 3.75 * u, x + 0.15 * u, g + 4.25 * u, x + 0.6 * u, g + 4.15 * u);
    ctx.bezierCurveTo(x + 1.3 * u, g + 4.0 * u, x + 1.25 * u, g + 3.2 * u, x + 1.0 * u, g + 2.35 * u);
    ctx.bezierCurveTo(x + 0.75 * u, g + 1.5 * u, x + 0.35 * u, g + 0.4 * u, x + 0.35 * u, g - 0.55 * u);
    ctx.bezierCurveTo(x + 0.35 * u, g - 1.6 * u, x + 0.95 * u, g - 2.3 * u, x + 1.55 * u, g - 1.95 * u);
    ctx.bezierCurveTo(x + 2.15 * u, g - 1.6 * u, x + 1.95 * u, g - 0.75 * u, x + 1.25 * u, g - 0.45 * u);
    ctx.bezierCurveTo(x + 0.55 * u, g - 0.15 * u, x + 0.35 * u, g + 0.9 * u, x + 0.85 * u, g + 1.75 * u);
    ctx.bezierCurveTo(x + 1.35 * u, g + 2.6 * u, x + 2.0 * u, g + 3.5 * u, x + 1.55 * u, g + 4.1 * u);
    ctx.bezierCurveTo(x + 1.15 * u, g + 4.6 * u, x + 0.55 * u, g + 4.35 * u, x + 0.55 * u, g + 3.85 * u);
    ctx.stroke();
    ctx.restore();
  }

  // 风格化的低音谱号：大头贴在 F 线（自下而上第 4 线）
  function drawBassClefVector(ctx, x, staffTop, space) {
    var u = space;
    var f = staffTop + u;
    ctx.save();
    ctx.strokeStyle = COLORS.staff;
    ctx.fillStyle = COLORS.staff;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.arc(x + 0.85 * u, f - 0.12 * u, 0.42 * u, 0, Math.PI * 2);
    ctx.fill();

    ctx.lineWidth = Math.max(1.6, 0.4 * u);
    ctx.beginPath();
    ctx.moveTo(x + 1.2 * u, f - 0.35 * u);
    ctx.bezierCurveTo(x + 2.45 * u, f - 1.05 * u, x + 2.15 * u, f + 1.75 * u, x + 0.75 * u, f + 2.0 * u);
    ctx.bezierCurveTo(x + 0.05 * u, f + 2.15 * u, x + 0.05 * u, f + 1.35 * u, x + 0.55 * u, f + 1.45 * u);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x + 2.3 * u, f - 0.95 * u, 0.18 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + 2.3 * u, f + 0.95 * u, 0.18 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawClef(ctx, clef, x, staffTop, lay) {
    var space = lay.space;
    var mode = lay.o.clefMode || "auto";
    var ok = false;
    var maxW = Math.max(2.2 * space, lay.clefW - 2 * lay.s);
    if (mode !== "vector") {
      ok =
        clef === "bass"
          ? // 低音谱号：上沿在顶线上方 0.55 个行距
            drawClefGlyph(
              ctx, "\uD834\uDD22", x, staffTop - 0.55 * space, 5.4 * space, COLORS.staff, maxW
            )
          : // 高音谱号：上沿在顶线上方 1.7 个行距
            drawClefGlyph(
              ctx, "\uD834\uDD1E", x, staffTop - 1.7 * space, 7.8 * space, COLORS.staff, maxW
            );
    }
    if (ok) return;
    if (clef === "bass") drawBassClefVector(ctx, x, staffTop, space);
    else drawTrebleClefVector(ctx, x, staffTop, space);
  }

  /* ============================================================
   * 七、升降号 / 还原号
   * ========================================================== */

  function drawSharp(ctx, x, y, space) {
    var u = space;
    var h = 1.4 * u;
    var w = 0.42 * u;
    ctx.save();
    ctx.strokeStyle = COLORS.notehead;
    ctx.lineCap = "butt";
    ctx.lineWidth = Math.max(1, 0.12 * u);
    ctx.beginPath();
    ctx.moveTo(x - w * 0.42, y - h * 0.5);
    ctx.lineTo(x - w * 0.42, y + h * 0.5);
    ctx.moveTo(x + w * 0.42, y - h * 0.5);
    ctx.lineTo(x + w * 0.42, y + h * 0.5);
    ctx.stroke();
    ctx.lineWidth = Math.max(1.1, 0.2 * u);
    ctx.beginPath();
    ctx.moveTo(x - w, y - h * 0.14);
    ctx.lineTo(x + w, y - h * 0.24);
    ctx.moveTo(x - w, y + h * 0.24);
    ctx.lineTo(x + w, y + h * 0.14);
    ctx.stroke();
    ctx.restore();
  }

  function drawFlat(ctx, x, y, space) {
    var u = space;
    var h = 1.45 * u;
    ctx.save();
    ctx.strokeStyle = COLORS.notehead;
    ctx.fillStyle = COLORS.notehead;
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(1, 0.13 * u);
    ctx.beginPath();
    ctx.moveTo(x - 0.1 * u, y - h * 0.52);
    ctx.lineTo(x - 0.1 * u, y + h * 0.48);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 0.08 * u, y + h * 0.0);
    ctx.bezierCurveTo(x + 0.5 * u, y - h * 0.1, x + 0.56 * u, y + h * 0.4, x - 0.08 * u, y + h * 0.48);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawNatural(ctx, x, y, space) {
    var u = space;
    var h = 1.3 * u;
    ctx.save();
    ctx.strokeStyle = COLORS.notehead;
    ctx.lineCap = "butt";
    ctx.lineWidth = Math.max(1, 0.11 * u);
    ctx.beginPath();
    ctx.moveTo(x - 0.18 * u, y - h * 0.48);
    ctx.lineTo(x - 0.18 * u, y + h * 0.32);
    ctx.moveTo(x + 0.18 * u, y - h * 0.32);
    ctx.lineTo(x + 0.18 * u, y + h * 0.48);
    ctx.stroke();
    ctx.lineWidth = Math.max(1, 0.14 * u);
    ctx.beginPath();
    ctx.moveTo(x - 0.18 * u, y - h * 0.05);
    ctx.lineTo(x + 0.18 * u, y - h * 0.15);
    ctx.moveTo(x - 0.18 * u, y + h * 0.15);
    ctx.lineTo(x + 0.18 * u, y + h * 0.05);
    ctx.stroke();
    ctx.restore();
  }

  function drawAccidental(ctx, kind, x, y, space) {
    if (kind === "sharp") drawSharp(ctx, x, y, space);
    else if (kind === "flat") drawFlat(ctx, x, y, space);
    else if (kind === "natural") drawNatural(ctx, x, y, space);
  }

  /* ============================================================
   * 八、谱表构件
   * ========================================================== */

  function drawStaffLines(ctx, lay, row) {
    var space = lay.space;
    var x0 = lay.systemLeft;
    var x1 = lay.barsX + lay.barW * row.count;
    ctx.save();
    ctx.strokeStyle = COLORS.staffLine;
    ctx.lineWidth = Math.max(1, 0.11 * space);
    ctx.beginPath();
    for (var i = 0; i < 5; i++) {
      ctx.moveTo(x0, row.staff1Top + i * space);
      ctx.lineTo(x1, row.staff1Top + i * space);
      ctx.moveTo(x0, row.staff2Top + i * space);
      ctx.lineTo(x1, row.staff2Top + i * space);
    }
    ctx.stroke();
    ctx.restore();
  }

  // 大谱表括线：一条贯穿两组谱表的竖线，两端略微探出
  function drawBrace(ctx, lay, row) {
    var x = lay.systemLeft;
    var top = row.staff1Top;
    var bottom = row.staff2Bottom;
    ctx.save();
    ctx.strokeStyle = COLORS.staff;
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(1.6, 0.22 * lay.space);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    // 上下两个小耳朵，强化「括起来」的感觉
    ctx.lineWidth = Math.max(1.2, 0.14 * lay.space);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x + 3.5, top);
    ctx.moveTo(x, bottom);
    ctx.lineTo(x + 3.5, bottom);
    ctx.stroke();
    ctx.restore();
  }

  function drawBarlines(ctx, lay, row) {
    var space = lay.space;
    var top = row.staff1Top;
    var bottom = row.staff2Bottom;
    var total = lay.totalBars;
    ctx.save();
    ctx.strokeStyle = COLORS.staff;
    for (var i = 0; i <= row.count; i++) {
      var barNo = row.startBar + i + 1; // 该线右侧小节号（1 起）
      var x = lay.barsX + i * lay.barW;
      var isLast = row.startBar + row.count === total && i === row.count;
      if (isLast) {
        ctx.lineWidth = Math.max(1, 0.12 * space);
        ctx.beginPath();
        ctx.moveTo(x - 0.4 * space, top);
        ctx.lineTo(x - 0.4 * space, bottom);
        ctx.stroke();
        ctx.lineWidth = Math.max(2, 0.4 * space);
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.stroke();
      } else {
        var thick = barNo > 1 && (barNo - 1) % 4 === 0;
        ctx.lineWidth = thick ? Math.max(1.4, 0.2 * space) : Math.max(1, 0.11 * space);
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawKeySignature(ctx, lay, row) {
    var key = lay.key;
    if (key.count <= 0) return;
    var space = lay.space;
    var useSharp = key.sharps > 0;
    var tSteps = useSharp ? TREBLE_SHARP_STEPS : TREBLE_FLAT_STEPS;
    var bSteps = useSharp ? BASS_SHARP_STEPS : BASS_FLAT_STEPS;
    var x = lay.keyX + space * 0.55;
    for (var i = 0; i < key.count; i++) {
      var cx = x + i * 0.95 * space;
      var ty = row.staff1Bottom - tSteps[i] * (space / 2);
      var by = row.staff2Bottom - bSteps[i] * (space / 2);
      drawAccidental(ctx, useSharp ? "sharp" : "flat", cx, ty, space);
      drawAccidental(ctx, useSharp ? "sharp" : "flat", cx, by, space);
    }
  }

  function drawTimeSignature(ctx, lay, row) {
    var space = lay.space;
    var cx = lay.timeX + lay.timeW / 2;
    var size = Math.max(9, 2.3 * space);
    ctx.save();
    ctx.fillStyle = COLORS.staff;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    setFont(ctx, size, "600", SERIF);
    ctx.fillText(String(lay.tsTop), cx, row.staff1Top + 1.15 * space);
    ctx.fillText(String(lay.tsBot), cx, row.staff1Top + 2.9 * space);
    ctx.fillText(String(lay.tsTop), cx, row.staff2Top + 1.15 * space);
    ctx.fillText(String(lay.tsBot), cx, row.staff2Top + 2.9 * space);
    ctx.restore();
  }

  /* ============================================================
   * 九、标题 / 段落 / 和弦 / 小节号 / 高亮
   * ========================================================== */

  function drawHeader(ctx, lay) {
    var d = lay.doc;
    if (!lay.hasHeader) return;
    var s = lay.s;
    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    if (d.title) {
      ctx.fillStyle = COLORS.title;
      setFont(ctx, 18 * s, "600", SANS);
      ctx.fillText(String(d.title), lay.padLeft + 2 * s, 24 * s);
    }
    if (d.subtitle) {
      ctx.fillStyle = COLORS.subtitle;
      setFont(ctx, 10.5 * s, "400", SANS);
      ctx.fillText(String(d.subtitle), lay.padLeft + 2 * s, 42 * s);
    }
    ctx.restore();
  }

  function drawSections(ctx, lay, row) {
    if (!lay.o.showSections) return;
    var sections = Array.isArray(lay.doc.sections) ? lay.doc.sections : [];
    if (!sections.length) return;
    var s = lay.s;
    var rowStart = row.startBar + 1;
    var rowEnd = row.startBar + row.count;
    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    setFont(ctx, 9.5 * s, "500", SANS);
    for (var i = 0; i < sections.length; i++) {
      var sec = sections[i] || {};
      var a = Math.round(num(sec.start, 1));
      var b = Math.round(num(sec.end, a));
      if (b < rowStart || a > rowEnd) continue;
      var s0 = Math.max(a, rowStart);
      var s1 = Math.min(b, rowEnd);
      var x0 = lay.barsX + (s0 - rowStart) * lay.barW;
      var x1 = lay.barsX + (s1 - rowStart + 1) * lay.barW;
      if (a >= rowStart) {
        ctx.fillStyle = COLORS.section;
        ctx.fillText(String(sec.name || ""), x0 + 3 * s, row.sectionY);
      }
      ctx.strokeStyle = COLORS.sectionRule;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0 + 1, row.sectionY + 3.5 * s);
      ctx.lineTo(x1 - 1, row.sectionY + 3.5 * s);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawChords(ctx, lay, row) {
    if (!lay.o.showChords) return;
    var chords = Array.isArray(lay.doc.chords) ? lay.doc.chords : [];
    if (!chords.length) return;
    var s = lay.s;
    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    setFont(ctx, 11 * s, "500", SANS);
    for (var i = 0; i < row.count; i++) {
      var raw = chords[row.startBar + i];
      var name = raw && typeof raw === "object" ? raw.name : raw;
      if (!name) continue;
      var active = lay.o.highlightBar === row.startBar + i + 1;
      ctx.fillStyle = active ? COLORS.chordActive : COLORS.chord;
      ctx.fillText(String(name), lay.barsX + i * lay.barW + 5 * s, row.chordY);
    }
    ctx.restore();
  }

  function drawBarNumber(ctx, lay, row) {
    if (!lay.o.showBarNumbers) return;
    var s = lay.s;
    ctx.save();
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillStyle = COLORS.barNumber;
    setFont(ctx, 9 * s, "500", SANS);
    ctx.fillText(String(row.startBar + 1), lay.systemLeft - 6 * s, row.staff1Top + 2 * lay.space);
    ctx.restore();
  }

  function drawHighlight(ctx, lay, row) {
    var bar = lay.o.highlightBar;
    if (!bar) return;
    var local = bar - 1 - row.startBar; // highlightBar 是 1 起的小节号
    if (local < 0 || local >= row.count) return;
    var x = lay.barsX + local * lay.barW;
    var top = row.top + 2 * lay.s;
    var h = row.staff2Bottom + 10 * lay.s - top;
    ctx.save();
    ctx.fillStyle = COLORS.highlightFill;
    ctx.fillRect(x, top, lay.barW, h);
    ctx.fillStyle = COLORS.highlightEdge;
    ctx.fillRect(x, top, Math.max(1.2, 0.16 * lay.space), h);
    ctx.restore();
  }

  /* ============================================================
   * 十、音符形状与时值
   * ========================================================== */

  // 时值（拍）-> 符头形状、符尾数、附点
  function noteShape(dur) {
    var d = Math.max(0.05, num(dur, 1));
    var bases = [0.125, 0.25, 0.5, 1, 2, 4, 8];
    var base = d;
    var dotted = false;
    for (var i = 0; i < bases.length; i++) {
      if (Math.abs(d - bases[i] * 1.5) < 0.02) {
        base = bases[i];
        dotted = true;
        break;
      }
    }
    var flags = base <= 0.25 ? 2 : base < 1 ? 1 : 0;
    return {
      base: base,
      dotted: dotted,
      flags: flags,
      hollow: base >= 2,
      whole: base >= 4
    };
  }

  function noteX(beatInBar, barX, barW, beatsPerBar, pad) {
    var inner = Math.max(8, barW - pad * 2);
    return barX + pad + (beatInBar / beatsPerBar) * inner;
  }

  // 加线（只画音符实际越过的线）
  function drawLedgerLines(ctx, x, y, step, space, halfW) {
    if (step >= -1 && step <= 9) return;
    var half = space / 2;
    ctx.save();
    ctx.strokeStyle = COLORS.staffLine;
    ctx.lineWidth = Math.max(1, 0.11 * space);
    ctx.beginPath();
    var s, ly;
    if (step >= 10) {
      for (s = 10; s <= step; s += 2) {
        ly = y + (step - s) * half;
        ctx.moveTo(x - halfW, ly);
        ctx.lineTo(x + halfW, ly);
      }
    } else {
      for (s = -2; s >= step; s -= 2) {
        ly = y + (step - s) * half;
        ctx.moveTo(x - halfW, ly);
        ctx.lineTo(x + halfW, ly);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  // 单个符尾（八分 1 条、十六分 2 条）
  function drawFlag(ctx, x, yEnd, dir, count, space) {
    if (!count) return;
    var u = space;
    ctx.save();
    ctx.fillStyle = COLORS.stem;
    ctx.translate(x, yEnd);
    if (dir !== "up") ctx.scale(1, -1);
    for (var i = 0; i < count; i++) {
      var off = i * 0.9 * u;
      ctx.beginPath();
      ctx.moveTo(0, off);
      ctx.bezierCurveTo(0.95 * u, off + 0.45 * u, 0.9 * u, off + 1.5 * u, 0.1 * u, off + 2.15 * u);
      ctx.bezierCurveTo(0.75 * u, off + 1.3 * u, 0.58 * u, off + 0.75 * u, 0, off + 0.58 * u);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawNotehead(ctx, n, noteW, noteH, space) {
    ctx.save();
    if (n.shape.whole) {
      ctx.strokeStyle = COLORS.notehead;
      ctx.lineWidth = Math.max(1.6, 0.24 * space);
      ellipsePath(ctx, n.x, n.y, noteW * 0.7, noteH * 0.5, -0.16);
      ctx.stroke();
    } else if (n.shape.hollow) {
      ctx.strokeStyle = COLORS.notehead;
      ctx.lineWidth = Math.max(1.8, 0.28 * space);
      ellipsePath(ctx, n.x, n.y, noteW * 0.5, noteH * 0.5, -0.34);
      ctx.stroke();
    } else {
      ctx.fillStyle = COLORS.notehead;
      ellipsePath(ctx, n.x, n.y, noteW * 0.5, noteH * 0.5, -0.34);
      ctx.fill();
    }
    ctx.restore();
  }

  // 空小节画全休止符：挂在自上而下第 2 线（第 4 线）下方
  function drawWholeRest(ctx, lay, row, clef, barX, barW) {
    var space = lay.space;
    var staffBottom = clef === "bass" ? row.staff2Bottom : row.staff1Bottom;
    var y = staffBottom - 3 * space;
    var w = 1.1 * space;
    ctx.save();
    ctx.fillStyle = COLORS.stem;
    ctx.fillRect(barX + barW / 2 - w / 2, y + 0.26 * space, w, 0.4 * space);
    ctx.restore();
  }

  /**
   * 画某一小节中某个谱表的全部音符。
   * @param {Array} items 已拆到本小节的音符（beatInBar 已换算）
   * @returns {number} 实际绘制的音符数
   */
  function drawBarNotes(ctx, lay, row, items, clef, barX, barW) {
    if (!items.length) return 0;
    var space = lay.space;
    var s = lay.s;
    var bpb = lay.beatsPerBar;
    var key = lay.key;
    var staffBottom = clef === "bass" ? row.staff2Bottom : row.staff1Bottom;

    var noteW = 1.2 * space;
    var noteH = 0.86 * space;
    var stemLen = 3.4 * space;
    var pad = Math.min(8 * s, barW * 0.09);
    var half = space / 2;

    // —— 1. 逐个换成坐标 ——
    var list = items.map(function (n) {
      var x = noteX(n.beatInBar, barX, barW, bpb, pad);
      var step = pitchToStaffStep(n.pitch, clef);
      var shape = noteShape(n.dur);
      return {
        pitch: n.pitch,
        start: n.start,
        beat: n.beatInBar,
        step: step,
        x: x,
        y: staffBottom - step * half,
        dur: n.dur,
        shape: shape,
        dir: step >= 4 ? "down" : "up",
        accidental: accidentalFor(n.pitch, key),
        stemX: 0,
        beamed: false,
        beamY: 0
      };
    });

    // —— 2. 同一时刻的音归为一个音柱（和弦 / 多轨重叠）——
    list.sort(function (a, b) {
      return a.start - b.start || b.step - a.step;
    });
    var cols = [];
    var last = null;
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (last && Math.abs(last.start - it.start) < 1e-4) {
        last.notes.push(it);
      } else {
        last = { start: it.start, beat: it.beat, x: it.x, notes: [it] };
        cols.push(last);
      }
    }
    // 先按「单音」定符干方向：中线及以上朝下
    cols.forEach(function (col) {
      var maxFlags = 0;
      col.notes.forEach(function (n) {
        if (n.shape.flags > maxFlags) maxFlags = n.shape.flags;
        n.dir = n.step >= 4 ? "down" : "up";
      });
      col.flags = maxFlags;
    });

    // 按「拍」分组（先不分方向），整组共用一个符干方向，
    // 这样同一拍里的八分/十六分音符不会一半朝上一半朝下，符杠才连得起来。
    var beatGroups = {};
    cols.forEach(function (col) {
      if (!col.flags) return;
      var beatIdx = Math.floor(col.beat + 1e-6);
      (beatGroups[beatIdx] || (beatGroups[beatIdx] = [])).push(col);
    });

    Object.keys(beatGroups).forEach(function (key) {
      var g = beatGroups[key];
      g.sort(function (a, b) { return a.x - b.x; });
      // 跨得越宽越倾向于朝下，避免符杠顶到上一行
      var span = g[g.length - 1].x - g[0].x;
      var sum = 0, count = 0;
      g.forEach(function (col) {
        col.notes.forEach(function (n) { sum += n.step; count++; });
      });
      var avg = count ? sum / count : 0;
      var dir = avg >= 4 || (span > 3 * noteW && avg >= 3) ? "down" : "up";
      g.forEach(function (col) {
        col.dir = dir;
        col.notes.forEach(function (n) {
          n.dir = dir;
          n.stemX = n.x + (dir === "up" ? 1 : -1) * noteW * 0.42;
        });
      });
    });

    // 没有符尾的音柱（四分/二分）仍按单音决定方向
    cols.forEach(function (col) {
      if (col.dir) return;
      var avg = 0;
      col.notes.forEach(function (n) { avg += n.step; });
      avg = avg / col.notes.length;
      col.dir = avg >= 4 ? "down" : "up";
      col.notes.forEach(function (n) {
        n.dir = col.dir;
        n.stemX = n.x + (col.dir === "up" ? 1 : -1) * noteW * 0.42;
      });
    });

    // —— 3. 符杠分组：同一拍、同向、至少两列 ——
    var groups = {};
    cols.forEach(function (col) {
      if (!col.flags) return;
      var beatIdx = Math.floor(col.beat + 1e-6);
      var k = beatIdx + "|" + col.dir;
      (groups[k] || (groups[k] = [])).push(col);
    });
    var beamGroups = [];
    Object.keys(groups).forEach(function (k) {
      var g = groups[k];
      if (g.length < 2) return;
      g.sort(function (a, b) { return a.x - b.x; });
      var uniq = [];
      g.forEach(function (col) {
        if (!uniq.length || col.x - uniq[uniq.length - 1].x > noteW * 0.72) uniq.push(col);
      });
      if (uniq.length < 2) return;

      var dir = uniq[0].dir;
      var up = dir === "up";
      // 每列符干的「外端」：朝上取最高音，朝下取最低音
      var xs = uniq.map(function (col) { return col.x; });
      var ends = uniq.map(function (col) {
        var best = null;
        col.notes.forEach(function (n) {
          var e = up ? n.y - stemLen : n.y + stemLen;
          if (best === null) best = e;
          else if (up ? e < best : e > best) best = e;
        });
        return best;
      });

      // 用最小二乘拟合一条略带倾斜的符杠线，斜率限制在 ±0.22
      var n = xs.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
      for (var q = 0; q < n; q++) {
        sx += xs[q]; sy += ends[q];
        sxx += xs[q] * xs[q]; sxy += xs[q] * ends[q];
      }
      var denom = n * sxx - sx * sx;
      var slope = denom ? (n * sxy - sx * sy) / denom : 0;
      slope = clamp(slope, -0.22, 0.22);
      var x0 = xs[0];
      var lineAt = function (x) { return ends[0] + slope * (x - x0); };

      // 保证每列符干都不短于 stemLen 的 0.78 倍
      var minStem = stemLen * 0.78;
      var shift = up ? 0 : 0;
      var first = true;
      uniq.forEach(function (col) {
        col.notes.forEach(function (nt) {
          var bound = up ? nt.y - minStem : nt.y + minStem;
          var d = up ? bound - lineAt(nt.x) : bound - lineAt(nt.x);
          if (first) { shift = d; first = false; }
          else if (up ? d < shift : d > shift) shift = d;
        });
      });
      lineAt = (function (base, sl, bx, off) {
        return function (x) { return base + sl * (x - bx) + off; };
      })(ends[0], slope, x0, shift);

      uniq.forEach(function (col) {
        col.beamed = true;
        col.beamLine = lineAt;
        col.notes.forEach(function (nt) {
          nt.beamed = true;
          nt.beamY = lineAt(nt.stemX);
        });
      });
      beamGroups.push({
        dir: dir,
        slope: slope,
        lineAt: lineAt,
        cols: uniq,
        x1: uniq[0].x,
        x2: uniq[uniq.length - 1].x
      });
    });

    // —— 4. 加线 ——
    cols.forEach(function (col) {
      col.notes.forEach(function (n) {
        drawLedgerLines(ctx, n.x, n.y, n.step, space, noteW * 0.92);
      });
    });

    // —— 5. 符干 ——
    ctx.save();
    ctx.strokeStyle = COLORS.stem;
    ctx.lineCap = "butt";
    ctx.lineWidth = Math.max(1, 0.13 * space);
    cols.forEach(function (col) {
      col.notes.forEach(function (n) {
        if (n.shape.whole) return;
        var y1 = n.beamed ? n.beamY : (col.dir === "up" ? n.y - stemLen : n.y + stemLen);
        ctx.beginPath();
        ctx.moveTo(n.stemX, n.y);
        ctx.lineTo(n.stemX, y1);
        ctx.stroke();
      });
    });
    ctx.restore();

    // —— 6. 符杠 ——
    ctx.save();
    ctx.fillStyle = COLORS.stem;
    var beamT = Math.max(2, 0.48 * space);
    beamGroups.forEach(function (bg) {
      var up = bg.dir === "up";
      var sx1 = bg.cols[0].notes[0].stemX;
      var sx2 = bg.cols[bg.cols.length - 1].notes[0].stemX;
      var overhang = 0.32 * space;
      var left = sx1 - (up ? 0.08 * space : overhang);
      var right = sx2 + (up ? overhang : 0.08 * space);
      var yl = bg.lineAt(left);
      var yr = bg.lineAt(right);

      // 用竖直厚度画一条倾斜的符杠
      ctx.beginPath();
      ctx.moveTo(left, yl);
      ctx.lineTo(right, yr);
      ctx.lineTo(right, yr + beamT);
      ctx.lineTo(left, yl + beamT);
      ctx.closePath();
      ctx.fill();

      // 十六分音符的第二条符杠：只画在连续两列以上的区段
      var runStart = -1;
      var flushRun = function (stopIdx) {
        if (runStart >= 0 && stopIdx - runStart >= 2) {
          var a = bg.cols[runStart];
          var b = bg.cols[stopIdx - 1];
          var ax = a.notes[0].stemX;
          var bx = b.notes[0].stemX;
          var ay = bg.lineAt(ax) + (up ? beamT * 1.5 : -beamT * 1.5);
          var by = bg.lineAt(bx) + (up ? beamT * 1.5 : -beamT * 1.5);
          ctx.beginPath();
          ctx.moveTo(ax - 0.08 * space, ay);
          ctx.lineTo(bx + 0.2 * space, by);
          ctx.lineTo(bx + 0.2 * space, by + beamT);
          ctx.lineTo(ax - 0.08 * space, ay + beamT);
          ctx.closePath();
          ctx.fill();
        }
        runStart = -1;
      };
      for (var j = 0; j <= bg.cols.length; j++) {
        var hasTwo = j < bg.cols.length && bg.cols[j].flags >= 2;
        if (hasTwo && runStart < 0) runStart = j;
        if (!hasTwo) flushRun(j);
      }
    });
    ctx.restore();

    // —— 7. 独立符尾（未被符杠连起来的）——
    cols.forEach(function (col) {
      if (col.beamed || !col.flags) return;
      col.notes.forEach(function (n) {
        if (n.shape.whole || n.shape.flags <= 0) return;
        var yEnd = col.dir === "up" ? n.y - stemLen : n.y + stemLen;
        drawFlag(ctx, n.stemX, yEnd, col.dir, n.shape.flags, space);
      });
    });

    // —— 8. 符头 ——
    cols.forEach(function (col) {
      col.notes.forEach(function (n) {
        drawNotehead(ctx, n, noteW, noteH, space);
      });
    });

    // —— 9. 附点（落在线上时上移半格，避免压线）——
    cols.forEach(function (col) {
      col.notes.forEach(function (n) {
        if (!n.shape.dotted) return;
        var dy = n.step % 2 === 0 ? -half * 0.5 : 0;
        var dx = n.shape.whole ? noteW * 0.82 : noteW * 0.7;
        ctx.save();
        ctx.fillStyle = COLORS.notehead;
        ctx.beginPath();
        ctx.arc(n.x + dx + 1.2 * s, n.y + dy, Math.max(1.2, 0.14 * space), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
    });

    // —— 10. 临时升降号 ——
    cols.forEach(function (col) {
      col.notes.forEach(function (n) {
        if (!n.accidental) return;
        drawAccidental(ctx, n.accidental, n.x - noteW * 0.62 - 2.2 * s, n.y, space);
      });
    });

    return list.length;
  }

  /* ============================================================
   * 十一、轨道 -> 谱表索引
   * ========================================================== */

  function buildIndex(doc, lay) {
    var tracks = Array.isArray(doc.tracks) ? doc.tracks : [];
    var bars = lay.totalBars;
    var bpb = lay.beatsPerBar;
    var idx = { treble: [], bass: [] };
    var i;
    for (i = 0; i < bars; i++) {
      idx.treble.push([]);
      idx.bass.push([]);
    }

    tracks.forEach(function (track) {
      if (!track || !Array.isArray(track.notes)) return;
      var clef = track.clef === "bass" ? "bass" : track.clef === "treble" ? "treble" : "auto";
      track.notes.forEach(function (n) {
        if (!n || typeof n.pitch !== "number" || !isFinite(n.pitch)) return;
        var start = num(n.start, 0);
        var bar = Math.floor(start / bpb + 1e-9);
        if (bar < 0 || bar >= bars) return;
        var target = clef === "auto" ? (n.pitch < 60 ? "bass" : "treble") : clef;
        idx[target][bar].push({
          pitch: n.pitch,
          start: start,
          dur: num(n.dur, 1),
          velocity: num(n.velocity, 80),
          beatInBar: start - bar * bpb
        });
      });
    });
    return idx;
  }

  /* ============================================================
   * 十二、整谱绘制
   * ========================================================== */

  function drawScore(ctx, lay) {
    var o = lay.o;
    var s = lay.s;
    var doc = lay.doc;

    if (o.background !== false && o.background !== "transparent" && o.background !== null) {
      ctx.save();
      ctx.fillStyle = o.background;
      ctx.fillRect(0, 0, lay.width, lay.height);
      ctx.restore();
    }

    var index = buildIndex(doc, lay);
    var noteCount = 0;

    for (var r = 0; r < lay.rows.length; r++) {
      var row = lay.rows[r];

      drawHighlight(ctx, lay, row);
      drawStaffLines(ctx, lay, row);
      drawBarlines(ctx, lay, row);
      drawBrace(ctx, lay, row);
      drawClef(ctx, "treble", lay.clefX, row.staff1Top, lay);
      drawClef(ctx, "bass", lay.clefX, row.staff2Top, lay);
      drawKeySignature(ctx, lay, row);
      drawTimeSignature(ctx, lay, row);
      drawBarNumber(ctx, lay, row);
      drawSections(ctx, lay, row);
      drawChords(ctx, lay, row);

      for (var b = 0; b < row.count; b++) {
        var barIdx = row.startBar + b;
        var barX = lay.barsX + b * lay.barW;
        var trebleNotes = index.treble[barIdx];
        var bassNotes = index.bass[barIdx];

        if (trebleNotes.length) {
          noteCount += drawBarNotes(ctx, lay, row, trebleNotes, "treble", barX, lay.barW);
        } else {
          drawWholeRest(ctx, lay, row, "treble", barX, lay.barW);
        }
        if (bassNotes.length) {
          noteCount += drawBarNotes(ctx, lay, row, bassNotes, "bass", barX, lay.barW);
        } else {
          drawWholeRest(ctx, lay, row, "bass", barX, lay.barW);
        }
      }
    }

    drawHeader(ctx, lay);
    return noteCount;
  }

  /* ============================================================
   * 十三、对外 API
   * ========================================================== */

  /**
   * 计算渲染尺寸（不绘制）。
   * @returns {{width:number, height:number, systems:number, barsPerSystem:number}}
   */
  function measure(doc, opts) {
    var lay = computeLayout(doc, opts);
    return {
      width: lay.width,
      height: lay.height,
      systems: lay.systems,
      barsPerSystem: lay.barsPerSystem
    };
  }

  /**
   * 渲染乐谱到 canvas（可反复调用，内部先清空再重画）。
   * @param {HTMLCanvasElement} canvas
   * @param {object} doc
   * @param {object} opts
   * @returns {{width:number, height:number, systems:number, barsPerSystem:number, notes:number}}
   */
  function render(canvas, doc, opts) {
    if (!canvas || typeof canvas.getContext !== "function") {
      throw new Error("Notation.render 需要一个 canvas 元素");
    }
    var lay = computeLayout(doc, opts);
    var o = lay.o;

    // devicePixelRatio：物理像素放大，CSS 尺寸保持逻辑像素，避免模糊
    var dpr = num(o.dpr, 0);
    if (dpr <= 0) dpr = (global && global.devicePixelRatio) || 1;
    dpr = clamp(dpr, 1, 4);

    var cssW = lay.width;
    var cssH = lay.height;
    var pxW = Math.max(1, Math.round(cssW * dpr));
    var pxH = Math.max(1, Math.round(cssH * dpr));

    if (canvas.width !== pxW) canvas.width = pxW;
    if (canvas.height !== pxH) canvas.height = pxH;
    if (canvas.style) {
      canvas.style.width = cssW + "px";
      canvas.style.height = cssH + "px";
      canvas.style.display = "block";
    }

    var ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法获得 canvas 的 2d 绘图上下文");

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var notes = drawScore(ctx, lay);

    ctx.setTransform(1, 0, 0, 1, 0, 0);

    return {
      width: cssW,
      height: cssH,
      systems: lay.systems,
      barsPerSystem: lay.barsPerSystem,
      notes: notes
    };
  }

  global.Notation = {
    measure: measure,
    render: render,
    version: VERSION,
    // 附加工具：调用方可用来做命中测试 / 音符定位
    pitchToStaffStep: pitchToStaffStep,
    noteShape: noteShape
  };
})(
  typeof window !== "undefined"
    ? window
    : typeof globalThis !== "undefined"
    ? globalThis
    : this
);
