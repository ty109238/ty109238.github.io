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

  /* ---------- 详情页：注入「蛋形态」/「同族伙伴」板块 ---------- */
  var EGG_NOTES = {
    '火系元素': '蛋壳上有一圈暗红纹路，摸上去是温的。放在篝火边，偶尔会发出细小的“噼啪”声。',
    '水系鲨': '蛋壳带着一层薄薄的水膜，摸起来凉而滑。靠近海浪时，里面的小家伙会轻轻顶着壳壁。',
    '草系蕉': '外壳像一片卷起来的嫩叶，闻起来有淡淡的青香蕉味。每天晒一会儿晨光，壳上的纹路会更清晰。',
    '草系绿翼': '蛋壳薄得能透出一点绿光，贴着耳朵能听到很轻的哼唱，像远处有人在唱歌。',
    '草系节奏猿': '敲一下会回响一记短促的鼓点，连敲三下它就会跟着打拍子，越敲越起劲。',
    '冰系雪人': '整枚蛋裹着一层薄冰，掌心放一会儿也不会化。不能靠近火堆，否则壳面会起水珠。',
    '土系咖啡蚁': '蛋壳是温热的砂土色，有股淡淡的咖啡香。埋在干燥细砂里最让它安心。',
    '草系蜜瓶': '蛋壳像一只倒扣的小木瓶，摇一摇没有声音，只有一点点黏稠的流动感。',
    '钢系熔炉': '外壳是冷硬的铁灰色，内里却持续传出微弱的暖意，夜里能听到金属膨胀的“咔哒”声。',
    '暗系胖豹': '蛋壳是暗紫近黑的颜色，只有在阴影里才会显出隐约的斑纹。放在明亮处它会一直不安地滚动。',
    '风系绅士鹅': '很轻，比同体积的蛋轻一半。放在窗边会被气流带着微微晃动，像随时要滚走。',
    '暗系岩甲': '壳面像一块黑曜石，敲上去声音很闷。需要放在阴凉、干燥的石板上，不能见强光。',
    '草系四叶喵': '壳上天然长着四片小叶纹，据说是好运的兆头。放在苔藓上，小叶会慢慢变绿。',
    '雷系旅行鸡': '蛋壳表面时不时窜过一道细小的静电，靠近会让人觉得指尖发麻。',
    '雷系甲虫': '壳面覆着一层硬甲纹，敲一下会有一声清脆的回响，像敲在金属上。',
    '水系洋流王子': '蛋壳内侧有水流流动的声音。需要放在浅水中，水位刚好没过一半。',
    '冰系快快': '壳面结着细小的霜花，温度很低。放在雪里它会自己往雪堆深处钻。',
    '风系慢慢': '整枚蛋会随着风向极缓慢地转动，转速慢到要盯着看很久才看得出来。',
    '冰系噗噗': '蛋壳上有一层冰晶羽纹，轻轻一碰会落下一点点冰粉，很快就会重新长出来。',
    '钢系咻咻': '壳面像上了漆的金属，能映出模糊的影子。里面偶尔传出极轻的齿轮转动声。',
    '水系露露': '整枚蛋是半透明的蓝色，能隐约看到里面有个小小的影子在缓慢地呼吸。',
    '土系墩墩': '沉得惊人，一只手几乎拿不动。壳面粗糙像岩石，摸久了手掌会留下砂土的痕迹。',
    '熔火游鱼族': '蛋壳像一枚被温泉水泡久了的鹅卵石，放进水里它会自己慢慢浮起来。',
    '霜华花族': '蛋壳外面裹着一层薄冰，里面却封着一朵没开的小花，温度一高花瓣就会缩回去。',
    '熔流甲壳族': '壳面一半凉一半烫，摸起来像刚从热水里捞出来的石头，外壳上还带着细小的气泡纹。',
    '矿脉蜥族': '蛋壳混着细砂和碎矿，偶尔能看到一点金绿色的反光，掂起来比看上去重得多。',
    '齿轮工坊族': '外壳是圆滚滚的金属罐，上弦之后会自己“叮叮”地转两圈，然后安静下来。',
    '浮空蟹族': '很轻，蛋壳里像装了一小团空气。放在水面上它不会沉，会跟着水波慢慢漂。'
  };

  function currentCreatureId() {
    var m = /\/creature\/(\d+)/.exec(location.pathname);
    return m ? Number(m[1]) : null;
  }

  function buildEggSection(c) {
    var imgPath = c.eggKey ? (DATA.images[c.eggKey] || '') : '';
    var frame = imgPath
      ? '<div class="egg-frame"><img src="' + imgPath + '" alt="' + c.name + ' 蛋形态" loading="lazy"></div>'
      : '<div class="egg-frame"><div class="egg-empty">待补充配图<br>（在编辑台「蛋形态」处上传）</div></div>';
    var note = c.eggNote || EGG_NOTES[c.family] || '孵化前它只是一枚安静的蛋，外壳上已经能看出这一族的纹路。';
    var chips = [];
    if (c.family) chips.push('家族 · ' + c.family);
    if (c.element) chips.push('属性 · ' + c.element);
    if (c.hatchCondition) chips.push('孵化条件见下方');

    var sec = document.createElement('section');
    sec.className = 'egg-section element-' + (c.element || '普通');
    sec.setAttribute('data-egg-for', String(c.id));
    sec.innerHTML =
      '<div class="record-heading"><div><p>EGG FORM</p><h2>蛋形态</h2></div><span>孵化之前的样子</span></div>' +
      '<div class="egg-card">' + frame +
      '<div class="egg-body"><h3>' + c.name + ' · 蛋</h3><p>' + note + '</p>' +
      '<div class="egg-meta">' + chips.map(function (t) { return '<span>' + t + '</span>'; }).join('') + '</div>' +
      '<a class="egg-manual" href="/eggs.html">查看全部蛋形态 →</a>' +
      '</div></div>';
    return sec;
  }

  function buildFamilySection(c) {
    var sibs = [];
    for (var i = 0; i < DATA.creatures.length; i++) {
      var x = DATA.creatures[i];
      if (x.family === c.family && x.id !== c.id) sibs.push(x);
    }
    if (!sibs.length) return null;
    sibs.sort(function (a, b) { return a.dexNo - b.dexNo; });

    var sec = document.createElement('section');
    sec.className = 'family-section';
    sec.setAttribute('data-family-for', String(c.id));

    var html = '<div class="record-heading"><div><p>FAMILY</p><h2>同族伙伴</h2></div>' +
      '<span>' + c.family + ' · 共 ' + (sibs.length + 1) + ' 只</span></div>' +
      '<div class="family-strip">';
    for (var k = 0; k < sibs.length; k++) {
      var s = sibs[k];
      var src = s.imageKey ? (DATA.images[s.imageKey] || '') : '';
      html += '<a class="family-card" href="/creature/' + s.id + '">' +
        (src ? '<img src="' + src + '" alt="' + s.name + '" loading="lazy">' : '') +
        '<b>' + s.name + '</b><small>No.' + String(s.dexNo).padStart(3, '0') + ' · ' + s.stage + '</small></a>';
    }
    html += '</div>';
    sec.innerHTML = html;
    return sec;
  }

  /* ---------- 详情页：关键数据 / 博士批注 / 属性克制折叠 ---------- */
  function decorateDetail(c) {
    var copy = document.querySelector('.detail-copy');
    if (!copy || copy.getAttribute('data-deco') === String(c.id)) return;
    copy.setAttribute('data-deco', String(c.id));

    var oldStats = copy.querySelector('.key-stats');
    if (oldStats) oldStats.remove();
    var total = (c.hp || 0) + (c.attack || 0) + (c.defense || 0) + (c.spAttack || 0) + (c.spDefense || 0) + (c.speed || 0);
    var stats = document.createElement('div');
    stats.className = 'key-stats';
    stats.innerHTML =
      '<div class="key-stat"><b>' + total + '</b><span>种族值总和</span></div>' +
      '<div class="key-stat"><b>' + (c.arenaRate || 0) + '%</b><span>竞技场出现率</span></div>' +
      '<div class="key-stat"><b>' + (c.exploreRate || 0) + '%</b><span>探索出现率</span></div>';
    var tags = copy.querySelector('.detail-tags');
    var h1 = copy.querySelector('h1');
    var anchorEl = h1 ? (h1.nextElementSibling || h1) : null;
    if (anchorEl && anchorEl.nextSibling) copy.insertBefore(stats, anchorEl.nextSibling);
    else if (tags && tags.parentElement === copy && tags.nextSibling) copy.insertBefore(stats, tags.nextSibling);
    else copy.appendChild(stats);

    var oldNote = copy.querySelector('.prof-note');
    if (oldNote) oldNote.remove();
    if (c.note) {
      var ps = copy.querySelectorAll('p');
      var desc = null;
      for (var i = 0; i < ps.length; i++) {
        if ((ps[i].textContent || '').length > 20) { desc = ps[i]; break; }
      }
      var note = document.createElement('p');
      note.className = 'prof-note';
      note.innerHTML = '<span>博士批注</span>' + c.note;
      if (desc && desc.nextSibling) copy.insertBefore(note, desc.nextSibling);
      else copy.appendChild(note);
    }
  }

  function makeCollapsible() {
    var sec = document.querySelector('.element-section');
    if (!sec || sec.getAttribute('data-collapsed') === '1') return;
    var head = sec.querySelector('.record-heading');
    if (!head) return;
    sec.setAttribute('data-collapsed', '1');

    var body = document.createElement('div');
    body.className = 'collapse-body is-hidden';
    var kids = [].slice.call(sec.children);
    for (var i = 0; i < kids.length; i++) {
      if (kids[i] !== head) body.appendChild(kids[i]);
    }

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'collapse-toggle';
    btn.textContent = '展开克制关系';
    btn.addEventListener('click', function () {
      var hidden = body.classList.toggle('is-hidden');
      btn.textContent = hidden ? '展开克制关系' : '收起克制关系';
    });
    head.appendChild(btn);
    sec.appendChild(body);
  }

  function syncEggSection() {
    if (!DATA) return;
    var id = currentCreatureId();
    var existing = document.querySelector('.egg-section');
    var famExisting = document.querySelector('.family-section');
    if (!id) {
      if (existing) existing.remove();
      if (famExisting) famExisting.remove();
      return;
    }
    var c = null;
    for (var i = 0; i < DATA.creatures.length; i++) if (DATA.creatures[i].id === id) { c = DATA.creatures[i]; break; }
    if (!c) {
      if (existing) existing.remove();
      if (famExisting) famExisting.remove();
      return;
    }
    if (existing && existing.getAttribute('data-egg-for') === String(c.id)) return;

    decorateDetail(c);
    makeCollapsible();

    var anchor = document.querySelector('.portrait-section');
    if (!anchor) return;
    if (existing) existing.remove();
    document.querySelectorAll('.family-section').forEach(function (n) { n.remove(); });
    anchor.parentElement.insertBefore(buildEggSection(c), anchor);

    var last = document.querySelector('.element-section');
    var holder = last ? last.parentElement : anchor.parentElement;
    var after = last || anchor;
    [buildFamilySection(c), buildRegionSection(c)].forEach(function (node) {
      if (!node) return;
      if (after && after.nextSibling) holder.insertBefore(node, after.nextSibling);
      else holder.appendChild(node);
      after = node;
    });
  }

  /* ---------- 首页：按家族分组视图 ---------- */
  function buildGroupedView() {
    var byFam = {};
    DATA.creatures.forEach(function (c) {
      var k = c.family || '未分组';
      if (!byFam[k]) byFam[k] = [];
      byFam[k].push(c);
    });
    var names = Object.keys(byFam).sort(function (a, b) {
      return Math.min.apply(null, byFam[a].map(function (x) { return x.dexNo; })) -
        Math.min.apply(null, byFam[b].map(function (x) { return x.dexNo; }));
    });
    var wrap = document.createElement('div');
    wrap.className = 'family-view';
    var html = '';
    names.forEach(function (fam) {
      var list = byFam[fam].sort(function (a, b) { return a.dexNo - b.dexNo; });
      var intro = (DATA.familyNotes && DATA.familyNotes[fam]) || '';
      html += '<section class="fgroup"><div class="fgroup-head"><h3>' + fam + '</h3><span>' +
        list.length + ' 只 · ' + list.map(function (x) { return x.stage; }).join(' / ') + '</span></div>' +
        (intro ? '<p class="fgroup-intro">' + intro + '</p>' : '') +
        '<div class="fgroup-cards">';
      list.forEach(function (x) {
        var src = x.imageKey ? (DATA.images[x.imageKey] || '') : '';
        html += '<a class="gcard" href="/creature/' + x.id + '">' +
          (src ? '<img src="' + src + '" alt="' + x.name + '" loading="lazy">' : '') +
          '<b>' + x.name + '</b><small>No.' + String(x.dexNo).padStart(3, '0') + ' · ' + x.stage + '</small></a>';
      });
      html += '</div></section>';
    });
    wrap.innerHTML = html;
    return wrap;
  }

  function syncHome() {
    if (!DATA) return;
    var grid = document.querySelector('.creature-grid');
    if (!grid) return;
    tagCatalog();
    buildCatalogTools();
    if (document.querySelector('.view-toggle')) { applyCatalog(); return; }

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'view-toggle';
    btn.textContent = '按家族查看';
    var host = grid.parentElement;
    var heading = document.querySelector('.section-heading');
    if (heading) heading.appendChild(btn);
    else host.insertBefore(btn, grid);

    var view = null;
    btn.addEventListener('click', function () {
      if (!view) { view = buildGroupedView(); host.appendChild(view); }
      var grouped = view.classList.toggle('is-on');
      grid.style.display = grouped ? 'none' : '';
      btn.textContent = grouped ? '返回平铺' : '按家族查看';
    });
  }

  /* ---------- 首页：排序 / 阶段筛选 ---------- */
  var catState = { stage: '全部', sort: 'default' };

  function tagCatalog() {
    var cards = document.querySelectorAll('a.creature-card');
    for (var i = 0; i < cards.length; i++) {
      var a = cards[i];
      if (a.getAttribute('data-tagged') === '1') continue;
      var m = /\/creature\/(\d+)/.exec(a.getAttribute('href') || '');
      if (!m) continue;
      var id = Number(m[1]);
      var c = null;
      for (var k = 0; k < DATA.creatures.length; k++) if (DATA.creatures[k].id === id) { c = DATA.creatures[k]; break; }
      if (!c) continue;
      a.setAttribute('data-tagged', '1');
      a.setAttribute('data-stage', c.stage || '');
      a.setAttribute('data-total', String((c.hp || 0) + (c.attack || 0) + (c.defense || 0) + (c.spAttack || 0) + (c.spDefense || 0) + (c.speed || 0)));
      a.setAttribute('data-dex', String(c.dexNo || 0));
    }
  }

  function applyCatalog() {
    var cards = [].slice.call(document.querySelectorAll('a.creature-card[data-tagged="1"]'));
    if (!cards.length) return;
    cards.forEach(function (a) {
      var show = catState.stage === '全部' || a.getAttribute('data-stage') === catState.stage;
      a.style.display = show ? '' : 'none';
      a.style.order = '';
    });
    var visible = cards.filter(function (a) { return a.style.display !== 'none'; });
    if (catState.sort === 'total') {
      visible.sort(function (x, y) { return Number(y.getAttribute('data-total')) - Number(x.getAttribute('data-total')); });
    } else if (catState.sort === 'dexdesc') {
      visible.sort(function (x, y) { return Number(y.getAttribute('data-dex')) - Number(x.getAttribute('data-dex')); });
    } else {
      return;
    }
    visible.forEach(function (a, i) { a.style.order = String(i); });
  }

  function buildCatalogTools() {
    var grid = document.querySelector('.creature-grid');
    if (!grid || document.querySelector('.catalog-tools')) return;

    var wrap = document.createElement('div');
    wrap.className = 'catalog-tools';

    var stageSel = document.createElement('select');
    ['全部', '一阶', '二阶', '三阶'].forEach(function (s) {
      var o = document.createElement('option');
      o.value = s;
      o.textContent = s === '全部' ? '全部阶段' : '只看' + s;
      stageSel.appendChild(o);
    });
    stageSel.addEventListener('change', function () { catState.stage = stageSel.value; applyCatalog(); });

    var sortSel = document.createElement('select');
    [['default', '默认排序'], ['total', '种族值高→低'], ['dexdesc', '编号倒序']].forEach(function (s) {
      var o = document.createElement('option');
      o.value = s[0];
      o.textContent = s[1];
      sortSel.appendChild(o);
    });
    sortSel.addEventListener('change', function () { catState.sort = sortSel.value; applyCatalog(); });

    wrap.appendChild(stageSel);
    wrap.appendChild(sortSel);
    var host = grid.parentElement;
    host.insertBefore(wrap, grid);
  }

  /* ---------- 详情页：这片区域还能遇到 ---------- */
  function buildRegionSection(c) {
    var region = String(c.captureLocation || '').split('·')[0].trim();
    if (!region) return null;
    var mates = [];
    for (var i = 0; i < DATA.creatures.length; i++) {
      var x = DATA.creatures[i];
      if (x.id === c.id) continue;
      if (String(x.captureLocation || '').indexOf(region) === 0) mates.push(x);
    }
    if (!mates.length) return null;
    mates.sort(function (a, b) { return a.dexNo - b.dexNo; });

    var sec = document.createElement('section');
    sec.className = 'family-section region-section';
    sec.setAttribute('data-region-for', String(c.id));
    var html = '<div class="record-heading"><div><p>HABITAT</p><h2>这片区域还能遇到</h2></div>' +
      '<span>' + region + ' · ' + mates.length + ' 只</span></div><div class="family-strip">';
    for (var k = 0; k < mates.length && k < 12; k++) {
      var s = mates[k];
      var src = s.imageKey ? (DATA.images[s.imageKey] || '') : '';
      var sub = String(s.captureLocation || '').split('·')[1] || '';
      html += '<a class="family-card" href="/creature/' + s.id + '">' +
        (src ? '<img src="' + src + '" alt="' + s.name + '" loading="lazy">' : '') +
        '<b>' + s.name + '</b><small>No.' + String(s.dexNo).padStart(3, '0') + ' · ' + sub + '</small></a>';
    }
    html += '</div>';
    sec.innerHTML = html;
    return sec;
  }

  /* ---------- 首页：最近更新 ---------- */
  function buildRecentSection() {
    var lp = DATA.lastPublished;
    if (!lp || !lp.ids || !lp.ids.length) return null;
    var ids = lp.ids;
    var list = DATA.creatures.filter(function (c) { return ids.indexOf(c.id) >= 0; });
    if (!list.length) return null;
    var day = String(lp.at || '').slice(0, 10);
    var sec = document.createElement('section');
    sec.className = 'recent-section';
    var html = '<div class="recent-head"><div><p>WHAT&#39;S NEW</p><h2>最近更新</h2></div>' +
      '<span>' + day + ' · ' + list.length + ' 只</span></div><div class="recent-strip">';
    list.slice(0, 10).forEach(function (c) {
      var src = c.imageKey ? (DATA.images[c.imageKey] || '') : '';
      html += '<a class="recent-card" href="/creature/' + c.id + '">' +
        (src ? '<img src="' + src + '" alt="' + c.name + '" loading="lazy">' : '') +
        '<b>' + c.name + '</b><small>No.' + String(c.dexNo).padStart(3, '0') + ' · ' + c.stage + '</small></a>';
    });
    html += '</div>';
    sec.innerHTML = html;
    return sec;
  }

  function syncRecent() {
    if (!DATA || document.querySelector('.recent-section')) return;
    var anchor = document.querySelector('.catalog-section');
    if (!anchor || !anchor.parentElement) return;
    var sec = buildRecentSection();
    if (sec) anchor.parentElement.insertBefore(sec, anchor);
  }

  function watchDetail() {
    var root = document.getElementById('root');
    if (!root) return;
    var timer = null;
    new MutationObserver(function () {
      clearTimeout(timer);
      timer = setTimeout(function () { syncEggSection(); syncHome(); syncRecent(); }, 120);
    }).observe(root, { childList: true, subtree: true });
    setInterval(function () { syncEggSection(); syncHome(); syncRecent(); }, 1200);
  }

  /* ---------- 离线支持 ---------- */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js?v=9', { scope: '/', updateViaCache: 'none' }).catch(function () {});
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
