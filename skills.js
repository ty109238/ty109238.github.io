/* 技能池 */
(function () {
  'use strict';

  var DATA = null, LIST = [];
  var ELEM_ICON = { 火: 'fire', 水: 'water', 草: 'grass', 冰: 'ice', 土: 'rock', 钢: 'steel', 风: 'wind', 光: 'light', 暗: 'dark', 雷: 'thunder' };
  var state = { cat: '全部', elem: '全部', book: '全部', q: '', sort: 'power' };

  function loadBooks() {
    try { return new Set(JSON.parse(localStorage.getItem('dex:books') || '[]')); }
    catch (e) { return new Set(); }
  }
  function saveBooks(set) {
    try { localStorage.setItem('dex:books', JSON.stringify([].slice.call(set))); } catch (e) {}
  }
  var owned = loadBooks();
  function usageMap() {
    try { return JSON.parse(localStorage.getItem('dex:usage') || '{}'); } catch (e) { return {}; }
  }
  function saveUsage(m) { try { localStorage.setItem('dex:usage', JSON.stringify(m)); } catch (e) {} }
  function saveOwned(set) { try { localStorage.setItem('dex:books', JSON.stringify([].slice.call(set))); } catch (e) {} }

  function $(id) { return document.getElementById(id); }

  function categoryOf(s) {
    if (s.category === '物理') return '物攻';
    if (s.category === '特殊') return '特攻';
    var d = s.description || '';
    return /防|护盾|抵挡|免疫|守护|壁垒|结界/.test(d) ? '防御' : '辅助';
  }

  function catClass(c) {
    return c === '物攻' ? 'cat-phys' : c === '特攻' ? 'cat-spec' : c === '防御' ? 'cat-def' : 'cat-sup';
  }

  /* 技能书规则：专属技能 与 威力≥95 的招式需要技能书 */
  function needsBook(s) {
    return !!(s.exclusive) || (s.power || 0) >= 95;
  }

  function build() {
    var owners = {};
    DATA.creatures.forEach(function (c) {
      var arr = DATA.skills[String(c.id)] || [];
      var seen = {};
      arr.forEach(function (s) {
        var key = s.name;
        if (!owners[key]) {
          owners[key] = { s: s, owner: c.name, dexNo: c.dexNo, owners: 1 };
        } else {
          owners[key].owners++;
        }
      });
    });
    LIST = Object.keys(owners).map(function (k) {
      var o = owners[k];
      var s = o.s;
      return {
        name: s.name,
        type: s.type,
        cat: categoryOf(s),
        power: s.power || 0,
        accuracy: s.accuracy || 0,
        pp: s.pp || 0,
        desc: s.description || '',
        learnLevel: s.learnLevel || 0,
        exclusive: !!s.exclusive,
        book: needsBook(s),
        owner: o.owner,
        owners: o.owners
      };
    });
    LIST.sort(function (a, b) { return b.power - a.power; });
  }

  function chips(host, values, current, onPick) {
    host.innerHTML = '';
    values.forEach(function (v) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (v === current ? ' on' : '');
      b.textContent = v;
      b.addEventListener('click', function () { onPick(v); });
      host.appendChild(b);
    });
  }

  function renderUsagePanel() {
    var host = document.getElementById('usagePanel');
    if (!host) return;
    var m = usageMap();
    var rows = DATA.creatures.map(function (c) {
      var n = m[String(c.id)] || 0;
      return '<div class="usage-row"><span class="u-name">No.' + String(c.dexNo).padStart(3, '0') + ' ' + c.name +
        '</span><span class="u-count' + (n >= 10 ? ' full' : '') + '">' + n + ' / 10</span>' +
        '<button class="u-btn" data-id="' + c.id + '" data-d="1">+1</button>' +
        '<button class="u-btn" data-id="' + c.id + '" data-d="5">+5</button>' +
        '<button class="u-btn" data-id="' + c.id + '" data-d="-1">-1</button></div>';
    }).join('');
    host.innerHTML = '<div class="usage-list">' + rows + '</div>';
    host.querySelectorAll('.u-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        var m2 = usageMap();
        var id = b.getAttribute('data-id');
        var d = parseInt(b.getAttribute('data-d'), 10);
        m2[id] = Math.max(0, (m2[id] || 0) + d);
        saveUsage(m2);
        if (m2[id] >= 10) unlockExclusive(id);
        renderUsagePanel();
        renderGrid();
        renderBookShelf();
        document.getElementById('tabList').addEventListener('click', function () {
          document.getElementById('tabList').classList.add('on');
          document.getElementById('tabBooks').classList.remove('on');
          document.querySelector('.sp-filters').hidden = false;
          document.getElementById('grid').hidden = false;
          document.getElementById('bookView').hidden = true;
        });
        document.getElementById('tabBooks').addEventListener('click', function () {
          document.getElementById('tabBooks').classList.add('on');
          document.getElementById('tabList').classList.remove('on');
          document.querySelector('.sp-filters').hidden = true;
          document.getElementById('grid').hidden = true;
          document.getElementById('bookView').hidden = false;
          renderBookShelf();
        });
      });
    });
  }

  function unlockExclusive(id) {
    var arr = DATA.skills[String(id)] || [];
    var n = 0;
    arr.forEach(function (sk) {
      if ((sk.exclusive || (sk.power || 0) >= 95) && !owned.has(sk.name)) { owned.add(sk.name); n++; }
    });
    if (n) saveOwned(owned);
    return n;
  }

  function renderFilters() {
    var cats = ['全部', '物攻', '特攻', '防御', '辅助'];
    var elems = ['全部', '火', '水', '草', '冰', '土', '钢', '风', '光', '暗', '雷'];
    var books = ['全部', '直接可用', '需技能书', '已获得', '未获得'];
    chips($('fCat'), cats, state.cat, function (v) { state.cat = v; renderFilters(); renderGrid(); });
    chips($('fElem'), elems, state.elem, function (v) { state.elem = v; renderFilters(); renderGrid(); });
    chips($('fBook'), books, state.book, function (v) { state.book = v; renderFilters(); renderGrid(); });
  }

  function renderGrid() {
    var q = state.q.trim().toLowerCase();
    var out = LIST.filter(function (s) {
      if (state.cat !== '全部' && s.cat !== state.cat) return false;
      if (state.elem !== '全部' && s.type !== state.elem) return false;
      if (state.book === '需技能书' && !s.book) return false;
      if (state.book === '直接可用' && s.book) return false;
      if (state.book === '已获得' && !(s.book && owned.has(s.name))) return false;
      if (state.book === '未获得' && !(s.book && !owned.has(s.name))) return false;
      if (q && (s.name + s.desc + s.owner).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    if (state.sort === 'name') out.sort(function (a, b) { return a.name.localeCompare(b.name, 'zh'); });
    else if (state.sort === 'pp') out.sort(function (a, b) { return b.pp - a.pp; });
    else out.sort(function (a, b) { return b.power - a.power; });

    var grid = $('grid');
    grid.innerHTML = '';
    var frag = document.createDocumentFragment();
    out.forEach(function (s) {
      var card = document.createElement('article');
      card.className = 'sk-card';
      card.innerHTML =
        '<h3><img src="/media/ui/elem-' + (ELEM_ICON[s.type] || 'fire') + '.webp" alt="">' + s.name +
        (s.book ? '<button type="button" class="sk-book' + (owned.has(s.name) ? ' got' : '') +
          '" data-name="' + s.name + '">' + (owned.has(s.name) ? '已获得' : '需技能书') + '</button>' : '') + '</h3>' +
        '<div class="sk-meta">' +
        '<span class="' + catClass(s.cat) + '">' + s.cat + '技能</span>' +
        '<span>' + s.type + '系</span>' +
        (s.power ? '<span>威力 ' + s.power + '</span>' : '<span>变化</span>') +
        (s.accuracy ? '<span>命中 ' + s.accuracy + '</span>' : '') +
        '<span>PP ' + s.pp + '</span>' +
        '</div>' +
        '<p class="sk-desc">' + s.desc + '</p>' +
        '<div class="sk-owner">' + (s.owners > 1 ? s.owner + ' 等 ' + s.owners + ' 只' : s.owner) +
        (s.exclusive ? ' · 专属' : '') + '</div>';
      frag.appendChild(card);
    });
    grid.appendChild(frag);
    var bookTotal = LIST.filter(function (x) { return x.book; }).length;
    $('count').textContent = '共 ' + LIST.length + ' 个技能 · 当前 ' + out.length +
      ' 个 · 技能书 ' + owned.size + '/' + bookTotal;
    grid.querySelectorAll('.sk-book').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var nm = btn.getAttribute('data-name');
        if (owned.has(nm)) owned.delete(nm); else owned.add(nm);
        saveBooks(owned);
        renderGrid();
      });
    });
    $('empty').hidden = out.length > 0;
  }

  function renderBookShelf() {
    var host = document.getElementById('bookGrid');
    if (!host || !DATA) return;
    var html = DATA.creatures.map(function (c) {
      var books = (DATA.skills[String(c.id)] || []).filter(function (s) { return s.exclusive || (s.power || 0) >= 95; });
      if (!books.length) return '';
      var got = books.filter(function (b) { return owned.has(b.name); }).length;
      return '<section class="book-group">' +
        '<header><b>No.' + String(c.dexNo).padStart(3, '0') + ' ' + c.name + '</b>' +
        '<span class="bg-count' + (got === books.length ? ' full' : '') + '">' + got + '/' + books.length + '</span></header>' +
        '<div class="bg-items">' +
        books.map(function (b) {
          var has = owned.has(b.name);
          return '<button class="bg-book' + (has ? ' has' : '') + '" data-name="' + b.name + '">' +
            '<span class="bg-ico">' + (has ? '📖' : '❔') + '</span>' +
            '<span class="bg-name">' + (has ? b.name : '未获得') + '</span>' +
            '</button>';
        }).join('') + '</div></section>';
    }).join('');
    host.innerHTML = html;
    host.querySelectorAll('.bg-book').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var nm = btn.getAttribute('data-name');
        if (owned.has(nm)) owned.delete(nm); else owned.add(nm);
        saveOwned(owned);
        renderBookShelf();
        renderGrid();
      });
    });
  }

  function boot() {
    fetch('/data/content.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        DATA = d;
        build();
        renderFilters();
        renderUsagePanel();
        renderGrid();
        renderBookShelf();
        document.getElementById('tabList').addEventListener('click', function () {
          document.getElementById('tabList').classList.add('on');
          document.getElementById('tabBooks').classList.remove('on');
          document.querySelector('.sp-filters').hidden = false;
          document.getElementById('grid').hidden = false;
          document.getElementById('bookView').hidden = true;
        });
        document.getElementById('tabBooks').addEventListener('click', function () {
          document.getElementById('tabBooks').classList.add('on');
          document.getElementById('tabList').classList.remove('on');
          document.querySelector('.sp-filters').hidden = true;
          document.getElementById('grid').hidden = true;
          document.getElementById('bookView').hidden = false;
          renderBookShelf();
        });
        $('q').addEventListener('input', function (e) { state.q = e.target.value; renderGrid(); });
        $('sort').addEventListener('change', function (e) { state.sort = e.target.value; renderGrid(); });
      })
      .catch(function (e) {
        document.querySelector('.sp-wrap').innerHTML = '<p style="color:#b3153f">加载失败：' + e.message + '</p>';
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
