/* 技能池 */
(function () {
  'use strict';

  var DATA = null, LIST = [];
  var ELEM_ICON = { 火: 'fire', 水: 'water', 草: 'grass', 冰: 'ice', 土: 'rock', 钢: 'steel', 风: 'wind', 光: 'light', 暗: 'dark', 雷: 'thunder' };
  var state = { cat: '全部', elem: '全部', book: '全部', q: '', sort: 'power' };

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

  function renderFilters() {
    var cats = ['全部', '物攻', '特攻', '防御', '辅助'];
    var elems = ['全部', '火', '水', '草', '冰', '土', '钢', '风', '光', '暗', '雷'];
    var books = ['全部', '直接可用', '需技能书'];
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
        (s.book ? '<span class="sk-book">技能书</span>' : '') + '</h3>' +
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
    $('count').textContent = '共 ' + LIST.length + ' 个技能 · 当前 ' + out.length + ' 个';
    $('empty').hidden = out.length > 0;
  }

  function boot() {
    fetch('/data/content.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        DATA = d;
        build();
        renderFilters();
        renderGrid();
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
