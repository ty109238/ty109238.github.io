/* 奥灵宠图鉴 · 静态镜像运行时
 * 把原站的服务端接口（/api/trpc/*）在本机用 data/content.json 复现，
 * 使原站的前端代码可以原样运行，离线也完全可用。
 * 不改动原站任何界面与文案；只提供数据来源。
 */
(function () {
  'use strict';

  var CONTENT_URL = '/data/content.json';
  var DATA = null;
  var loading = null;
  var source = 'remote';

  /* ---------- 本地草稿（作者在编辑台里预览未发布的改动） ---------- */
  function readDraft() {
    try {
      if (localStorage.getItem('dex:preview') !== '1') return null;
      var raw = localStorage.getItem('dex:draft');
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }

  function load() {
    if (loading) return loading;
    loading = fetch(CONTENT_URL + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('content.json HTTP ' + r.status);
        return r.json();
      })
      .then(function (j) {
        var d = readDraft();
        if (!d) { DATA = j; source = 'remote'; return DATA; }
        DATA = d; source = 'draft';
        return applyLocalImages().then(function () { return DATA; });
      })
      .catch(function (err) {
        return caches.open('dex-shell-v1').then(function (c) {
          return c.match(CONTENT_URL);
        }).then(function (r) {
          if (!r) throw err;
          return r.json();
        }).then(function (j) {
          DATA = j; source = 'cache'; return DATA;
        });
      });
    return loading;
  }

  /* 作者在编辑台换过的图，尚未发布时直接用本机 IndexedDB 里的文件预览 */
  function applyLocalImages() {
    if (typeof indexedDB === 'undefined' || !indexedDB.databases) return Promise.resolve();
    return indexedDB.databases().then(function (list) {
      var has = list.some(function (d) { return d.name === 'dex-editor'; });
      if (!has) return;
      return new Promise(function (resolve) {
        var req = indexedDB.open('dex-editor', 1);
        req.onerror = function () { resolve(); };
        req.onsuccess = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains('files')) { resolve(); return; }
          var map = {};
          var cur = db.transaction('files', 'readonly').objectStore('files').openCursor();
          cur.onerror = function () { resolve(); };
          cur.onsuccess = function (e) {
            var c = e.target.result;
            if (!c) {
              Object.keys(DATA.images).forEach(function (key) {
                var hit = map[DATA.images[key]];
                if (hit) DATA.images[key] = hit;
              });
              resolve();
              return;
            }
            try { map[c.key] = URL.createObjectURL(c.value); } catch (err) {}
            c.continue();
          };
        };
      });
    });
  }

  /* ---------- 与原站一致的数据整形 ---------- */
  function sortItems(a, b) { return a.dexNo - b.dexNo; }

  function listPayload(input) {
    var f = input || {};
    var items = DATA.creatures.slice().sort(sortItems);
    if (f.element && f.element !== '全部') items = items.filter(function (c) { return c.element === f.element; });
    if (f.stage && f.stage !== '全部') items = items.filter(function (c) { return c.stage === f.stage; });
    if (f.form && f.form !== '全部') items = items.filter(function (c) { return c.form === f.form; });
    if (f.search && String(f.search).trim()) {
      var q = String(f.search).trim().toLowerCase();
      items = items.filter(function (c) { return String(c.name || '').toLowerCase().indexOf(q) >= 0; });
    }
    return { items: items, imageUrls: DATA.images };
  }

  function creatureById(id) {
    for (var i = 0; i < DATA.creatures.length; i++) if (DATA.creatures[i].id === id) return DATA.creatures[i];
    return null;
  }

  function detailPayload(id) {
    var c = creatureById(id);
    if (!c) return null;
    var skills = (DATA.skills[id] || []).map(function (s, i) {
      return { id: 900000 + id * 10 + i, creatureId: id, slot: s.slot, name: s.name, pp: s.pp, description: s.description };
    });
    var traits = (DATA.traits[id] || []).map(function (t, i) {
      return { id: 800000 + id * 10 + i, family: t.family || c.family, slot: t.slot, name: t.name, description: t.description };
    });
    var evolution = (DATA.evolution[id] || []).map(creatureById).filter(Boolean);
    return { creature: c, skills: skills, evolution: evolution, traits: traits, imageUrls: DATA.images };
  }

  /* ---------- tRPC 应答 ---------- */
  var UNAUTH = {
    error: {
      json: {
        message: 'Authentication required',
        code: -32001,
        data: { code: 'UNAUTHORIZED', httpStatus: 401, path: 'auth.me' }
      }
    }
  };

  function bodyFor(name, input) {
    if (name === 'auth.me') return { body: UNAUTH, status: 401 };
    if (name === 'creature.list') return { body: { result: { data: { json: listPayload(input) } } }, status: 200 };
    if (name === 'creature.detail') {
      var p = detailPayload(Number(input.id));
      if (!p) return { body: { error: { json: { message: 'Not found', code: -32004, data: { httpStatus: 404, path: name } } } }, status: 404 };
      return { body: { result: { data: { json: p } } }, status: 200 };
    }
    return {
      body: { error: { json: { message: '只读镜像：' + name + ' 未开放', code: -32001, data: { httpStatus: 401, path: name } } } },
      status: 401
    };
  }

  function safeJSON(s) { try { return JSON.parse(s); } catch (e) { return null; } }

  function normaliseInputs(raw, n) {
    if (!raw) { var a = []; for (var k = 0; k < n; k++) a.push({}); return a; }
    if (Object.prototype.hasOwnProperty.call(raw, 'json')) { var b = []; for (var m = 0; m < n; m++) b.push(raw); return b; }
    var out = [];
    for (var i = 0; i < n; i++) out.push(raw[String(i)] || {});
    return out;
  }

  function respond(paths, batch, rawInput) {
    return load().then(function () {
      var inputs = normaliseInputs(rawInput, paths.length);
      var results = paths.map(function (name, i) {
        var input = (inputs[i] && inputs[i].json) || {};
        return bodyFor(name, input);
      });
      if (batch) {
        return new Response(JSON.stringify(results.map(function (r) { return r.body; })), {
          status: 200,
          headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
        });
      }
      var only = results[0] || { body: {}, status: 200 };
      return new Response(JSON.stringify(only.body), {
        status: only.status,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
      });
    }).catch(function (err) {
      return new Response(JSON.stringify({
        error: { json: { message: '数据加载失败：' + err.message, code: -32603, data: { httpStatus: 500 } } }
      }), { status: 500, headers: { 'content-type': 'application/json' } });
    });
  }

  /* ---------- fetch 拦截 ---------- */
  var origFetch = window.fetch ? window.fetch.bind(window) : null;

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var idx = url.indexOf('/api/trpc/');
    if (idx >= 0) {
      var u = new URL(url, location.href);
      var paths = u.pathname.slice('/api/trpc/'.length).split(',').filter(Boolean);
      var batch = u.searchParams.get('batch') === '1';
      var raw = null;
      var qp = u.searchParams.get('input');
      if (qp) raw = safeJSON(qp);
      if (!raw && init && typeof init.body === 'string') raw = safeJSON(init.body);
      return respond(paths, batch, raw);
    }
    if (url.indexOf('/api/log') >= 0) {
      return Promise.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    }
    if (url.indexOf('/api/oauth') >= 0) {
      return Promise.resolve(new Response('{}', { status: 204 }));
    }
    if (origFetch) return origFetch(input, init);
    return Promise.reject(new Error('fetch unavailable'));
  };

  /* ---------- 供编辑台使用 ---------- */
  window.__DEX__ = {
    load: load,
    get data() { return DATA; },
    get source() { return source; },
    reload: function () {
      loading = null;
      localStorage.removeItem('dex:preview');
      return load();
    }
  };

  /* ---------- 详情页：注入「蛋形态」板块 ---------- */
  function currentCreatureId() {
    var m = /\/creature\/(\d+)/.exec(location.pathname);
    return m ? Number(m[1]) : null;
  }

  function buildEggSection(c) {
    var imgPath = c.eggKey ? (DATA.images[c.eggKey] || '') : '';
    var frame = imgPath
      ? '<div class="egg-frame"><img src="' + imgPath + '" alt="' + c.name + ' 蛋形态" loading="lazy"></div>'
      : '<div class="egg-frame"><div class="egg-empty">待补充配图<br>（在编辑台「蛋形态」处上传）</div></div>';
    var note = c.eggNote || '孵化前它只是一枚安静的蛋，外壳上已经能看出这一族的纹路。';
    var chips = [];
    if (c.family) chips.push('家族 · ' + c.family);
    if (c.element) chips.push('属性 · ' + c.element);
    if (c.hatchCondition) chips.push('孵化条件见下方');

    var sec = document.createElement('section');
    sec.className = 'egg-section';
    sec.setAttribute('data-egg-for', String(c.id));
    sec.innerHTML =
      '<div class="record-heading"><div><p>EGG FORM</p><h2>蛋形态</h2></div><span>孵化之前的样子</span></div>' +
      '<div class="egg-card">' + frame +
      '<div class="egg-body"><h3>' + c.name + ' · 蛋</h3><p>' + note + '</p>' +
      '<div class="egg-meta">' + chips.map(function (t) { return '<span>' + t + '</span>'; }).join('') + '</div>' +
      '</div></div>';
    return sec;
  }

  function syncEggSection() {
    if (!DATA) return;
    var id = currentCreatureId();
    var existing = document.querySelector('.egg-section');
    if (!id) { if (existing) existing.remove(); return; }
    var c = null;
    for (var i = 0; i < DATA.creatures.length; i++) if (DATA.creatures[i].id === id) { c = DATA.creatures[i]; break; }
    if (!c) { if (existing) existing.remove(); return; }
    if (existing && existing.getAttribute('data-egg-for') === String(c.id)) return;

    var anchor = document.querySelector('.portrait-section');
    if (!anchor) return;
    if (existing) existing.remove();
    anchor.parentElement.insertBefore(buildEggSection(c), anchor);
  }

  function watchDetail() {
    var root = document.getElementById('root');
    if (!root) return;
    var timer = null;
    new MutationObserver(function () {
      clearTimeout(timer);
      timer = setTimeout(syncEggSection, 120);
    }).observe(root, { childList: true, subtree: true });
    setInterval(syncEggSection, 1500);
  }

  /* ---------- 离线支持 ---------- */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js?v=4', { scope: '/', updateViaCache: 'none' }).catch(function () {});
    });
  }

  /* ---------- 有新内容时提示刷新 ---------- */
  function showUpdateBar() {
    if (document.getElementById('dex-update-bar')) return;
    var bar = document.createElement('div');
    bar.id = 'dex-update-bar';
    bar.textContent = '图鉴有新内容 · 点这里刷新';
    bar.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:28px', 'transform:translateX(-50%)',
      'z-index:2147483000', 'padding:12px 22px', 'border-radius:999px',
      'background:#262722', 'color:#fff', 'border:2px solid #e7bd55',
      'box-shadow:5px 5px 0 rgba(38,39,34,.35)',
      'font:700 15px/1 "Microsoft YaHei","PingFang SC",system-ui,sans-serif',
      'letter-spacing:.04em', 'cursor:pointer'
    ].join(';');
    bar.addEventListener('click', function () {
      try { localStorage.removeItem('dex:preview'); } catch (e) {}
      location.reload();
    });
    document.body.appendChild(bar);
  }

  function checkFresh() {
    if (!DATA || !DATA.updatedAt) return;
    if (document.hidden) return;
    fetch(CONTENT_URL + '?probe=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && j.updatedAt && j.updatedAt !== DATA.updatedAt) showUpdateBar();
      })
      .catch(function () {});
  }

  setTimeout(function () {
    checkFresh();
    setInterval(checkFresh, 60000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) checkFresh();
    });
  }, 3000);

  load().then(function () {
    watchDetail();
  });
})();
