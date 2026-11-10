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
    redeemed: {}         // 已用兑换码
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
      if (raw) {
        var o = JSON.parse(raw);
        save.owned = o.owned || {};
        save.shards = o.shards || {};
        save.pity = o.pity || 0;
        save.lastFree = o.lastFree || '';
        save.redeemed = o.redeemed || {};
      }
    } catch (e) {}
  }

  function persist() {
    try { localStorage.setItem(STORE, JSON.stringify(save)); } catch (e) {}
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
      results.push(grant(card));

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

  /* ---------- 结果层 ---------- */
  function showResults(results, count) {
    var grid = $('resultGrid');
    grid.innerHTML = '';
    results.forEach(function (r) {
      var d = document.createElement('div');
      d.className = 'res-card' + (r.dup ? '' : ' new');
      d.innerHTML = '<img src="' + r.card.img + '" alt="">' +
        '<span class="badge">' + (r.dup ? ('重复 +' + r.shards + ' 碎片') : ('新卡 ' + VAR_NAMES[r.variant - 1])) + '</span>';
      grid.appendChild(d);
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
          b.innerHTML = VAR_NAMES[vv - 1] + (has ? '<small>已解锁</small>' : '<small>' + cost + ' 碎片</small>');
          b.addEventListener('click', function () {
            if (has) return;
            if ((save.shards[c.idx] || 0) < cost) {
              alert('碎片不足：需要 ' + cost + '，当前 ' + (save.shards[c.idx] || 0));
              return;
            }
            save.shards[c.idx] -= cost;
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

  /* ---------- 初始化 ---------- */
  function bind() {
    $('pull1').addEventListener('click', function () { doPull(1, false); });
    $('pull10').addEventListener('click', function () { doPull(10, false); });
    $('pullFree').addEventListener('click', function () {
      if (save.lastFree === today()) return;
      doPull(10, true);
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
      ['pull', 'collection', 'exchange', 'gift'].forEach(function (k) {
        $('panel-' + k).classList.toggle('hidden', k !== tab);
      });
      if (tab === 'collection') renderCollection();
      if (tab === 'exchange') renderExchange();
      if (tab === 'gift') renderGift();
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
    loadCards().then(function () {
      bind();
      renderPull();
      renderCollection();
    }).catch(function () {
      $('gachaSub').textContent = '加载失败，请刷新重试';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
