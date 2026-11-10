/* 卡册：单屏 3×3 卡槽、搜索、筛选、收藏 */
(function () {
  var PAGE_SIZE = 9;
  var STAGES = ['一阶', '二阶', '三阶'];
  var ELEMENTS = ['钢', '草', '水', '火', '土', '风', '雷', '冰', '光', '暗'];
  var RARITIES = ['普通', '优秀', '稀有', '传说'];
  var POWER_BANDS = [
    { t: '全部', v: null },
    { t: '<1400', v: [0, 1400] },
    { t: '1400-1700', v: [1400, 1700] },
    { t: '1700-1850', v: [1700, 1850] },
    { t: '1850+', v: [1850, 99999] }
  ];
  var FAV_KEY = 'cardAlbum:favs';

  var state = {
    list: [],
    page: 0,
    q: '',
    stages: new Set(),
    elems: new Set(),
    rarities: new Set(),
    powerBand: null,
    favOnly: false,
    sort: 'idx',
    book: 'normal'      // normal | ur
  };

  function $(id) { return document.getElementById(id); }
  function pad2(n) { return ('0' + n).slice(-2); }

  function loadFavs() {
    try {
      var raw = localStorage.getItem(FAV_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr : []);
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

  var CARD_COLORS = {"01":"#bf6559","02":"#d57a61","03":"#dc8e7f","04":"#68a9cd","05":"#5682ac","06":"#7bb3c6","07":"#90b575","08":"#91b47c","09":"#71a868","10":"#509f5f","11":"#6cb671","12":"#a7cf90","13":"#99b79a","14":"#b4cca6","15":"#abc3a6","16":"#bad1e3","17":"#9bc1d3","18":"#78a6cc","19":"#b2a690","20":"#a8978c","21":"#b3a8a1","22":"#497445","23":"#446740","24":"#46683a","25":"#c4c5c2","26":"#b9b6af","27":"#c2ada3","28":"#514567","29":"#a8a1b0","30":"#36294b","31":"#d5d9d3","32":"#b2bcc0","33":"#c8d3d3","34":"#614e74","35":"#a6a29b","36":"#c9c9c1","37":"#68a267","38":"#74af68","39":"#7eb270","40":"#608398","41":"#5d85a0","42":"#5283a1","43":"#3a5d89","44":"#426787","45":"#507186","46":"#7692a9","47":"#5c7789","48":"#6b7c94","49":"#6893b4","50":"#b2c7d8","51":"#5581ae","52":"#9f7b63","53":"#6590ad","54":"#927562","55":"#664441","56":"#ceaea7","57":"#5b3431","58":"#9db9d1","59":"#5584a2","60":"#6185ac","61":"#486d4b","62":"#9a908c","63":"#b7a8a9","64":"#4f6b82","65":"#cdc8b7","66":"#beb09f","67":"#b4a388","68":"#455b82","69":"#d2c9c1","70":"#445577","71":"#d3c2c1","72":"#45697e","73":"#bcc1c8","74":"#456e8e","75":"#b99da2","76":"#c6a1a8","77":"#875c8d"};
  var cardColors = CARD_COLORS;

  function load() {
    return fetch('/data/content.json', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var favs = loadFavs();
        return d.creatures.map(function (c, i) {
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
            fav: favs.has(i + 1)
          };
        });
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

  function chipRow(host, items, isOn, onToggle, extraCls) {
    host.innerHTML = '';
    items.forEach(function (item) {
      var label = typeof item === 'string' ? item : item.t;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (extraCls ? ' ' + extraCls + label : '') + (isOn(item) ? ' on' : '');
      b.textContent = label;
      b.addEventListener('click', function () { onToggle(item); });
      host.appendChild(b);
    });
  }

  function renderChips() {
    chipRow($('stageChips'), STAGES,
      function (s) { return state.stages.has(s); },
      function (s) {
        if (state.stages.has(s)) state.stages.delete(s); else state.stages.add(s);
        state.page = 0; render();
      });

    chipRow($('elemChips'), ELEMENTS,
      function (s) { return state.elems.has(s); },
      function (s) {
        if (state.elems.has(s)) state.elems.delete(s); else state.elems.add(s);
        state.page = 0; render();
      });

    chipRow($('rarityChips'), RARITIES,
      function (s) { return state.rarities.has(s); },
      function (s) {
        if (state.rarities.has(s)) state.rarities.delete(s); else state.rarities.add(s);
        state.page = 0; render();
      }, 'r-');

    var pc = $('powerChips');
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

  function renderFavTag() {
    var n = 0;
    state.list.forEach(function (it) { if (it.fav) n++; });
    var tag = $('favTag');
    tag.textContent = (state.favOnly ? '★' : '☆') + ' 收藏 ' + n;
    tag.classList.toggle('on', state.favOnly);
  }

  function renderGrid() {
    var grid = $('cardGrid');
    var filtered = state.list.filter(match);
    if (state.sort === 'power') {
      filtered = filtered.slice().sort(function (a, b) { return b.power - a.power; });
    }
    var pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (state.page >= pages) state.page = pages - 1;
    if (state.page < 0) state.page = 0;

    var slice = filtered.slice(state.page * PAGE_SIZE, state.page * PAGE_SIZE + PAGE_SIZE);
    grid.innerHTML = '';

    for (var i = 0; i < PAGE_SIZE; i++) {
      var it = slice[i];
      var slot = document.createElement('div');
      slot.className = 'slot' + (it ? '' : ' empty-slot');
      if (!it) {
        slot.innerHTML = '<div class="frame"></div><span class="slot-no">空卡槽 ' + (i + 1) + '</span>';
        grid.appendChild(slot);
        continue;
      }
      slot.title = it.name;
      var urMode = state.book === 'ur';
      var src = urMode ? ('/media/cards-ur/' + pad2(it.idx) + '.webp') : it.img;
      slot.className = 'slot' + (urMode ? ' ur' : '');
      if (urMode) slot.style.setProperty('--slot-bg', '#3a2c18');
      else slot.style.setProperty('--slot-bg', cardColors[pad2(it.idx)] || '#cfc2ad');
      slot.innerHTML =
        '<div class="frame"><img src="' + src + '" alt="' + it.name + '" loading="lazy"></div>' +
        '<span class="slot-no">卡槽 ' + (i + 1) + ' · ' + it.stage + ' · ' + it.element + '</span>' +
        '<span class="rar r-' + (urMode ? '传说' : it.rarity) + '">' + (urMode ? 'UR' : it.rarity) + '</span>' +
        '<span class="pw">战力 ' + it.power + '</span>' +
        '<button class="fav' + (it.fav ? ' on' : '') + '" type="button" title="收藏">' + (it.fav ? '★' : '☆') + '</button>';

      slot.addEventListener('click', function (item) {
        return function (e) {
          if (e.target.closest('.fav')) return;
          openViewer(item);
        };
      }(it));

      (function (item) {
        var fb = slot.querySelector('.fav');
        fb.addEventListener('click', function (e) {
          e.stopPropagation();
          item.fav = toggleFav(item.idx);
          fb.classList.toggle('on', item.fav);
          fb.textContent = item.fav ? '★' : '☆';
          renderFavTag();
          if (state.favOnly) renderGrid();
        });
      })(it);

      grid.appendChild(slot);
    }

    $('cardEmpty').classList.toggle('hidden', filtered.length > 0);
    $('cardGrid').style.display = filtered.length ? '' : 'none';

    var pager = $('cardPager');
    pager.innerHTML = '';
    if (pages > 1) {
      var prev = document.createElement('button');
      prev.type = 'button';
      prev.textContent = '‹ 上一页';
      prev.disabled = state.page <= 0;
      prev.addEventListener('click', function () { goPage(state.page - 1); });
      var next = document.createElement('button');
      next.type = 'button';
      next.textContent = '下一页 ›';
      next.disabled = state.page >= pages - 1;
      next.addEventListener('click', function () { goPage(state.page + 1); });
      var label = document.createElement('b');
      label.textContent = (state.page + 1) + ' / ' + pages;
      pager.appendChild(prev);
      pager.appendChild(label);
      pager.appendChild(next);
    }
    pager.style.display = pages > 1 ? '' : 'none';
    var pv = $('prevPage'), nx = $('nextPage');
    if (pv) pv.disabled = state.page <= 0;
    if (nx) nx.disabled = state.page >= pages - 1;

    var bits = [];
    if (state.stages.size) bits.push(Array.from(state.stages).join('/'));
    if (state.elems.size) bits.push(Array.from(state.elems).join('/'));
    if (state.rarities.size) bits.push(Array.from(state.rarities).join('/'));
    if (state.powerBand) bits.push('战力 ' + state.powerBand[0] + '+');
    if (state.favOnly) bits.push('收藏');
    $('filterCount').textContent = bits.length ? bits.join(' ') : '全部';

    $('cardCount').textContent = '共 ' + filtered.length + ' 张 · 第 ' + (state.page + 1) + ' / ' + pages + ' 页';
    $('cardSortBtn').textContent = state.sort === 'power' ? '战力 ↓' : '编号 ↑';
  }

  function openViewer(it) {
    var urMode = state.book === 'ur';
    $('viewerImg').src = urMode ? ('/media/cards-ur/' + pad2(it.idx) + '.webp') : it.img;
    $('viewerCap').textContent = it.name + ' · ' + it.stage + ' · ' + it.element + '系 · 战力 ' + it.power +
      (state.book === 'ur' ? ' · UR' : ' · ' + it.rarity);
    $('cardViewer').classList.remove('hidden');
  }

  function goPage(target) {
    var grid = $('cardGrid');
    var dir = target > state.page ? 'flip-next' : 'flip-prev';
    state.page = target;
    renderGrid();
    if (grid) {
      grid.classList.remove('flip-next', 'flip-prev');
      void grid.offsetWidth;
      grid.classList.add(dir);
      setTimeout(function () { grid.classList.remove(dir); }, 440);
    }
  }

  function render() {
    renderChips();
    renderFavTag();
    renderGrid();
  }

  function init() {
    $('cardSearch').addEventListener('input', function (e) {
      state.q = e.target.value.trim();
      state.page = 0;
      renderGrid();
    });
    var bookTabs = $('bookTabs');
    if (bookTabs) {
      bookTabs.addEventListener('click', function (e) {
        var b = e.target.closest('.book-tab');
        if (!b) return;
        state.book = b.getAttribute('data-book');
        state.page = 0;
        [].slice.call(bookTabs.children).forEach(function (x) { x.classList.toggle('on', x === b); });
        renderGrid();
      });
    }

    $('cardFilterBtn').addEventListener('click', function () {
      $('filterPanel').classList.toggle('hidden');
    });
    $('cardSortBtn').addEventListener('click', function () {
      state.sort = state.sort === 'power' ? 'idx' : 'power';
      state.page = 0;
      render();
    });
    var pv = $('prevPage'), nx = $('nextPage');
    if (pv) pv.addEventListener('click', function () { if (state.page > 0) goPage(state.page - 1); });
    if (nx) nx.addEventListener('click', function () { goPage(state.page + 1); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft' && state.page > 0) goPage(state.page - 1);
      if (e.key === 'ArrowRight') goPage(state.page + 1);
    });
    var touchX = null;
    var book = document.querySelector('.book');
    if (book) {
      book.addEventListener('touchstart', function (e) { touchX = e.touches[0].clientX; }, { passive: true });
      book.addEventListener('touchend', function (e) {
        if (touchX === null) return;
        var dx = e.changedTouches[0].clientX - touchX;
        touchX = null;
        if (Math.abs(dx) < 45) return;
        if (dx < 0) goPage(state.page + 1);
        else if (state.page > 0) goPage(state.page - 1);
      }, { passive: true });
    }
    $('favTag').addEventListener('click', function () {
      state.favOnly = !state.favOnly;
      state.page = 0;
      render();
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
