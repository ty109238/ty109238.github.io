/* 奥灵宠图鉴 · 静态镜像运行时
 * 把原站的服务端接口（/api/trpc/*）在本机用 data/content.json 复现，
 * 使原站的前端代码可以原样运行，离线也完全可用。
 * 不改动原站任何界面与文案；只提供数据来源。
 */
(function () {
  'use strict';

  var CONTENT_URL = '/data/content.json?d=102';
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
      ? '<div class="egg-frame"><img src="' + imgPath + '" alt="' + c.name + ' 蛋形态" width="220" height="220" loading="lazy" decoding="async"></div>'
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
        (src ? '<img src="' + src + '" alt="' + s.name + '" width="132" height="96" loading="lazy" decoding="async">' : '') +
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

  /* 分支进化 */
  function syncBranch(c) {
    var sec = document.querySelector('.evolution-section');
    if (!sec) return;
    var old = sec.querySelector('.evo-branch');
    if (!c || !c.branch || !c.branch.length) { if (old) old.remove(); return; }
    if (old && old.getAttribute('data-branch-for') === String(c.id)) return;
    if (old) old.remove();

    var wrap = document.createElement('div');
    wrap.className = 'evo-branch';
    var cards = c.branch.map(function (b) {
      var target = null;
      for (var i = 0; i < DATA.creatures.length; i++) if (DATA.creatures[i].id === b.to) { target = DATA.creatures[i]; break; }
      var src = target && target.imageKey ? (DATA.images[target.imageKey] || '') : '';
      return '<a class="evo-branch-card" href="/creature/' + b.to + '">' +
        (src ? '<img src="' + src + '" alt="' + b.name + '" width="64" height="64" loading="lazy">' : '') +
        '<span class="evo-branch-info"><b>' + b.name + '</b><small>' + b.condition + '</small></span>' +
        '</a>';
    }).join('');
    wrap.setAttribute('data-branch-for', String(c.id));
    wrap.innerHTML = '<p class="evo-branch-title">分支进化 · 同一只，两种未来</p><div class="evo-branch-list">' + cards + '</div>';
    sec.appendChild(wrap);
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
    syncBranch(c);
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
        (src ? '<img src="' + src + '" alt="' + s.name + '" width="132" height="96" loading="lazy" decoding="async">' : '') +
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
        (src ? '<img src="' + src + '" alt="' + c.name + '" width="116" height="82" loading="lazy" decoding="async">' : '') +
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
          '<p class="nature-effect" data-k="natureEffect"></p>' +
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
      var natObj = findNature(nat);
      var effLine = sec.querySelector('[data-k="natureEffect"]');
      if (effLine) {
        if (natObj && natObj.up && NATURE_SKILL[natObj.up]) {
          effLine.textContent = '✦ ' + nat + '：' + NATURE_SKILL[natObj.up].label + '（已计入技能威力）';
        } else if (natObj && natObj.special) {
          effLine.textContent = '✦ ' + nat + '：' + natObj.special + '（不影响技能威力）';
        } else {
          effLine.textContent = '';
        }
      }
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
        (src ? '<img src="' + src + '" alt="' + c.name + '" width="116" height="82" loading="lazy" decoding="async">' : '') +
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

  /* ---------- 首页：彩虹形态筛选 ---------- */
  function syncFormFilter() {
    if (!DATA) return;
    var target = null;
    var groups = document.querySelectorAll('fieldset.filter-group');
    for (var i = 0; i < groups.length; i++) {
      var lg = groups[i].querySelector('legend');
      if (lg && (lg.textContent || '').trim() === '形态') { target = groups[i].querySelector('.filter-options') || groups[i]; break; }
    }
    if (!target) return;
    // 每种形态只保留一个按钮
    ['rainbow', 'nightmare'].forEach(function (kind) {
      var els = target.querySelectorAll('[data-form="' + kind + '"]');
      for (var i = 1; i < els.length; i++) els[i].remove();
    });

    function makeChip(kind, label, cls) {
      if (target.querySelector('[data-form="' + kind + '"]')) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.setAttribute('data-form', kind);
      b.textContent = label;
      b.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var on = b.classList.toggle('on');
        if (on) {
          localStorage.setItem('dex:catalogForm', kind);
          target.querySelectorAll('[data-form]').forEach(function (o) {
            if (o !== b) o.classList.remove('on');
          });
        } else {
          localStorage.setItem('dex:catalogForm', 'normal');
        }
        applyCatalogForm();
      });
      target.appendChild(b);
      if (localStorage.getItem('dex:catalogForm') === kind) b.classList.add('on');
    }

    makeChip('rainbow', '彩虹', 'rainbow-chip');
    makeChip('nightmare', '魇化', 'nightmare-chip');
    applyCatalogForm();
  }

  function formUrlOf(n, kind) {
    if (!DATA) return null;
    var keyName = kind === 'nightmare' ? 'nightmareKey' : 'rainbowKey';
    for (var i = 0; i < DATA.creatures.length; i++) {
      var c = DATA.creatures[i];
      if ((c.id === n || c.dexNo === n) && c[keyName]) return DATA.images[c[keyName]] || null;
    }
    return null;
  }

  function rainbowUrlOf(n) { return formUrlOf(n, 'rainbow'); }

  function applyDetailForm() {
    var c = currentCreature();
    if (!c || !DATA) return;
    var mode2 = localStorage.getItem('dex:catalogForm') || 'normal';
    var on = mode2 === 'rainbow' || mode2 === 'nightmare';

    function swap(img, url) {
      if (!img || !url) return;
      if (!img.getAttribute('data-src-normal')) img.setAttribute('data-src-normal', img.src);
      img.src = url;
    }
    function restore(img) {
      var n = img.getAttribute('data-src-normal');
      if (n) { img.src = n; img.removeAttribute('data-src-normal'); }
    }

    // 当前灵宠：所有立绘/写真图（按 src 路径识别，兼容任意容器）
    var ownKey = mode2 === 'nightmare' ? c.nightmareKey : c.rainbowKey;
    var own = ownKey ? (DATA.images[ownKey] || null) : null;
    if (own) {
      var all = document.querySelectorAll('img');
      for (var i = 0; i < all.length; i++) {
        var src = all[i].getAttribute('src') || all[i].getAttribute('data-src-normal') || '';
        if (/\/media\/(portraits|creatures)\//.test(src)) {
          on ? swap(all[i], own) : restore(all[i]);
        }
      }
    }

    // 进化链 / 同族伙伴：按卡片里的链接判断是哪只
    var links = document.querySelectorAll('a[href*="/creature/"]');
    for (var k = 0; k < links.length; k++) {
      var m = /\/(\d+)(?:$|[?#])/.exec(links[k].getAttribute('href') || '');
      if (!m) continue;
      var url = formUrlOf(parseInt(m[1], 10), mode2);
      if (!url) continue;
      var imgs = links[k].querySelectorAll('img');
      for (var j = 0; j < imgs.length; j++) on ? swap(imgs[j], url) : restore(imgs[j]);
    }
  }

  function currentCreature() {
    var id = currentCreatureId();
    if (!id || !DATA) return null;
    for (var i = 0; i < DATA.creatures.length; i++) if (DATA.creatures[i].id === id) return DATA.creatures[i];
    return null;
  }

  function applyCatalogForm() {
    var mode = localStorage.getItem('dex:catalogForm') || 'normal';
    var on = mode === 'rainbow' || mode === 'nightmare';
    var cards = document.querySelectorAll('a.creature-card');
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var img = card.querySelector('.creature-art img, img');
      var link = card.getAttribute('href') || '';
      var m = /\/(\d+)$/.exec(link);
      if (!img || !m) continue;
      if (!img.getAttribute('data-src-normal')) img.setAttribute('data-src-normal', img.src);
      if (on) {
        var url = formUrlOf(parseInt(m[1], 10), mode);
        if (url) img.src = url;
      }
    }
    if (!on) {
      var cards2 = document.querySelectorAll('a.creature-card img');
      for (var n = 0; n < cards2.length; n++) {
        var s0 = cards2[n].getAttribute('data-src-normal');
        if (s0) { cards2[n].src = s0; cards2[n].removeAttribute('data-src-normal'); }
      }
    }
  }

  /* ---------- 板块标题图标 ---------- */
  var SEC_ICONS = {
    '蛋形态': 'ui-hatchcond',
    '孵化条件': 'ui-hatchcond',
    '种族值': 'ui-radar',
    '技能手册': null
  };
  var ELEM_ICON = { 火: 'fire', 水: 'water', 草: 'grass', 冰: 'ice', 土: 'rock', 钢: 'steel', 风: 'wind', 光: 'light', 暗: 'dark', 雷: 'thunder' };

  function syncHeaderIcons() {
    var head = document.querySelector('header') || document.body;
    var links = head.querySelectorAll('a');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      if (a.querySelector('.ui-ico')) continue;
      var t = a.textContent.replace(/\s/g, '');
      if (t.indexOf('作者入口') === 0) {
        var img = document.createElement('img');
        img.className = 'ui-ico';
        img.src = '/media/ui/ui-author.webp';
        img.alt = '';
        a.insertBefore(img, a.firstChild);
        [].slice.call(a.querySelectorAll('svg')).forEach(function (svg) { svg.remove(); });
      }
      if (t.indexOf('作者入口') === 0) {
        [].slice.call(a.querySelectorAll('svg')).forEach(function (svg) { svg.remove(); });
      }
    }
  }

  function elementIconOf(c) {
    var ELEM_ICON = { 火: 'fire', 水: 'water', 草: 'grass', 冰: 'ice', 土: 'rock', 钢: 'steel', 风: 'wind', 光: 'light', 暗: 'dark', 雷: 'thunder' };
    return 'trait-' + (ELEM_ICON[c.element] || 'fire');
  }

  function makeEntryIcon(src, cls) {
    var img = document.createElement('img');
    img.className = cls || 'entry-ico';
    img.src = '/media/ui/' + src + '.webp';
    img.alt = '';
    return img;
  }

  function currentCreature() {
    var id = currentCreatureId();
    if (!id || !DATA) return null;
    for (var i = 0; i < DATA.creatures.length; i++) if (DATA.creatures[i].id === id) return DATA.creatures[i];
    return null;
  }

  function applyForm(form) {
    var c = currentCreature();
    if (!c) return;
    var rb = c.rainbowKey ? (DATA.images[c.rainbowKey] || '') : '';
    if (!rb) return;
    var normalRe = /\/media\/(creatures|portraits)\//;
    var imgs = document.querySelectorAll('.portrait-frame img, .detail-copy img, .evolution-member img, img[src*="/media/creatures/"], img[src*="/media/rainbow/"]');
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      if (form === 'rainbow') {
        if (!img.getAttribute('data-src-normal')) img.setAttribute('data-src-normal', img.src);
        img.src = rb;
      } else {
        var n = img.getAttribute('data-src-normal');
        if (n) { img.src = n; img.removeAttribute('data-src-normal'); }
      }
    }
    var btns = document.querySelectorAll('.form-btn');
    for (var k = 0; k < btns.length; k++) btns[k].classList.toggle('on', btns[k].getAttribute('data-form') === form);
  }

  function syncFormToggle() {
    var c = currentCreature();
    if (!c || !c.rainbowKey) return;
    if (document.querySelector('.form-switch')) {
      applyForm(localStorage.getItem('dex:form') === 'rainbow' ? 'rainbow' : 'normal');
      return;
    }
    var head = document.querySelector('.record-heading');
    if (!head) return;
    var box = document.createElement('div');
    box.className = 'form-switch';
    box.innerHTML =
      '<button type="button" class="form-btn" data-form="normal">普通形态</button>' +
      '<button type="button" class="form-btn rainbow" data-form="rainbow">彩虹形态</button>';
    box.addEventListener('click', function (e) {
      var b = e.target.closest('.form-btn');
      if (!b) return;
      var f = b.getAttribute('data-form');
      localStorage.setItem('dex:form', f === 'rainbow' ? 'rainbow' : 'normal');
      applyForm(f);
    });
    head.appendChild(box);
    applyForm(localStorage.getItem('dex:form') === 'rainbow' ? 'rainbow' : 'normal');
  }

  function killEvoBg() {
    var nodes = document.querySelectorAll('.evolution-member, .evolution-member *');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.tagName === 'IMG') { el.style.setProperty('background', 'transparent', 'important'); continue; }
      if (el.getAttribute('data-evobg') === '1') continue;
      el.setAttribute('data-evobg', '1');
      el.style.setProperty('background', 'transparent', 'important');
      el.style.setProperty('background-image', 'none', 'important');
      el.style.setProperty('box-shadow', 'none', 'important');
    }
    var members = document.querySelectorAll('.evolution-member');
    for (var k = 0; k < members.length; k++) {
      var m = members[k];
      if (m.classList.contains('is-current')) {
        m.style.setProperty('outline', '3px solid #dd2590', 'important');
        m.style.setProperty('outline-offset', '3px', 'important');
        m.style.setProperty('border-radius', '14px', 'important');
      } else {
        m.style.setProperty('border', '0', 'important');
      }
    }
  }

  function killEggBg() {
    var frames = document.querySelectorAll('.egg-frame, .egg-frame *');
    for (var i = 0; i < frames.length; i++) {
      var el = frames[i];
      if (el.tagName === 'IMG') {
        el.style.setProperty('background', 'transparent', 'important');
        continue;
      }
      if (el.getAttribute('data-nobg') === '1') continue;
      el.setAttribute('data-nobg', '1');
      el.style.setProperty('background', 'transparent', 'important');
      el.style.setProperty('background-image', 'none', 'important');
      el.style.setProperty('border', '0', 'important');
      el.style.setProperty('box-shadow', 'none', 'important');
    }
  }

  function frameTraitSection() {
    var secs = document.querySelectorAll('.detail-page > section');
    for (var i = 0; i < secs.length; i++) {
      var h = secs[i].querySelector('.record-heading h2');
      if (h && h.textContent.indexOf('被动特性') >= 0) {
        if (!secs[i].classList.contains('trait-sec')) secs[i].classList.add('trait-sec');
      }
    }
  }

  function killTraitBg() {
    var entries = document.querySelectorAll('.traits-list .trait-entry');
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (e.getAttribute('data-nobg') === '1') continue;
      e.setAttribute('data-nobg', '1');
      var nodes = [e].concat([].slice.call(e.querySelectorAll('div, span, h3, h4, p, small')));
      for (var k = 0; k < nodes.length; k++) {
        var nd = nodes[k];
        nd.style.setProperty('background-image', 'none', 'important');
        if (nd.classList.contains('trait-emblem')) {
          nd.style.setProperty('background-color', 'transparent', 'important');
          nd.style.setProperty('border', '0', 'important');
          continue;
        }
        nd.style.setProperty('background-color', '#ffffff', 'important');
        nd.style.setProperty('border', '0', 'important');
        nd.style.setProperty('box-shadow', 'none', 'important');
        nd.style.setProperty('border-radius', '0', 'important');
      }
      e.style.setProperty('padding', '6px 0', 'important');
    }
  }

  function syncEntryIcons() {
    var id = currentCreatureId();
    if (!id || !DATA) return;
    var c = null;
    for (var i = 0; i < DATA.creatures.length; i++) if (DATA.creatures[i].id === id) { c = DATA.creatures[i]; break; }
    if (!c) return;

    // 被动特性：每个特性左侧换成对应属性徽章
    var emblems = document.querySelectorAll('.trait-emblem');
    for (var t = 0; t < emblems.length; t++) {
      var em = emblems[t];
      if (em.querySelector('img.entry-ico')) continue;
      em.innerHTML = '';
      em.appendChild(makeEntryIcon(elementIconOf(c), 'entry-ico trait-ico'));
    }

    // 捕捉地点 → 捕捉条件图标
    var pin = document.querySelector('.field-note:not(.hatch) > svg');
    if (pin) {
      pin.parentNode.replaceChild(makeEntryIcon('ui-catch', 'entry-ico note-ico'), pin);
    }

    // 孵化条件 → 蛋/沙漏图标
    var egg = document.querySelector('.field-note.hatch > svg');
    if (egg) {
      egg.parentNode.replaceChild(makeEntryIcon('ui-hatchcond', 'entry-ico note-ico'), egg);
    }
  }

  var entryObs = null;
  function watchEntries() {
    if (entryObs) return;
    var root = document.querySelector('.detail-page');
    if (!root) return;
    var t = null;
    entryObs = new MutationObserver(function () {
      clearTimeout(t);
      t = setTimeout(function () { syncSkillNumbers(); syncEntryIcons(); killEggBg(); killEvoBg(); frameTraitSection(); killTraitBg(); }, 80);
    });
    entryObs.observe(root, { childList: true, subtree: true });
  }

  function syncSkillNumbers() {
    var entries = document.querySelectorAll('.skill-entry');
    for (var i = 0; i < entries.length; i++) {
      var top = entries[i].querySelector('.skill-top');
      if (!top) continue;
      var span = top.querySelector('span');
      if (!span) continue;
      var n = i + 1;
      if (n > 9) continue;
      if (span.getAttribute('data-slot') === String(n)) continue;
      span.setAttribute('data-slot', String(n));
      span.classList.add('skill-no');
      span.innerHTML = '<img src="/media/ui/slot-' + n + '.webp" alt="' + n + '">';
      span.style.setProperty('background', 'transparent', 'important');
      span.style.setProperty('background-image', 'none', 'important');
      span.style.setProperty('border', '0', 'important');
      span.style.setProperty('box-shadow', 'none', 'important');
      span.style.setProperty('width', '30px', 'important');
      span.style.setProperty('height', '30px', 'important');
      span.style.setProperty('display', 'inline-flex', 'important');
      span.style.setProperty('align-items', 'center', 'important');
      span.style.setProperty('justify-content', 'center', 'important');
    }
  }

  function syncSkillCollapse() {
    var secs = document.querySelectorAll('.detail-page > section');
    var sec = null;
    for (var i = 0; i < secs.length; i++) {
      var h = secs[i].querySelector('.record-heading h2');
      if (h && h.textContent.indexOf('技能手册') >= 0) { sec = secs[i]; break; }
    }
    if (!sec) return;
    var btn = sec.querySelector('.skill-fold');
    if (btn) btn.remove();   // 只显示专属技能，不再需要折叠
  }

  function syncEntryIcons() {
    var id = currentCreatureId();
    if (!id || !DATA) return;
    var c = null;
    for (var i = 0; i < DATA.creatures.length; i++) if (DATA.creatures[i].id === id) { c = DATA.creatures[i]; break; }
    if (!c) return;

    // 被动特性：每个特性左侧换成对应属性徽章
    var emblems = document.querySelectorAll('.trait-emblem');
    for (var t = 0; t < emblems.length; t++) {
      var em = emblems[t];
      if (em.querySelector('img.entry-ico')) continue;
      em.innerHTML = '';
      em.appendChild(makeEntryIcon(elementIconOf(c), 'entry-ico trait-ico'));
    }

    // 捕捉地点 → 捕捉条件图标
    var pin = document.querySelector('.field-note:not(.hatch) > svg');
    if (pin) {
      pin.parentNode.replaceChild(makeEntryIcon('ui-catch', 'entry-ico note-ico'), pin);
    }

    // 孵化条件 → 蛋/沙漏图标
    var egg = document.querySelector('.field-note.hatch > svg');
    if (egg) {
      egg.parentNode.replaceChild(makeEntryIcon('ui-hatchcond', 'entry-ico note-ico'), egg);
    }
  }

  var entryObs = null;
  function watchEntries() {
    if (entryObs) return;
    var root = document.querySelector('.detail-page');
    if (!root) return;
    var t = null;
    entryObs = new MutationObserver(function () {
      clearTimeout(t);
      t = setTimeout(function () { syncSkillNumbers(); syncEntryIcons(); killEggBg(); killEvoBg(); frameTraitSection(); killTraitBg(); }, 80);
    });
    entryObs.observe(root, { childList: true, subtree: true });
  }

  function syncSkillOwnOnly() {
    var c = currentCreature();
    if (!c || !DATA || !DATA.skills) return;
    var arr = DATA.skills[String(c.id)] || [];
    var own = {};
    for (var k = 0; k < arr.length; k++) if (arr[k].own) own[arr[k].name] = 1;
    if (!Object.keys(own).length) return;
    var entries = document.querySelectorAll('.skill-entry');
    for (var i = 0; i < entries.length; i++) {
      var h = entries[i].querySelector('h3');
      var nm = h ? h.textContent.trim() : '';
      var show = !!own[nm];
      entries[i].style.display = show ? '' : 'none';
      entries[i].setAttribute('data-own', show ? '1' : '0');
    }
  }

  function syncSkillNumbers() {
    var entries = document.querySelectorAll('.skill-entry');
    for (var i = 0; i < entries.length; i++) {
      var top = entries[i].querySelector('.skill-top');
      if (!top) continue;
      var span = top.querySelector('span');
      if (!span) continue;
      var n = i + 1;
      if (n > 9) continue;
      if (span.getAttribute('data-slot') === String(n)) continue;
      span.setAttribute('data-slot', String(n));
      span.classList.add('skill-no');
      span.innerHTML = '<img src="/media/ui/slot-' + n + '.webp" alt="' + n + '">';
      span.style.setProperty('background', 'transparent', 'important');
      span.style.setProperty('background-image', 'none', 'important');
      span.style.setProperty('border', '0', 'important');
      span.style.setProperty('box-shadow', 'none', 'important');
      span.style.setProperty('width', '30px', 'important');
      span.style.setProperty('height', '30px', 'important');
      span.style.setProperty('display', 'inline-flex', 'important');
      span.style.setProperty('align-items', 'center', 'important');
      span.style.setProperty('justify-content', 'center', 'important');
    }
  }

  function syncSkillCollapse() {
    var secs = document.querySelectorAll('.detail-page > section');
    var sec = null;
    for (var i = 0; i < secs.length; i++) {
      var h = secs[i].querySelector('.record-heading h2');
      if (h && h.textContent.indexOf('技能手册') >= 0) { sec = secs[i]; break; }
    }
    if (!sec) return;
    var entries = sec.querySelectorAll('.skill-entry');
    if (entries.length <= 4) return;

    var collapsed = localStorage.getItem('dex:skillfold') !== '0';
    var head = sec.querySelector('.record-heading');
    var btn = sec.querySelector('.skill-fold');
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'skill-fold';
      btn.addEventListener('click', function () {
        var cur = localStorage.getItem('dex:skillfold') !== '0';
        localStorage.setItem('dex:skillfold', cur ? '0' : '1');
        syncSkillCollapse();
      });
      (head || sec).appendChild(btn);
    }
    btn.textContent = collapsed ? ('展开全部 ' + entries.length + ' 个技能 ▾') : '收起（只看前 4 个） ▴';
    for (var k = 0; k < entries.length; k++) {
      entries[k].style.display = (collapsed && k >= 4) ? 'none' : '';
    }
  }

  function syncSectionIcons() {
    var id = currentCreatureId();
    if (!id || !DATA) return;
    var c = null;
    for (var i = 0; i < DATA.creatures.length; i++) if (DATA.creatures[i].id === id) { c = DATA.creatures[i]; break; }
    if (!c) return;
    var heads = document.querySelectorAll('.record-heading');
    for (var h = 0; h < heads.length; h++) {
      var el = heads[h];
      if (el.querySelector('.sec-ico')) continue;
      var titleEl = el.querySelector('h2');
      if (!titleEl) continue;
      var title = titleEl.textContent.trim();
      var stale = el.querySelector('.sec-ico');
      if (title.indexOf('被动特性') >= 0) { if (stale) stale.remove(); continue; }
      if (stale) continue;
      var icon = SEC_ICONS[title] || null;
      if (!icon) continue;
      var img = document.createElement('img');
      img.className = 'sec-ico';
      img.src = '/media/ui/' + icon + '.webp';
      img.alt = '';
      titleEl.parentNode.insertBefore(img, titleEl);
    }
  }

  /* ---------- 详情页：右侧目录 ---------- */
  function syncToc() {
    var id = currentCreatureId();
    var old = document.querySelector('.page-toc');
    if (!id) { if (old) old.remove(); return; }
    var secs = [].slice.call(document.querySelectorAll('.detail-page section, article.detail-page > section'))
      .filter(function (el) { return el.querySelector(':scope > .record-heading h2'); });
    if (!secs.length) return;
    var sig = secs.map(function (el) { return el.className; }).join('|');
    if (old && old.getAttribute('data-sig') === sig) return;
    if (old) old.remove();

    var toc = document.createElement('nav');
    toc.className = 'page-toc';
    toc.setAttribute('data-sig', sig);
    var collapsed = localStorage.getItem('dex:toc') === '0';
    if (collapsed) toc.classList.add('collapsed');
    var btn = document.createElement('button');
    btn.className = 'toc-toggle';
    btn.type = 'button';
    btn.innerHTML = '<span class="toc-ico">☰</span><span class="toc-txt">目录</span>';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      toc.classList.toggle('collapsed');
      localStorage.setItem('dex:toc', toc.classList.contains('collapsed') ? '0' : '1');
    });
    toc.appendChild(btn);
    secs.forEach(function (el, i) {
      var h = el.querySelector(':scope > .record-heading h2');
      if (!h) return;
      el.id = el.id || 'sec-' + i;
      var a = document.createElement('a');
      a.href = '#' + el.id;
      a.textContent = h.textContent.trim();
      a.addEventListener('click', function (e) {
        e.preventDefault();
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      toc.appendChild(a);
    });
    document.body.appendChild(toc);
  }

  /* ---------- 新手引导 ---------- */
  function maybeOnboard() {
    if (localStorage.getItem('dex:onboard') === '1') return;
    if (document.querySelector('.onboard')) return;
    if (currentCreatureId()) return;
    var steps = [
      ['👋', '欢迎来到奥灵宠图鉴', '这里收录了 74 只灵宠、666 个技能、12 种天气与 17 种环境组合。'],
      ['📖', '技能书是门槛', '每只灵宠有 5 个专属技能，需要「技能书」才能在战斗里使用。赢一场随机得 1 本，连胜 3 场再得 1 本。'],
      ['⚔️', '熟练度会成长', '同一只灵宠出战 10 次解锁它的全部专属技能书；出战 20 次后属性额外 +10%。'],
      ['🌦', '天气 / 场地 / 环境', '防御技会改变天气（5 回合），专属技会改变场地（8 回合）。两者组合会形成 17 种环境，效果更强。']
    ];
    var box = document.createElement('div');
    box.className = 'onboard';
    var idx = 0;
    function draw() {
      var st = steps[idx];
      box.innerHTML =
        '<div class="ob-card">' +
        '<div class="ob-ico">' + st[0] + '</div>' +
        '<h3>' + st[1] + '</h3>' +
        '<p>' + st[2] + '</p>' +
        '<div class="ob-foot"><span class="ob-dots">' + steps.map(function (_, i) {
          return '<i class="' + (i === idx ? 'on' : '') + '"></i>';
        }).join('') + '</span>' +
        '<button class="ob-next" type="button">' + (idx === steps.length - 1 ? '开始探索' : '下一步') + '</button>' +
        '</div></div>';
      box.querySelector('.ob-next').addEventListener('click', function () {
        if (idx < steps.length - 1) { idx++; draw(); }
        else { localStorage.setItem('dex:onboard', '1'); box.remove(); }
      });
    }
    draw();
    document.body.appendChild(box);
  }

  /* ---------- 移动端底部导航 ---------- */
  function syncMobileNav() {
    if (document.querySelector('.mobile-nav')) return;
    if (!DATA) return;
    var items = [
      { k: 'fn-home', t: '首页', href: '/' },
      { k: 'fn-dex', t: '图鉴', href: '/' },
      { k: 'fn-arena', t: '对战', href: '/battle.html' },
      { k: 'ui-fav', t: '收藏', href: '/favs.html' },
      { k: 'fn-explore', t: '搜索', act: 'search' }
    ];
    var nav = document.createElement('nav');
    nav.className = 'mobile-nav';
    nav.innerHTML = items.map(function (x) {
      return '<a class="mnav-btn" data-act="' + (x.act || '') + '" href="' + (x.href || '#') + '">' +
        '<img src="/media/ui/' + x.k + '.webp" alt=""><span>' + x.t + '</span></a>';
    }).join('');
    document.body.appendChild(nav);
    nav.addEventListener('click', function (e) {
      var a = e.target.closest('.mnav-btn');
      if (a && a.getAttribute('data-act') === 'search') {
        e.preventDefault();
        if (window.__dexOpenSearch) window.__dexOpenSearch();
      }
    });
  }

  /* ---------- 侧边功能栏 ---------- */
  function syncSideRail() {
    if (document.querySelector('.side-rail')) return;
    if (!DATA) return;
    if (document.getElementById('battleView')) return;
    var items = [
      { k: 'fn-home', t: '回到首页', href: '/' },
      { k: 'fn-quest', t: '公告', act: 'notice' },
      { k: 'fn-explore', t: '搜索灵宠', act: 'search' },
      { k: 'fn-research', t: '属性克制', href: '/types.html' },
      { k: 'ui-family', t: '家族图鉴', href: '/family.html' },
      { k: 'ui-hatchbook', t: '孵化手册', href: '/eggs.html' },
      { k: 'fn-arena', t: '战斗模拟', href: '/battle.html' },
      { k: 'ui-skillpool', t: '技能池', href: '/skills.html' },
      { k: 'ui-statusbook', t: '状态图鉴', href: '/status.html' },
      { k: 'ui-envbook', t: '环境图鉴', href: '/env.html' },
      { k: 'fn-btn-normal', t: '进度存档', href: '/save.html' },
      { k: 'ui-fav', t: '我的收藏', href: '/favs.html' }
    ];
    var rail = document.createElement('nav');
    rail.className = 'side-rail';
    rail.innerHTML = items.map(function (x) {
      return '<a class="rail-btn" data-act="' + (x.act || '') + '" href="' + (x.href || '#') + '" title="' + x.t + '">' +
        '<img src="/media/ui/' + x.k + '.webp" alt="' + x.t + '">' +
        '<span>' + x.t + '</span></a>';
    }).join('');
    document.body.appendChild(rail);
    rail.addEventListener('click', function (e) {
      var a = e.target.closest('.rail-btn');
      if (!a) return;
      var act = a.getAttribute('data-act');
      if (act === 'notice') { e.preventDefault(); if (window.__dexOpenNotice) window.__dexOpenNotice(); }
      if (act === 'search') { e.preventDefault(); if (window.__dexOpenSearch) window.__dexOpenSearch(); }
    });
  }

  /* ---------- 首页：站内导航 ---------- */
  function syncNavStrip() {
    if (!DATA || document.querySelector('.site-links')) return;
    if (currentCreatureId()) return;
    var anchor = document.querySelector('.catalog-section');
    if (!anchor || !anchor.parentElement) return;
    var items = [
      { href: '/eggs.html', t: '孵化手册', d: '28 个家族的蛋形态', k: 'ui-hatchbook' },
      { href: '/types.html', t: '属性克制', d: '十系完整对照表', k: 'fn-research' },
      { href: '/family.html', t: '家族图鉴', d: '28 个家族总览', k: 'ui-family' },
      { href: '/battle.html', t: '战斗模拟', d: '六对六回合制对战', k: 'fn-arena' },
      { href: '/skills.html', t: '技能池', d: '全站 600+ 招式', k: 'ui-skillpool' },
      { href: '/status.html', t: '状态图鉴', d: '17 种状态说明', k: 'ui-statusbook' },
      { href: '/env.html', t: '环境图鉴', d: '12 天气 · 10 场地 · 17 环境', k: 'ui-envbook' },
      { href: '/save.html', t: '进度存档', d: '导出/导入你的进度', k: 'fn-btn-normal' },
      { href: '/favs.html', t: '我的收藏', d: '你标星过的灵宠', k: 'ui-fav' }
    ];
    if (!currentCreatureId()) {
      items.push({ href: '/studio.html', t: '工作室', d: '制作团队与手记', k: 'studio-logo' });
    }
    var strip = document.createElement('nav');
    strip.className = 'site-links';
    strip.innerHTML = items.map(function (x) {
      return '<a class="site-link" href="' + x.href + '">' +
        '<span class="site-link-k"><img src="/media/ui/' + x.k + '.webp" alt="" width="80" height="80"></span>' +
        '<span class="site-link-t"><b>' + x.t + '</b><small>' + x.d + '</small></span>' +
        '<span class="site-link-arrow">→</span></a>';
    }).join('');
    anchor.parentElement.insertBefore(strip, anchor);
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
        '<a class="studio-logo" href="/studio.html" aria-label="进入工作室页面">' +
          '<img src="/media/ui/studio-logo.webp" alt="' + s.name + '" loading="lazy">' +
        '</a>' +
        '<div class="studio-right">' +
          '<p class="studio-kicker">STUDIO · 制作团队</p>' +
          '<h2>' + s.name + '</h2>' +
          '<p class="studio-sub">《咻噗 · 奥灵宠图鉴》由这个小小的工作室一起做出来。每一只灵宠、每一段说明，都从这张桌子出发。</p>' +
          '<div class="studio-rows">' + rows + '</div>' +
          '<a class="studio-more" href="/studio.html">走进工作室 · 看制作手记 →</a>' +
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

  /* ---------- 非首页：底部工作室条 ---------- */
  function syncStudioMini() {
    if (!DATA || document.querySelector('.studio-mini')) return;
    if (!currentCreatureId()) return;
    var foot = document.querySelector('footer');
    var holder = foot ? foot.parentElement : (document.querySelector('article.detail-page') || document.querySelector('main'));
    if (!holder) return;
    var s = DATA.studio || { name: '谭熠的橘子工作室' };
    var mini = document.createElement('div');
    mini.className = 'studio-mini';
    mini.innerHTML =
      '<a class="studio-mini-logo" href="/studio.html" aria-label="' + s.name + '">' +
        '<img src="/media/ui/studio-logo.webp" alt="" loading="lazy">' +
      '</a>' +
      '<div class="studio-mini-copy"><span>制作团队</span><b>' + s.name + '</b></div>' +
      '<a class="studio-mini-link" href="/studio.html">了解工作室 →</a>' +
      '<button type="button" class="studio-mini-collapse" title="收起">×</button>';
    if (foot) holder.insertBefore(mini, foot); else holder.appendChild(mini);
    var cb = mini.querySelector('.studio-mini-collapse');
    if (cb) {
      cb.addEventListener('click', function () {
        document.documentElement.classList.add('hide-studio');
        try {
          var cur = JSON.parse(localStorage.getItem('dex:ui') || '{}');
          cur.hideStudio = true;
          localStorage.setItem('dex:ui', JSON.stringify(cur));
        } catch (e) {}
      });
    }
  }

  /* ---------- 全站搜索 ---------- */
  var searchIndex = null;

  function buildSearchIndex() {
    if (searchIndex) return searchIndex;
    searchIndex = DATA.creatures.map(function (c) {
      var sk = (DATA.skills && DATA.skills[c.id]) || [];
      var tr = (DATA.traits && DATA.traits[c.id]) || [];
      var parts = [c.name, c.family, c.element, c.stage, c.form, c.race, c.description, c.captureLocation, c.hatchCondition, c.note];
      sk.forEach(function (x) { parts.push(x.name, x.description); });
      tr.forEach(function (x) { parts.push(x.name, x.description); });
      return {
        id: c.id, name: c.name, dex: c.dexNo, family: c.family, element: c.element, stage: c.stage,
        text: parts.join(' ').toLowerCase()
      };
    });
    return searchIndex;
  }

  function openSearch() {
    if (document.querySelector('.search-modal')) return;
    var idx = buildSearchIndex();
    var m = document.createElement('div');
    m.className = 'search-modal';
    m.innerHTML =
      '<div class="search-box" role="dialog" aria-label="搜索">' +
        '<div class="search-head">' +
          '<input class="search-input" type="search" placeholder="搜名字 / 家族 / 属性 / 技能 / 描述…" autocomplete="off">' +
          '<button type="button" class="search-close">关闭</button>' +
        '</div>' +
        '<div class="search-results"></div>' +
      '</div>';
    document.body.appendChild(m);

    var input = m.querySelector('.search-input');
    var list = m.querySelector('.search-results');
    var active = 0;
    var results = [];

    function render(q) {
      q = (q || '').trim().toLowerCase();
      results = q ? idx.filter(function (x) { return x.text.indexOf(q) >= 0; }).slice(0, 24) : idx.slice(0, 12);
      active = 0;
      if (!results.length) {
        list.innerHTML = '<p class="search-empty">没有找到「' + q + '」相关的灵宠</p>';
        return;
      }
      list.innerHTML = results.map(function (r, i) {
        return '<a class="search-row' + (i === 0 ? ' is-active' : '') + '" href="/creature/' + r.id + '">' +
          '<span class="search-dex">No.' + String(r.dex).padStart(3, '0') + '</span>' +
          '<b>' + r.name + '</b>' +
          '<small>' + r.family + ' · ' + r.element + '系 · ' + r.stage + '</small></a>';
      }).join('');
    }

    function move(d) {
      var rows = list.querySelectorAll('.search-row');
      if (!rows.length) return;
      active = (active + d + rows.length) % rows.length;
      rows.forEach(function (r, i) { r.classList.toggle('is-active', i === active); });
      rows[active].scrollIntoView({ block: 'nearest' });
    }

    input.addEventListener('input', function () { render(input.value); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') {
        var rows = list.querySelectorAll('.search-row');
        if (rows[active]) location.href = rows[active].getAttribute('href');
      } else if (e.key === 'Escape') { m.remove(); }
    });
    m.addEventListener('click', function (e) {
      if (e.target === m || e.target.className === 'search-close') m.remove();
    });
    render('');
    setTimeout(function () { input.focus(); }, 30);
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

  /* 分支来源标签：由 XX 分化而来 */
  function syncFromTag(c) {
    var sec = document.querySelector('.evolution-section');
    if (!sec) return;
    var old = sec.querySelector('.evo-from');
    if (!c || !c.from) { if (old) old.remove(); return; }
    if (old && old.getAttribute('data-from-for') === String(c.id)) return;
    if (old) old.remove();
    var f = c.from;
    var tag = document.createElement('a');
    tag.className = 'evo-from';
    tag.setAttribute('data-from-for', String(c.id));
    tag.href = '/creature/' + f.id;
    tag.innerHTML = '<span class="evo-from-cap">分支进化</span>' +
      '由 <b>No.' + String(f.dexNo).padStart(3, '0') + ' ' + f.name + '</b>' +
      (f.condition ? '（' + f.condition + '）' : '') + ' 分化而来' +
      '<span class="evo-from-arrow">→</span>';
    var head = sec.querySelector('.record-heading');
    if (head && head.nextSibling) sec.insertBefore(tag, head.nextSibling);
    else sec.insertBefore(tag, sec.firstChild);
  }

  /* ---------- 技能：属性 / 分类 / 威力 / 命中 / 学习等级 / 状态图标 ---------- */
  var STATUS_KEYWORDS = [
    ['燃烧', 'burn'], ['灼烧', 'burn'], ['中毒', 'poison'], ['冰冻', 'freeze'], ['冻结', 'freeze'],
    ['流血', 'bleed'], ['闪避', 'dodge'], ['暴击', 'crit'], ['回复生命', 'heal'], ['回复', 'heal'],
    ['护盾', 'shield'], ['能量', 'energy']
  ];

  function statusIcons(desc) {
    var out = [];
    for (var i = 0; i < STATUS_KEYWORDS.length; i++) {
      var k = STATUS_KEYWORDS[i];
      if (desc.indexOf(k[0]) >= 0 && out.indexOf(k[1]) < 0) out.push(k[1]);
      if (out.length >= 2) break;
    }
    return out;
  }

  /* 技能与性格 / 养成的联动 */
  var NATURE_SKILL = {
    attack: { cats: ['物理'], mult: 1.10, label: '物理技能 +10%' },
    spAttack: { cats: ['特殊'], mult: 1.10, label: '特殊技能 +10%' },
    defense: { cats: [], mult: 1.00, label: '受到物理伤害 -10%' },
    spDefense: { cats: [], mult: 1.00, label: '受到特殊伤害 -10%' },
    speed: { cats: ['变化'], mult: 1.15, label: '变化技能效果 +15%' }
  };
  var TALENT_SKILL = [0.95, 0.98, 1.00, 1.02, 1.05, 1.08, 1.12, 1.16, 1.20];

  function natureSkillBonus(natureName, category) {
    var nat = findNature(natureName);
    if (!nat || !nat.up) return { mult: 1, label: '' };
    var rule = NATURE_SKILL[nat.up];
    if (!rule) return { mult: 1, label: '' };
    var hit = rule.cats.indexOf(category) >= 0;
    return { mult: hit ? rule.mult : 1, label: rule.label };
  }

  function trainSkillMult(st) {
    var lvl = 1 + (st.level - 1) * 0.004;
    var star = 1 + (st.star - 1) * 0.03;
    var stage = 1 + (st.stage - 1) * 0.05;
    var talent = TALENT_SKILL[st.talent] || 1;
    return { mult: lvl * star * stage * talent, lvl: lvl, star: star, stage: stage, talent: talent };
  }

  function syncSkillMeta(c) {
    var sec = document.querySelector('.skills-section');
    if (!sec || !c) return;
    if (sec.getAttribute('data-skill-for') === String(c.id) && sec.querySelector('.skill-meta')) return;
    sec.setAttribute('data-skill-for', String(c.id));
    var entries = sec.querySelectorAll('.skill-entry');
    var arr = (DATA.skills && DATA.skills[c.id]) || [];
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var s = arr[i];
      if (!s) continue;
      var old = entry.querySelector('.skill-meta');
      if (old) old.remove();

      var meta = document.createElement('div');
      meta.className = 'skill-meta';
      var BOLT_ICO = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M37 3 13 36h13l-3 25 24-34H34l3-24Z" fill="#f6c94a" stroke="#3a2a12" stroke-width="4.5" stroke-linejoin="round"/></svg>');
      var ICON_MAP = { 火: 'fire', 水: 'water', 草: 'grass', 冰: 'ice', 土: 'rock', 钢: 'steel', 风: 'wind', 光: 'light', 暗: 'dark', 雷: 'thunder' };
      var typeIco = '/media/ui/elem-' + (ICON_MAP[s.type] || (s.type === '雷' ? 'thunder' : 'fire')) + '.webp';
      var chips = [];
      chips.push('<span class="sm-type"><img src="' + typeIco + '" alt="" width="16" height="16">' + s.type + '系</span>');
      chips.push('<span class="sm-cat sm-' + (s.category === '物理' ? 'phys' : s.category === '特殊' ? 'spec' : 'stat') + '">' + s.category + '</span>');

      chips.push('<span class="sm-num">威力 <b>' + (s.power == null ? '—' : s.power) + '</b></span>');
      if (s.prio === 1) chips.push('<span class="sm-prio up">先手+1</span>');
      if (s.prio === -1) chips.push('<span class="sm-prio down">先手-1</span>');
      chips.push('<span class="sm-num">命中 <b>' + (s.accuracy == null ? (s.category === '变化' ? '—' : '必中') : s.accuracy) + '</b></span>');
      chips.push('<span class="sm-lv">Lv.' + s.learnLevel + '</span>');

      var st = statusIcons(s.description || '');
      var stHtml = st.map(function (k) {
        return '<img class="sm-status" src="/media/ui/status/' + k + '.webp" alt="" width="18" height="18" title="' + k + '">';
      }).join('');

      meta.innerHTML = chips.join('') + stHtml;
      var p = entry.querySelector('p');
      if (p && p.nextSibling) entry.insertBefore(meta, p.nextSibling);
      else entry.appendChild(meta);
    }
  }

  var lastBranchId = null;
  function tickBranch() {
    var id = currentCreatureId();
    if (!id || !DATA) return;
    if (id === lastBranchId && document.querySelector('.train-section')) return;
    lastBranchId = id;
    for (var i = 0; i < DATA.creatures.length; i++) {
      if (DATA.creatures[i].id === id) { syncBranch(DATA.creatures[i]); syncFromTag(DATA.creatures[i]); syncSkillMeta(DATA.creatures[i]); return; }
    }
  }

  function watchDetail() {
    var root = document.getElementById('root');
    if (!root) return;
    var timer = null;
    new MutationObserver(function () {
      clearTimeout(timer);
      timer = setTimeout(function () { syncEggSection(); syncHome(); syncRecent(); syncStudio(); syncStudioMini(); syncNavStrip(); syncSideRail(); syncFormFilter(); applyDetailForm(); }, 300);
    }).observe(root, { childList: true });
    setInterval(function () { syncEggSection(); syncHome(); syncRecent(); syncStudio(); syncStudioMini(); syncNavStrip(); syncFormFilter(); syncSideRail(); syncMobileNav(); syncFormFilter(); applyDetailForm(); syncToc(); syncSkillNumbers(); syncSectionIcons(); syncSkillCollapse(); syncEntryIcons(); frameTraitSection(); killTraitBg(); watchEntries(); syncHeaderIcons(); tickBranch(); }, 2500);
  }

  window.__dexOpenNotice = openNotice;
  window.__dexOpenSearch = openSearch;

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
