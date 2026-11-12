/* 抽卡系统：单抽 / 十连 / 60 抽保底自选 / 碎片兑换 / 赠送兑换 */
(function () {
  var STORE = 'gacha:v1';
  var PITY_MAX = 60;
  var VARIANTS = 5;                       // 每张卡预留 5 种画风
  var VAR_NAMES = ['原型', '画风 II', '画风 III', '画风 IV', '画风 V'];

  var RARITY = {
    normal: { key: 'normal', label: '普通', rate: 0.52, shard: 5, cost: 60 },
    good: { key: 'good', label: '优秀', rate: 0.30, shard: 10, cost: 120 },
    rare: { key: 'rare', label: '稀有', rate: 0.14, shard: 20, cost: 240 },
    legend: { key: 'legend', label: '传说', rate: 0.04, shard: 40, cost: 480 }
  };

  var state = {
    cards: [],           // {idx,name,stage,element,power,rarity,img}
    byRarity: {},
    colFilter: 'all',
    pickIdx: null,       // 自选保底
    giftPick: null,
    draft: null
  };

  var save = {
    owned: {},           // "idx:variant" -> 1
    shards: {},          // idx -> n
    pity: 0,
    lastFree: '',        // YYYY-MM-DD
    redeemed: {},        // 已用兑换码
    history: [],         // 抽卡历史
    muted: false
  };

  function $(id) { return document.getElementById(id); }

  function pad2(n) { return ('0' + n).slice(-2); }

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORE);
      if (!raw) return;
      var o = JSON.parse(raw);
      save.owned = o.owned || {};
      save.shards = o.shards || {};
      save.pity = o.pity || 0;
      save.lastFree = o.lastFree || '';
      save.redeemed = o.redeemed || {};
      save.history = o.history || [];
      save.muted = !!o.muted;
    } catch (e) {}
  }

  function persist() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        owned: save.owned,
        shards: save.shards,
        pity: save.pity,
        lastFree: save.lastFree,
        redeemed: save.redeemed,
        history: (save.history || []).slice(-300),
        muted: save.muted
      }));
    } catch (e) {}
  }


  /* ---------- 卡包 ---------- */
  var PACK_META = {
    0: { name: '彩虹卡包', desc: '全图鉴精选' },
    24: { name: '伙伴卡包', desc: '新伙伴们' }
  };

  function packCards(packId) {
    // 1..23：每包 3 只同族（一阶/二阶/三阶）；24：70-77；0：全部
    if (packId === 0) return state.cards.map(function (c) { return c.idx; });
    if (packId === 24) {
      var out = [];
      for (var i = 70; i <= 77; i++) out.push(i);
      return out;
    }
    var base = (packId - 1) * 3 + 1;
    return [base, base + 1, base + 2].filter(function (n) { return n <= 77; });
  }

  function packName(packId) {
    if (PACK_META[packId]) return PACK_META[packId].name;
    var ids = packCards(packId);
    var first = findCard(ids[0]);
    return (first ? first.name : '灵宠') + '卡包';
  }

  function randomPack() {
    var r = Math.random();
    if (r < 0.05) return 0;        // 彩虹卡包
    if (r < 0.10) return 24;       // 伙伴卡包
    return 1 + Math.floor(Math.random() * 23);
  }

  function drawFromPack(packId, count) {
    var ids = packCards(packId);
    var results = [];
    for (var i = 0; i < count; i++) {
      save.pity++;
      var card;
      if (save.pity >= PITY_MAX && state.pickIdx) {
        card = findCard(state.pickIdx) || pickCardOf('legend');
        save.pity = 0;
      } else if (save.pity >= PITY_MAX) {
        card = pickCardOf('legend');
        save.pity = 0;
      } else {
        var rar = rollRarity(false);
        var pool = ids.map(findCard).filter(function (c) { return c && c.rarity === rar; });
        if (!pool.length) pool = ids.map(findCard).filter(Boolean);
        card = pool[Math.floor(Math.random() * pool.length)];
        if (rar === 'legend') save.pity = 0;
      }
      var got = grant(card);
      save.history.push({ t: Date.now(), idx: card.idx, variant: got.variant,
                          dup: got.dup, shards: got.shards, rarity: card.rarity });
      results.push(got);
    }
    return results;
  }

  /* ---------- 音效（预生成 WAV，按需预加载） ---------- */
  var SFX = {
    pull: '/media/sfx/pull.wav',
    flip: '/media/sfx/flip.wav',
    rare: '/media/sfx/rare.wav',
    legend: '/media/sfx/legend.wav',
    dup: '/media/sfx/dup.wav',
    click: '/media/sfx/click.wav',
    tear: '/media/sfx/tear.wav'
  };
  var sfxCache = {};

  function preloadSfx() {
    if (save.muted) return;
    Object.keys(SFX).forEach(function (k) {
      if (sfxCache[k]) return;
      var a = new Audio(SFX[k]);
      a.preload = 'auto';
      a.volume = 0.55;
      sfxCache[k] = a;
    });
  }

  function playSfx(k, vol) {
    if (save.muted) return;
    var a = sfxCache[k];
    if (!a) {
      a = new Audio(SFX[k]);
      a.preload = 'auto';
      sfxCache[k] = a;
    }
    try {
      a.pause();
      a.currentTime = 0;
      a.volume = vol == null ? 0.55 : vol;
      var p = a.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) {}
  }

  function sfxFlip() { playSfx('flip', 0.45); }
  function sfxPull() { playSfx('pull', 0.5); }
  function sfxRare() { playSfx('rare', 0.55); }
  function sfxLegend() { playSfx('legend', 0.6); }
  function sfxDup() { playSfx('dup', 0.4); }
  function sfxClick() { playSfx('click', 0.4); }
  function sfxByRarity(r) {
    if (r === 'legend') sfxLegend();
    else if (r === 'rare') sfxRare();
  }

  function rarityOf(power) {
    if (power < 1400) return 'normal';
    if (power < 1700) return 'good';
    if (power < 1850) return 'rare';
    return 'legend';
  }

  function loadCards() {
    return fetch('/data/content.json', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        state.cards = d.creatures.map(function (c, i) {
          var total = (c.hp || 0) + (c.attack || 0) + (c.defense || 0) +
                      (c.spAttack || 0) + (c.spDefense || 0) + (c.speed || 0);
          var power = Math.round(total * 3.1);
          var rar = rarityOf(power);
          return {
            idx: i + 1,
            name: c.name,
            stage: c.stage,
            element: c.element,
            power: power,
            rarity: rar,
            img: '/media/cards/' + pad2(i + 1) + '.webp'
          };
        });
        state.byRarity = { normal: [], good: [], rare: [], legend: [] };
        state.cards.forEach(function (c) { state.byRarity[c.rarity].push(c); });
      });
  }

  /* ---------- 抽取 ---------- */
  function rollRarity(forceGoodPlus) {
    var r = Math.random();
    var acc = 0;
    var order = ['legend', 'rare', 'good', 'normal'];
    for (var i = 0; i < order.length; i++) {
      acc += RARITY[order[i]].rate;
      if (r < acc) {
        var k = order[i];
        if (forceGoodPlus && k === 'normal') k = 'good';
        return k;
      }
    }
    return 'normal';
  }

  function pickCardOf(rarity) {
    var pool = state.byRarity[rarity];
    if (!pool || !pool.length) pool = state.cards;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function findCard(idx) {
    for (var i = 0; i < state.cards.length; i++) if (state.cards[i].idx === idx) return state.cards[i];
    return null;
  }

  function grant(card, forcedVariant) {
    // 已拥有 → 碎片；否则解锁一个画风（默认原型）
    var variant = forcedVariant || 1;
    var key = card.idx + ':' + variant;
    if (save.owned[key]) {
      var add = RARITY[card.rarity].shard;
      save.shards[card.idx] = (save.shards[card.idx] || 0) + add;
      return { card: card, variant: variant, dup: true, shards: add };
    }
    save.owned[key] = 1;
    return { card: card, variant: variant, dup: false, shards: 0 };
  }

  function doPull(count, freePull) {
    sfxPull();
    var results = [];
    var gotGoodPlus = false;

    for (var i = 0; i < count; i++) {
      save.pity++;
      var card;
      if (save.pity >= PITY_MAX && state.pickIdx) {
        card = findCard(state.pickIdx) || pickCardOf('legend');
        save.pity = 0;
      } else if (save.pity >= PITY_MAX) {
        card = pickCardOf('legend');
        save.pity = 0;
      } else {
        var rar = rollRarity(false);
        card = pickCardOf(rar);
        if (rar === 'legend') save.pity = 0;
        if (rar !== 'normal') gotGoodPlus = true;
      }
      if (card.rarity !== 'normal') gotGoodPlus = true;
      var got = grant(card);
      save.history.push({
        t: Date.now(),
        idx: card.idx,
        variant: got.variant,
        dup: got.dup,
        shards: got.shards,
        rarity: card.rarity
      });
      results.push(got);

      // 十连保底：最后一抽仍全是普通则升级
      if (count === 10 && i === count - 1 && !gotGoodPlus) {
        var better = pickCardOf('good');
        results[results.length - 1] = grant(better);
      }
    }

    if (freePull) save.lastFree = today();
    persist();
    renderPull();
    showResults(results, count);
  }

  /* ---------- 渲染：抽卡页 ---------- */
  function renderPull() {
    var pct = Math.min(100, Math.round(save.pity / PITY_MAX * 100));
    $('pityNow').textContent = save.pity;
    $('pityBar').style.width = pct + '%';

    var pickCard = state.pickIdx ? findCard(state.pickIdx) : null;
    $('pickName').textContent = pickCard ? (pickCard.name + ' · ' + RARITY[pickCard.rarity].label) : '未选择';
    $('pityNote').textContent = pickCard
      ? ('再抽 ' + Math.max(0, PITY_MAX - save.pity) + ' 次必得「' + pickCard.name + '」')
      : '每 60 抽必得你自选的卡牌（未选择则随机传说）';

    var freeOK = save.lastFree !== today();
    $('pullFree').disabled = !freeOK;
    $('freeState').textContent = freeOK ? '今日可领' : '今日已领取';

    var total = 0;
    Object.keys(save.shards).forEach(function (k) { total += save.shards[k]; });
    $('shardTotal').textContent = total;

    var rl = $('rateList');
    rl.innerHTML = '';
    ['legend', 'rare', 'good', 'normal'].forEach(function (k) {
      var d = document.createElement('span');
      d.className = 'rate-item r-' + k;
      d.textContent = RARITY[k].label + ' ' + Math.round(RARITY[k].rate * 100) + '%';
      rl.appendChild(d);
    });

    $('gachaSub').textContent = '已收集 ' + Object.keys(save.owned).length + ' 张 · 保底 ' + save.pity + '/' + PITY_MAX;
  }


  /* ---------- 撕卡包 ---------- */
  var packFlow = null;

  function startPackFlow(totalCards) {
    // 10 连至少 3 种不同卡包
    var packs = [];
    if (totalCards <= 3) {
      packs.push({ id: randomPack(), count: 3 });
    } else {
      var distinct = [];
      while (distinct.length < 3) {
        var id = randomPack();
        if (distinct.indexOf(id) < 0) distinct.push(id);
      }
      var remain = totalCards;
      distinct.forEach(function (id, i) {
        var take = i === distinct.length - 1 ? remain : Math.max(2, Math.round(totalCards / distinct.length));
        take = Math.min(take, remain - (distinct.length - 1 - i) * 2);
        packs.push({ id: id, count: take });
        remain -= take;
      });
      if (remain > 0) packs[packs.length - 1].count += remain;
    }
    packFlow = { packs: packs, index: 0, results: [] };
    showPackStage();
  }

  function showPackStage() {
    var stage = $('packStage');
    if (!stage) {
      stage = document.createElement('div');
      stage.id = 'packStage';
      stage.className = 'pack-stage';
      stage.innerHTML =
        '<div class="pack-wrap" id="packWrap">' +
          '<img class="pack-img" id="packImg" alt="卡包">' +
          '<img class="pack-img pack-top" id="packTop" alt="">' +
          '<div class="seal plain" id="packSeal"></div>' +
          '<div class="tear-rim" id="tearRim"></div>' +
          '<div class="paper-layer" id="paperLayer"></div>' +
        '</div>';
      document.body.appendChild(stage);
    }
    stage.classList.remove('hidden');
    renderPack();
  }

  function renderPack() {
    var pf = packFlow;
    if (!pf) return;
    var stage1 = $('packStage');
    if (stage1) stage1.classList.remove('hidden');
    var cur = pf.packs[pf.index];
    if (!cur) { finishPackFlow(); return; }
    var srcPack = '/media/packs/' + ('0' + cur.id).slice(-2) + '.webp';
    var img = $('packImg');
    img.src = srcPack;
    var top = $('packTop');
    if (top) { top.src = srcPack; top.style.clipPath = tearClip(0); top.style.transform = ''; top.style.opacity = '1'; }
    var pl = $('paperLayer');
    if (pl) pl.innerHTML = '';
    var rim = $('tearRim');
    if (rim) { rim.style.backgroundImage = RIM_SVG; rim.style.top = '2%'; rim.style.opacity = '0'; }
    
    var seal = $('packSeal');
    seal.style.transform = '';
    seal.style.opacity = '';
    seal.classList.remove('torn');
    bindTear();
  }

  var tearState = null;

  // 纸张撕裂白边的 SVG（锯齿 + 细微纤维）
  var RIM_SVG = (function () {
    var teeth = 26, w = 260, h = 14, step = w / teeth, d = [];
    d.push('M0 0');
    for (var i = 0; i <= teeth; i++) {
      var x = i * step;
      var y = (i % 2 === 0) ? h * 0.15 : h * 0.85;
      d.push('L' + x.toFixed(1) + ' ' + y.toFixed(1));
    }
    d.push('L' + w + ' 0 Z');
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
      '<path d="' + d.join(' ') + '" fill="#fdf8ec"/>' +
      '<path d="' + d.join(' ') + '" fill="none" stroke="#c9b48c" stroke-width="0.7" opacity="0.55"/>' +
      '</svg>';
    return 'url("data:image/svg+xml;utf8,' + encodeURIComponent(svg) + '")';
  })();

  function placeRim(p) {
    var rim = $('tearRim');
    if (!rim) return;
    var seam = 0.02 + p * 0.35;          // 与 tearClip 的 edge 保持一致
    rim.style.top = (seam * 100) + '%';
    rim.style.opacity = p > 0.02 ? '1' : '0';
  }

  // 生成锯齿撕口（p=0 时在顶部，p=1 时撕到底部）
  function tearClip(p) {
    var edge = 0.02 + p * 0.42;          // 撕口所在的相对高度
    var teeth = 16;
    var pts = ['0% 0%', '100% 0%'];
    var jag = 0.012 + p * 0.02;          // 锯齿幅度
    for (var i = teeth; i >= 0; i--) {
      var x = (i / teeth) * 100;
      var y = (edge + (i % 2 === 0 ? -jag : jag)) * 100;
      pts.push(x.toFixed(2) + '% ' + y.toFixed(2) + '%');
    }
    return 'polygon(' + pts.join(', ') + ')';
  }

  function spawnPaperBits(host, count) {
    if (!host) return;
    for (var i = 0; i < count; i++) {
      var b = document.createElement('i');
      b.className = 'paper-bit';
      var dx = (Math.random() - 0.5) * 220;
      var dy = -40 - Math.random() * 120;
      var rot = Math.random() * 720 - 360;
      b.style.setProperty('--dx', dx.toFixed(0) + 'px');
      b.style.setProperty('--dy', dy.toFixed(0) + 'px');
      b.style.setProperty('--rot', rot.toFixed(0) + 'deg');
      b.style.left = (20 + Math.random() * 60) + '%';
      b.style.top = (14 + Math.random() * 10) + '%';
      b.style.animationDelay = (Math.random() * 0.12) + 's';
      host.appendChild(b);
    }
    setTimeout(function () {
      if (host) host.innerHTML = '';
    }, 1200);
  }

  function bindTear() {
    var wrap = $('packWrap'), seal = $('packSeal'), fill = $('tearFill');
    if (!wrap || !seal) return;
    tearState = { dragging: false, startX: 0, progress: 0, done: false };

    function setProgress(p) {
      tearState.progress = Math.max(0, Math.min(1, p));
      var pr = tearState.progress;
      if (fill) fill.style.width = (pr * 100) + '%';
      seal.style.transform = 'translateY(' + (-pr * 40) + 'px) rotate(' + (-pr * 6) + 'deg)';
      seal.style.opacity = String(1 - pr * 0.8);
      var top = $('packTop');
      if (top) {
        top.style.clipPath = tearClip(pr * 0.35);
        top.style.transform = 'translateY(' + (-pr * 10) + 'px)';
      }
      placeRim(pr * 0.35);
    }

    function onDown(e) {
      if (tearState.done) return;
      tearState.dragging = true;
      tearState.startX = (e.touches ? e.touches[0].clientX : e.clientX);
      tearState.progress = 0;
      playSfx('flip', 0.3);
    }
    function onMove(e) {
      if (!tearState.dragging || tearState.done) return;
      var x = (e.touches ? e.touches[0].clientX : e.clientX);
      var w = wrap.getBoundingClientRect().width || 240;
      setProgress((x - tearState.startX) / (w * 0.75));
      if (tearState.progress >= 0.92) finishTear();
    }
    function onUp() {
      if (tearState.done) return;
      tearState.dragging = false;
      if (tearState.progress < 0.92) setProgress(tearState.progress > 0.35 ? 0.35 : 0);
    }
    function finishTear() {
      if (tearState.done) return;
      tearState.done = true;
      tearState.dragging = false;
      playSfx('tear', 0.75);
      seal.classList.add('torn');
      seal.style.transform = 'translateY(-70px) rotate(-14deg)';
      seal.style.opacity = '0';

      var top = $('packTop');
      if (top) {
        top.style.clipPath = tearClip(1);
        top.classList.add('peel');
        top.style.transform = 'translateY(-64%) rotate(-9deg)';
        top.style.opacity = '0';
      }
      placeRim(0.35);
      var rim2 = $('tearRim');
      if (rim2) { rim2.style.opacity = '1'; }
      var wrap2 = $('packWrap');
      if (wrap2) {
        wrap2.classList.add('bounce');
        setTimeout(function () { wrap2.classList.remove('bounce'); }, 700);
      }
      spawnPaperBits($('paperLayer'), 18);
      setTimeout(function () { playSfx('rare', 0.45); }, 200);
      setTimeout(revealPackCards, 620);
    }

    if (tearState.bound) {
      tearState.onDown = onDown; tearState.onMove = onMove; tearState.onUp = onUp; tearState.finishTear = finishTear;
      return;
    }
    tearState.bound = true;
    tearState.onDown = onDown; tearState.onMove = onMove; tearState.onUp = onUp; tearState.finishTear = finishTear;

    seal.addEventListener('mousedown', onDown);
    seal.addEventListener('touchstart', onDown, { passive: true });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
  }

  function revealPackCards() {
    var stage0 = $('packStage');
    if (stage0) stage0.classList.add('hidden');
    var pf = packFlow;
    var cur = pf.packs[pf.index];
    var got = drawFromPack(cur.id, cur.count);
    pf.results = pf.results.concat(got);
    persist();
    renderPull();

    // 用结果层展示这一包的卡
    showResults(got, cur.count);
    var btn = $('resultClose');
    btn.textContent = pf.index >= pf.packs.length - 1 ? '全部收下' : '下一包 →';
    btn.onclick = function (ev) {
      if (ev) ev.stopPropagation();
      $('resultLayer').classList.add('hidden');
      if (pf.index >= pf.packs.length - 1) {
        finishPackFlow();
      } else {
        pf.index++;
        renderPack();
      }
    };
  }

  function finishPackFlow() {
    var stage = $('packStage');
    if (stage) stage.classList.add('hidden');
    packFlow = null;
    renderPull();
    renderCollection();
    renderHistory();
  }

  /* ---------- 结果层 ---------- */
  function showResults(results, count) {
    var grid = $('resultGrid');
    grid.innerHTML = '';
    results.forEach(function (r, i) {
      var wrap = document.createElement('div');
      wrap.className = 'res-card' + (r.dup ? '' : ' new');

      var flip = document.createElement('div');
      flip.className = 'flip-wrap';
      flip.innerHTML =
        '<div class="flip-face flip-front"><img src="/media/cards/back.webp" alt="卡背"></div>' +
        '<div class="flip-face flip-back"><img src="' + r.card.img + '" alt="">' +
        '<span class="flip-badge">' + (r.dup ? ('重复 +' + r.shards + ' 碎片') : ('新卡 ' + VAR_NAMES[r.variant - 1])) + '</span></div>';

      flip.addEventListener('click', function () { flip.classList.toggle('flipped'); });
      wrap.appendChild(flip);
      grid.appendChild(wrap);

      setTimeout(function () {
        flip.classList.add('flipped');
        sfxFlip();
        setTimeout(function () {
          if (r.dup) sfxDup(); else sfxByRarity(r.card.rarity);
        }, 260);
      }, 260 + i * 130);
    });

    $('resultTitle').textContent = count === 1 ? '单抽结果' : (count === 10 ? '十连结果' : '抽取结果');
    $('resultLayer').classList.remove('hidden');
  }

  /* ---------- 收藏图鉴 ---------- */
  function ownedVariants(idx) {
    var list = [];
    for (var v = 1; v <= VARIANTS; v++) if (save.owned[idx + ':' + v]) list.push(v);
    return list;
  }

  function renderCollection() {
    var grid = $('colGrid');
    grid.innerHTML = '';
    var shown = 0;
    var ownedCount = 0;

    state.cards.forEach(function (c) {
      var vars = ownedVariants(c.idx);
      if (vars.length) ownedCount++;
      var f = state.colFilter;
      if (f === 'owned' && !vars.length) return;
      if (f === 'normal' && c.rarity !== 'normal') return;
      if (f === 'good' && c.rarity !== 'good') return;
      if (f === 'rare' && c.rarity !== 'rare') return;
      if (f === 'legend' && c.rarity !== 'legend') return;
      shown++;

      var d = document.createElement('div');
      d.className = 'col-card' + (vars.length ? '' : ' locked');
      d.innerHTML = '<img src="' + c.img + '" alt="">' +
        '<span class="rt r-' + c.rarity + '">' + RARITY[c.rarity].label + '</span>' +
        (vars.length ? '<span class="var">' + vars.length + '/' + VARIANTS + ' 画风</span>' : '');
      d.title = vars.length ? c.name : '未获得';
      grid.appendChild(d);
    });

    $('colCount').textContent = '已收集 ' + ownedCount + ' / ' + state.cards.length + ' 种卡牌';
    if (!shown) {
      grid.innerHTML = '<p class="hint">这里还没有卡牌，去抽卡吧。</p>';
    }
  }

  /* ---------- 碎片兑换 ---------- */
  function renderExchange() {
    var host = $('exList');
    host.innerHTML = '';
    var any = false;
    state.cards.forEach(function (c) {
      var vars = ownedVariants(c.idx);
      var shard = save.shards[c.idx] || 0;
      if (!vars.length && !shard) return;
      any = true;
      var row = document.createElement('div');
      row.className = 'ex-item';
      var head = document.createElement('div');
      head.className = 'ex-head';
      head.innerHTML = '<b>' + c.name + '</b><span>碎片 ' + shard + '</span>';
      row.appendChild(head);

      var vhost = document.createElement('div');
      vhost.className = 'ex-vars';
      var cost = RARITY[c.rarity].cost;
      for (var v = 1; v <= VARIANTS; v++) {
        (function (vv) {
          var has = !!save.owned[c.idx + ':' + vv];
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'ex-var' + (has ? ' on' : ' locked');
          var vcost = cost;
          b.innerHTML = VAR_NAMES[vv - 1] + (has ? '<small>已解锁</small>' : '<small>' + vcost + ' 碎片</small>');
          b.addEventListener('click', function () {
            if (has) return;
            if ((save.shards[c.idx] || 0) < vcost) {
              alert('碎片不足：需要 ' + vcost + '，当前 ' + (save.shards[c.idx] || 0));
              return;
            }
            save.shards[c.idx] -= vcost;
            save.owned[c.idx + ':' + vv] = 1;
            persist();
            renderExchange();
            renderCollection();
            renderPull();
          });
          vhost.appendChild(b);
        })(v);
      }
      row.appendChild(vhost);
      host.appendChild(row);
    });
    if (!any) host.innerHTML = '<p class="hint">还没有可兑换的卡牌，先抽几张吧。</p>';
  }

  /* ---------- 赠送码 ---------- */
  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function makeCode(idx, variant) {
    var body = idx + ':' + variant + ':' + Date.now().toString(36);
    var code = body + ':' + hashStr('aoling-' + body);
    return 'AO' + btoa(unescape(encodeURIComponent(code))).replace(/=+$/, '');
  }

  function parseCode(raw) {
    try {
      var s = raw.trim();
      if (s.indexOf('AO') !== 0) return null;
      var dec = decodeURIComponent(escape(atob(s.slice(2))));
      var parts = dec.split(':');
      if (parts.length !== 4) return null;
      var idx = parseInt(parts[0], 10);
      var variant = parseInt(parts[1], 10);
      var body = parts[0] + ':' + parts[1] + ':' + parts[2];
      if (hashStr('aoling-' + body) !== parts[3]) return null;
      if (!idx || !variant || variant < 1 || variant > VARIANTS) return null;
      return { idx: idx, variant: variant, raw: s };
    } catch (e) { return null; }
  }

  function renderGift() {
    var host = $('giftPick');
    host.innerHTML = '';
    var owned = Object.keys(save.owned);
    if (!owned.length) {
      host.innerHTML = '<p class="hint">还没有可赠送的卡牌。</p>';
      return;
    }
    owned.slice(0, 120).forEach(function (key) {
      var p = key.split(':');
      var c = findCard(parseInt(p[0], 10));
      if (!c) return;
      var d = document.createElement('div');
      d.className = 'gift-card' + (state.giftPick === key ? ' on' : '');
      d.innerHTML = '<img src="' + c.img + '" alt="' + c.name + '">';
      d.title = c.name + ' · ' + VAR_NAMES[parseInt(p[1], 10) - 1];
      d.addEventListener('click', function () {
        state.giftPick = key;
        var cc = findCard(parseInt(p[0], 10));
        $('giftCode').value = makeCode(cc.idx, parseInt(p[1], 10));
        renderGift();
      });
      host.appendChild(d);
    });
  }

  /* ---------- 抽卡历史 ---------- */
  function timeText(ts) {
    var d = new Date(ts);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
      pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function renderHistory() {
    var host = $('hisList');
    host.innerHTML = '';
    var list = save.history.slice().reverse();
    $('hisCount').textContent = '共 ' + save.history.length + ' 次记录';
    if (!list.length) {
      host.innerHTML = '<p class="hint">还没有抽卡记录。</p>';
      return;
    }
    list.slice(0, 200).forEach(function (h) {
      var c = findCard(h.idx);
      if (!c) return;
      var row = document.createElement('div');
      row.className = 'his-item';
      row.innerHTML =
        '<img src="' + c.img + '" alt="">' +
        '<div class="his-info"><b>' + c.name + '</b>' +
          '<small>' + timeText(h.t) + ' · ' + VAR_NAMES[(h.variant || 1) - 1] + '</small></div>' +
        '<span class="his-r ' + h.rarity + '">' + RARITY[h.rarity].label + '</span>' +
        '<span class="his-tag ' + (h.dup ? 'dup' : 'new') + '">' + (h.dup ? ('重复 +' + h.shards) : '新卡') + '</span>';
      host.appendChild(row);
    });
  }

  /* ---------- 自选层 ---------- */
  function renderPickLayer() {
    var grid = $('pickGrid');
    var q = ($('pickSearch').value || '').trim();
    grid.innerHTML = '';
    state.cards.forEach(function (c) {
      if (q && c.name.indexOf(q) < 0) return;
      var d = document.createElement('div');
      d.className = 'pick-card' + (state.pickIdx === c.idx ? ' on' : '');
      d.innerHTML = '<img src="' + c.img + '" alt="' + c.name + '">';
      d.title = c.name;
      d.addEventListener('click', function () {
        state.pickIdx = c.idx;
        $('pickLayer').classList.add('hidden');
        renderPull();
      });
      grid.appendChild(d);
    });
  }

  /* ---------- 跨设备存档 ---------- */
  function exportSave() {
    var payload = {
      owned: save.owned,
      shards: save.shards,
      pity: save.pity,
      lastFree: save.lastFree,
      at: Date.now()
    };
    var body = JSON.stringify(payload);
    var code = body + '|' + hashStr('aoling-save-' + body);
    return 'ASV' + btoa(unescape(encodeURIComponent(code))).replace(/=+$/, '');
  }

  function importSave(raw) {
    try {
      var s = (raw || '').trim();
      if (s.indexOf('ASV') !== 0) return { ok: false, msg: '不是存档码（应以 ASV 开头）' };
      var dec = decodeURIComponent(escape(atob(s.slice(3))));
      var cut = dec.lastIndexOf('|');
      if (cut < 0) return { ok: false, msg: '存档码格式错误' };
      var body = dec.slice(0, cut);
      var sig = dec.slice(cut + 1);
      if (hashStr('aoling-save-' + body) !== sig) return { ok: false, msg: '存档码校验失败' };
      var o = JSON.parse(body);
      var addedCards = 0, addedShards = 0;
      Object.keys(o.owned || {}).forEach(function (k) {
        if (!save.owned[k]) { save.owned[k] = 1; addedCards++; }
      });
      Object.keys(o.shards || {}).forEach(function (k) {
        save.shards[k] = (save.shards[k] || 0) + (o.shards[k] || 0);
        addedShards += (o.shards[k] || 0);
      });
      if (typeof o.pity === 'number') save.pity = Math.max(save.pity, o.pity);
      persist();
      return { ok: true, msg: '导入成功：新增 ' + addedCards + ' 张卡、+' + addedShards + ' 碎片' };
    } catch (e) {
      return { ok: false, msg: '存档码解析失败' };
    }
  }

  /* ---------- 云存档：GitHub Gist ---------- */
  var GH_KEY = 'gacha:ghtoken';
  var GIST_KEY = 'gacha:gistid';

  function ghToken() {
    try { return localStorage.getItem(GH_KEY) || ''; } catch (e) { return ''; }
  }

  function savePayload() {
    return JSON.stringify({
      owned: save.owned, shards: save.shards, pity: save.pity,
      lastFree: save.lastFree, history: save.history.slice(-300), at: Date.now()
    });
  }

  function cloudPush() {
    var tk = $('ghToken').value.trim() || ghToken();
    var msg = $('cloudMsg');
    if (!tk) { msg.className = 'sync-msg bad'; msg.textContent = '请先填入 GitHub Token'; return; }
    localStorage.setItem(GH_KEY, tk);
    var gid = '';
    try { gid = localStorage.getItem(GIST_KEY) || ''; } catch (e) {}

    var body = {
      description: '咻噗·奥灵宠 抽卡存档',
      files: { 'aoling-gacha-save.json': { content: savePayload() } }
    };
    var url = gid ? ('https://api.github.com/gists/' + gid) : 'https://api.github.com/gists';
    msg.className = 'sync-msg'; msg.textContent = '上传中…';
    fetch(url, {
      method: gid ? 'PATCH' : 'POST',
      headers: { Authorization: 'token ' + tk, 'Content-Type': 'application/json' },
      body: JSON.stringify(gid ? { files: body.files } : body)
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      localStorage.setItem(GIST_KEY, j.id);
      msg.className = 'sync-msg ok';
      msg.textContent = '已上传云端（gist ' + j.id.slice(0, 8) + '…）';
    }).catch(function (e) {
      msg.className = 'sync-msg bad';
      msg.textContent = '上传失败：' + e.message + '（检查 Token 的 gist 权限）';
    });
  }

  function cloudPull() {
    var tk = $('ghToken').value.trim() || ghToken();
    var msg = $('cloudMsg');
    if (!tk) { msg.className = 'sync-msg bad'; msg.textContent = '请先填入 GitHub Token'; return; }
    localStorage.setItem(GH_KEY, tk);
    var gid = '';
    try { gid = localStorage.getItem(GIST_KEY) || ''; } catch (e) {}
    if (!gid) { msg.className = 'sync-msg bad'; msg.textContent = '本机还没有云端存档记录，请先上传一次'; return; }

    msg.className = 'sync-msg'; msg.textContent = '拉取中…';
    fetch('https://api.github.com/gists/' + gid, {
      headers: { Authorization: 'token ' + tk }
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      var f = j.files && j.files['aoling-gacha-save.json'];
      if (!f) throw new Error('云端存档缺少数据文件');
      var content = f.content;
      if (f.truncated && f.raw_url) {
        return fetch(f.raw_url).then(function (r2) { return r2.text(); });
      }
      return content;
    }).then(function (txt) {
      var o = typeof txt === 'string' ? JSON.parse(txt) : txt;
      var addCards = 0, addShards = 0;
      Object.keys(o.owned || {}).forEach(function (k) { if (!save.owned[k]) { save.owned[k] = 1; addCards++; } });
      Object.keys(o.shards || {}).forEach(function (k) {
        save.shards[k] = (save.shards[k] || 0) + (o.shards[k] || 0);
        addShards += (o.shards[k] || 0);
      });
      if (typeof o.pity === 'number') save.pity = Math.max(save.pity, o.pity);
      if (Array.isArray(o.history)) save.history = save.history.concat(o.history).slice(-300);
      persist();
      renderPull(); renderCollection(); renderGift(); renderHistory();
      msg.className = 'sync-msg ok';
      msg.textContent = '已拉取：新增 ' + addCards + ' 张卡、+' + addShards + ' 碎片';
    }).catch(function (e) {
      msg.className = 'sync-msg bad';
      msg.textContent = '拉取失败：' + e.message;
    });
  }

  /* ---------- 初始化 ---------- */
  function bind() {
    $('pull1').addEventListener('click', function () { sfxClick(); startPackFlow(3); });
    $('pull10').addEventListener('click', function () { sfxClick(); startPackFlow(10); });
    $('pullFree').addEventListener('click', function () {
      if (save.lastFree === today()) return;
      sfxClick();
      save.lastFree = today();
      persist();
      startPackFlow(10);
    });
    $('resultClose').addEventListener('click', function () { $('resultLayer').classList.add('hidden'); });
    $('pickBtn').addEventListener('click', function () { renderPickLayer(); $('pickLayer').classList.remove('hidden'); });
    $('pickClose').addEventListener('click', function () { $('pickLayer').classList.add('hidden'); });
    $('pickSearch').addEventListener('input', renderPickLayer);

    $('gachaTabs').addEventListener('click', function (e) {
      var b = e.target.closest('.tab');
      if (!b) return;
      var tab = b.getAttribute('data-tab');
      [].slice.call(document.querySelectorAll('.tab')).forEach(function (x) { x.classList.toggle('on', x === b); });
      ['pull', 'collection', 'exchange', 'history', 'gift'].forEach(function (k) {
        $('panel-' + k).classList.toggle('hidden', k !== tab);
      });
      if (tab === 'collection') renderCollection();
      if (tab === 'exchange') renderExchange();
      if (tab === 'gift') renderGift();
      if (tab === 'history') renderHistory();
    });

    function backTabClick() {
      var pullTab = document.querySelector('.tab[data-tab="pull"]');
      if (pullTab) pullTab.click();
    }
    [].slice.call(document.querySelectorAll('.back-tab')).forEach(function (b) {
      b.addEventListener('click', function () { sfxClick(); backTabClick(); });
    });

    $('colFilter').addEventListener('click', function (e) {
      var b = e.target.closest('.chip');
      if (!b) return;
      state.colFilter = b.getAttribute('data-f');
      [].slice.call($('colFilter').children).forEach(function (x) { x.classList.toggle('on', x === b); });
      renderCollection();
    });

    $('giftCopy').addEventListener('click', function () {
      var v = $('giftCode').value;
      if (!v) return;
      if (navigator.clipboard) navigator.clipboard.writeText(v).then(function () { $('giftCopy').textContent = '已复制'; setTimeout(function () { $('giftCopy').textContent = '复制'; }, 1200); });
    });

    var mb = $('muteBtn');
    if (mb) {
      mb.textContent = save.muted ? '🔇' : '🔊';
      mb.classList.toggle('off', save.muted);
      mb.addEventListener('click', function () {
        save.muted = !save.muted;
        persist();
        mb.textContent = save.muted ? '🔇' : '🔊';
        mb.classList.toggle('off', save.muted);
        if (!save.muted) { preloadSfx(); sfxFlip(); }
      });
    }

    if ($('hisClear')) {
      $('hisClear').addEventListener('click', function () {
        if (!confirm('清空抽卡历史？（不影响卡牌和碎片）')) return;
        save.history = [];
        persist();
        renderHistory();
      });
    }

    if ($('ghToken')) {
      try { $('ghToken').value = ghToken(); } catch (e) {}
      $('cloudPush').addEventListener('click', cloudPush);
      $('cloudPull').addEventListener('click', cloudPull);
    }

    var sa = $('syncArea');
    if (sa) {
      $('syncExport').addEventListener('click', function () {
        sa.value = exportSave();
        $('syncMsg').className = 'sync-msg ok';
        $('syncMsg').textContent = '已生成，复制发给另一台设备粘贴导入即可';
      });
      $('syncImport').addEventListener('click', function () {
        var r = importSave(sa.value);
        $('syncMsg').className = 'sync-msg ' + (r.ok ? 'ok' : 'bad');
        $('syncMsg').textContent = r.msg;
        if (r.ok) { renderPull(); renderCollection(); renderGift(); }
      });
      $('syncCopy').addEventListener('click', function () {
        if (!sa.value) return;
        if (navigator.clipboard) navigator.clipboard.writeText(sa.value).then(function () {
          $('syncMsg').className = 'sync-msg ok';
          $('syncMsg').textContent = '已复制到剪贴板';
        });
      });
    }

    $('redeemBtn').addEventListener('click', function () {
      var msg = $('redeemMsg');
      var parsed = parseCode($('redeemInput').value || '');
      if (!parsed) { msg.className = 'redeem-msg bad'; msg.textContent = '兑换码无效'; return; }
      if (save.redeemed[parsed.raw]) { msg.className = 'redeem-msg bad'; msg.textContent = '这个码已经用过了'; return; }
      var c = findCard(parsed.idx);
      if (!c) { msg.className = 'redeem-msg bad'; msg.textContent = '找不到对应的卡牌'; return; }
      var r = grant(c, parsed.variant);
      save.redeemed[parsed.raw] = 1;
      persist();
      renderPull();
      renderCollection();
      renderGift();
      msg.className = 'redeem-msg ok';
      msg.textContent = r.dup
        ? ('已拥有「' + c.name + '」，转换 +' + r.shards + ' 碎片')
        : ('获得「' + c.name + '」· ' + VAR_NAMES[parsed.variant - 1]);
    });
  }

  function init() {
    loadState();
    try {
      preloadSfx();
      loadCards().then(function () {
        try {
          bind();
          renderPull();
          renderCollection();
        } catch (e2) {
          $('gachaSub').textContent = 'ERR-B: ' + e2.message;
        }
      }).catch(function (e3) {
        $('gachaSub').textContent = 'ERR-C: ' + (e3 && e3.message ? e3.message : e3);
      });
    } catch (e1) {
      $('gachaSub').textContent = 'ERR-A: ' + e1.message;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
