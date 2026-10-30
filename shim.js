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
    var power = calcPower(total, loadTrain(c.id, c));
    var stats = document.createElement('div');
    stats.className = 'key-stats';
    stats.innerHTML =
      '<div class="key-stat key-power" data-k="power"><b>' + power.toLocaleString('en-US') + '</b><span>战斗力</span></div>' +
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

  /* 上一只 / 下一只 */
  function buildPetNav(c) {
    var list = DATA.creatures.slice().sort(function (a, b) { return a.dexNo - b.dexNo; });
    var idx = -1;
    for (var i = 0; i < list.length; i++) if (list[i].id === c.id) { idx = i; break; }
    if (idx < 0) return null;
    var prev = list[idx - 1];
    var next = list[idx + 1];
    var nav = document.createElement('nav');
    nav.className = 'pet-nav';
    nav.setAttribute('data-nav-for', String(c.id));
    nav.innerHTML =
      (prev ? '<a href="/creature/' + prev.id + '">← ' + prev.name + '</a>' : '<span class="off">已是第一只</span>') +
      (next ? '<a href="/creature/' + next.id + '">' + next.name + ' →</a>' : '<span class="off">已是最后一只</span>');
    return nav;
  }

  function syncPetNav(c) {
    var hero = document.querySelector('.detail-hero');
    if (!hero) return;
    var old = hero.querySelector('.pet-nav');
    if (old && old.getAttribute('data-nav-for') === String(c.id)) return;
    if (old) old.remove();
    var nav = buildPetNav(c);
    if (!nav) return;
    var back = hero.querySelector('.back-link');
    if (back && back.parentElement === hero) hero.insertBefore(nav, back.nextSibling);
    else hero.insertBefore(nav, hero.firstChild);
  }

  /* 把属性色变量注入技能区，让技能卡跟着属性上色 */
  function applyElementVars() {
    var src = document.querySelector('.portrait-section.element-') || document.querySelector('[class*="element-"]');
    if (!src) return;
    var cs = getComputedStyle(src);
    var targets = document.querySelectorAll('.skills-section, .traits-section, .stats-section');
    for (var i = 0; i < targets.length; i++) {
      targets[i].style.setProperty('--element-color', cs.getPropertyValue('--element-color'));
      targets[i].style.setProperty('--element-soft', cs.getPropertyValue('--element-soft'));
      targets[i].style.setProperty('--element-pale', cs.getPropertyValue('--element-pale'));
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
    applyElementVars();
    syncTrain(c);
    makeCollapsible();
    syncPetNav(c);

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
    ensureRankToggle();
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
    var fams = [];
    list.forEach(function (c) { if (c.family && fams.indexOf(c.family) < 0) fams.push(c.family); });
    var sec = document.createElement('section');
    sec.className = 'recent-section';
    var html = '<div class="recent-head"><div><p>WHAT&#39;S NEW</p><h2>最近更新</h2></div>' +
      '<span>' + day + ' · 共 ' + list.length + ' 只</span></div>' +
      '<p class="recent-desc">本次新增 ' + list.length + ' 只灵宠，来自 ' + fams.length + ' 个家族：' +
      fams.join('、') + '。左右拖动可以看完全部，点卡片直接进详情页。</p>' +
      '<div class="recent-strip">';
    list.forEach(function (c) {
      var src = c.imageKey ? (DATA.images[c.imageKey] || '') : '';
      html += '<a class="recent-card" href="/creature/' + c.id + '">' +
        '<span class="recent-new">NEW</span>' +
        (src ? '<img src="' + src + '" alt="' + c.name + '" loading="lazy">' : '') +
        '<b>' + c.name + '</b><small>No.' + String(c.dexNo).padStart(3, '0') + ' · ' + c.stage + '</small></a>';
    });
    html += '</div>';
    sec.innerHTML = html;
    return sec;
  }

  function syncRecent() {
    if (!DATA || document.querySelector('.recent-section')) return;
    if (currentCreatureId()) return; // 只在首页出现
    var anchor = document.querySelector('.catalog-section');
    if (!anchor || !anchor.parentElement) return;
    var sec = buildRecentSection();
    if (sec) anchor.parentElement.insertBefore(sec, anchor);
  }

  /* ---------- 详情页：养成模拟（天赋 / 等级 / 星级 / 阶段 → 战斗力） ---------- */
  var TALENTS = ['一无是处', '表现平平', '随处可见', '普普通通', '稍微稀有', '稀有', '百里挑一', '独一无二', '唯我独尊'];
  var TALENT_MULT = [0.80, 0.90, 1.00, 1.10, 1.22, 1.35, 1.50, 1.66, 1.85];
  var STAGE_DEFAULT = { '一阶': 1, '二阶': 2, '三阶': 3 };

  /* 性格：20 种 ±10% 数值型 + 4 种特殊型 */
  var STAT_LABEL = { attack: '攻击', defense: '防御', spAttack: '特攻', spDefense: '特防', speed: '速度' };
  var NATURES = [
    { n: '孤僻', up: 'attack', down: 'defense' },
    { n: '固执', up: 'attack', down: 'spAttack' },
    { n: '调皮', up: 'attack', down: 'spDefense' },
    { n: '勇敢', up: 'attack', down: 'speed' },
    { n: '大胆', up: 'defense', down: 'attack' },
    { n: '淘气', up: 'defense', down: 'spAttack' },
    { n: '无虑', up: 'defense', down: 'spDefense' },
    { n: '悠闲', up: 'defense', down: 'speed' },
    { n: '保守', up: 'spAttack', down: 'attack' },
    { n: '稳重', up: 'spAttack', down: 'defense' },
    { n: '马虎', up: 'spAttack', down: 'spDefense' },
    { n: '冷静', up: 'spAttack', down: 'speed' },
    { n: '温顺', up: 'spDefense', down: 'attack' },
    { n: '慎重', up: 'spDefense', down: 'spAttack' },
    { n: '沉着', up: 'spDefense', down: 'defense' },
    { n: '狂妄', up: 'spDefense', down: 'speed' },
    { n: '胆小', up: 'speed', down: 'attack' },
    { n: '急躁', up: 'speed', down: 'defense' },
    { n: '天真', up: 'speed', down: 'spDefense' },
    { n: '开朗', up: 'speed', down: 'spAttack' },
    { n: '害羞', special: '农场种植速度 +10%，远航速度 -10%' },
    { n: '认真', special: '远航速度 +10%，农场种植速度 -10%' },
    { n: '实干', special: '血量额外回复 +10%，受到直接伤害 +10%' },
    { n: '坦率', special: '平衡型，经验获取 +2%' }
  ];

  function findNature(name) {
    for (var i = 0; i < NATURES.length; i++) if (NATURES[i].n === name) return NATURES[i];
    return null;
  }

  function natureDesc(nature) {
    if (!nature) return '平衡';
    if (nature.special) return nature.special;
    return '+' + STAT_LABEL[nature.up] + ' 10% · -' + STAT_LABEL[nature.down] + ' 10%';
  }

  function statsTotal(c) {
    return (c.hp || 0) + (c.attack || 0) + (c.defense || 0) + (c.spAttack || 0) + (c.spDefense || 0) + (c.speed || 0);
  }

  function baseWithNature(c, natureName) {
    var base = statsTotal(c);
    var nat = findNature(natureName);
    if (!nat || !nat.up) return Math.round(base);
    return Math.round(base + (c[nat.up] || 0) * 0.1 - (c[nat.down] || 0) * 0.1);
  }

  /* 按种族值推荐两个性格：加最高项，减最低的两项 */
  function recommendNatures(c) {
    var keys = ['attack', 'defense', 'spAttack', 'spDefense', 'speed'];
    var sorted = keys.slice().sort(function (a, b) { return (c[b] || 0) - (c[a] || 0); });
    var best = sorted[0];
    var worst = sorted.slice(-2);
    var out = [];
    for (var i = 0; i < NATURES.length && out.length < 2; i++) {
      var nat = NATURES[i];
      if (nat.up === best && worst.indexOf(nat.down) >= 0) out.push(nat);
    }
    if (!out.length) {
      for (var j = 0; j < NATURES.length && out.length < 2; j++) {
        if (NATURES[j].up === best) out.push(NATURES[j]);
      }
    }
    return out;
  }

  function trainKey(id) { return 'dex:train:' + id; }

  function loadTrain(id, c) {
    var rec = recommendNatures(c);
    var o = c.official || null;
    var def = {
      level: o && o.level ? o.level : 1,
      talent: o && o.talent != null ? o.talent : 3,
      star: o && o.star ? o.star : 1,
      stage: o && o.stage ? o.stage : (STAGE_DEFAULT[c.stage] || 1),
      nature: (o && o.nature) || (rec.length ? rec[0].n : '坦率')
    };
    try {
      var s = JSON.parse(localStorage.getItem(trainKey(id)) || 'null');
      if (s) {
        return {
          level: s.level || def.level,
          talent: s.talent == null ? def.talent : s.talent,
          star: s.star || def.star,
          stage: s.stage || def.stage,
          nature: s.nature || def.nature
        };
      }
    } catch (e) {}
    return def;
  }

  function calcPower(base, st) {
    var lm = 1 + (st.level - 1) * 0.02;
    var tm = TALENT_MULT[st.talent] || 1;
    var sm = 1 + (st.star - 1) * 0.08;
    var gm = 1 + (st.stage - 1) * 0.15;
    return Math.round(base * lm * tm * sm * gm);
  }

  function buildTrainPanel(c) {
    var base = statsTotal(c);
    var st = loadTrain(c.id, c);
    var rec = recommendNatures(c);

    var sec = document.createElement('section');
    sec.className = 'train-section';
    sec.setAttribute('data-train-for', String(c.id));

    function row(key, label, min, max, val, suffix) {
      return '<div class="train-row">' +
        '<span class="train-label">' + label + '</span>' +
        '<input type="range" min="' + min + '" max="' + max + '" step="1" value="' + val + '" data-k="' + key + '">' +
        '<b class="train-val" data-v="' + key + '">' + val + (suffix || '') + '</b>' +
        '</div>';
    }

    var natureOpts = NATURES.map(function (x) {
      return '<option value="' + x.n + '"' + (x.n === st.nature ? ' selected' : '') + '>' + x.n + '（' + natureDesc(x) + '）</option>';
    }).join('');

    var recChips = rec.map(function (x) {
      return '<button type="button" class="nature-chip" data-nature="' + x.n + '">官方推荐 · ' + x.n + '</button>';
    }).join('');

    sec.innerHTML =
      '<div class="record-heading"><div><p>TRAINING</p><h2>养成模拟</h2></div><span>拖动调整 · 数据只保存在你的浏览器</span></div>' +
      '<div class="train-grid">' +
        '<div class="power-box">' +
          '<span class="power-cap">战斗力</span>' +
          '<b class="power-num">' + calcPower(baseWithNature(c, st.nature), st).toLocaleString('en-US') + '</b>' +
          '<span class="power-sub">种族值 ' + base + ' × 性格 × 等级 × 天赋 × 星级 × 阶段</span>' +
          '<button type="button" class="share-btn">生成战绩图</button>' +
        '</div>' +
        '<div class="train-controls">' +
          row('level', '等级', 1, 60, st.level, ' 级') +
          row('talent', '天赋', 0, 8, st.talent, '') +
          row('star', '星级', 1, 9, st.star, ' ★') +
          row('stage', '阶段', 1, 6, st.stage, ' 阶') +
          '<div class="train-row nature-row">' +
            '<span class="train-label">性格</span>' +
            '<select class="nature-sel" data-k="nature">' + natureOpts + '</select>' +
            '<b class="train-val" data-v="nature">' + st.nature + '</b>' +
          '</div>' +
          '<div class="nature-rec">' + recChips + '</div>' +
        '</div>' +
      '</div>';

    var talentVal = sec.querySelector('[data-v="talent"]');
    talentVal.textContent = TALENTS[st.talent];

    function refresh() {
      var lvl = Number(sec.querySelector('[data-k="level"]').value);
      var tal = Number(sec.querySelector('[data-k="talent"]').value);
      var star = Number(sec.querySelector('[data-k="star"]').value);
      var stage = Number(sec.querySelector('[data-k="stage"]').value);
      var nat = sec.querySelector('[data-k="nature"]').value;
      var p = { level: lvl, talent: tal, star: star, stage: stage, nature: nat };

      sec.querySelector('[data-v="level"]').textContent = lvl + ' 级';
      sec.querySelector('[data-v="talent"]').textContent = TALENTS[tal] + ' · ×' + TALENT_MULT[tal].toFixed(2);
      sec.querySelector('[data-v="star"]').textContent = star + ' ★';
      sec.querySelector('[data-v="stage"]').textContent = stage + ' 阶';
      sec.querySelector('[data-v="nature"]').textContent = nat;
      var nb = baseWithNature(c, nat);
      var pw = calcPower(nb, p);
      sec.querySelector('.power-num').textContent = pw.toLocaleString('en-US');
      sec.querySelector('.power-sub').textContent = '种族值 ' + base + ' → 性格修正 ' + nb + ' × 等级 × 天赋 × 星级 × 阶段';
      var topPower = document.querySelector('.key-stats [data-k="power"] b');
      if (topPower) topPower.textContent = pw.toLocaleString('en-US');

      try { localStorage.setItem(trainKey(c.id), JSON.stringify(p)); } catch (e) {}
    }

    sec.querySelectorAll('input[type="range"]').forEach(function (inp) {
      inp.addEventListener('input', refresh);
    });
    var natSel = sec.querySelector('[data-k="nature"]');
    if (natSel) natSel.addEventListener('change', refresh);
    sec.querySelectorAll('.nature-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        if (natSel) natSel.value = chip.getAttribute('data-nature');
        refresh();
      });
    });
    var shareBtn = sec.querySelector('.share-btn');
    if (shareBtn) {
      shareBtn.addEventListener('click', function () {
        var st2 = {
          level: Number(sec.querySelector('[data-k="level"]').value),
          talent: Number(sec.querySelector('[data-k="talent"]').value),
          star: Number(sec.querySelector('[data-k="star"]').value),
          stage: Number(sec.querySelector('[data-k="stage"]').value),
          nature: sec.querySelector('[data-k="nature"]').value
        };
        makeShareCard(c, st2, baseWithNature(c, st2.nature));
      });
    }
    refresh();

    return sec;
  }

  function syncTrain(c) {
    var old = document.querySelector('.train-section');
    if (old && old.getAttribute('data-train-for') === String(c.id)) return;
    if (old) old.remove();
    var anchor = document.querySelector('.stats-section');
    if (!anchor || !anchor.parentElement) return;
    anchor.parentElement.insertBefore(buildTrainPanel(c), anchor);
  }

  /* ---------- 首页：战斗力排行榜 ---------- */
  function powerOf(c) {
    var st = loadTrain(c.id, c);
    return calcPower(baseWithNature(c, st.nature), st);
  }

  var ELEM_COLOR = { 火: '#f15a3c', 水: '#1570ef', 草: '#3e9c68', 冰: '#4aa8d8', 土: '#a97b3f', 钢: '#60778e', 风: '#3aa6a0', 光: '#d9a400', 暗: '#6c4a8e', 雷: '#e0a11b' };

  var rankFilter = { element: '全部', family: '全部' };

  function buildRankView() {
    var list = DATA.creatures.filter(function (c) {
      if (rankFilter.element !== '全部' && c.element !== rankFilter.element) return false;
      if (rankFilter.family !== '全部' && c.family !== rankFilter.family) return false;
      return true;
    }).map(function (c) { return { c: c, p: powerOf(c), st: loadTrain(c.id, c) }; });
    list.sort(function (a, b) { return b.p - a.p || a.c.dexNo - b.c.dexNo; });

    var wrap = document.createElement('div');
    wrap.className = 'rank-view';
    var html = '';
    list.forEach(function (row, i) {
      var c = row.c;
      var src = c.imageKey ? (DATA.images[c.imageKey] || '') : '';
      var rank = i + 1;
      var cls = rank <= 3 ? ' is-top rank-' + rank : '';
      html += '<a class="rank-row' + cls + '" href="/creature/' + c.id + '">' +
        '<span class="rank-no">' + rank + '</span>' +
        (src ? '<img src="' + src + '" alt="' + c.name + '" loading="lazy">' : '') +
        '<span class="rank-name"><b>' + c.name + '</b><small>No.' + String(c.dexNo).padStart(3, '0') + ' · ' + c.stage + ' · ' + c.family + '</small></span>' +
        '<span class="rank-tags">Lv.' + row.st.level + ' · ' + TALENTS[row.st.talent] + ' · ' + row.st.star + '★ · ' + row.st.stage + '阶 · ' + row.st.nature + '</span>' +
        '<span class="rank-power">' + row.p.toLocaleString('en-US') + '</span>' +
        '</a>';
    });
    if (!list.length) html = '<p class="rank-empty">这个筛选下没有灵宠</p>';
    wrap.innerHTML = html;
    return wrap;
  }

  function ensureRankToggle() {
    var heading = document.querySelector('.section-heading');
    if (!heading || document.querySelector('.rank-toggle')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rank-toggle';
    btn.textContent = '战斗力榜';
    heading.appendChild(btn);

    var view = null;
    var tools = null;

    function rerender() {
      if (!view) return;
      var fresh = buildRankView();
      view.innerHTML = fresh.innerHTML;
    }

    btn.addEventListener('click', function () {
      var grid = document.querySelector('.creature-grid');
      var fam = document.querySelector('.family-view');
      var on = !(view && view.classList.contains('is-on'));

      if (on) {
        if (!tools) {
          tools = document.createElement('div');
          tools.className = 'rank-tools';
          var elems = ['全部'].concat(Object.keys(ELEM_COLOR));
          var fams = ['全部'];
          DATA.creatures.forEach(function (c) { if (c.family && fams.indexOf(c.family) < 0) fams.push(c.family); });
          tools.innerHTML =
            '<select data-k="element">' + elems.map(function (e) { return '<option value="' + e + '">' + (e === '全部' ? '全部属性' : e + '系') + '</option>'; }).join('') + '</select>' +
            '<select data-k="family">' + fams.map(function (f) { return '<option value="' + f + '">' + (f === '全部' ? '全部家族' : f) + '</option>'; }).join('') + '</select>' +
            '<span class="rank-count"></span>';
          grid.parentElement.insertBefore(tools, grid.nextSibling);
          tools.addEventListener('change', function (e) {
            var k = e.target.getAttribute('data-k');
            if (!k) return;
            rankFilter[k] = e.target.value;
            rerender();
            updateCount();
          });
        }
        if (!view) { view = buildRankView(); grid.parentElement.appendChild(view); }
        rerender();
        tools.style.display = 'flex';
        tools.parentElement.insertBefore(tools, view);
        view.classList.add('is-on');
        updateCount();
      } else {
        if (view) view.classList.remove('is-on');
        if (tools) tools.style.display = 'none';
      }

      if (on && fam) fam.classList.remove('is-on');
      grid.style.display = on ? 'none' : '';
      btn.textContent = on ? '返回列表' : '战斗力榜';
      var vt = document.querySelector('.view-toggle');
      if (on && vt) vt.textContent = '按家族查看';
    });

    function updateCount() {
      var n = document.querySelectorAll('.rank-view .rank-row').length;
      var cnt = document.querySelector('.rank-count');
      if (cnt) cnt.textContent = '共 ' + n + ' 只';
    }
  }

  /* ---------- 首页：工作室 ---------- */
  function buildStudioSection() {
    var s = DATA.studio || { name: '谭熠的橘子工作室', members: [{ role: '主策划', name: '谭熠' }, { role: '角色审核建模', name: '吴静秋' }] };
    var sec = document.createElement('section');
    sec.className = 'studio-section';
    var rows = (s.members || []).map(function (m, i) {
      return '<div class="studio-member"><span class="studio-num">0' + (i + 1) + '</span>' +
        '<span class="studio-role">' + m.role + '</span>' +
        '<b class="studio-name">' + m.name + '</b></div>';
    }).join('');
    sec.innerHTML =
      '<div class="studio-inner">' +
        '<div class="studio-logo">' +
          '<img src="/media/ui/studio-logo.webp" alt="' + s.name + '" loading="lazy">' +
        '</div>' +
        '<div class="studio-right">' +
          '<p class="studio-kicker">STUDIO · 制作团队</p>' +
          '<h2>' + s.name + '</h2>' +
          '<p class="studio-sub">《咻噗 · 奥灵宠图鉴》由这个小小的工作室一起做出来。每一只灵宠、每一段说明，都从这张桌子出发。</p>' +
          '<div class="studio-rows">' + rows + '</div>' +
        '</div>' +
      '</div>';
    return sec;
  }

  function syncStudio() {
    if (!DATA || document.querySelector('.studio-section')) return;
    if (currentCreatureId()) return;
    var anchor = document.querySelector('.catalog-section');
    if (!anchor || !anchor.parentElement) return;
    var holder = anchor.parentElement;
    var foot = document.querySelector('footer');
    var sec = buildStudioSection();
    if (foot && foot.parentElement === holder) holder.insertBefore(sec, foot);
    else holder.appendChild(sec);
  }

  /* ---------- 公告 ---------- */
  function noticeItems() {
    var lp = DATA.lastPublished;
    if (DATA.announcement && DATA.announcement.length) return DATA.announcement.slice();
    var items = [];
    if (lp && lp.ids && lp.ids.length) {
      var list = DATA.creatures.filter(function (c) { return lp.ids.indexOf(c.id) >= 0; });
      var fams = [];
      list.forEach(function (c) { if (c.family && fams.indexOf(c.family) < 0) fams.push(c.family); });
      items.push('新增 ' + list.length + ' 只灵宠（No.' + String(list[0].dexNo).padStart(3, '0') + '–No.' +
        String(list[list.length - 1].dexNo).padStart(3, '0') + '），来自 ' + fams.length + ' 个家族：' + fams.join('、') + '。');
    }
    items.push('每只灵宠新增「蛋形态」「博士批注」「同族伙伴」和「这片区域还能遇到」。');
    items.push('新增「养成模拟」：等级 1–60、天赋 9 档、星级 1–9、阶段 1–6、24 种性格，拖动即可实时计算战斗力。');
    items.push('新增「战斗力榜」，可以按属性或家族单独排行；养成面板还能一键生成战绩图分享。');
    items.push('新增「孵化手册」：按家族收录所有蛋形态，从灵宠详情页的蛋形态卡片进入。');
    return items;
  }

  function openNotice() {
    var old = document.querySelector('.notice-modal');
    if (old) { old.remove(); return; }
    var items = noticeItems();
    var day = (DATA.lastPublished && DATA.lastPublished.at) ? String(DATA.lastPublished.at).slice(0, 10) : '';

    var m = document.createElement('div');
    m.className = 'notice-modal';
    m.innerHTML =
      '<div class="notice-box" role="dialog" aria-label="公告">' +
        '<div class="notice-head"><div><p>NOTICE</p><h2>' + (DATA.announcementTitle || '更新公告') + '</h2></div>' +
        (day ? '<span>' + day + '</span>' : '') + '</div>' +
        '<ul class="notice-list">' + items.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul>' +
        '<div class="notice-foot">' +
          '<a class="notice-more" href="/eggs.html">去看看孵化手册 →</a>' +
          '<button type="button" class="notice-close">关闭</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(m);
    m.addEventListener('click', function (e) {
      if (e.target === m || e.target.className === 'notice-close') m.remove();
    });
  }

  /* ---------- 分享战绩图 ---------- */
  function makeShareCard(c, st, base) {
    var W = 1200, H = 630;
    var cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    var ctx = cv.getContext('2d');
    var col = ELEM_COLOR[c.element] || '#1570ef';
    var power = calcPower(base, st);

    var g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#0e1726');
    g.addColorStop(1, '#1d2b47');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = col;
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    ctx.arc(W - 120, 90, 220, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(60, 60, W - 120, H - 120);

    ctx.fillStyle = '#ffd66b';
    ctx.font = '700 24px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('咻噗 · 奥灵宠图鉴', 96, 118);

    ctx.fillStyle = '#fff';
    ctx.font = '900 64px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(c.name, 96, 210);

    ctx.fillStyle = '#9fb3c8';
    ctx.font = '500 22px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('No.' + String(c.dexNo).padStart(3, '0') + ' · ' + c.family + ' · ' + c.stage, 96, 252);

    ctx.fillStyle = '#f7fbff';
    ctx.font = '700 20px "PingFang SC","Microsoft YaHei",sans-serif';
    var tags = ['Lv.' + st.level, TALENTS[st.talent], st.star + ' 星', st.stage + ' 阶', st.nature];
    var tx = 96;
    tags.forEach(function (t) {
      var w = ctx.measureText(t).width + 28;
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(tx, 300, w, 40, 20) : ctx.rect(tx, 300, w, 40);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff';
      ctx.fillText(t, tx + 14, 327);
      tx += w + 12;
    });

    ctx.fillStyle = '#9fb3c8';
    ctx.font = '500 20px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('种族值 ' + statsTotal(c) + '  →  性格修正 ' + base, 96, 470);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffd66b';
    ctx.font = '700 24px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('战斗力', W - 96, 508);
    ctx.fillStyle = '#fff';
    ctx.font = '900 96px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(power.toLocaleString('en-US'), W - 96, 594);
    ctx.textAlign = 'left';

    function show(dataUrl) {
      var old = document.querySelector('.share-modal');
      if (old) old.remove();
      var m = document.createElement('div');
      m.className = 'share-modal';
      m.innerHTML = '<div class="share-box"><img src="' + dataUrl + '" alt="战力战绩图">' +
        '<div class="share-actions"><a class="share-save" download="' + c.name + '-战斗力.png" href="' + dataUrl + '">保存图片</a>' +
        '<button type="button" class="share-close">关闭</button></div>' +
        '<p class="share-tip">手机上长按图片即可保存到相册</p></div>';
      document.body.appendChild(m);
      m.addEventListener('click', function (e) {
        if (e.target === m || e.target.className === 'share-close') m.remove();
      });
    }

    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      ctx.drawImage(img, 700, 70, 380, 380);
      show(cv.toDataURL('image/png'));
    };
    img.onerror = function () { show(cv.toDataURL('image/png')); };
    img.src = DATA.images[c.imageKey] || '';
  }

  function watchDetail() {
    var root = document.getElementById('root');
    if (!root) return;
    var timer = null;
    new MutationObserver(function () {
      clearTimeout(timer);
      timer = setTimeout(function () { syncEggSection(); syncHome(); syncRecent(); syncStudio(); }, 120);
    }).observe(root, { childList: true, subtree: true });
    setInterval(function () { syncEggSection(); syncHome(); syncRecent(); syncStudio(); }, 1200);
  }

  window.__dexOpenNotice = openNotice;

  /* ---------- 离线支持 ---------- */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js?v=10', { scope: '/', updateViaCache: 'none' }).catch(function () {});
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
