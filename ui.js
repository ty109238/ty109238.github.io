/* 图鉴 UI 增强：属性图标 / 收藏 / 显示设置 / 公告跳转 */
(function () {
  'use strict';

  var ICONS = {
    火: '/media/ui/elem-fire.webp',
    水: '/media/ui/elem-water.webp',
    草: '/media/ui/elem-grass.webp',
    冰: '/media/ui/elem-ice.webp',
    土: '/media/ui/elem-rock.webp',
    钢: '/media/ui/elem-steel.webp',
    风: '/media/ui/elem-wind.webp',
    光: '/media/ui/elem-light.webp',
    暗: '/media/ui/elem-dark.webp',
    雷: 'data:image/svg+xml;utf8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M37 3 13 36h13l-3 25 24-34H34l3-24Z" fill="#f6c94a" stroke="#3a2a12" stroke-width="4.5" stroke-linejoin="round"/></svg>'
    )
  };

  function iconImg(el, cls) {
    var i = document.createElement('img');
    i.src = ICONS[el];
    i.alt = '';
    i.className = cls || 'elem-ico';
    i.setAttribute('aria-hidden', 'true');
    i.loading = 'lazy';
    return i;
  }

  /* ---------- 元素小图标 ---------- */
  function decorateChips(root) {
    var nodes = (root || document).querySelectorAll('span, button, strong, b');
    var reg = /^(火|水|草|冰|土|钢|风|光|暗|雷)系$/;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.getAttribute('data-elem-ico') === '1') continue;
      if (n.closest('svg')) continue;
      if (n.children.length > 1) continue;
      var t = (n.textContent || '').trim();
      var m = reg.exec(t);
      if (!m) continue;
      n.setAttribute('data-elem-ico', '1');
      n.insertBefore(iconImg(m[1]), n.firstChild);
      n.classList.add('has-ico');
    }
  }

  /* ---------- 属性克制轮盘：高亮当前属性 ---------- */
  function currentElement() {
    var spans = document.querySelectorAll('.detail-copy span, .detail-copy strong');
    var reg = /^(火|水|草|冰|土|钢|风|光|暗|雷)系$/;
    for (var i = 0; i < spans.length; i++) {
      var t = (spans[i].textContent || '').trim();
      if (reg.test(t) && !spans[i].querySelector('img')) return t.charAt(0);
    }
    return null;
  }

  function highlightWheel() {
    var svg = document.querySelector('.element-wheel-chart');
    if (!svg) return;
    var cur = currentElement();
    if (!cur) return;
    var gs = svg.querySelectorAll('g');
    for (var i = 0; i < gs.length; i++) {
      var g = gs[i];
      var t = (g.textContent || '').trim();
      g.classList.toggle('is-current', t === cur + '系');
    }
  }

  /* ---------- 收藏 ---------- */
  var FAV_KEY = 'dex:favs';
  function favs() {
    try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveFavs(list) {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(list)); } catch (e) {}
  }
  function toggleFav(id) {
    var list = favs();
    var i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1); else list.push(id);
    saveFavs(list);
    return i < 0;
  }

  var COLORS = { 火: '#f15a3c', 水: '#1570ef', 草: '#3e9c68', 冰: '#4aa8d8', 土: '#a97b3f', 钢: '#60778e', 风: '#3aa6a0', 光: '#d9a400', 暗: '#6c4a8e', 雷: '#e0a11b' };
  var PALE = { 火: '#ffd66b', 水: '#a9e5ff', 草: '#cdeaa8', 冰: '#cfeffb', 土: '#f0dcbe', 钢: '#dfe7ee', 风: '#c9eeea', 光: '#ffeeb0', 暗: '#e0d3f0', 雷: '#ffe9a8' };
  var SOFT = { 火: '#fff0e7', 水: '#e7f6ff', 草: '#eef9e9', 冰: '#e9f6fd', 土: '#fdf3e3', 钢: '#eef2f6', 风: '#e8f7f6', 光: '#fffaе0', 暗: '#f3ecfb', 雷: '#fff7dd' };

  function cardElement(a) {
    var meta = a.querySelector('.card-meta span');
    if (!meta) return null;
    var t = (meta.textContent || '').trim();
    var m = /^(火|水|草|冰|土|钢|风|光|暗|雷)/.exec(t);
    return m ? m[1] : null;
  }

  function decorateCards() {
    var cards = document.querySelectorAll('a.creature-card[href*="/creature/"]');
    var list = favs();
    for (var i = 0; i < cards.length; i++) {
      var a = cards[i];
      if (a.getAttribute('data-fav-btn') === '1') {
        a.classList.toggle('is-fav', list.indexOf(Number(a.getAttribute('href').split('/').pop())) >= 0);
        continue;
      }
      var id = Number(a.getAttribute('href').split('/').pop());
      a.setAttribute('data-fav-btn', '1');
      a.classList.toggle('is-fav', list.indexOf(id) >= 0);
      var el = cardElement(a);
      if (el) {
        a.style.setProperty('--element-color', COLORS[el] || '#1570ef');
        a.style.setProperty('--element-pale', PALE[el] || '#dcecf8');
        a.style.setProperty('--element-soft', SOFT[el] || '#f5faff');
      }
      var btn = document.createElement('span');
      btn.className = 'fav-btn';
      btn.setAttribute('role', 'button');
      btn.title = '收藏';
      btn.textContent = '★';
      btn.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var cid = Number(this.parentElement.getAttribute('href').split('/').pop());
        var on = toggleFav(cid);
        this.parentElement.classList.toggle('is-fav', on);
        if (document.body.classList.contains('show-favs')) applyFavFilter();
      });
      a.appendChild(btn);
    }
  }

  function applyFavFilter() {
    var on = document.body.classList.toggle('show-favs');
    var links = document.querySelectorAll('.site-nav .nav-link[data-role="fav"]');
    for (var i = 0; i < links.length; i++) links[i].classList.toggle('is-on', on);
    return on;
  }

  /* ---------- 顶部导航图标 ---------- */
  function headerIcons() {
    var nav = document.querySelector('.site-nav');
    if (!nav || nav.getAttribute('data-ui') === '1') return;
    nav.setAttribute('data-ui', '1');

    var links = nav.querySelectorAll('a.nav-link');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      if (a.querySelector('img.ui-ico')) continue;
      if (a.getAttribute('href') !== '/') continue;
      var svg = a.querySelector('svg');
      var img = document.createElement('img');
      img.className = 'ui-ico';
      img.src = '/media/ui/ui-dex.webp';
      img.alt = '';
      img.setAttribute('aria-hidden', 'true');
      if (svg) svg.replaceWith(img); else a.insertBefore(img, a.firstChild);
    }

    var notice = document.createElement('button');
    notice.type = 'button';
    notice.className = 'nav-link nav-btn';
    notice.setAttribute('data-role', 'notice');
    notice.innerHTML = '<img class="ui-ico" src="/media/ui/ui-notice.webp" alt=""><span>公告</span>';
    notice.addEventListener('click', function () {
      if (window.__dexOpenNotice) { window.__dexOpenNotice(); return; }
      var t = document.querySelector('.recent-section') || document.querySelector('.catalog-section');
      if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    var fav = document.createElement('button');
    fav.type = 'button';
    fav.className = 'nav-link nav-btn';
    fav.setAttribute('data-role', 'fav');
    fav.innerHTML = '<img class="ui-ico" src="/media/ui/ui-fav.webp" alt=""><span>收藏</span>';
    fav.addEventListener('click', function () { applyFavFilter(); });

    var gear = document.createElement('button');
    gear.type = 'button';
    gear.className = 'nav-link nav-btn';
    gear.setAttribute('data-role', 'settings');
    gear.innerHTML = '<img class="ui-ico" src="/media/ui/ui-settings.webp" alt=""><span>设置</span>';
    gear.addEventListener('click', openSettings);

    nav.insertBefore(notice, nav.firstChild);
    nav.appendChild(fav);
    nav.appendChild(gear);
  }

  /* ---------- 显示设置 ---------- */
  function openSettings() {
    var old = document.querySelector('.ui-sheet');
    if (old) { old.remove(); return; }

    var sheet = document.createElement('div');
    sheet.className = 'ui-sheet';
    var compact = document.documentElement.classList.contains('density-compact');
    var motion = !document.documentElement.classList.contains('no-motion');

    sheet.innerHTML =
      '<h4>显示设置</h4>' +
      '<label class="ui-row"><span>紧凑模式</span><input type="checkbox" data-k="compact"' + (compact ? ' checked' : '') + '></label>' +
      '<label class="ui-row"><span>界面动效</span><input type="checkbox" data-k="motion"' + (motion ? ' checked' : '') + '></label>' +
      '<button class="ui-mini" data-k="clear">清空本地收藏与缓存</button>' +
      '<p class="ui-tip">设置只保存在当前浏览器</p>';

    document.body.appendChild(sheet);

    sheet.addEventListener('change', function (e) {
      var k = e.target.getAttribute('data-k');
      if (k === 'compact') document.documentElement.classList.toggle('density-compact', e.target.checked);
      if (k === 'motion') document.documentElement.classList.toggle('no-motion', !e.target.checked);
      try {
        localStorage.setItem('dex:ui', JSON.stringify({
          compact: document.documentElement.classList.contains('density-compact'),
          motion: !document.documentElement.classList.contains('no-motion')
        }));
      } catch (err) {}
    });
    sheet.addEventListener('click', function (e) {
      if (e.target.getAttribute('data-k') === 'clear') {
        try { localStorage.removeItem(FAV_KEY); } catch (err) {}
        var cards = document.querySelectorAll('a.creature-card.is-fav');
        for (var i = 0; i < cards.length; i++) cards[i].classList.remove('is-fav');
        e.target.textContent = '已清空';
      }
      if (e.target === sheet) sheet.remove();
    });
  }

  function restoreSettings() {
    try {
      var s = JSON.parse(localStorage.getItem('dex:ui') || 'null');
      if (!s) return;
      document.documentElement.classList.toggle('density-compact', !!s.compact);
      document.documentElement.classList.toggle('no-motion', s.motion === false);
    } catch (e) {}
  }

  /* ---------- 循环增强 ---------- */
  function tick() {
    decorateChips();
    decorateCards();
    highlightWheel();
    headerIcons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { restoreSettings(); tick(); });
  } else {
    restoreSettings();
    tick();
  }
  setInterval(tick, 1500);
  window.addEventListener('load', tick);
})();
