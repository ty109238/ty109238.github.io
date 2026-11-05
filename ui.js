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
    雷: '/media/ui/elem-thunder.webp',
    暗: '/media/ui/elem-dark.webp'
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
      if (n.children.length > 2) continue;
      if (n.querySelector('img')) continue;
      if (n.classList.contains('sm-type')) continue;
      var raw = (n.textContent || '').trim();
      var t = raw.replace(/[^\u4e00-\u9fa5]/g, '');
      var m = reg.exec(t);
      if (!m) continue;
      // 去掉标签里原有的符号图标（emoji 或 svg）
      for (var ci = n.childNodes.length - 1; ci >= 0; ci--) {
        var ch = n.childNodes[ci];
        if (ch.nodeType === 1 && ch.tagName.toLowerCase() === 'svg') { ch.remove(); continue; }
        if (ch.nodeType === 3 && !/[\u4e00-\u9fa5]/.test(ch.textContent) && ch.textContent.trim()) {
          ch.textContent = ch.textContent.replace(/[^\s]/g, '');
        }
      }
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
      var descEl = a.querySelector('.creature-card-copy p');
      if (descEl && !a.getAttribute('data-desc')) a.setAttribute('data-desc', descEl.textContent.trim());
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
    if (!nav) return;

    var links = nav.querySelectorAll('a.nav-link');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      if (a.querySelector('img.ui-ico')) continue;
      if (a.getAttribute('href') !== '/') continue;
      var svg = a.querySelector('svg');
      var img = document.createElement('img');
      img.className = 'ui-ico';
      img.src = '/media/ui/fn-dex.webp';
      img.alt = '';
      img.setAttribute('aria-hidden', 'true');
      if (svg) svg.replaceWith(img); else a.insertBefore(img, a.firstChild);
    }

    var notice = document.createElement('button');
    notice.type = 'button';
    notice.className = 'nav-link nav-btn';
    notice.setAttribute('data-role', 'notice');
    notice.innerHTML = '<img class="ui-ico" src="/media/ui/fn-quest.webp" alt=""><span>公告</span>';
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
    fav.addEventListener('click', function () { location.href = '/favs.html'; });

    var gear = document.createElement('button');
    gear.type = 'button';
    gear.className = 'nav-link nav-btn';
    gear.setAttribute('data-role', 'settings');
    gear.innerHTML = '<img class="ui-ico" src="/media/ui/fn-settings.webp" alt=""><span>设置</span>';
    gear.addEventListener('click', openSettings);

    var search = document.createElement('button');
    search.type = 'button';
    search.className = 'nav-link nav-btn';
    search.setAttribute('data-role', 'search');
    search.innerHTML = '<img class="ui-ico" src="/media/ui/fn-explore.webp" alt=""><span>搜索</span>';
    search.addEventListener('click', function () { if (window.__dexOpenSearch) window.__dexOpenSearch(); });

    // 逐项补齐，React 重渲染后也能自动补回来
    if (!nav.querySelector('[data-role="notice"]')) nav.insertBefore(notice, nav.firstChild);
    if (!nav.querySelector('[data-role="search"]')) nav.insertBefore(search, notice.nextSibling);
    if (!nav.querySelector('[data-role="fav"]')) nav.appendChild(fav);
    if (!nav.querySelector('[data-role="settings"]')) nav.appendChild(gear);
  }

  /* ---------- 显示设置 ---------- */
  function openSettings() {
    var old = document.querySelector('.ui-sheet');
    if (old) { old.remove(); return; }

    var sheet = document.createElement('div');
    sheet.className = 'ui-sheet';
    var compact = document.documentElement.classList.contains('density-compact');
    var hideNotice = document.documentElement.classList.contains('hide-notice');
    var hideStudio = document.documentElement.classList.contains('hide-studio');
    var motion = !document.documentElement.classList.contains('no-motion');

    sheet.innerHTML =
      '<h4>显示设置</h4>' +
      '<label class="ui-row"><span>紧凑模式</span><input type="checkbox" data-k="compact"' + (compact ? ' checked' : '') + '></label>' +
      '<label class="ui-row"><span>界面动效</span><input type="checkbox" data-k="motion"' + (motion ? ' checked' : '') + '></label>' +
      '<label class="ui-row"><span>隐藏顶部公告</span><input type="checkbox" data-k="hideNotice"' + (hideNotice ? ' checked' : '') + '></label>' +
      '<label class="ui-row"><span>隐藏工作室介绍</span><input type="checkbox" data-k="hideStudio"' + (hideStudio ? ' checked' : '') + '></label>' +
      '<button class="ui-mini" data-k="clear">清空本地收藏与缓存</button>' +
      '<p class="ui-tip">设置只保存在当前浏览器</p>';

    document.body.appendChild(sheet);

    sheet.addEventListener('change', function (e) {
      var k = e.target.getAttribute('data-k');
      if (k === 'compact') document.documentElement.classList.toggle('density-compact', e.target.checked);
      if (k === 'motion') document.documentElement.classList.toggle('no-motion', !e.target.checked);
      if (k === 'hideNotice') document.documentElement.classList.toggle('hide-notice', e.target.checked);
      if (k === 'hideStudio') document.documentElement.classList.toggle('hide-studio', e.target.checked);
      try {
        localStorage.setItem('dex:ui', JSON.stringify({
          compact: document.documentElement.classList.contains('density-compact'),
          motion: !document.documentElement.classList.contains('no-motion'),
          hideNotice: document.documentElement.classList.contains('hide-notice'),
          hideStudio: document.documentElement.classList.contains('hide-studio')
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
      document.documentElement.classList.toggle('hide-notice', !!s.hideNotice);
      document.documentElement.classList.toggle('hide-studio', !!s.hideStudio);
    } catch (e) {}
  }

  /* ---------- 循环增强 ---------- */
  function fadeInImages() {
    document.querySelectorAll('.creature-art img, .portrait-frame img, .egg-frame img, .hero-portrait img').forEach(function (img) {
      if (img.getAttribute('data-fade') === '1') return;
      img.setAttribute('data-fade', '1');
      if (img.complete && img.naturalWidth) { img.classList.add('img-ready'); return; }
      img.classList.add('img-loading');
      img.addEventListener('load', function () { img.classList.remove('img-loading'); img.classList.add('img-ready'); });
    });
  }

  function imageHints() {
    var hero = document.querySelectorAll('.hero-visual img, .hero-portrait img');
    for (var i = 0; i < hero.length; i++) {
      hero[i].setAttribute('fetchpriority', 'high');
      hero[i].setAttribute('decoding', 'sync');
    }
    var cards = document.querySelectorAll('a.creature-card img');
    for (var k = 0; k < cards.length; k++) {
      if (cards[k].getAttribute('data-hint') === '1') continue;
      cards[k].setAttribute('data-hint', '1');
      cards[k].setAttribute('decoding', 'async');
      if (k >= 12) {
        cards[k].setAttribute('loading', 'lazy');
      } else {
        cards[k].setAttribute('loading', 'eager');
        cards[k].setAttribute('fetchpriority', 'high');
      }
    }
  }

  function tick() {
    imageHints();
    fadeInImages();
    decorateChips();
    decorateCards();
    highlightWheel();
    headerIcons();
  }

  /* ---------- 快捷键 / 回到顶部 ---------- */
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (window.__dexOpenSearch) window.__dexOpenSearch();
    }
  });

  var topBtn = null;
  function syncTopBtn() {
    var y = window.scrollY || document.documentElement.scrollTop;
    if (y > 900) {
      if (!topBtn) {
        topBtn = document.createElement('button');
        topBtn.className = 'to-top';
        topBtn.type = 'button';
        topBtn.textContent = '↑';
        topBtn.title = '回到顶部';
        topBtn.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
        document.body.appendChild(topBtn);
      }
    } else if (topBtn) {
      topBtn.remove();
      topBtn = null;
    }
  }
  window.addEventListener('scroll', syncTopBtn, { passive: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { restoreSettings(); tick(); });
  } else {
    restoreSettings();
    tick();
  }
  setInterval(function () { tick(); syncTopBtn(); }, 1500);
  window.addEventListener('load', tick);
})();


/* ---------- PWA：安装 App + 新版提示 ---------- */
(function () {
  var deferred = null;

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function isAndroid() { return /Android/i.test(navigator.userAgent); }
  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  }

  function guide() {
    var box = document.createElement('div');
    box.className = 'pwa-guide';
    var steps = isIOS()
      ? ['点击底部的「分享」按钮（方框 + 向上箭头）', '在菜单里找到「添加到主屏幕」', '点右上角「添加」，桌面就会出现图标']
      : isAndroid()
        ? ['点击右上角「⋮」菜单', '选择「安装应用」或「添加到主屏幕」', '确认后桌面就会出现图标']
        : ['点击地址栏右侧的「安装」图标', '或按 Ctrl+Shift+A 打开安装', '确认后桌面就会出现图标'];
    box.innerHTML = '<div class="pwa-guide-card"><h3>把「奥灵宠图鉴」装到桌面</h3><ol>' +
      steps.map(function (x) { return '<li>' + x + '</li>'; }).join('') +
      '</ol><p class="pwa-guide-tip">装好后是独立窗口，断网也能看，我这里更新会自动同步。</p>' +
      '<button type="button" class="pwa-guide-ok">知道了</button></div>';
    document.body.appendChild(box);
    function close() { box.remove(); }
    box.addEventListener('click', function (e) {
      if (e.target === box || e.target.classList.contains('pwa-guide-ok')) close();
    });
  }

  function ensureBtn() {
    if (isStandalone()) return null;
    var exist = document.getElementById('pwaInstall');
    if (exist) return exist;
    var b = document.createElement('button');
    b.id = 'pwaInstall';
    b.type = 'button';
    b.className = 'pwa-install';
    b.innerHTML = '<span>⬇</span> 安装 App';
    b.addEventListener('click', async function () {
      if (deferred) {
        deferred.prompt();
        var res = await deferred.userChoice;
        if (res && res.outcome === 'accepted') { b.remove(); deferred = null; return; }
        deferred = null;
      }
      guide();
    });
    document.body.appendChild(b);
    return b;
  }

  setTimeout(function () { ensureBtn(); }, 1200);

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
    ensureBtn();
  });

  window.addEventListener('appinstalled', function () {
    var b = document.getElementById('pwaInstall');
    if (b) b.remove();
  });

  var refreshing = false;

  function toast(html, action) {
    var old = document.querySelector('.pwa-toast');
    if (old) old.remove();
    var t = document.createElement('div');
    t.className = 'pwa-toast';
    t.innerHTML = '<span>' + html + '</span>';
    if (action) {
      var a = document.createElement('button');
      a.type = 'button';
      a.textContent = action.text;
      a.addEventListener('click', action.fn);
      t.appendChild(a);
    }
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add('show'); }, 30);
    return t;
  }

  function askUpdate(reg) {
    if (refreshing) return;
    if (Date.now() - Number(localStorage.getItem('dex:swRefreshedAt') || 0) < 10 * 60 * 1000) return;
    if (document.querySelector('.pwa-toast')) return;
    var t = toast('发现新版本', {
      text: '立即刷新',
      fn: function () {
        refreshing = true;
        localStorage.setItem('dex:swRefreshedAt', String(Date.now()));
        if (t && t.parentNode) t.remove();
        var w = reg.waiting;
        if (w) {
          w.postMessage({ type: 'SKIP_WAITING' });
          setTimeout(function () { location.reload(); }, 400);
        } else {
          location.reload();
        }
      }
    });
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then(function (reg) {
      // 只提示「等待中」的更新，避免刚装完就弹
      if (reg.waiting && navigator.serviceWorker.controller) askUpdate(reg);
      setInterval(function () { reg.update(); }, 5 * 60 * 1000);
      reg.addEventListener('updatefound', function () {
        var nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', function () {
          if (nw.state === 'installed' && navigator.serviceWorker.controller && reg.waiting) {
            askUpdate(reg);
          }
        });
      });
    }).catch(function () {});
  }

  // 新 SW 接管后自动刷新一次（用户点了「立即刷新」的情况下）
  navigator.serviceWorker && navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (refreshing) location.reload();
  });

  // 独立窗口运行时隐藏安装按钮
  if (window.matchMedia('(display-mode: standalone)').matches) {
    var b = document.getElementById('pwaInstall');
    if (b) b.remove();
  }
})();
