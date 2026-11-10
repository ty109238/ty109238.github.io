/* 卡册：每页 9 张、搜索、阶段 / 属性筛选 */
(function () {
  var PAGE_SIZE = 9;
  var STAGES = ['一阶', '二阶', '三阶'];
  var ELEMENTS = ['钢', '草', '水', '火', '土', '风', '雷', '冰', '光', '暗'];

  var state = {
    data: null,
    list: [],
    page: 0,
    q: '',
    stages: new Set(),
    elems: new Set(),
    rarities: new Set(),
    powerBand: null,
    favOnly: false,
  };

  function $(id) { return document.getElementById(id); }

  function pad2(n) { return ('0' + n).slice(-2); }

  var FAV_KEY = 'cardAlbum:favs';

  function loadFavs() {
    try {
      var raw = localStorage.getItem(FAV_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return new Set(arr);
    } catch (e) { return new Set(); }
  }

  function saveFavs(set) {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(Array.from(set))); } catch (e) {}
  }

  function toggleFav(idx) {
    var set = loadFavs();
    if (set.has(idx)) set.delete(idx); else set.add(idx);
    saveFavs(set);
    return set.has(idx);
  }

  function load() {
    return fetch('/data/content.json', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var favs = loadFavs();
        var items = d.creatures.map(function (c, i) {
          var total = (c.hp || 0) + (c.attack || 0) + (c.defense || 0) +
                      (c.spAttack || 0) + (c.spDefense || 0) + (c.speed || 0);
          var power = Math.round(total * 3.1);
          var rarity = power < 1400 ? '普通' : (power < 1700 ? '优秀' : (power < 1850 ? '稀有' : '传说'));
          return {
            idx: i + 1,
            name: c.name,
            stage: c.stage,
            element: c.element,
            element2: c.element2 || '',
            power: power,
            rarity: rarity,
            img: '/media/cards/' + pad2(i + 1) + '.webp',
            fav: favs.has(i + 1),
          };
        });
        items.sort(function (a, b) { return a.idx - b.idx; });
        return items;
      });
  }

  function match(it) {
    if (state.q && it.name.indexOf(state.q) < 0) return false;
    if (state.stages.size && !state.stages.has(it.stage)) return false;
    if (state.elems.size && !(state.elems.has(it.element) || state.elems.has(it.element2))) return false;
    if (state.rarities.size && !state.rarities.has(it.rarity)) return false;
    if (state.favOnly && !it.fav) return false;
    if (state.powerBand) {
      var b = state.powerBand;
      if (it.power < b[0] || it.power >= b[1]) return false;
    }
    return true;
  }

  var RARITIES = ['普通', '优秀', '稀有', '传说'];
  var POWER_BANDS = [
    { t: '全部', v: null },
    { t: '<1400', v: [0, 1400] },
    { t: '1400-1700', v: [1400, 1700] },
    { t: '1700-1850', v: [1700, 1850] },
    { t: '1850+', v: [1850, 99999] },
  ];

  function renderChips() {
    var sc = $('stageChips');
    var ec = $('elemChips');
    sc.innerHTML = '';
    ec.innerHTML = '';

    var rc = $('rarityChips');
    if (rc) {
      rc.innerHTML = '';
      RARITIES.forEach(function (r) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip r-' + r + (state.rarities.has(r) ? ' on' : '');
        b.textContent = r;
        b.addEventListener('click', function () {
          if (state.rarities.has(r)) state.rarities.delete(r); else state.rarities.add(r);
          state.page = 0; render();
        });
        rc.appendChild(b);
      });
    }

    var pc = $('powerChips');
    if (pc) {
      pc.innerHTML = '';
      POWER_BANDS.forEach(function (band) {
        var on = (band.v === null && !state.powerBand) ||
                 (band.v && state.powerBand && band.v[0] === state.powerBand[0]);
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip' + (on ? ' on' : '');
        b.textContent = band.t;
        b.addEventListener('click', function () {
          state.powerBand = band.v;
          state.page = 0; render();
        });
        pc.appendChild(b);
      });
    }

    var fc = $('favChip');
    if (fc) {
      fc.className = 'chip fav-chip' + (state.favOnly ? ' on' : '');
      fc.textContent = state.favOnly ? '★ 只看收藏' : '☆ 只看收藏';
    }

    STAGES.forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (state.stages.has(s) ? ' on' : '');
      b.textContent = s;
      b.addEventListener('click', function () {
        if (state.stages.has(s)) state.stages.delete(s); else state.stages.add(s);
        state.page = 0;
        render();
      });
      sc.appendChild(b);
    });

    ELEMENTS.forEach(function (s) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (state.elems.has(s) ? ' on' : '');
      b.textContent = s;
      b.addEventListener('click', function () {
        if (state.elems.has(s)) state.elems.delete(s); else state.elems.add(s);
        state.page = 0;
        render();
      });
      ec.appendChild(b);
    });
  }

  function renderGrid() {
    var grid = $('cardGrid');
    var filtered = state.list.filter(match);
    var pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (state.page >= pages) state.page = pages - 1;
    if (state.page < 0) state.page = 0;

    var slice = filtered.slice(state.page * PAGE_SIZE, state.page * PAGE_SIZE + PAGE_SIZE);
    grid.innerHTML = '';
    slice.forEach(function (it) {
      var d = document.createElement('div');
      d.className = 'card';
      d.innerHTML = '<img src="' + it.img + '" alt="' + it.name + '" loading="lazy">' +
        '<span class="tag">' + it.stage + ' · ' + it.element + '</span>' +
        '<span class="rar r-' + it.rarity + '">' + it.rarity + '</span>' +
        '<span class="pw">战力 ' + it.power + '</span>' +
        '<button class="fav' + (it.fav ? ' on' : '') + '" type="button" title="收藏">' + (it.fav ? '★' : '☆') + '</button>';
      d.addEventListener('click', function (e) {
        if (e.target.closest('.fav')) return;
        openViewer(it);
      });
      var fb = d.querySelector('.fav');
      fb.addEventListener('click', function (e) {
        e.stopPropagation();
        var on = toggleFav(it.idx);
        it.fav = on;
        fb.classList.toggle('on', on);
        fb.textContent = on ? '★' : '☆';
        if (state.favOnly) renderGrid();
      });
      grid.appendChild(d);
    });

    $('cardEmpty').classList.toggle('hidden', filtered.length > 0);

    var pager = $('cardPager');
    pager.innerHTML = '';
    for (var i = 0; i < pages; i++) {
      (function (p) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = String(p + 1);
        if (p === state.page) b.className = 'on';
        b.addEventListener('click', function () { state.page = p; renderGrid(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
        pager.appendChild(b);
      })(i);
    }
    pager.style.display = pages > 1 ? '' : 'none';

    var bits = [];
    if (state.stages.size) bits.push(Array.from(state.stages).join('/'));
    if (state.elems.size) bits.push(Array.from(state.elems).join('/'));
    if (state.rarities.size) bits.push(Array.from(state.rarities).join('/'));
    if (state.powerBand) bits.push('战力 ' + state.powerBand[0] + '+');
    if (state.favOnly) bits.push('收藏');
    $('filterCount').textContent = bits.length ? bits.join(' ') : '全部';
    $('cardCount').textContent = '共 ' + filtered.length + ' 张 · 第 ' + (state.page + 1) + ' / ' + pages + ' 页';
  }

  function openViewer(it) {
    $('viewerImg').src = it.img;
    $('viewerCap').textContent = it.name + ' · ' + it.stage + ' · ' + it.element + '系';
    $('cardViewer').classList.remove('hidden');
  }

  function render() {
    renderChips();
    renderGrid();
  }

  function init() {
    $('cardSearch').addEventListener('input', function (e) {
      state.q = e.target.value.trim();
      state.page = 0;
      renderGrid();
    });
    var fc = $('favChip');
    if (fc) {
      fc.addEventListener('click', function () {
        state.favOnly = !state.favOnly;
        state.page = 0;
        render();
      });
    }
    $('cardFilterBtn').addEventListener('click', function () {
      $('filterPanel').classList.toggle('hidden');
    });
    $('viewerClose').addEventListener('click', function () {
      $('cardViewer').classList.add('hidden');
    });
    $('cardViewer').addEventListener('click', function (e) {
      if (e.target.id === 'cardViewer') $('cardViewer').classList.add('hidden');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') $('cardViewer').classList.add('hidden');
    });

    load().then(function (items) {
      state.list = items;
      render();
    }).catch(function () {
      $('cardCount').textContent = '加载失败，请刷新重试';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
