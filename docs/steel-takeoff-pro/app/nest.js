/**
 * Steel Takeoff Pro — mass + 1D nesting engine (browser + Node).
 * Port of empire/local-ai/steel_takeoff_nest.py nesting rules.
 * Practical fabrication nest only — not engineering certification.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SteelTakeoff = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_STOCK_MM = [12000, 9000, 8000, 6000];
  var FREE_MEMBER_LIMIT = 15;

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  /** Expand qty into individual pieces, longest first. */
  function expandMembers(members) {
    var out = [];
    members.forEach(function (m, idx) {
      var qty = Math.max(0, parseInt(m.qty, 10) || 0);
      var len = Math.round(Number(m.length_mm));
      var section = String(m.section || '').trim();
      var mark = String(m.mark || ('M' + (idx + 1))).trim() || ('M' + (idx + 1));
      var preferred = m.stock_mm ? Math.round(Number(m.stock_mm)) : null;
      for (var i = 0; i < qty; i++) {
        out.push({
          mark: qty === 1 ? mark : mark + '-' + (i + 1),
          section: section,
          length_mm: len,
          stock_mm: preferred,
        });
      }
    });
    out.sort(function (a, b) {
      return b.length_mm - a.length_mm;
    });
    return out;
  }

  /**
   * First-fit decreasing nest by section family.
   * stockSizes: prefer shortest that fits when opening a new bar.
   */
  function nest(items, opts) {
    opts = opts || {};
    var stockSizes = (opts.stockSizes || DEFAULT_STOCK_MM).slice().map(Number);
    var kerf = opts.kerf_mm != null ? Number(opts.kerf_mm) : 3;
    var endTrim = opts.end_trim_mm != null ? Number(opts.end_trim_mm) : 10;
    var minOffcut = opts.min_offcut_mm != null ? Number(opts.min_offcut_mm) : 600;

    var bars = [];
    var cuts = [];

    function newBar(section, stockMm) {
      var usable = stockMm - endTrim;
      if (usable <= 0) {
        throw new Error('end_trim ' + endTrim + ' leaves no usable length on ' + stockMm);
      }
      var b = {
        stock_id: bars.length + 1,
        section: section,
        stock_mm: stockMm,
        remaining: usable,
        cuts: [],
      };
      bars.push(b);
      return b;
    }

    function pickStock(length, preferred) {
      if (preferred) {
        if (length > preferred - endTrim) {
          throw new Error(
            'piece ' + length + ' mm does not fit preferred stock ' + preferred
          );
        }
        return preferred;
      }
      var fits = stockSizes.filter(function (s) {
        return length <= s - endTrim;
      });
      if (!fits.length) {
        throw new Error(
          'piece ' + length + ' mm longer than all stock sizes [' + stockSizes.join(',') + ']'
        );
      }
      return Math.min.apply(null, fits);
    }

    items.forEach(function (it) {
      var placed = false;
      for (var i = 0; i < bars.length; i++) {
        var b = bars[i];
        if (b.section !== it.section) continue;
        var need = b.cuts.length === 0 ? it.length_mm : it.length_mm + kerf;
        if (need <= b.remaining) {
          var k = b.cuts.length === 0 ? 0 : kerf;
          b.remaining -= need;
          b.cuts.push({ mark: it.mark, length_mm: it.length_mm, kerf_mm: k });
          cuts.push({
            stock_id: b.stock_id,
            stock_mm: b.stock_mm,
            section: it.section,
            mark: it.mark,
            length_mm: it.length_mm,
            kerf_mm: k,
          });
          placed = true;
          break;
        }
      }
      if (placed) return;
      var stockMm = pickStock(it.length_mm, it.stock_mm);
      var nb = newBar(it.section, stockMm);
      nb.remaining -= it.length_mm;
      nb.cuts.push({ mark: it.mark, length_mm: it.length_mm, kerf_mm: 0 });
      cuts.push({
        stock_id: nb.stock_id,
        stock_mm: stockMm,
        section: it.section,
        mark: it.mark,
        length_mm: it.length_mm,
        kerf_mm: 0,
      });
    });

    var summaries = bars.map(function (b) {
      var offcut = b.remaining;
      var used = b.stock_mm - endTrim - offcut;
      return {
        stock_id: b.stock_id,
        section: b.section,
        stock_mm: b.stock_mm,
        pieces: b.cuts.length,
        offcut_mm: offcut,
        used_mm: used,
        scrap: offcut < minOffcut,
        usable_offcut: offcut >= minOffcut,
        waste_pct: round1((offcut / b.stock_mm) * 100),
        cuts: b.cuts.slice(),
      };
    });

    var buy = {};
    summaries.forEach(function (s) {
      var key = s.section + '|' + s.stock_mm;
      buy[key] = (buy[key] || 0) + 1;
    });
    var buyList = Object.keys(buy)
      .map(function (k) {
        var parts = k.split('|');
        return { section: parts[0], stock_mm: Number(parts[1]), bars: buy[k] };
      })
      .sort(function (a, b) {
        if (a.section === b.section) return a.stock_mm - b.stock_mm;
        return a.section < b.section ? -1 : 1;
      });

    var totalStockMm = summaries.reduce(function (a, s) {
      return a + s.stock_mm;
    }, 0);
    var totalOffcut = summaries.reduce(function (a, s) {
      return a + s.offcut_mm;
    }, 0);

    return {
      cuts: cuts,
      bars: summaries,
      buy_list: buyList,
      totals: {
        bars: summaries.length,
        pieces: cuts.length,
        scrap_bars: summaries.filter(function (s) {
          return s.scrap;
        }).length,
        total_stock_mm: totalStockMm,
        total_offcut_mm: totalOffcut,
        waste_pct: totalStockMm ? round1((totalOffcut / totalStockMm) * 100) : 0,
      },
      meta: {
        kerf_mm: kerf,
        end_trim_mm: endTrim,
        min_offcut_mm: minOffcut,
        stock_mm: stockSizes,
      },
    };
  }

  /**
   * Mass schedule: total kg and metres by section.
   * sectionMassMap: { designation: kg_m }
   */
  function massSchedule(members, sectionMassMap) {
    var by = {};
    members.forEach(function (m) {
      var section = String(m.section || '').trim();
      var qty = Math.max(0, parseInt(m.qty, 10) || 0);
      var lenMm = Number(m.length_mm) || 0;
      var metres = (lenMm / 1000) * qty;
      var kgm = sectionMassMap[section];
      if (kgm == null) {
        // try case-insensitive
        var keys = Object.keys(sectionMassMap);
        for (var i = 0; i < keys.length; i++) {
          if (keys[i].toLowerCase() === section.toLowerCase()) {
            kgm = sectionMassMap[keys[i]];
            section = keys[i];
            break;
          }
        }
      }
      if (!by[section]) {
        by[section] = {
          section: section,
          qty_pieces: 0,
          total_m: 0,
          kg_m: kgm != null ? kgm : null,
          total_kg: 0,
          unknown_mass: kgm == null,
        };
      }
      by[section].qty_pieces += qty;
      by[section].total_m = round2(by[section].total_m + metres);
      if (kgm != null) {
        by[section].total_kg = round2(by[section].total_kg + metres * kgm);
      }
    });
    var rows = Object.keys(by)
      .map(function (k) {
        return by[k];
      })
      .sort(function (a, b) {
        return a.section < b.section ? -1 : 1;
      });
    var totalKg = round2(
      rows.reduce(function (a, r) {
        return a + (r.total_kg || 0);
      }, 0)
    );
    var totalM = round2(
      rows.reduce(function (a, r) {
        return a + r.total_m;
      }, 0)
    );
    return { rows: rows, total_kg: totalKg, total_m: totalM };
  }

  /** Simple cost estimate from A$/kg and/or A$/m overrides per section. */
  function costEstimate(massRows, opts) {
    opts = opts || {};
    var defaultPerKg = opts.aud_per_kg != null ? Number(opts.aud_per_kg) : 0;
    var defaultPerM = opts.aud_per_m != null ? Number(opts.aud_per_m) : 0;
    var perSection = opts.per_section || {}; // { section: { aud_per_kg, aud_per_m } }

    var lines = massRows.map(function (r) {
      var cfg = perSection[r.section] || {};
      var pkg = cfg.aud_per_kg != null ? Number(cfg.aud_per_kg) : defaultPerKg;
      var pm = cfg.aud_per_m != null ? Number(cfg.aud_per_m) : defaultPerM;
      var costKg = pkg > 0 && r.total_kg ? r.total_kg * pkg : 0;
      var costM = pm > 0 ? r.total_m * pm : 0;
      // Prefer $/kg when both set; if only one set use that; if both, sum would double-count so prefer kg
      var cost = 0;
      var basis = 'none';
      if (pkg > 0 && r.kg_m != null) {
        cost = costKg;
        basis = 'kg';
      } else if (pm > 0) {
        cost = costM;
        basis = 'm';
      }
      return {
        section: r.section,
        total_m: r.total_m,
        total_kg: r.total_kg,
        aud_per_kg: pkg,
        aud_per_m: pm,
        basis: basis,
        cost_aud: round2(cost),
      };
    });
    var total = round2(
      lines.reduce(function (a, l) {
        return a + l.cost_aud;
      }, 0)
    );
    return { lines: lines, total_aud: total };
  }

  function parseCsv(text) {
    var lines = String(text || '')
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .filter(function (l) {
        return l.trim().length;
      });
    if (!lines.length) return [];
    function splitRow(line) {
      var cells = [];
      var cur = '';
      var inQ = false;
      for (var i = 0; i < line.length; i++) {
        var ch = line[i];
        if (inQ) {
          if (ch === '"' && line[i + 1] === '"') {
            cur += '"';
            i++;
          } else if (ch === '"') {
            inQ = false;
          } else {
            cur += ch;
          }
        } else if (ch === '"') {
          inQ = true;
        } else if (ch === ',') {
          cells.push(cur.trim());
          cur = '';
        } else {
          cur += ch;
        }
      }
      cells.push(cur.trim());
      return cells;
    }
    var header = splitRow(lines[0]).map(function (h) {
      return h.toLowerCase().replace(/\s+/g, '_');
    });
    var alias = {
      mark: 'mark',
      member: 'mark',
      tag: 'mark',
      section: 'section',
      size: 'section',
      designation: 'section',
      length_mm: 'length_mm',
      length: 'length_mm',
      len_mm: 'length_mm',
      len: 'length_mm',
      qty: 'qty',
      quantity: 'qty',
      q: 'qty',
      stock_mm: 'stock_mm',
      stock: 'stock_mm',
    };
    var idx = {};
    header.forEach(function (h, i) {
      var key = alias[h] || h;
      idx[key] = i;
    });
    if (idx.section == null || idx.length_mm == null) {
      throw new Error('CSV needs section and length_mm columns (optional: mark, qty, stock_mm)');
    }
    var rows = [];
    for (var r = 1; r < lines.length; r++) {
      var cells = splitRow(lines[r]);
      var lengthRaw = cells[idx.length_mm];
      var length = Number(lengthRaw);
      // allow metres if value < 30 and header was "length" without _mm — treat as mm if >= 30 else if has decimal maybe m
      if (header[idx.length_mm] === 'length' && length > 0 && length < 30) {
        length = Math.round(length * 1000);
      }
      rows.push({
        mark: idx.mark != null ? cells[idx.mark] || '' : '',
        section: cells[idx.section] || '',
        length_mm: Math.round(length),
        qty: idx.qty != null ? parseInt(cells[idx.qty] || '1', 10) || 1 : 1,
        stock_mm:
          idx.stock_mm != null && cells[idx.stock_mm]
            ? Math.round(Number(cells[idx.stock_mm]))
            : null,
      });
    }
    return rows;
  }

  function toCsv(rows, columns) {
    function esc(v) {
      var s = v == null ? '' : String(v);
      if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    }
    var lines = [columns.join(',')];
    rows.forEach(function (row) {
      lines.push(
        columns
          .map(function (c) {
            return esc(row[c]);
          })
          .join(',')
      );
    });
    return lines.join('\n') + '\n';
  }


  /** Normalise a pasted license key. */
  function normalizeLicenseKey(key) {
    return String(key || '').trim().toUpperCase().replace(/\s+/g, '');
  }

  /**
   * Soft offline Pro license check (STP-XXXX-XXXX-XXXX).
   * Checksum: weighted char-code sum of the 12 payload chars must be divisible by 97.
   * No demo keys. No Payhip product secret in the client — verify API is server-only.
   * Trade-off: determined users can forge a checksum-valid key; fine for AU tradie MVP.
   */
  function validateLicenseKey(key) {
    key = normalizeLicenseKey(key);
    var m = /^STP-([A-Z0-9]{4})-([A-Z0-9]{4})-([A-Z0-9]{4})$/.exec(key);
    if (!m) return { ok: false, reason: 'Use format STP-XXXX-XXXX-XXXX' };
    var payload = m[1] + m[2] + m[3];
    var sum = 0;
    for (var i = 0; i < payload.length; i++) sum += payload.charCodeAt(i) * (i + 1);
    if (sum % 97 !== 0) return { ok: false, reason: 'Key checksum failed' };
    return { ok: true, tier: 'pro', key: key };
  }

  /** Build a checksum-valid STP key. Uses first 10 seed chars; searches last 2. */
  function mintLicenseKey(seed) {
    var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    var p = String(seed || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    while (p.length < 10) p += '0';
    p = p.slice(0, 10);
    for (var a = 0; a < alphabet.length; a++) {
      for (var b = 0; b < alphabet.length; b++) {
        var cand = p + alphabet.charAt(a) + alphabet.charAt(b);
        var s2 = 0;
        for (var t = 0; t < 12; t++) s2 += cand.charCodeAt(t) * (t + 1);
        if (s2 % 97 === 0) {
          return 'STP-' + cand.slice(0, 4) + '-' + cand.slice(4, 8) + '-' + cand.slice(8, 12);
        }
      }
    }
    throw new Error('could not mint key');
  }

  return {
    DEFAULT_STOCK_MM: DEFAULT_STOCK_MM,
    FREE_MEMBER_LIMIT: FREE_MEMBER_LIMIT,
    expandMembers: expandMembers,
    nest: nest,
    massSchedule: massSchedule,
    costEstimate: costEstimate,
    parseCsv: parseCsv,
    toCsv: toCsv,
    round2: round2,
    round1: round1,
    normalizeLicenseKey: normalizeLicenseKey,
    validateLicenseKey: validateLicenseKey,
    mintLicenseKey: mintLicenseKey,
  };
});
