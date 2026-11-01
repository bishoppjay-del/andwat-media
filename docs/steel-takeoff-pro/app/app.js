/* Steel Takeoff Pro — UI (static SPA). Relies on nest.js + sections.json */
(function () {
  'use strict';
  var ST = window.SteelTakeoff;
  var LS_KEY = 'stp_project_v1';
  var LS_LICENSE = 'stp_license_v1';
  var FREE_LIMIT = ST.FREE_MEMBER_LIMIT;

  var state = {
    sections: [],
    massMap: {},
    members: [],
    settings: {
      kerf_mm: 3,
      end_trim_mm: 10,
      min_offcut_mm: 600,
      stockSizes: [12000, 9000, 8000, 6000],
      aud_per_kg: 2.8,
      aud_per_m: 0,
    },
    pro: false,
    projectName: 'Untitled job',
  };

  var el = {};

  function $(id) { return document.getElementById(id); }

  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () { t.classList.remove('show'); }, 2800);
  }

  function isPro() {
    return !!state.pro;
  }

  function memberCount() {
    return state.members.reduce(function (a, m) { return a + (parseInt(m.qty, 10) || 0); }, 0);
  }

  function canAddMembers(extraPieces) {
    if (isPro()) return true;
    return memberCount() + (extraPieces || 0) <= FREE_LIMIT;
  }

  function updateBadge() {
    var b = $('tierBadge');
    if (isPro()) {
      b.className = 'badge pro';
      b.textContent = 'Pro unlocked';
    } else {
      b.className = 'badge free';
      b.textContent = 'Free · ' + memberCount() + '/' + FREE_LIMIT + ' members';
    }
    document.querySelectorAll('[data-pro-only]').forEach(function (node) {
      node.classList.toggle('locked', !isPro());
      var note = node.querySelector('.lock-note');
      if (note) note.style.display = isPro() ? 'none' : 'block';
      node.querySelectorAll('button,input,textarea,select').forEach(function (ctrl) {
        if (ctrl.dataset.allowFree === '1') return;
        if (!isPro()) {
          // keep visible but gate actions in handlers
        }
      });
    });
    $('btnSave').disabled = !isPro();
    $('btnExportCsv').disabled = !isPro();
    $('btnPrint').disabled = !isPro();
    $('csvPaste').disabled = !isPro();
    $('csvFile').disabled = !isPro();
    $('btnImportCsv').disabled = !isPro();
  }

  function sectionOptionsHtml(selected) {
    var byType = {};
    state.sections.forEach(function (s) {
      (byType[s.type] = byType[s.type] || []).push(s);
    });
    var html = '<option value="">Select section…</option>';
    Object.keys(byType).forEach(function (type) {
      html += '<optgroup label="' + type + '">';
      byType[type].forEach(function (s) {
        var sel = s.label === selected ? ' selected' : '';
        html += '<option value="' + s.label + '"' + sel + '>' + s.label + ' · ' + s.kg_m + ' kg/m</option>';
      });
      html += '</optgroup>';
    });
    return html;
  }

  function renderMembers() {
    var tbody = $('membersBody');
    tbody.innerHTML = '';
    state.members.forEach(function (m, i) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td><input data-i="' + i + '" data-f="mark" value="' + escapeAttr(m.mark) + '" style="width:72px"></td>' +
        '<td><select data-i="' + i + '" data-f="section" style="min-width:160px">' + sectionOptionsHtml(m.section) + '</select></td>' +
        '<td class="num"><input data-i="' + i + '" data-f="length_mm" type="number" min="1" step="1" value="' + (m.length_mm || '') + '" style="width:90px;text-align:right"></td>' +
        '<td class="num"><input data-i="' + i + '" data-f="qty" type="number" min="1" step="1" value="' + (m.qty || 1) + '" style="width:60px;text-align:right"></td>' +
        '<td class="num muted">' + (state.massMap[m.section] != null ? state.massMap[m.section] : '—') + '</td>' +
        '<td><button type="button" class="ghost" data-del="' + i + '" title="Remove">✕</button></td>';
      tbody.appendChild(tr);
    });
    updateBadge();
    recompute();
  }

  function escapeAttr(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function recompute() {
    var mass = ST.massSchedule(state.members, state.massMap);
    var cost = ST.costEstimate(mass.rows, {
      aud_per_kg: Number($('audPerKg').value) || 0,
      aud_per_m: Number($('audPerM').value) || 0,
    });
    state.settings.aud_per_kg = Number($('audPerKg').value) || 0;
    state.settings.aud_per_m = Number($('audPerM').value) || 0;
    state.settings.kerf_mm = Number($('kerf').value) || 0;
    state.settings.end_trim_mm = Number($('endTrim').value) || 0;
    state.settings.min_offcut_mm = Number($('minOffcut').value) || 0;

    var stockRaw = $('stockSizes').value || '12000,9000,8000,6000';
    state.settings.stockSizes = stockRaw.split(',').map(function (x) { return parseInt(x.trim(), 10); }).filter(Boolean);

    var items = ST.expandMembers(state.members.filter(function (m) { return m.section && m.length_mm; }));
    var nestResult = null;
    var nestError = null;
    try {
      nestResult = items.length ? ST.nest(items, {
        stockSizes: state.settings.stockSizes,
        kerf_mm: state.settings.kerf_mm,
        end_trim_mm: state.settings.end_trim_mm,
        min_offcut_mm: state.settings.min_offcut_mm,
      }) : null;
    } catch (e) {
      nestError = e.message || String(e);
    }

    // mass table
    var mb = $('massBody');
    mb.innerHTML = '';
    mass.rows.forEach(function (r) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + r.section + (r.unknown_mass ? ' <span class="bad">?</span>' : '') + '</td>' +
        '<td class="num">' + r.qty_pieces + '</td>' +
        '<td class="num">' + r.total_m.toFixed(2) + '</td>' +
        '<td class="num">' + (r.kg_m != null ? r.kg_m : '—') + '</td>' +
        '<td class="num">' + (r.unknown_mass ? '—' : r.total_kg.toFixed(1)) + '</td>';
      mb.appendChild(tr);
    });
    $('statMass').textContent = mass.total_kg.toFixed(1) + ' kg';
    $('statMetres').textContent = mass.total_m.toFixed(2) + ' m';
    $('statCost').textContent = '$' + cost.total_aud.toFixed(2);

    // buy / nest
    var buyBody = $('buyBody');
    var nestBody = $('nestBody');
    buyBody.innerHTML = '';
    nestBody.innerHTML = '';
    if (nestError) {
      $('statBars').textContent = '—';
      $('statWaste').textContent = '—';
      $('nestError').textContent = nestError;
      $('nestError').style.display = 'block';
    } else {
      $('nestError').style.display = 'none';
      if (nestResult) {
        $('statBars').textContent = String(nestResult.totals.bars);
        $('statWaste').textContent = nestResult.totals.waste_pct + '%';
        nestResult.buy_list.forEach(function (b) {
          var kgm = state.massMap[b.section];
          var totalM = (b.bars * b.stock_mm) / 1000;
          var kg = kgm != null ? (totalM * kgm) : null;
          var tr = document.createElement('tr');
          tr.innerHTML =
            '<td>' + b.section + '</td>' +
            '<td class="num">' + b.stock_mm + '</td>' +
            '<td class="num">' + b.bars + '</td>' +
            '<td class="num">' + totalM.toFixed(1) + '</td>' +
            '<td class="num">' + (kg != null ? kg.toFixed(1) : '—') + '</td>';
          buyBody.appendChild(tr);
        });
        nestResult.bars.forEach(function (bar) {
          var wrap = document.createElement('div');
          wrap.style.marginBottom = '10px';
          var title = document.createElement('div');
          title.innerHTML = '<strong>Bar #' + bar.stock_id + '</strong> · ' + bar.section + ' · ' +
            bar.stock_mm + ' mm · offcut ' + bar.offcut_mm + ' mm' +
            (bar.usable_offcut ? ' <span class="ok">(usable)</span>' : ' <span class="warn">(scrap)</span>');
          wrap.appendChild(title);
          var viz = document.createElement('div');
          viz.className = 'bar-viz';
          var usable = bar.stock_mm - state.settings.end_trim_mm;
          bar.cuts.forEach(function (c) {
            if (c.kerf_mm) {
              var k = document.createElement('div');
              k.className = 'kerf';
              k.style.width = ((c.kerf_mm / bar.stock_mm) * 100) + '%';
              k.title = 'kerf ' + c.kerf_mm + ' mm';
              viz.appendChild(k);
            }
            var d = document.createElement('div');
            d.className = 'cut';
            d.style.width = ((c.length_mm / bar.stock_mm) * 100) + '%';
            d.title = c.mark + ' ' + c.length_mm + ' mm';
            viz.appendChild(d);
          });
          var off = document.createElement('div');
          off.className = 'off';
          off.style.width = ((bar.offcut_mm / bar.stock_mm) * 100) + '%';
          off.title = 'offcut ' + bar.offcut_mm + ' mm';
          viz.appendChild(off);
          wrap.appendChild(viz);
          var cuts = document.createElement('div');
          cuts.className = 'muted';
          cuts.style.fontSize = '0.8rem';
          cuts.textContent = bar.cuts.map(function (c) {
            return c.mark + ' @ ' + c.length_mm;
          }).join(' · ');
          wrap.appendChild(cuts);
          nestBody.appendChild(wrap);
        });
        state._lastNest = nestResult;
        state._lastMass = mass;
        state._lastCost = cost;
      } else {
        $('statBars').textContent = '0';
        $('statWaste').textContent = '—';
      }
    }

    // print sheet content
    renderPrintSheet(mass, nestResult, cost);
  }

  function renderPrintSheet(mass, nestResult, cost) {
    var box = $('printSheet');
    var html = '<h1>Steel Takeoff Pro — Material Schedule</h1>';
    html += '<p><strong>Job:</strong> ' + escapeAttr(state.projectName) +
      ' &nbsp;|&nbsp; <strong>Date:</strong> ' + new Date().toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' }) +
      ' (Australia/Brisbane)</p>';
    html += '<p class="muted">Andwat Co · Brisbane · ABN 77 173 994 186 · Nesting aid only — check lengths on the floor before cutting.</p>';
    html += '<h2>Mass by section</h2><table><thead><tr><th>Section</th><th class="num">Pcs</th><th class="num">m</th><th class="num">kg/m</th><th class="num">kg</th></tr></thead><tbody>';
    mass.rows.forEach(function (r) {
      html += '<tr><td>' + r.section + '</td><td class="num">' + r.qty_pieces + '</td><td class="num">' +
        r.total_m.toFixed(2) + '</td><td class="num">' + (r.kg_m != null ? r.kg_m : '—') +
        '</td><td class="num">' + (r.unknown_mass ? '—' : r.total_kg.toFixed(1)) + '</td></tr>';
    });
    html += '</tbody></table>';
    html += '<p><strong>Total:</strong> ' + mass.total_m.toFixed(2) + ' m · ' + mass.total_kg.toFixed(1) + ' kg';
    if (cost) html += ' · Est. A$' + cost.total_aud.toFixed(2);
    html += '</p>';
    if (nestResult) {
      html += '<h2>Buy list</h2><table><thead><tr><th>Section</th><th class="num">Stock mm</th><th class="num">Bars</th></tr></thead><tbody>';
      nestResult.buy_list.forEach(function (b) {
        html += '<tr><td>' + b.section + '</td><td class="num">' + b.stock_mm + '</td><td class="num">' + b.bars + '</td></tr>';
      });
      html += '</tbody></table>';
      html += '<p>Kerf ' + nestResult.meta.kerf_mm + ' mm · End trim ' + nestResult.meta.end_trim_mm +
        ' mm · Waste ' + nestResult.totals.waste_pct + '%</p>';
      html += '<h2>Saw sheet</h2>';
      nestResult.bars.forEach(function (bar) {
        html += '<p><strong>Bar #' + bar.stock_id + '</strong> ' + bar.section + ' × ' + bar.stock_mm +
          ' mm — ' + bar.cuts.map(function (c) { return c.mark + ' ' + c.length_mm; }).join(', ') +
          ' — offcut ' + bar.offcut_mm + ' mm</p>';
      });
    }
    box.innerHTML = html;
  }

  function addMember(prefill) {
    var extra = prefill && prefill.qty ? parseInt(prefill.qty, 10) || 1 : 1;
    if (!canAddMembers(extra)) {
      openUpgrade('Free plan is capped at ' + FREE_LIMIT + ' members. Unlock Pro for unlimited members, CSV import, export and saved projects.');
      return;
    }
    state.members.push({
      mark: (prefill && prefill.mark) || ('M' + (state.members.length + 1)),
      section: (prefill && prefill.section) || '',
      length_mm: (prefill && prefill.length_mm) || 3000,
      qty: extra,
    });
    renderMembers();
  }

  function openUpgrade(msg) {
    $('upgradeMsg').textContent = msg || 'Pro unlocks CSV import/export, printable schedules, saved projects and unlimited members.';
    $('upgradeModal').classList.add('open');
  }

  function closeUpgrade() {
    $('upgradeModal').classList.remove('open');
  }

  function applyLicense(key, persist) {
    var res = ST.validateLicenseKey(key);
    if (!res.ok) {
      toast(res.reason || 'Invalid key');
      return false;
    }
    state.pro = true;
    if (persist) {
      localStorage.setItem(LS_LICENSE, JSON.stringify({ key: key.trim().toUpperCase(), at: Date.now() }));
    }
    updateBadge();
    toast('Pro unlocked');
    closeUpgrade();
    return true;
  }

  function loadLicense() {
    try {
      var raw = localStorage.getItem(LS_LICENSE);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (data && data.key && ST.validateLicenseKey(data.key).ok) {
        state.pro = true;
      }
    } catch (e) { /* ignore */ }
  }

  function saveProject() {
    if (!isPro()) {
      openUpgrade('Saved projects are a Pro feature (stored in this browser only).');
      return;
    }
    var payload = {
      name: state.projectName,
      members: state.members,
      settings: state.settings,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(LS_KEY, JSON.stringify(payload));
    toast('Project saved in this browser');
  }

  function loadProject() {
    if (!isPro()) {
      openUpgrade('Loading saved projects is a Pro feature.');
      return;
    }
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) { toast('No saved project'); return; }
      var data = JSON.parse(raw);
      state.projectName = data.name || 'Untitled job';
      state.members = data.members || [];
      if (data.settings) {
        Object.assign(state.settings, data.settings);
        $('kerf').value = state.settings.kerf_mm;
        $('endTrim').value = state.settings.end_trim_mm;
        $('minOffcut').value = state.settings.min_offcut_mm;
        $('stockSizes').value = (state.settings.stockSizes || []).join(',');
        $('audPerKg').value = state.settings.aud_per_kg;
        $('audPerM').value = state.settings.aud_per_m;
      }
      $('projectName').value = state.projectName;
      renderMembers();
      toast('Loaded ' + state.projectName);
    } catch (e) {
      toast('Could not load project');
    }
  }

  function exportCsv() {
    if (!isPro()) {
      openUpgrade('CSV export is a Pro feature.');
      return;
    }
    var nestResult = state._lastNest;
    var mass = state._lastMass;
    if (!mass) { toast('Nothing to export'); return; }
    var parts = [];
    parts.push('=== MEMBERS ===');
    parts.push(ST.toCsv(state.members.map(function (m) {
      return { mark: m.mark, section: m.section, length_mm: m.length_mm, qty: m.qty };
    }), ['mark', 'section', 'length_mm', 'qty']));
    parts.push('=== MASS ===');
    parts.push(ST.toCsv(mass.rows.map(function (r) {
      return { section: r.section, qty_pieces: r.qty_pieces, total_m: r.total_m, kg_m: r.kg_m, total_kg: r.total_kg };
    }), ['section', 'qty_pieces', 'total_m', 'kg_m', 'total_kg']));
    if (nestResult) {
      parts.push('=== BUY LIST ===');
      parts.push(ST.toCsv(nestResult.buy_list, ['section', 'stock_mm', 'bars']));
      parts.push('=== SAW SHEET ===');
      parts.push(ST.toCsv(nestResult.cuts, ['stock_id', 'section', 'stock_mm', 'mark', 'length_mm', 'kerf_mm']));
    }
    var blob = new Blob([parts.join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (state.projectName || 'takeoff').replace(/\s+/g, '-') + '-steel-takeoff.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importCsvText(text) {
    if (!isPro()) {
      openUpgrade('CSV import is a Pro feature.');
      return;
    }
    try {
      var rows = ST.parseCsv(text);
      var pieces = rows.reduce(function (a, r) { return a + (r.qty || 1); }, 0);
      if (!isPro() && pieces > FREE_LIMIT) {
        openUpgrade('That CSV has ' + pieces + ' members. Free is capped at ' + FREE_LIMIT + '.');
        return;
      }
      state.members = rows;
      renderMembers();
      toast('Imported ' + rows.length + ' rows');
    } catch (e) {
      toast(e.message || 'CSV parse failed');
    }
  }

  function wire() {
    el = {
      addBtn: $('btnAdd'),
    };
    $('btnAdd').addEventListener('click', function () { addMember(); });
    $('btnSample').addEventListener('click', function () {
      state.members = [
        { mark: 'C1', section: '310UB40.4', length_mm: 6200, qty: 4 },
        { mark: 'C2', section: '310UB40.4', length_mm: 4100, qty: 2 },
        { mark: 'B1', section: '200UB25.4', length_mm: 5800, qty: 6 },
        { mark: 'P1', section: '100x100x6.0SHS', length_mm: 2400, qty: 8 },
        { mark: 'A1', section: '75x75x6EA', length_mm: 1500, qty: 10 },
      ];
      // sample has 30 pieces — only load full sample if Pro, else trim
      if (!isPro()) {
        // shrink to fit free limit
        state.members = [
          { mark: 'C1', section: '310UB40.4', length_mm: 6200, qty: 2 },
          { mark: 'B1', section: '200UB25.4', length_mm: 5800, qty: 3 },
          { mark: 'P1', section: '100x100x6.0SHS', length_mm: 2400, qty: 4 },
          { mark: 'A1', section: '75x75x6EA', length_mm: 1500, qty: 4 },
        ];
        toast('Loaded free sample (13 members). Unlock Pro for the full demo.');
      } else {
        toast('Loaded Pro sample job');
      }
      renderMembers();
    });
    $('membersBody').addEventListener('input', function (ev) {
      var t = ev.target;
      if (!t.dataset || t.dataset.i == null) return;
      var i = Number(t.dataset.i);
      var f = t.dataset.f;
      if (!state.members[i]) return;
      if (f === 'qty') {
        var newQty = parseInt(t.value, 10) || 1;
        var others = memberCount() - (parseInt(state.members[i].qty, 10) || 0);
        if (!isPro() && others + newQty > FREE_LIMIT) {
          toast('Free limit is ' + FREE_LIMIT + ' members');
          t.value = state.members[i].qty;
          openUpgrade();
          return;
        }
        state.members[i].qty = newQty;
      } else if (f === 'length_mm') {
        state.members[i].length_mm = parseInt(t.value, 10) || 0;
      } else if (f === 'mark') {
        state.members[i].mark = t.value;
      } else if (f === 'section') {
        state.members[i].section = t.value;
      }
      updateBadge();
      recompute();
    });
    $('membersBody').addEventListener('change', function (ev) {
      // section select
      var t = ev.target;
      if (t.dataset && t.dataset.f === 'section') {
        state.members[Number(t.dataset.i)].section = t.value;
        renderMembers();
      }
    });
    $('membersBody').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-del]');
      if (!btn) return;
      state.members.splice(Number(btn.dataset.del), 1);
      renderMembers();
    });

    ['kerf', 'endTrim', 'minOffcut', 'stockSizes', 'audPerKg', 'audPerM'].forEach(function (id) {
      $(id).addEventListener('change', recompute);
      $(id).addEventListener('input', recompute);
    });

    $('projectName').addEventListener('input', function (ev) {
      state.projectName = ev.target.value || 'Untitled job';
    });

    $('btnSave').addEventListener('click', saveProject);
    $('btnLoad').addEventListener('click', loadProject);
    $('btnExportCsv').addEventListener('click', exportCsv);
    $('btnPrint').addEventListener('click', function () {
      if (!isPro()) { openUpgrade('Printable PDF-style schedule is a Pro feature.'); return; }
      window.print();
    });
    $('btnImportCsv').addEventListener('click', function () {
      if (!isPro()) { openUpgrade('CSV import is a Pro feature.'); return; }
      importCsvText($('csvPaste').value);
    });
    $('csvFile').addEventListener('change', function (ev) {
      if (!isPro()) { openUpgrade('CSV import is a Pro feature.'); ev.target.value = ''; return; }
      var file = ev.target.files && ev.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () { importCsvText(String(reader.result || '')); };
      reader.readAsText(file);
    });

    $('btnUnlock').addEventListener('click', function () { openUpgrade(); });
    $('btnApplyKey').addEventListener('click', function () {
      applyLicense($('licenseKey').value, true);
    });
    $('btnCloseUpgrade').addEventListener('click', closeUpgrade);
    $('upgradeModal').addEventListener('click', function (ev) {
      if (ev.target.id === 'upgradeModal') closeUpgrade();
    });
  }

  function boot() {
    fetch('sections.json')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        state.sections = data.sections || [];
        state.massMap = {};
        state.sections.forEach(function (s) {
          state.massMap[s.label] = s.kg_m;
          state.massMap[s.id] = s.kg_m;
        });
        $('sectionSource').textContent = data.count + ' AU sections · ' + (data.source || '');
        loadLicense();
        wire();
        updateBadge();
        if (!state.members.length) {
          // start with one empty row under free limit
          addMember({ mark: 'M1', section: '310UB40.4', length_mm: 6000, qty: 1 });
        } else {
          renderMembers();
        }
      })
      .catch(function (e) {
        document.body.innerHTML = '<p style="padding:2rem;color:#f87171">Failed to load sections.json: ' + e + '</p>';
      });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
