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
  };

  function $(id) { return document.getElementById(id); }

  function pad2(n) { return ('0' + n).slice(-2); }

  function load() {
    return fetch('/data/content.json', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var items = d.creatures.map(function (c, i) {
          return {
            idx: i + 1,
            name: c.name,
            stage: c.stage,
            element: c.element,
            element2: c.element2 || '',
            img: '/media/cards/' + pad2(i + 1) + '.webp',
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
    return true;
  }

  function renderChips() {
    var sc = $('stageChips');
    var ec = $('elemChips');
    sc.innerHTML = '';
    ec.innerHTML = '';

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
        '<span class="tag">' + it.stage + ' · ' + it.element + '</span>';
      d.addEventListener('click', function () { openViewer(it); });
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
