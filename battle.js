/* 咻噗·奥灵宠图鉴 — 战斗模拟器 */
(function () {
  'use strict';

  var DATA = null;
  var CHART = {
    钢: { strong: ['冰', '光'], weak: ['火', '土'] },
    水: { strong: ['火', '土'], weak: ['草', '雷'] },
    火: { strong: ['草', '冰', '钢'], weak: ['水', '土'] },
    草: { strong: ['水', '土'], weak: ['火', '冰', '风'] },
    土: { strong: ['火', '雷', '钢'], weak: ['水', '草', '冰'] },
    风: { strong: ['草', '土'], weak: ['雷', '冰', '钢'] },
    雷: { strong: ['水', '风'], weak: ['土', '草'] },
    冰: { strong: ['草', '风', '土'], weak: ['火', '钢'] },
    光: { strong: ['暗'], weak: ['钢'] },
    暗: { strong: ['光'], weak: ['光', '钢'] }
  };
  var TALENTS = ['一无是处', '表现平平', '随处可见', '普普通通', '稍微稀有', '稀有', '百里挑一', '独一无二', '唯我独尊'];
  var TALENT_MULT = [0.8, 0.9, 1.0, 1.1, 1.22, 1.35, 1.5, 1.66, 1.85];
  var TALENT_SKILL = [0.95, 0.98, 1.0, 1.02, 1.05, 1.08, 1.12, 1.16, 1.2];
  var NATURES = [
    ['孤僻', 'attack', 'defense'], ['固执', 'attack', 'spAttack'], ['调皮', 'attack', 'spDefense'], ['勇敢', 'attack', 'speed'],
    ['大胆', 'defense', 'attack'], ['淘气', 'defense', 'spAttack'], ['无虑', 'defense', 'spDefense'], ['悠闲', 'defense', 'speed'],
    ['保守', 'spAttack', 'attack'], ['稳重', 'spAttack', 'defense'], ['马虎', 'spAttack', 'spDefense'], ['冷静', 'spAttack', 'speed'],
    ['温顺', 'spDefense', 'attack'], ['慎重', 'spDefense', 'spAttack'], ['沉着', 'spDefense', 'defense'], ['狂妄', 'spDefense', 'speed'],
    ['胆小', 'speed', 'attack'], ['急躁', 'speed', 'defense'], ['天真', 'speed', 'spDefense'], ['开朗', 'speed', 'spAttack']
  ];
  var STAT_LABEL = { hp: '生命', attack: '物攻', defense: '物防', spAttack: '魔攻', spDefense: '魔防', speed: '速度' };
  var STAGE_OPT = ['一阶', '二阶', '三阶'];
  var WEATHERS = {
    '晴朗': { fire: 1.2, water: 0.8, ice: 1.0, wind: 1.0, desc: '火系威力 +20%｜水系 -20%' },
    '下雨': { fire: 0.8, water: 1.2, ice: 1.0, wind: 1.0, desc: '水系威力 +20%｜火系 -20%' },
    '下雪': { fire: 0.9, water: 1.0, ice: 1.2, wind: 0.9, desc: '冰系威力 +20%｜风系 -10%' }
  };
  var WEATHER_KEYS = ['晴朗', '下雨', '下雪'];
  var PRIORITY_WORDS = /先制|抢先|突袭|急速|迅捷|疾走|闪光/;
  var SLOW_WORDS = /蓄力|重击|全力|耗尽|最后一击/;

  var state = {
    my: new Array(6).fill(null),
    enemy: new Array(6).fill(null),
    editing: null,
    battle: null
  };

  /* ---------------- 工具 ---------------- */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function skillPriority(s) {
    if (typeof s.prio === 'number') return s.prio;
    var d = s.description || '';
    if (/先手\+1/.test(d)) return 1;
    if (/先手-1/.test(d)) return -1;
    if (PRIORITY_WORDS.test(d)) return 1;
    if (SLOW_WORDS.test(d)) return -1;
    return 0;
  }

  function weatherMult(weather, type) {
    var w = WEATHERS[weather];
    if (!w) return 1;
    return w[{ 火: 'fire', 水: 'water', 冰: 'ice', 风: 'wind' }[type]] || 1;
  }

  function bookSet() {
    try { return new Set(JSON.parse(localStorage.getItem('dex:books') || '[]')); }
    catch (e) { return new Set(); }
  }
  function allBookSkills() {
    var out = [];
    DATA.creatures.forEach(function (c) {
      (DATA.skills[String(c.id)] || []).forEach(function (sk) {
        if (needsBook(sk)) out.push({ name: sk.name, cid: c.id, cname: c.name, dexNo: c.dexNo });
      });
    });
    return out;
  }

  function saveBookSet(set) {
    try { localStorage.setItem('dex:books', JSON.stringify([].slice.call(set))); } catch (e) {}
  }

  function showBookDrop(book, bonus) {
    if (!book) return;
    var old = document.querySelector('.book-drop');
    if (old) old.remove();
    var box = document.createElement('div');
    box.className = 'book-drop';
    box.innerHTML =
      '<div class="bd-card">' +
      '<div class="bd-kicker">' + (bonus ? '连胜奖励' : '战斗奖励') + '</div>' +
      '<div class="bd-ico">📖</div>' +
      '<div class="bd-name">《' + book.name + '》</div>' +
      '<div class="bd-owner">' + book.cname + ' 的专属技能书</div>' +
      '<div class="bd-tip">已放入技能池，请在战斗配置中选用</div>' +
      '</div>';
    document.body.appendChild(box);
    box.addEventListener('click', function () { box.remove(); });
    setTimeout(function () { if (box.parentNode) box.remove(); }, 2600);
  }

  function awardBook() {
    var have = bookSet();
    var pool = allBookSkills().filter(function (x) { return !have.has(x.name); });
    if (!pool.length) return null;
    var pickOne = pool[Math.floor(Math.random() * pool.length)];
    have.add(pickOne.name);
    saveBookSet(have);
    return pickOne;
  }

  function usageMap() {
    try { return JSON.parse(localStorage.getItem('dex:usage') || '{}'); } catch (e) { return {}; }
  }
  function saveUsage(m) {
    try { localStorage.setItem('dex:usage', JSON.stringify(m)); } catch (e) {}
  }

  function bumpUsage(team) {
    var m = usageMap();
    var unlocked = [];
    team.forEach(function (cfg) {
      if (!cfg) return;
      var key = String(cfg.c.id);
      m[key] = (m[key] || 0) + 1;
      if (m[key] >= 10) {
        var have = bookSet();
        (DATA.skills[key] || []).forEach(function (sk) {
          if (needsBook(sk) && !have.has(sk.name)) {
            have.add(sk.name);
            unlocked.push(sk.name);
          }
        });
        saveBookSet(have);
      }
    });
    saveUsage(m);
    return unlocked;
  }

  function needsBook(s) {
    return !!(s && (s.exclusive || (s.power || 0) >= 95));
  }
  function allowedSkill(s) {
    return !needsBook(s) || bookSet().has(s.name);
  }

  function skillCat(s) {
    if (s.category === '物理') return '物攻';
    if (s.category === '特殊') return '魔攻';
    var d = s.description || '';
    return /防|护盾|抵挡|免疫|守护/.test(d) ? '防御' : '辅助';
  }

  function typeMult(atkType, defType) {
    var row = CHART[atkType] || { strong: [], weak: [] };
    if (row.strong.indexOf(defType) >= 0) return 2;
    if (row.weak.indexOf(defType) >= 0) return 0.5;
    return 1;
  }

  /* ---------------- 数值 ---------------- */
  function natureOf(name) {
    for (var i = 0; i < NATURES.length; i++) if (NATURES[i][0] === name) return { name: name, up: NATURES[i][1], down: NATURES[i][2] };
    return null;
  }

  function proficiency(cid) {
    var m = usageMap();
    var n = m[String(cid)] || 0;
    return { n: n, mult: 1 + Math.min(n, 20) * 0.005 };
  }

  function computeStats(cfg) {
    var c = cfg.c;
    var L = cfg.level;
    var prof = proficiency(c.id).mult;
    var mult = (1 + (cfg.star - 1) * 0.03) * (1 + (cfg.stage - 1) * 0.05) * (TALENT_SKILL[cfg.talent] || 1) * prof;
    var nat = natureOf(cfg.nature);
    var out = {};
    ['hp', 'attack', 'defense', 'spAttack', 'spDefense', 'speed'].forEach(function (k) {
      var base = c[k] || 0;
      var v;
      if (k === 'hp') {
        v = Math.floor(((2 * base + 31) * L) / 100) + L + 10 + Math.floor((cfg.evs.hp || 0) / 4);
      } else {
        v = Math.floor((((2 * base + 31) * L) / 100 + 5) * prof) + Math.floor((cfg.evs[k] || 0) / 4);
        v = Math.floor(v * mult);
        if (nat && nat.up === k) v = Math.floor(v * 1.1);
        if (nat && nat.down === k) v = Math.floor(v * 0.9);
      }
      out[k] = v;
    });
    return out;
  }

  function skillPowerFor(mon, s) {
    if (s.power == null) return 0;
    var nat = natureOf(mon.cfg.nature);
    var m = 1;
    if (nat && nat.up === 'attack' && s.category === '物理') m *= 1.1;
    if (nat && nat.up === 'spAttack' && s.category === '特殊') m *= 1.1;
    m *= 1 + (mon.cfg.level - 1) * 0.004;
    m *= 1 + (mon.cfg.star - 1) * 0.03;
    return Math.round(s.power * m);
  }

  /* 特性 → 战斗效果（按描述关键词解析） */
  function parseTrait(cid, idx) {
    var all = (DATA.traits && DATA.traits[String(cid)]) || [];
    var arr = (typeof idx === 'number' && all[idx]) ? [all[idx]] : all;
    var txt = arr.map(function (t) { return (t.name || '') + '：' + (t.description || ''); }).join(' ');
    var e = { reduce: {}, boost: {}, crit: 0, heal: 0, shield: 0, speedUp: 0, onFaint: null, immune: [], text: arr.map(function (t) { return t.name; }).join(' · ') };
    if (!txt) return e;

    var mRed = /受到(\S{1,2})系攻击时伤害降低/.exec(txt);
    if (mRed) e.reduce[mRed[1]] = 0.8;
    if (/火系攻击时伤害提高/.test(txt)) e.reduce['火'] = (e.reduce['火'] || 1) * 1.15;

    var mBoost = /(\S{1,2})系技能威力(?:提升|增加|提高)/.exec(txt);
    if (mBoost) e.boost[mBoost[1]] = 1.15;

    if (/暴击率/.test(txt)) e.crit += 0.15;
    if (/回合结束时回复|每回合.*回复|每回合回血/.test(txt)) e.heal = 1 / 16;
    if (/护盾/.test(txt)) e.shield = 0.2;
    if (/速度(?:小幅)?提升|提高速度/.test(txt)) e.speedUp = 0.1;
    if (/不会陷入睡眠/.test(txt)) e.immune.push('睡眠');
    if (/免疫击退|免疫.*状态/.test(txt)) e.immune.push('击退');
    if (/倒下时/.test(txt)) {
      if (/同伴.*全属性|全属性 \+1|全属性\+1/.test(txt)) e.onFaint = { type: 'buffAlly' };
      else if (/敌方.*伤害|造成.*伤害/.test(txt)) e.onFaint = { type: 'burst' };
      else if (/护盾/.test(txt)) e.onFaint = { type: 'shieldAlly' };
    }
    if (/队伍只剩下自己/.test(txt)) e.lastStand = true;
    return e;
  }

  function makeMon(cfg, side, idx) {
    var st = computeStats(cfg);
    return {
      cfg: cfg, side: side, idx: idx,
      name: cfg.c.name, element: cfg.c.element,
      maxHp: st.hp, hp: st.hp,
      stats: st,
      skills: cfg.skills.map(function (s) { return Object.assign({}, s, { ppMax: s.pp || 20, ppNow: s.pp || 20 }); }),
      buffs: { attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0 },
      effects: parseTrait(cfg.c.id, cfg.traitIdx || 0),
      status: {},
      shield: 0,
      fainted: false
    };
  }

  function buffMult(stage) {
    if (stage >= 0) return 1 + 0.5 * stage;
    return 1 / (1 + 0.5 * -stage);
  }

  function eff(mon, key) {
    var v = mon.stats[key] * buffMult(mon.buffs[key]);
    if (key === 'speed') {
      if (mon.status['麻痹']) v *= 0.5;
      if (mon.status['潮湿']) v *= 0.85;
      if (mon.status['减速']) v *= 0.8;
    }
    return Math.floor(v);
  }

  /* ---------------- 建队 ---------------- */
  function renderSlots() {
    [['my', $('mySlots'), $('myCount')], ['enemy', $('enemySlots'), $('enemyCount')]].forEach(function (pair) {
      var side = pair[0], host = pair[1], cnt = pair[2];
      host.innerHTML = '';
      var n = 0;
      state[side].forEach(function (cfg, i) {
        var slot = el('div', 'slot' + (cfg ? ' filled' : ''));
        if (cfg) {
          n++;
          var src = DATA.images[cfg.c.imageKey] || '';
          slot.setAttribute('data-i', i);
          slot.innerHTML = '<span class="x" data-x="' + i + '">×</span>' +
            (src ? '<img src="' + src + '" alt="">' : '') +
            '<b>' + cfg.c.name + '</b>' +
            '<small>Lv.' + cfg.level + ' · ' + cfg.star + '★ · ' + cfg.stage + '阶</small>';
          slot.addEventListener('click', function (e) {
            if (e.target.getAttribute('data-x') != null) {
              state[side][i] = null;
              renderSlots();
              return;
            }
            openEditor(side, i);
          });
        } else {
          slot.innerHTML = '<span class="empty-t">＋ 选择灵宠</span>';
          slot.addEventListener('click', function () { openEditor(side, i); });
        }
        host.appendChild(slot);
      });
      cnt.textContent = n + ' / 6';
    });
    var ok = state.my.every(Boolean) && state.enemy.every(Boolean);
    $('startBattle').disabled = !ok;
  }

  function defaultCfg(c) {
    var st = { '一阶': 1, '二阶': 2, '三阶': 3 }[c.stage] || 1;
    var all = (DATA.skills[String(c.id)] || []).slice();
    var shared = all.filter(function (x) { return !x.exclusive; });
    var own = all.filter(function (x) { return x.exclusive; });
    var skills = shared.filter(allowedSkill).slice(0, 4);
    if (skills.length < 4) {
      all.filter(allowedSkill).forEach(function (x) {
        if (skills.length < 4 && skills.indexOf(x) < 0) skills.push(x);
      });
    }
    var main = skills[0] && skills[0].category === '物理' ? 'attack' : 'spAttack';
    var evs = { hp: 6, attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 252 };
    evs[main] = 252;
    return {
      c: c, level: 40, star: Math.min(9, st * 2), talent: Math.min(8, st + 2),
      stage: st, nature: '坦率', evs: evs,
      traitIdx: 0,
      skills: skills,
      pool: buildPool(c)
    };
  }

  function buildPool(c) {
    var own = DATA.skills[String(c.id)] || [];
    var seen = {};
    own.forEach(function (s) { seen[s.name] = 1; });
    var pool = own.slice();
    DATA.creatures.forEach(function (x) {
      if (x.element !== c.element) return;
      (DATA.skills[String(x.id)] || []).forEach(function (s) {
        if (seen[s.name]) return;
        seen[s.name] = 1;
        pool.push(s);
      });
    });
    return pool.slice(0, 28);
  }

  /* ---------------- 配置弹窗 ---------------- */
  function openEditor(side, idx) {
    state.editing = { side: side, idx: idx, cfg: state[side][idx] ? JSON.parse(JSON.stringify(state[side][idx])) : null };
    if (!state.editing.cfg) state.editing.cfg = null;
    renderEditor();
    $('modal').hidden = false;
  }

  function renderEditor() {
    var cfg = state.editing.cfg;
    var body = $('mboxBody');
    body.innerHTML = '';

    if (!cfg) {
      $('mboxTitle').textContent = '选择灵宠';
      var grid = el('div', 'pick-grid');
      DATA.creatures.forEach(function (c) {
        var src = DATA.images[c.imageKey] || '';
        var p = el('div', 'pick', (src ? '<img src="' + src + '" alt="">' : '') + '<b>' + c.name + '</b><small>No.' + String(c.dexNo).padStart(3, '0') + '</small>');
        p.addEventListener('click', function () {
          state.editing.cfg = defaultCfg(c);
          renderEditor();
        });
        grid.appendChild(p);
      });
      body.appendChild(grid);
      $('mboxOk').disabled = true;
      return;
    }

    $('mboxTitle').textContent = cfg.c.name + ' · No.' + String(cfg.c.dexNo).padStart(3, '0');
    $('mboxOk').disabled = false;

    var row = el('div', 'row2');
    function field(label, options, value, onChange) {
      var f = el('label', 'field', '<span>' + label + '</span>');
      var sel = el('select');
      options.forEach(function (o) {
        var op = el('option', null, o.t);
        op.value = o.v;
        if (String(o.v) === String(value)) op.selected = true;
        sel.appendChild(op);
      });
      sel.addEventListener('change', function () { onChange(sel.value); });
      f.appendChild(sel);
      return f;
    }
    row.appendChild(field('等级', Array.from({ length: 60 }, function (_, i) { return { v: i + 1, t: i + 1 }; }), cfg.level, function (v) { cfg.level = Number(v); }));
    row.appendChild(field('星级', Array.from({ length: 9 }, function (_, i) { return { v: i + 1, t: (i + 1) + ' 星' }; }), cfg.star, function (v) { cfg.star = Number(v); }));
    row.appendChild(field('天赋', TALENTS.map(function (t, i) { return { v: i, t: t }; }), cfg.talent, function (v) { cfg.talent = Number(v); }));
    row.appendChild(field('阶段', Array.from({ length: 6 }, function (_, i) { return { v: i + 1, t: (i + 1) + ' 阶' }; }), cfg.stage, function (v) { cfg.stage = Number(v); }));
    body.appendChild(row);

    var trWrap = el('div', 'row2');
    var traits = (DATA.traits && DATA.traits[String(cfg.c.id)]) || [];
    if (traits.length) {
      trWrap.appendChild(field('特性', traits.map(function (t, i) { return { v: i, t: t.name }; }), cfg.traitIdx || 0, function (v) {
        cfg.traitIdx = Number(v);
        var box = document.getElementById('traitDesc');
        if (box) box.innerHTML = traits[Number(v)].description || '';
      }));
      var td = el('div', 'field', '<span>特性效果</span><div class="ev-left" id="traitDesc">' + (traits[cfg.traitIdx || 0].description || '') + '</div>');
      trWrap.appendChild(td);
    }
    body.appendChild(trWrap);

    var natWrap = el('div', 'row2');
    natWrap.appendChild(field('性格', ['坦率'].concat(NATURES.map(function (n) { return n[0]; })).map(function (n) { return { v: n, t: n }; }), cfg.nature, function (v) { cfg.nature = v; }));
    var preview = el('div', 'field', '<span>面板预览</span><div class="ev-left" id="statPreview"></div>');
    natWrap.appendChild(preview);
    body.appendChild(natWrap);

    // 学习力
    var evTitle = el('p', 'sub', '学习力分配（合计 510，单项最高 255）· <b id="evLeft"></b>');
    body.appendChild(evTitle);
    var evGrid = el('div', 'ev-grid');
    var keys = ['hp', 'attack', 'defense', 'spAttack', 'spDefense', 'speed'];
    keys.forEach(function (k) {
      var r = el('div', 'ev-row');
      r.innerHTML = '<span>' + STAT_LABEL[k] + '</span>';
      var inp = el('input');
      inp.type = 'range'; inp.min = 0; inp.max = 255; inp.step = 1;
      inp.value = cfg.evs[k] || 0;
      var val = el('b', null, String(cfg.evs[k] || 0));
      inp.addEventListener('input', function () {
        var total = keys.reduce(function (s, kk) { return s + (cfg.evs[kk] || 0); }, 0) - (cfg.evs[k] || 0);
        var want = Number(inp.value);
        var allow = Math.min(255, 510 - total);
        cfg.evs[k] = Math.min(want, allow);
        inp.value = cfg.evs[k];
        val.textContent = cfg.evs[k];
        updateEvLeft();
      });
      r.appendChild(inp);
      r.appendChild(val);
      evGrid.appendChild(r);
    });
    body.appendChild(evGrid);

    function updateEvLeft() {
      var total = keys.reduce(function (s, kk) { return s + (cfg.evs[kk] || 0); }, 0);
      var left = $('evLeft');
      if (left) left.innerHTML = '剩余 <b>' + (510 - total) + '</b>';
      var prev = $('statPreview');
      if (prev) {
        var st = computeStats(cfg);
        prev.innerHTML = keys.map(function (k) { return STAT_LABEL[k] + ' ' + st[k]; }).join(' · ');
      }
    }
    updateEvLeft();

    // 技能
    body.appendChild(el('p', 'sub', '技能选择（选满 4 个）· <b id="skCount"></b>'));
    var skWrap = el('div', 'skill-pick');
    cfg.pool.forEach(function (s) {
      var on = cfg.skills.some(function (x) { return x.name === s.name; });
      var locked = !allowedSkill(s);
      var card = el('div', 'sk' + (on ? ' on' : '') + (locked ? ' locked' : ''),
        '<b>' + s.name + '</b>' +
        '<small><span class="tag">' + s.type + '系</span><span class="tag">' + skillCat(s) + '</span>' +
        (s.power ? '威力 ' + s.power : '变化') + ' · ' + (s.accuracy ? '命中 ' + s.accuracy : '—') +
        (locked ? ' · 🔒 需技能书' : '') + '</small>');
      card.addEventListener('click', function () {
        if (locked && !on) {
          alert('需要《技能书 · ' + s.name + '》才能学习。\n到「技能池」页面把它标记为已获得。');
          return;
        }
        var i = cfg.skills.findIndex(function (x) { return x.name === s.name; });
        if (i >= 0) { cfg.skills.splice(i, 1); }
        else if (cfg.skills.length < 4) { cfg.skills.push(s); }
        renderEditor();
        var c2 = document.getElementById('skCount');
        if (c2) c2.textContent = cfg.skills.length + ' / 4';
      });
      skWrap.appendChild(card);
    });
    body.appendChild(skWrap);
    document.getElementById('skCount').textContent = cfg.skills.length + ' / 4';
  }

  /* ---------------- AI 配队 ---------------- */
  function randomTeam(side) {
    var pool = DATA.creatures.slice();
    for (var i = 0; i < 6; i++) {
      var c = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      var cfg = defaultCfg(c);
      cfg.nature = pick(['保守', '固执', '胆小', '大胆', '沉着', '开朗']);
      state[side][i] = cfg;
    }
    renderSlots();
  }

  /* ---------------- 战斗 ---------------- */
  function b0() { return state.battle; }

  function maybeWeather() {
    var b = state.battle;
    if (!b || b.over) return;
    if (b.turn % 3 !== 0) return;
    if (Math.random() > 0.45) return;
    var next = pick(WEATHER_KEYS.filter(function (k) { return k !== b.weather; }));
    b.weather = next;
    logLine('天气变成了 <b>' + next + '</b>（' + WEATHERS[next].desc + '）', 'turn');
  }

  function saveTeam() {
    try {
      var slim = state.my.map(function (c) {
        return c ? { id: c.c.id, level: c.level, star: c.star, talent: c.talent, stage: c.stage, nature: c.nature, evs: c.evs, skills: c.skills.map(function (x) { return x.name; }) } : null;
      });
      localStorage.setItem('dex:team', JSON.stringify(slim));
    } catch (e) {}
  }

  function loadTeam() {
    try {
      var slim = JSON.parse(localStorage.getItem('dex:team') || 'null');
      if (!slim) return false;
      var ok = false;
      slim.forEach(function (x, i) {
        if (!x) return;
        var c = DATA.creatures.filter(function (y) { return y.id === x.id; })[0];
        if (!c) return;
        var cfg = defaultCfg(c);
        cfg.level = x.level; cfg.star = x.star; cfg.talent = x.talent; cfg.stage = x.stage;
        cfg.nature = x.nature; cfg.evs = x.evs || cfg.evs;
        if (x.skills && x.skills.length) {
          var picked = cfg.pool.filter(function (s) { return x.skills.indexOf(s.name) >= 0; }).slice(0, 4);
          if (picked.length === 4) cfg.skills = picked;
        }
        state.my[i] = cfg;
        ok = true;
      });
      return ok;
    } catch (e) { return false; }
  }

  function sanitizeTeam() {
    state.my.concat(state.enemy).forEach(function (cfg) {
      if (!cfg) return;
      var keep = cfg.skills.filter(allowedSkill);
      if (!keep.length) {
        var fb = (cfg.pool || []).filter(allowedSkill).slice(0, 4);
        keep = fb;
      }
      cfg.skills = keep;
    });
  }

  function startBattle() {
    bumpUsage(state.my);
    if (!state.my.every(Boolean) || !state.enemy.every(Boolean)) return;
    state.battle = {
      my: state.my.map(function (cfg, i) { return makeMon(cfg, 'my', i); }),
      en: state.enemy.map(function (cfg, i) { return makeMon(cfg, 'enemy', i); }),
      myActive: 0, enActive: 0,
      turn: 1, log: [], over: false, busy: false,
      awaitingSwitch: false,
      weather: '晴朗',
      ai: (document.getElementById('aiLevel') && document.getElementById('aiLevel').value) || 'normal'
    };
    $('buildView').classList.add('hidden');
    $('battleView').classList.remove('hidden');
    $('resultView').classList.add('hidden');
    $('step').textContent = '第 2 步 · 战斗';
    renderBattle();
    logLine('对战开始！', 'turn');
    logLine('当前天气：<b>' + b0().weather + '</b>（' + WEATHERS[b0().weather].desc + '）');
    logLine('我方首发 ' + state.battle.my[0].name + '，敌方首发 ' + state.battle.en[0].name + '。');
  }

  function renderBattle() {
    var b = state.battle;
    if (!b) return;
    renderMiniRow('enemyRow', b.en, b.enActive);
    renderMiniRow('myRow', b.my, b.myActive);
    var em = b.en[b.enActive], mm = b.my[b.myActive];
    $('enemyActive').innerHTML = monCardHtml(em);
    $('myActive').innerHTML = monCardHtml(mm);

    var wb = document.getElementById('weatherBadge');
    if (wb) wb.innerHTML = '天气 <b>' + b.weather + '</b> · ' + WEATHERS[b.weather].desc;

    var bar = skillBar;
    bar.innerHTML = '';
    var anyPP = mm.skills.some(function (s) { return s.ppNow > 0; });
    var showSkills = anyPP ? mm.skills : [STRUGGLE];
    mm.skills.forEach(function (s, i) {
      var btn = el('button', 'skill-btn');
      bindSkillTip(btn, s);
      btn.innerHTML = '<img class="sk-ico" src="/media/ui/fn-skillbook.webp" alt=""><span class="pp">PP ' + s.ppNow + '/' + s.ppMax + '</span><b>' + s.name + '</b>' +
        '<small>' + s.type + '系 · ' + skillCat(s) + ' · ' + (s.power ? '威力 ' + s.power : '变化') +
        (s.accuracy ? ' · 命中 ' + s.accuracy : '') + '</small>';
      btn.disabled = s.ppNow <= 0 || b.busy || b.awaitingSwitch;
      btn.addEventListener('click', function () { playerAct(i); });
      bar.appendChild(btn);
    });
    if (!anyPP) {
      var sb = el('button', 'skill-btn', '<b>挣扎</b><small>无技能可用 · 威力 40 · 自身反伤</small>');
      sb.addEventListener('click', function () { playerAct(-1); });
      bar.innerHTML = '';
      bar.appendChild(sb);
    }

    var sw = $('switchBar');
    sw.innerHTML = '';
    b.my.forEach(function (m, i) {
      if (i === b.myActive) return;
      var btn = el('button', 'switch-btn', '<img class="sw-ico" src="/media/ui/fn-team.webp" alt="">' + m.name + (m.fainted ? '（倒下）' : ' · ' + m.hp + '/' + m.maxHp));
      btn.disabled = m.fainted || b.busy;
      btn.addEventListener('click', function () { switchTo('my', i, true); });
      sw.appendChild(btn);
    });
    flushFx();
  }

  function renderMiniRow(id, team, active) {
    var host = $(id);
    host.innerHTML = '';
    team.forEach(function (m, i) {
      var card = el('div', 'mini-card' + (m.fainted ? ' dead' : '') + (i === active ? ' active' : ''));
      var src = DATA.images[m.cfg.c.imageKey] || '';
      var pct = Math.max(0, (m.hp / m.maxHp) * 100);
      card.innerHTML = (src ? '<img src="' + src + '" alt="">' : '') +
        '<div class="hpbar"><i style="width:' + pct + '%"></i></div>';
      host.appendChild(card);
    });
  }

  function monCardHtml(m) {
    if (!m) return '';
    var src = DATA.images[m.cfg.c.imageKey] || '';
    var pct = Math.max(0, (m.hp / m.maxHp) * 100);
    var st = Object.keys(m.status).map(function (k) {
      return '<span class="chip bad">' + k + (m.status[k] > 0 ? ' ' + m.status[k] : '') + '</span>';
    }).join('');
    if (m.shield > 0) st += '<span class="chip good">护盾 ' + m.shield + '</span>';
    var buffs = Object.keys(m.buffs).filter(function (k) { return m.buffs[k] !== 0; })
      .map(function (k) { return '<span class="chip">' + STAT_LABEL[k] + ' ' + (m.buffs[k] > 0 ? '+' : '') + m.buffs[k] + '</span>'; }).join('');
    return '<img src="' + src + '" alt="">' +
      '<h4>' + m.name + '</h4>' +
      '<div class="tags">Lv.' + m.cfg.level + ' · ' + m.element + '系 · ' + m.cfg.nature +
      (m.effects && m.effects.text ? ' · ' + m.effects.text : '') +
      (proficiency(m.cfg.c.id).n ? ' · 熟练 ' + proficiency(m.cfg.c.id).n : '') + '</div>' +
      '<div class="hp-wrap"><div class="hp-line"><span>HP</span><span>' + m.hp + ' / ' + m.maxHp + '</span></div>' +
      '<div class="hp-bar' + (pct < 30 ? ' low' : '') + '"><i style="width:' + pct + '%"></i></div></div>' +
      '<div class="st-line">' + st + buffs + '</div>';
  }

  function logLine(text, cls) {
    var b = state.battle;
    if (!b) return;
    b.log.push({ t: text, c: cls || '' });
    document.querySelectorAll('.log').forEach(function (box) {
      var p = el('p', cls || '');
      p.innerHTML = text;
      box.appendChild(p);
      box.scrollTop = box.scrollHeight;
    });
  }

  function aliveIdx(team) {
    return team.map(function (m, i) { return m.fainted ? -1 : i; }).filter(function (i) { return i >= 0; });
  }

  function calcDamage(attacker, defender, s) {
    var cat = s.category;
    if (cat === '变化' || !s.power) return { dmg: 0, type: 1, crit: false };
    var atkKey = cat === '物理' ? 'attack' : 'spAttack';
    var defKey = cat === '物理' ? 'defense' : 'spDefense';
    if (attacker.status['燃烧'] && cat === '物理') { }
    var L = attacker.cfg.level;
    var power = skillPowerFor(attacker, s);
    var A = eff(attacker, atkKey);
    var D = eff(defender, defKey);
    var base = (((2 * L) / 5 + 2) * power * (A / Math.max(1, D))) / 50 + 2;
    var tm = typeMult(s.type, defender.element);
    var stab = s.type === attacker.element ? 1.1 : 1;
    var wm = weatherMult((state.battle && state.battle.weather) || '晴朗', s.type);
    var tb1 = (attacker.effects && attacker.effects.boost[s.type]) || 1;
    var tb2 = (defender.effects && defender.effects.reduce[s.type]) || 1;
    var critChance = 0.0625 + ((attacker.effects && attacker.effects.crit) || 0);
    var crit = Math.random() < critChance;
    var dmg = base * tm * stab * wm * tb1 * tb2 * (crit ? 1.5 : 1) * rnd(0.85, 1);
    return { dmg: Math.max(1, Math.floor(dmg)), type: tm, crit: crit };
  }

  function applyStatus(target, s) {
    var d = s.description || '';
    var chance = 0.35;
    if (/灼烧|燃烧/.test(d) && Math.random() < chance) target.status['燃烧'] = 3;
    if (/中毒/.test(d) && Math.random() < chance) target.status['中毒'] = 3;
    if (/冰冻|冻结/.test(d) && Math.random() < 0.25) target.status['冰冻'] = 2;
    if (/流血/.test(d) && Math.random() < chance) target.status['流血'] = 3;
  }

  function applyBuff(mon, s) {
    var d = s.description || '';
    var isSelf = /自身|自己/.test(d) || !/对手|敌方/.test(d);
    var target = isSelf ? mon : mon;
    if (/提升.*物防|物防.*提升|提升物防/.test(d)) target.buffs.defense = clamp(target.buffs.defense + 1, -3, 3);
    if (/提升.*特防|特防.*提升/.test(d)) target.buffs.spDefense = clamp(target.buffs.spDefense + 1, -3, 3);
    if (/提升.*速度|速度.*提升/.test(d)) target.buffs.speed = clamp(target.buffs.speed + 1, -3, 3);
    if (/提升.*攻击|物攻.*提升/.test(d)) target.buffs.attack = clamp(target.buffs.attack + 1, -3, 3);
    if (/提升.*特攻|特攻.*提升/.test(d)) target.buffs.spAttack = clamp(target.buffs.spAttack + 1, -3, 3);
    if (/降低.*物防/.test(d)) target.buffs.defense = clamp(target.buffs.defense - 1, -3, 3);
    if (/护盾|守护|抵挡/.test(d)) target.shield += Math.floor(mon.maxHp * 0.25);
  }

  function spawnFx(mon, dmg, crit, heal) {
    var b = state.battle;
    if (!b || !mon) return;
    (b._fx = b._fx || []).push({ side: mon.side, name: mon.name, dmg: dmg, crit: crit, heal: heal });
  }

  function flushFx() {
    var b = state.battle;
    if (!b || !b._fx || !b._fx.length) return;
    var q = b._fx.slice();
    b._fx = [];
    q.forEach(function (x) {
      var host = null;
      if (b.mode === 'double') {
        var cards = document.querySelectorAll('#dblEnemy .dbl-card, #dblMine .dbl-card');
        for (var i = 0; i < cards.length; i++) {
          var nm = cards[i].querySelector('b');
          if (nm && nm.textContent.trim() === x.name) { host = cards[i]; break; }
        }
      } else {
        host = document.querySelector(x.side === 'my' ? '#myActive' : '#enemyActive');
      }
      if (!host) return;
      var f = document.createElement('span');
      f.className = 'dmg-float' + (x.crit ? ' crit' : '') + (x.heal ? ' heal' : '');
      f.textContent = (x.heal ? '+' : '-') + x.dmg;
      host.appendChild(f);
      setTimeout(function () { if (f.parentNode) f.remove(); }, 900);
      host.classList.add('hit-shake');
      setTimeout(function () { host.classList.remove('hit-shake'); }, 320);
    });
  }

  var STAT_CN2 = { hp: '生命', attack: '物攻', defense: '物防', spAttack: '特攻', spDefense: '特防', speed: '速度' };

  function applyFx(user, foe, s) {
    if (!s.fx || !s.fx.length) return;
    s.fx.forEach(function (f) {
      if (f.k === 'stat') {
        var who = f.who === 'self' ? user : foe;
        who.buffs[f.stat] = clamp((who.buffs[f.stat] || 0) + f.stage, -3, 3);
        logLine((f.who === 'self' ? user.name : foe.name) + ' 的' + STAT_CN2[f.stat] +
          (f.stage > 0 ? ' +' : ' ') + f.stage + '。');
      } else if (f.k === 'dmg') {
        if (Math.random() < (f.chance || 0.3)) {
          foe.status[f.status] = 3;
          logLine('<b>' + foe.name + '</b> 陷入「' + f.status + '」。');
        }
      } else if (f.k === 'heal') {
        var hl = Math.floor(user.maxHp * (f.pct || 0.28));
        user.hp = Math.min(user.maxHp, user.hp + hl);
        logLine(user.name + ' 回复了 <span class="eff">' + hl + '</span> 点生命。');
      } else if (f.k === 'shield') {
        user.shield += Math.floor(user.maxHp * (f.pct || 0.25));
        logLine(user.name + ' 获得了护盾。');
      } else if (f.k === 'guard') {
        user.protecting = true;
        user.guardRider = f.rider || null;
        user._guardReduce = f.reduce || 0.6;
        logLine(user.name + ' 进入防御姿态（减伤 ' + Math.round((1 - (f.reduce || 0.6)) * 100) + '%）。');
      }
    });
  }

  function useSkill(user, foe, s, dmgMult, opts) {
    opts = opts || {};
    if (s.ppNow <= 0) { logLine(user.name + ' 的技能没有 PP 了。'); return; }
    s.ppNow--;
    var label = '<b>' + user.name + '</b> 使用 <b>' + s.name + '</b>。';

    if (s.category === '变化') {
      applyFx(user, foe, s);
      return;
    }
    if (false) {
      var d = s.description || '';
      var tgtMon = opts.ally ? foe : user;
      if (/回复|治疗/.test(d)) {
        var heal = Math.floor(tgtMon.maxHp * 0.28);
        tgtMon.hp = Math.min(tgtMon.maxHp, tgtMon.hp + heal);
        spawnFx(tgtMon, heal, false, true);
        logLine(label + ' 回复了 <span class="eff">' + heal + '</span> 点生命。');
      } else {
        applyBuff(tgtMon, s);
        logLine(label + ' 状态发生了变化。');
      }
      if (/降低|削弱/.test(d)) {
        var key = /特防/.test(d) ? 'spDefense' : /物防/.test(d) ? 'defense' : /速度/.test(d) ? 'speed' : 'attack';
        foe.buffs[key] = clamp(foe.buffs[key] - 1, -3, 3);
      }
      return;
    }

    if (s.accuracy && Math.random() * 100 > s.accuracy) {
      logLine(label + ' 但是没有命中。');
      return;
    }

    var r = calcDamage(user, foe, s);
    var dmg = Math.max(1, Math.floor(r.dmg * (dmgMult || 1)));
    if (foe.protecting) {
      dmg = Math.max(1, Math.floor(dmg * (1 - (foe._guardReduce || 0.6))));
      if (foe.guardRider && foe.guardRider.weather && state.battle) {
        state.battle.weather = foe.guardRider.weather;
        logLine('天气变为「<b>' + foe.guardRider.weather + '</b>」，持续 ' + (foe.guardRider.turns || 5) + ' 回合。', 'turn');
        foe.guardRider = null;
      }
      var counter = Math.max(1, Math.floor(foe.maxHp / 16));
      user.hp = Math.max(0, user.hp - counter);
      logLine(foe.name + ' 保护反击，' + user.name + ' 受到 <span class="dmg">' + counter + '</span> 点反伤。');
    }
    if (foe.shield > 0) {
      var absorbed = Math.min(foe.shield, dmg);
      foe.shield -= absorbed;
      dmg -= absorbed;
      if (absorbed > 0) logLine('护盾吸收了 ' + absorbed + ' 点伤害。');
    }
    foe.hp = Math.max(0, foe.hp - dmg);
    spawnFx(foe, dmg, r.crit, false);

    var extra = '';
    if (r.type === 2) extra = ' <span class="eff">效果出众！</span>';
    else if (r.type === 0.5) extra = ' <span class="weak">收效甚微…</span>';
    if (r.crit) extra += ' <span class="crit">会心一击！</span>';
    logLine(label + ' 造成 <span class="dmg">' + dmg + '</span> 点伤害。' + extra);
    if (dmg > 0) applyFx(user, foe, s);
  }

  function endOfTurn(team) {
    team.forEach(function (m) {
      if (m.fainted) return;
      var tick = 0;
      if (m.status['燃烧']) { tick += Math.floor(m.maxHp / 16); m.status['燃烧']--; if (m.status['燃烧'] <= 0) delete m.status['燃烧']; }
      if (m.status['中毒']) { tick += Math.floor(m.maxHp / 12); m.status['中毒']--; if (m.status['中毒'] <= 0) delete m.status['中毒']; }
      if (m.status['流血']) { tick += Math.floor(m.maxHp / 16); m.status['流血']--; if (m.status['流血'] <= 0) delete m.status['流血']; }
      if (m.status['冰冻']) { m.status['冰冻']--; if (m.status['冰冻'] <= 0) delete m.status['冰冻']; }
      ['麻痹', '潮湿', '减速'].forEach(function (k) {
        if (m.status[k]) { m.status[k]--; if (m.status[k] <= 0) delete m.status[k]; }
      });
      if (tick > 0) {
        m.hp = Math.max(0, m.hp - tick);
        logLine(m.name + ' 受到状态伤害 <span class="dmg">' + tick + '</span>。');
      }
      if (m.effects && m.effects.heal > 0 && m.hp > 0 && m.hp < m.maxHp) {
        var hl = Math.max(1, Math.floor(m.maxHp * m.effects.heal));
        m.hp = Math.min(m.maxHp, m.hp + hl);
        logLine(m.name + ' 的特性回复了 <span class="eff">' + hl + '</span> 点体力。');
      }
    });
  }

  function checkFaint() {
    var b = state.battle;
    var out = false;
    [['my', b.myActive], ['enemy', b.enActive]].forEach(function (pair) {
      var side = pair[0], idx = pair[1];
      var m = (side === 'my' ? b.my : b.en)[idx];
      if (m && m.hp <= 0 && !m.fainted) {
        m.fainted = true;
        out = true;
        logLine('<b>' + m.name + '</b> 倒下了。', 'turn');
        if (m.effects && m.effects.onFaint) applyFaintTrait(m, side);
      }
    });
    return out;
  }

  function applyFaintTrait(mon, side) {
    var b = state.battle;
    var allies = side === 'my' ? b.my : b.en;
    var foes = side === 'my' ? b.en : b.my;
    var t = mon.effects.onFaint;
    var living = allies.filter(function (x) { return !x.fainted; });
    if (t.type === 'buffAlly' && living[0]) {
      ['attack', 'defense', 'spAttack', 'spDefense', 'speed'].forEach(function (k) { living[0].buffs[k] = clamp(living[0].buffs[k] + 1, -3, 3); });
      logLine(mon.name + ' 的特性为 ' + living[0].name + ' 提供了全属性 +1。');
    } else if (t.type === 'burst') {
      var foe = foes.filter(function (x) { return !x.fainted; })[0];
      if (foe) {
        var dmg = Math.floor(mon.maxHp / 10);
        foe.hp = Math.max(0, foe.hp - dmg);
    spawnFx(foe, dmg, r.crit, false);
        logLine(mon.name + ' 的特性对 ' + foe.name + ' 造成 <span class="dmg">' + dmg + '</span> 点伤害。');
      }
    } else if (t.type === 'shieldAlly' && living[0]) {
      living[0].shield += Math.floor(mon.maxHp * 0.2);
      logLine(mon.name + ' 的特性为 ' + living[0].name + ' 提供了护盾。');
    }
  }

  function afterFaint() {
    var b = state.battle;
    if (b.my[b.myActive].fainted) {
      var alive = aliveIdx(b.my);
      if (!alive.length) return finish(false);
      if (alive.length === 1) { switchTo('my', alive[0], false); }
      else {
        b.awaitingSwitch = true;
        logLine('请选择下一只上场的灵宠。', 'turn');
        renderBattle();
        return;
      }
    }
    if (b.en[b.enActive].fainted) {
      var ealive = aliveIdx(b.en);
      if (!ealive.length) return finish(true);
      b.enActive = ealive[0];
      logLine('敌方派出 <b>' + b.en[b.enActive].name + '</b>。');
    }
    b.awaitingSwitch = false;
    renderBattle();
  }

  function loadRecord() {
    try { return JSON.parse(localStorage.getItem('dex:battle') || 'null') || { games: 0, wins: 0, streak: 0, best: 0, recent: [] }; }
    catch (e) { return { games: 0, wins: 0, streak: 0, best: 0, recent: [] }; }
  }
  function saveRecord(r) {
    try { localStorage.setItem('dex:battle', JSON.stringify(r)); } catch (e) {}
    var box = document.getElementById('recordLine');
    if (box) {
      var hist = (r.recent || []).slice(-5).map(function (x) {
        return '<span class="recent-game ' + (x.w ? 'win' : 'lose') + '">' + (x.w ? '胜' : '负') + ' · ' + x.t + '回合</span>';
      }).join('');
      box.innerHTML = '战绩：<b>' + r.games + '</b> 场 · 胜 <b>' + r.wins + '</b> · 连胜 <b>' + r.streak + '</b>（最高 ' + r.best + '）' +
        (hist ? '<span class="recent-games">' + hist + '</span>' : '');
    }
  }

  function finishDraw() {
    var b = state.battle;
    b.over = true;
    b.winner = null;
    battleView.classList.add('hidden');
    resultView.classList.remove('hidden');
    step.textContent = '对战结束';
    resultTitle.innerHTML = '<span style="color:#8ea3b8">平局</span>';
    resultSub.textContent = '双方都撑过了 100 回合 · 共 ' + b.turn + ' 回合';
    b.replayCode = buildReplayCode();
    var rv = document.getElementById('replayBox');
    if (rv) { rv.value = b.replayCode; document.getElementById('replayArea').classList.remove('hidden'); }
  }

  function finish(win) {
    var rec = loadRecord();
    rec.games++;
    if (win) { rec.wins++; rec.streak++; if (rec.streak > rec.best) rec.best = rec.streak; }
    else { rec.streak = 0; }
    rec.recent = (rec.recent || []).slice(-4);
    rec.recent.push({ w: win ? 1 : 0, t: state.battle.turn, we: state.battle.weather, at: Date.now() });
    saveRecord(rec);
    var b = state.battle;
    b.over = true;
    b.winner = win;
    $('battleView').classList.add('hidden');
    $('resultView').classList.remove('hidden');
    $('step').textContent = '对战结束';
    $('resultTitle').innerHTML = win ? '<span class="win">胜利！</span>' : '<span class="lose">惜败…</span>';
    var left = aliveIdx(b.my).length, eleft = aliveIdx(b.en).length;
    resultSub.textContent = '我方剩余 ' + left + ' 只 · 敌方剩余 ' + eleft + ' 只 · 共 ' + b.turn + ' 回合 · 天气 ' + b.weather;
    b.replayCode = buildReplayCode();
    var rv = document.getElementById('replayBox');
    if (rv) {
      rv.value = b.replayCode;
      document.getElementById('replayArea').classList.remove('hidden');
    }
  }

  function switchTo(side, idx, manual) {
    var b = state.battle;
    if (side === 'my') {
      logLine('换上 <b>' + b.my[idx].name + '</b>。（换人消耗本回合行动）');
      b.myActive = idx;
    } else {
      b.enActive = idx;
    }
    b.awaitingSwitch = false;
    renderBattle();
    if (manual) { /* 切换消耗一回合 */ enemyAct(); }
  }

  function playerAct(skillIdx) {
    var b = state.battle;
    if (b.busy || b.over || b.awaitingSwitch) return;
    b.busy = true;
    var me = b.my[b.myActive], foe = b.en[b.enActive];
    var mySkill = skillIdx < 0 ? STRUGGLE : me.skills[skillIdx];
    var enemySkill = chooseAiSkill(foe, me);
    var aiSwitch = aiWantsSwitch(foe, me);
    if (aiSwitch >= 0) {
      logLine('敌方换上 <b>' + b.en[aiSwitch].name + '</b>（AI 判断换人更有利）。', 'turn');
      b.enActive = aiSwitch;
      foe = b.en[b.enActive];
    }

    var mySpeed = eff(me, 'speed') * (me.frozenSkip ? 1 : 1);
    var foeSpeed = eff(foe, 'speed');

    var myPri = skillPriority(mySkill), foePri = skillPriority(enemySkill);
    var order;
    if (myPri !== foePri) order = myPri > foePri ? [['my', mySkill], ['enemy', enemySkill]] : [['enemy', enemySkill], ['my', mySkill]];
    else order = mySpeed >= foeSpeed ? [['my', mySkill], ['enemy', enemySkill]] : [['enemy', enemySkill], ['my', mySkill]];
    if (myPri !== 0 || foePri !== 0) {
      if (myPri > foePri) logLine('（先手 +' + myPri + ' 抢在对手之前出手）');
      else if (myPri < foePri) logLine('（对手先手 +' + foePri + ' 抢先）');
      else if (myPri > 0) logLine('（双方先手相同，比速度）');
      else logLine('（双方先手 -1，必定后手）');
    }
    if (aiSwitch >= 0) order = order.filter(function (x) { return x[0] !== 'enemy'; });
    logLine('—— 第 ' + b.turn + ' 回合 ——', 'turn');

    for (var i = 0; i < order.length; i++) {
      if (b.over) break;
      var who = order[i][0], sk = order[i][1];
      var user = who === 'my' ? b.my[b.myActive] : b.en[b.enActive];
      var target = who === 'my' ? b.en[b.enActive] : b.my[b.myActive];
      if (user.fainted) continue;
      if (user.status['麻痹'] && Math.random() < 0.25) {
        logLine(user.name + ' 被麻痹了，无法行动。');
        continue;
      }
      if (user.status['冰冻'] && Math.random() < 0.3) {
        logLine(user.name + ' 被冻住了，无法行动。');
        continue;
      }
      useSkill(user, target, sk);
      checkFaint();
    }

    endOfTurn(b.my);
    endOfTurn(b.en);
    checkFaint();

    b.turn++;
    b.busy = false;
    if (b.turn > 100) { logLine('回合数达到上限，判定为平局。', 'turn'); return finishDraw(); }
    maybeWeather();

    if (aliveIdx(b.my).length === 0) return finish(false);
    if (aliveIdx(b.en).length === 0) return finish(true);

    if (b.my[b.myActive].fainted || b.en[b.enActive].fainted) {
      afterFaint();
    } else {
      renderBattle();
    }
  }

  function enemyAct() {
    // 手动换人后，敌方行动一次
    var b = state.battle;
    var foe = b.en[b.enActive], me = b.my[b.myActive];
    logLine('—— 敌方行动 ——', 'turn');
    useSkill(foe, me, chooseAiSkill(foe, me));
    checkFaint();
    endOfTurn(b.en);
    endOfTurn(b.my);
    if (aliveIdx(b.my).length === 0) return finish(false);
    if (aliveIdx(b.en).length === 0) return finish(true);
    if (b.my[b.myActive].fainted || b.en[b.enActive].fainted) afterFaint();
    else renderBattle();
  }

  function expectedDamage(attacker, defender) {
    var best = 0;
    attacker.skills.forEach(function (s) {
      if (s.ppNow <= 0 || s.category === '变化' || !s.power) return;
      var r = calcDamage(attacker, defender, s);
      if (r.dmg > best) best = r.dmg;
    });
    return best;
  }

  function aiWantsSwitch(ai, foe) {
    var b = state.battle;
    if (!b || b.ai !== 'hard') return -1;
    var best = expectedDamage(ai, foe);
    if (best > foe.maxHp * 0.22) return -1;
    var alt = -1, altScore = best;
    b.en.forEach(function (m, i) {
      if (i === b.enActive || m.fainted) return;
      var d = expectedDamage(m, foe);
      if (d > altScore) { altScore = d; alt = i; }
    });
    return alt;
  }

  var STRUGGLE = { name: '挣扎', type: '无', category: '物理', power: 40, accuracy: null, pp: 0, ppNow: 99, ppMax: 99, description: '无技能可用时的全力一撞，自身也会受到少量反伤。', learnLevel: 0 };

  function bindSkillTip(btn, skill) {
    var timer = null;
    var tip = null;
    function show() {
      hide();
      tip = document.createElement('div');
      tip.className = 'skill-tip';
      tip.innerHTML = '<b>' + skill.name + '</b>' +
        '<div class="tip-meta">' + skill.type + '系 · ' + skillCat(skill) + ' · ' +
        (skill.power ? '威力 ' + skill.power : '变化') +
        (skill.accuracy ? ' · 命中 ' + skill.accuracy : '') + ' · PP ' + skill.pp + '</div>' +
        '<p>' + (skill.description || '') + '</p>';
      document.body.appendChild(tip);
      var r = btn.getBoundingClientRect();
      var top = r.bottom + 8;
      if (top + 120 > window.innerHeight) top = r.top - 8 - tip.offsetHeight;
      tip.style.left = Math.min(window.innerWidth - 300, Math.max(8, r.left)) + 'px';
      tip.style.top = Math.max(8, top) + 'px';
    }
    function hide() { if (tip) { tip.remove(); tip = null; } }
    btn.addEventListener('pointerdown', function () { timer = setTimeout(show, 350); });
    ['pointerup', 'pointerleave', 'pointercancel', 'click'].forEach(function (ev) {
      btn.addEventListener(ev, function () { clearTimeout(timer); setTimeout(hide, 1200); });
    });
    btn.addEventListener('contextmenu', function (e) { e.preventDefault(); show(); });
  }

  function chooseAiSkill(attacker, defender) {
    var level = (state.battle && state.battle.ai) || 'normal';
    var usable = attacker.skills.filter(function (s) { return s.ppNow > 0; });
    if (!usable.length) return STRUGGLE;
    if (level === 'easy') return pick(usable);
    var best = null, bestScore = -1;
    attacker.skills.forEach(function (s) {
      if (s.ppNow <= 0) return;
      var score;
      if (s.category === '变化') {
        var d = s.description || '';
        score = /回复|治疗/.test(d) ? (attacker.hp < attacker.maxHp * 0.5 ? 70 : 10) : 25;
      } else {
        var r = calcDamage(attacker, defender, s);
        score = r.dmg * (0.9 + Math.random() * 0.2);
      }
      if (score > bestScore) { bestScore = score; best = s; }
    });
    if (!best) best = attacker.skills[0];
    // 高难度不随机；普通难度偶尔换招
    if (level !== 'hard' && Math.random() < 0.15) {
      var alt = pick(attacker.skills.filter(function (s) { return s.ppNow > 0; }));
      if (alt) best = alt;
    }
    return best;
  }

  /* ---------------- 回放 ---------------- */
  function buildReplayCode() {
    var b = state.battle;
    var payload = {
      v: 1, at: new Date().toISOString(), ai: b.ai, weather: b.weather,
      mode: b.mode || 'single',
      winner: b.winner ? 'my' : 'enemy', turns: b.turn,
      my: b.my.map(function (m) { return { n: m.name, lv: m.cfg.level, star: m.cfg.star, tal: m.cfg.talent, st: m.cfg.stage, na: m.cfg.nature }; }),
      en: b.en.map(function (m) { return { n: m.name, lv: m.cfg.level, star: m.cfg.star, tal: m.cfg.talent, st: m.cfg.stage, na: m.cfg.nature }; }),
      log: b.log.map(function (x) { return x.t; })
    };
    try { return btoa(unescape(encodeURIComponent(JSON.stringify(payload)))); } catch (e) { return ''; }
  }

  function decodeReplay(code) {
    try { return JSON.parse(decodeURIComponent(escape(atob(code)))); } catch (e) { return null; }
  }

  function showReplay(data, idx) {
    var box = document.getElementById('replayLog');
    if (!box) return;
    box.innerHTML = '';
    for (var i = 0; i <= idx && i < data.log.length; i++) {
      var p = document.createElement('p');
      p.innerHTML = data.log[i];
      box.appendChild(p);
    }
    box.scrollTop = box.scrollHeight;
    var lbl = document.getElementById('replayPos');
    if (lbl) lbl.textContent = (idx + 1) + ' / ' + data.log.length;
  }

  function startReplayPlayer(data) {
    document.getElementById('buildView').classList.add('hidden');
    document.getElementById('battleView').classList.add('hidden');
    document.getElementById('resultView').classList.add('hidden');
    var host = document.getElementById('replayView');
    host.classList.remove('hidden');
    document.getElementById('step').textContent = '回放 · ' + (data.winner === 'my' ? '我方胜利' : '敌方胜利');
    document.getElementById('replayHead').textContent =
      (data.mode === 'double' ? '【双打】 ' : '【单打】 ') +
      '我方：' + data.my.map(function (x) { return x.n; }).join('、') +
      '　｜　敌方：' + data.en.map(function (x) { return x.n; }).join('、') +
      '　｜　' + data.turns + ' 回合 · 天气 ' + data.weather;
    var idx = 0;
    showReplay(data, 0);
    document.getElementById('replayNext').onclick = function () {
      if (idx < data.log.length - 1) { idx++; showReplay(data, idx); }
    };
    document.getElementById('replayAll').onclick = function () {
      idx = data.log.length - 1; showReplay(data, idx);
    };
  }

  /* ---------------- 双打 ---------------- */
  var dbl = { on: false, b: null, pick: [null, null], target: [0, 0], ally: [false, false] };

  function setMode(on) {
    dbl.on = on;
    var t = document.getElementById('modeLabel');
    if (t) t.textContent = on ? '双打（2v2）' : '单打（1v1）';
    var b1 = document.getElementById('modeSingle');
    var b2 = document.getElementById('modeDouble');
    if (b1 && b2) { b1.classList.toggle('on', !on); b2.classList.toggle('on', on); }
  }

  function startDoubles() {
    bumpUsage(state.my);
    var b = {
      mode: 'double',
      my: state.my.map(function (cfg, i) { return makeMon(cfg, 'my', i); }),
      en: state.enemy.map(function (cfg, i) { return makeMon(cfg, 'enemy', i); }),
      mySlots: [0, 1], enSlots: [0, 1],
      turn: 1, log: [], over: false, busy: false, awaiting: false,
      weather: '晴朗', winner: null,
      ai: (document.getElementById('aiLevel') && document.getElementById('aiLevel').value) || 'normal'
    };
    dbl.b = b;
    state.battle = b;          // 共享函数（天气/日志）读这个
    dbl.pick = [null, null];
    dbl.target = [0, 0];
    document.getElementById('buildView').classList.add('hidden');
    document.getElementById('battleView').classList.add('hidden');
    document.getElementById('dblView').classList.remove('hidden');
    document.getElementById('step').textContent = '第 2 步 · 双打 · 第 1 回合';
    logLine('双打对战开始！', 'turn');
    logLine('我方 ' + b.my[0].name + ' + ' + b.my[1].name + '　VS　' + b.en[0].name + ' + ' + b.en[1].name);
    logLine('天气：<b>' + b.weather + '</b>（' + WEATHERS[b.weather].desc + '）');
    renderDoubles();
  }

  function dblMon(side, slot) {
    var b = dbl.b;
    var idx = (side === 'my' ? b.mySlots : b.enSlots)[slot];
    return (side === 'my' ? b.my : b.en)[idx];
  }

  function dblAliveSlot(side) {
    var b = dbl.b;
    var slots = side === 'my' ? b.mySlots : b.enSlots;
    return slots.map(function (_, s) { return s; }).filter(function (s) { return dblMon(side, s) && !dblMon(side, s).fainted; });
  }

  function dblCard(m, tag) {
    if (!m) return '<div class="dbl-card empty">—</div>';
    var src = DATA.images[m.cfg.c.imageKey] || '';
    var pct = Math.max(0, (m.hp / m.maxHp) * 100);
    var st = Object.keys(m.status).map(function (k) { return '<span class="chip bad">' + k + '</span>'; }).join('');
    if (m.shield > 0) st += '<span class="chip good">盾 ' + m.shield + '</span>';
    var buffs = Object.keys(m.buffs).filter(function (k) { return m.buffs[k] !== 0; })
      .map(function (k) { return '<span class="chip">' + STAT_LABEL[k] + (m.buffs[k] > 0 ? '+' : '') + m.buffs[k] + '</span>'; }).join('');
    return '<div class="dbl-card' + (m.fainted ? ' dead' : '') + '">' +
      '<span class="dbl-tag">' + tag + '</span>' +
      '<img src="' + src + '" alt="">' +
      '<b>' + m.name + '</b><small>Lv.' + m.cfg.level + ' · ' + m.element + '系' +
      (m.effects && m.effects.text ? ' · ' + m.effects.text : '') + '</small>' +
      '<div class="hp-bar' + (pct < 30 ? ' low' : '') + '"><i style="width:' + pct + '%"></i></div>' +
      '<div class="dbl-hp">' + m.hp + ' / ' + m.maxHp + '</div>' +
      '<div class="st-line">' + st + buffs + '</div></div>';
  }

  function renderDoubles() {
    var b = dbl.b;
    if (!b) return;
    document.getElementById('dblEnemy').innerHTML = dblCard(dblMon('enemy', 0), '敌A · 前排') + dblCard(dblMon('enemy', 1), '敌B · 后排');
    document.getElementById('dblMine').innerHTML = dblCard(dblMon('my', 0), '我A · 前排') + dblCard(dblMon('my', 1), '我B · 后排');
    var wb = document.getElementById('dblWeather');
    if (wb) wb.innerHTML = '天气 <b>' + b.weather + '</b> · ' + WEATHERS[b.weather].desc;
    document.getElementById('step').textContent = '第 2 步 · 双打 · 第 ' + b.turn + ' 回合';

    var host = document.getElementById('dblActions');
    host.innerHTML = '';
    var cf = document.getElementById('dblConfirm');
    if (cf) cf.disabled = !!b.awaiting;
    [0, 1].forEach(function (slot) {
      var m = dblMon('my', slot);
      var row = el('div', 'dbl-row');
      var name = ['我A', '我B'][slot];
      if (!m || m.fainted) { row.innerHTML = '<span class="dbl-name">' + name + '（已倒下）</span>'; host.appendChild(row); return; }
      row.appendChild(el('span', 'dbl-name', name + ' · ' + m.name));
      var skRow = el('div', 'dbl-skills');
      var pbtn = el('button', 'skill-btn protect-btn' + (dbl.pick[slot] === 'protect' ? ' picked' : ''));
      pbtn.innerHTML = '<b>保护</b><small>本回合减伤 60%（不可连续）</small>';
      pbtn.disabled = b.busy || m.protectUsed;
      pbtn.addEventListener('click', function () { dbl.pick[slot] = 'protect'; renderDoubles(); });
      skRow.appendChild(pbtn);
      m.skills.forEach(function (s, i) {
        var btn = el('button', 'skill-btn' + (dbl.pick[slot] === i ? ' picked' : ''));
        bindSkillTip(btn, s);
        var isChange = s.category === '变化';
        var spread = /范围|全体|领域/.test(s.description || '');
        var tgt = isChange ? (dbl.ally[slot] ? '友' : '自') : (spread ? 'A+B' : (dbl.target[slot] === 0 ? 'A' : 'B'));
        btn.innerHTML = '<span class="pp">PP ' + s.ppNow + '</span><b>' + s.name + '</b>' +
          '<small>' + s.type + '系 · ' + skillCat(s) + ' · ' + (s.power ? '威力 ' + s.power : '变化') + '</small>' +
          '<span class="tgt">' + tgt + '</span>';
        btn.disabled = s.ppNow <= 0 || b.busy;
        btn.addEventListener('click', function (e) {
          if (dbl.pick[slot] === i) {
            if (isChange) dbl.ally[slot] = !dbl.ally[slot];
            else if (!spread) dbl.target[slot] = dbl.target[slot] === 0 ? 1 : 0;
          } else {
            dbl.pick[slot] = i;
          }
          renderDoubles();
        });
        skRow.appendChild(btn);
      });
      var swp = el('button', 'skill-btn swap-btn', '<b>⇄ 换位</b><small>与前排交换位置</small>');
      swp.disabled = b.busy || b.swapped;
      swp.addEventListener('click', function () {
        if (b.swapped) return;
        var t0 = b.mySlots[0], t1 = b.mySlots[1];
        b.mySlots[0] = t1; b.mySlots[1] = t0;
        b.swapped = true;
        dbl.pick = [null, null];
        logLine('我方调整站位：前排 ' + dblMon('my', 0).name + '，后排 ' + dblMon('my', 1).name + '。');
        renderDoubles();
      });
      row.appendChild(swp);
      row.appendChild(skRow);
      host.appendChild(row);
    });

    var sw = document.getElementById('dblSwitch');
    sw.innerHTML = b.awaiting ? '<div class="await-tip">请选择替补上场（' + b.awaiting.length + ' 个空位）</div>' : '';
    b.my.forEach(function (m, i) {
      if (b.mySlots.indexOf(i) >= 0 || m.fainted) return;
      var btn = el('button', 'switch-btn', m.name + ' · ' + m.hp + '/' + m.maxHp);
      btn.disabled = b.busy && !b.awaiting;
      if (b.awaiting) btn.classList.add('urge');
      btn.addEventListener('click', function () { dblSwitchIn(i); });
      sw.appendChild(btn);
    });
    flushFx();
  }

  function dblSwitchIn(idx) {
    var b = dbl.b;
    var slot = b.mySlots.findIndex(function (i) {
      var m = b.my[i];
      return !m || m.fainted;
    });
    if (slot < 0) { logLine('场上没有空位，无法换人。'); return; }
    logLine('换上 <b>' + b.my[idx].name + '</b>。');
    b.mySlots[slot] = idx;
    if (b.awaiting) {
      b.awaiting = b.awaiting.filter(function (s) { return s !== slot; });
      if (!b.awaiting.length) b.awaiting = null;
    }
    renderDoubles();
  }

  function dblConfirm() {
    var b = dbl.b;
    if (b.busy || b.over) return;
    var acts = [];
    [0, 1].forEach(function (slot) {
      var m = dblMon('my', slot);
      if (!m || m.fainted) return;
      if (dbl.pick[slot] === 'protect') {
        acts.push({ side: 'my', slot: slot, mon: m, protect: true });
        return;
      }
      var si = dbl.pick[slot];
      var s = si == null ? null : m.skills[si];
      if (!s || s.ppNow <= 0) {
        s = m.skills.filter(function (x) { return x.ppNow > 0; })[0] || STRUGGLE;
      }
      acts.push({ side: 'my', slot: slot, mon: m, skill: s, target: dbl.target[slot], ally: dbl.ally[slot] && s.category === '变化' });
    });
    var myAliveSlots = [0, 1].filter(function (t) { var m = dblMon('my', t); return m && !m.fainted; });
    var focus = -1;
    if (b.ai === 'hard' && myAliveSlots.length === 2) {
      var weakest = myAliveSlots.slice().sort(function (x, y) { return dblMon('my', x).hp - dblMon('my', y).hp; })[0];
      var total = 0;
      b.enSlots.forEach(function (_, slot2) {
        var em = dblMon('enemy', slot2);
        if (!em || em.fainted) return;
        total += expectedDamage(em, dblMon('my', weakest));
      });
      if (total >= dblMon('my', weakest).hp * 0.9) focus = weakest;
    }
    var splitIdx = 0;
    b.enSlots.forEach(function (_, slot) {
      var m = dblMon('enemy', slot);
      if (!m || m.fainted) return;
      var s = chooseAiSkill(m, dblMon('my', 0) || m);
      var tg;
      if (focus >= 0) tg = focus;
      else if (b.ai === 'hard' && myAliveSlots.length === 2) { tg = myAliveSlots[splitIdx % 2]; splitIdx++; }
      else tg = Math.random() < 0.5 ? 0 : 1;
      acts.push({ side: 'enemy', slot: slot, mon: m, skill: s, target: tg });
    });

    acts.sort(function (a, c) {
      var pa = a.protect ? 3 : skillPriority(a.skill);
      var pc = c.protect ? 3 : skillPriority(c.skill);
      if (pa !== pc) return pc - pa;
      return eff(c.mon, 'speed') - eff(a.mon, 'speed');
    });

    b.busy = true;
    logLine('—— 第 ' + b.turn + ' 回合 ——', 'turn');
    acts.forEach(function (a) {
      if (b.over) return;
      if (a.mon.fainted) return;
      if (a.protect) {
        var streak = a.mon.protectStreak || 0;
        var rate = streak === 0 ? 1 : streak === 1 ? 0.5 : 0.25;
        if (Math.random() <= rate) {
          a.mon.protecting = true;
          a.mon.protectStreak = streak + 1;
          logLine('<b>' + a.mon.name + '</b> 进入保护状态。');
        } else {
          a.mon.protectStreak = 0;
          logLine('<b>' + a.mon.name + '</b> 的保护失败了。');
        }
        return;
      }
      var foeSide = a.side === 'my' ? 'enemy' : 'my';
      var teamOfFoe = foeSide === 'my' ? b.my : b.en;
      var slotsOfFoe = foeSide === 'my' ? b.mySlots : b.enSlots;
      var ti = a.target;
      // 前后排：物理单体技先打前排(slot 0)，前排活着不能直接打后排
      if (a.skill.category === '物理' && ti === 1) {
        var front = dblMon(foeSide, 0);
        if (front && !front.fainted) { ti = 0; }
      }
      var foe = dblMon(foeSide, ti) || dblMon(foeSide, 1 - ti);
      if (!foe || foe.fainted) foe = teamOfFoe.filter(function (m) { return !m.fainted; })[0];
      if (!foe) return;
      if (a.ally) {
        // 友方目标：作用于自己一方的另一只（治疗/增益）
        var allyMon = dblMon(a.side, 1 - a.slot) || a.mon;
        useSkill(a.mon, allyMon, a.skill, 1, { ally: true });
        return;
      }
      if (a.mon.status['麻痹'] && Math.random() < 0.25) { logLine(a.mon.name + ' 被麻痹了，无法行动。'); return; }
      if (a.mon.status['冰冻'] && Math.random() < 0.3) { logLine(a.mon.name + ' 被冻住了。'); return; }
      var spread = /范围|全体|领域/.test(a.skill.description || '');
      if (spread) {
        [0, 1].forEach(function (s2) {
          var t2 = dblMon(foeSide, s2);
          if (t2 && !t2.fainted) useSkill(a.mon, t2, a.skill, 0.75);
        });
      } else {
        useSkill(a.mon, foe, a.skill);
      }
    });

    endOfTurn(b.my); endOfTurn(b.en);
    dblCheckFaint();
    b.swapped = false;
    b.my.concat(b.en).forEach(function (m) {
      if (!m.protecting) m.protectStreak = 0;
      m.protecting = false;
      m.protectUsed = false;
    });
    b.turn++;
    b.busy = false;
    dbl.pick = [null, null];
    if (b.turn > 100) { finishDraw(); return; }
    maybeWeather();
    if (dblAliveSlot('my').length === 0) return dblFinish(false);
    if (dblAliveSlot('enemy').length === 0) return dblFinish(true);
    // 敌方自动补位；我方由玩家手选
    b.enSlots.forEach(function (idx, s) {
      if (b.en[idx] && !b.en[idx].fainted) return;
      var next = b.en.map(function (m, i) { return { m: m, i: i }; })
        .filter(function (x) { return !x.m.fainted && b.enSlots.indexOf(x.i) < 0; })[0];
      if (next) {
        b.enSlots[s] = next.i;
        logLine('敌方换上 <b>' + next.m.name + '</b>。');
      }
    });
    var emptyMy = [];
    b.mySlots.forEach(function (idx, s) { if (!b.my[idx] || b.my[idx].fainted) emptyMy.push(s); });
    if (emptyMy.length) {
      var benchAlive = b.my.filter(function (m, i) { return !m.fainted && b.mySlots.indexOf(i) < 0; });
      if (!benchAlive.length) { renderDoubles(); return dblFinish(false); }
      b.awaiting = emptyMy;
      logLine('请选择替补上场（' + emptyMy.length + ' 个空位）。', 'turn');
      renderDoubles();
      return;
    }
    b.awaiting = null;
    renderDoubles();
  }

  function dblCheckFaint() {
    var b = dbl.b;
    ['my', 'enemy'].forEach(function (side) {
      var team = side === 'my' ? b.my : b.en;
      var slots = side === 'my' ? b.mySlots : b.enSlots;
      slots.forEach(function (i) {
        var m = team[i];
        if (m && m.hp <= 0 && !m.fainted) {
          m.fainted = true;
          logLine('<b>' + m.name + '</b> 倒下了。', 'turn');
          if (m.effects && m.effects.onFaint) applyFaintTrait(m, side);
        }
      });
    });
  }

  function dblFinish(win) {
    var b = dbl.b;
    b.over = true;
    b.winner = win;
    var rec = loadRecord();
    rec.games++;
    if (win) { rec.wins++; rec.streak++; if (rec.streak > rec.best) rec.best = rec.streak; }
    else { rec.streak = 0; }
    rec.recent = (rec.recent || []).slice(-4);
    rec.recent.push({ w: win ? 1 : 0, t: b.turn, we: b.weather, at: Date.now() });
    saveRecord(rec);
    if (win) {
      var got = awardBook();
      if (got) { logLine('获得技能书《' + got.name + '》（' + got.cname + '）', 'turn'); showBookDrop(got, false); }
      if (rec.streak > 0 && rec.streak % 3 === 0) {
        var bonus = awardBook();
        if (bonus) { logLine('连胜 ' + rec.streak + ' 场奖励：技能书《' + bonus.name + '》', 'turn'); showBookDrop(bonus, true); }
      }
    }

    document.getElementById('dblView').classList.add('hidden');
    document.getElementById('resultView').classList.remove('hidden');
    document.getElementById('step').textContent = '对战结束';
    document.getElementById('resultTitle').innerHTML = win ? '<span class="win">胜利！</span>' : '<span class="lose">惜败…</span>';
    document.getElementById('resultSub').textContent = '双打 · 共 ' + b.turn + ' 回合 · 天气 ' + b.weather;
    b.replayCode = buildReplayCode();
    var rv = document.getElementById('replayBox');
    if (rv) { rv.value = b.replayCode; document.getElementById('replayArea').classList.remove('hidden'); }
  }

  /* ---------------- 初始化 ---------------- */
  function boot() {
    fetch('/data/content.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        DATA = d;
        renderSlots();
        saveRecord(loadRecord());
        if (loadTeam()) { renderSlots(); }
        $('mboxCancel').addEventListener('click', function () { $('modal').hidden = true; });
        $('mboxOk').addEventListener('click', function () {
          var e = state.editing;
          if (e && e.cfg && e.cfg.skills.length === 4) {
            state[e.side][e.idx] = e.cfg;
          } else if (e && e.cfg) {
            alert('请选满 4 个技能');
            return;
          }
          $('modal').hidden = true;
          renderSlots();
        });
        $('myRandom').addEventListener('click', function () { randomTeam('my'); });
        var m1 = document.getElementById('modeSingle');
        var m2 = document.getElementById('modeDouble');
        if (m1) m1.addEventListener('click', function () { setMode(false); });
        if (m2) m2.addEventListener('click', function () { setMode(true); });
        var conf = document.getElementById('dblConfirm');
        if (conf) conf.addEventListener('click', dblConfirm);
        var dg = document.getElementById('dblGiveUp');
        if (dg) dg.addEventListener('click', function () { if (!confirm('确定认输吗？')) return; document.getElementById('dblView').classList.add('hidden'); document.getElementById('buildView').classList.remove('hidden'); setMode(false); });
        $('enemyRandom').addEventListener('click', function () { randomTeam('enemy'); });
        $('clearAll').addEventListener('click', function () {
          state.my = new Array(6).fill(null);
          state.enemy = new Array(6).fill(null);
          renderSlots();
        });
        $('startBattle').addEventListener('click', function () {
          sanitizeTeam();
          saveTeam();
          if (dbl.on) startDoubles(); else startBattle();
        });
        $('giveUp').addEventListener('click', function () {
          if (!confirm('确定认输并返回组队吗？本局不算胜利。')) return;
          state.battle = null;
          state.battle = null;
          $('battleView').classList.add('hidden');
          $('buildView').classList.remove('hidden');
          $('step').textContent = '第 1 步 · 组队';
          renderSlots();
        });
        document.getElementById('copyReplay').addEventListener('click', function () {
          var v = document.getElementById('replayBox');
          v.select();
          try { document.execCommand('copy'); this.textContent = '已复制'; } catch (e) { this.textContent = '请手动复制'; }
        });
        document.getElementById('downloadReplay').addEventListener('click', function () {
          var code = document.getElementById('replayBox').value;
          var data = decodeReplay(code);
          var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'aoling-battle-' + Date.now() + '.json';
          a.click();
        });

        var m = /replay=([^&]+)/.exec(location.hash);
        if (m) {
          var data2 = decodeReplay(decodeURIComponent(m[1]));
          if (data2) startReplayPlayer(data2);
        }

        $('again').addEventListener('click', function () {
          state.battle = null;
          $('resultView').classList.add('hidden');
          $('buildView').classList.remove('hidden');
          $('step').textContent = '第 1 步 · 组队';
          $('log').innerHTML = '';
          renderSlots();
        });
      })
      .catch(function (e) {
        document.querySelector('.wrap').innerHTML = '<p style="color:#b3153f">加载失败：' + e.message + '</p>';
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
