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

  function computeStats(cfg) {
    var c = cfg.c;
    var L = cfg.level;
    var mult = (1 + (cfg.star - 1) * 0.03) * (1 + (cfg.stage - 1) * 0.05) * (TALENT_SKILL[cfg.talent] || 1);
    var nat = natureOf(cfg.nature);
    var out = {};
    ['hp', 'attack', 'defense', 'spAttack', 'spDefense', 'speed'].forEach(function (k) {
      var base = c[k] || 0;
      var v;
      if (k === 'hp') {
        v = Math.floor(((2 * base + 31) * L) / 100) + L + 10 + Math.floor((cfg.evs.hp || 0) / 4);
      } else {
        v = Math.floor(((2 * base + 31) * L) / 100 + 5) + Math.floor((cfg.evs[k] || 0) / 4);
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

  function makeMon(cfg, side, idx) {
    var st = computeStats(cfg);
    return {
      cfg: cfg, side: side, idx: idx,
      name: cfg.c.name, element: cfg.c.element,
      maxHp: st.hp, hp: st.hp,
      stats: st,
      skills: cfg.skills.map(function (s) { return Object.assign({}, s, { ppMax: s.pp || 20, ppNow: s.pp || 20 }); }),
      buffs: { attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0 },
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
    return Math.floor(mon.stats[key] * buffMult(mon.buffs[key]));
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
    var evs = { hp: 0, attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0 };
    return {
      c: c, level: 30, star: Math.min(9, st * 2), talent: Math.min(8, st + 2),
      stage: st, nature: '坦率', evs: evs,
      skills: DATA.skills[String(c.id)].slice(0, 4),
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
      var card = el('div', 'sk' + (on ? ' on' : ''),
        '<b>' + s.name + '</b>' +
        '<small><span class="tag">' + s.type + '系</span><span class="tag">' + skillCat(s) + '</span>' +
        (s.power ? '威力 ' + s.power : '变化') + ' · ' + (s.accuracy ? '命中 ' + s.accuracy : '—') + '</small>');
      card.addEventListener('click', function () {
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
      cfg.level = 40;
      cfg.nature = pick(['保守', '固执', '胆小', '大胆', '沉着', '开朗']);
      var keys = ['hp', 'attack', 'defense', 'spAttack', 'spDefense', 'speed'];
      var main = cfg.skills[0] && cfg.skills[0].category === '物理' ? 'attack' : 'spAttack';
      cfg.evs = { hp: 252, attack: 0, defense: 0, spAttack: 0, spDefense: 4, speed: 252 };
      cfg.evs[main] = 252;
      cfg.evs = { hp: 4, attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0 };
      cfg.evs[main] = 252;
      cfg.evs.speed = 252;
      cfg.evs.hp = 6;
      state[side][i] = cfg;
    }
    renderSlots();
  }

  /* ---------------- 战斗 ---------------- */
  function startBattle() {
    if (!state.my.every(Boolean) || !state.enemy.every(Boolean)) return;
    state.battle = {
      my: state.my.map(function (cfg, i) { return makeMon(cfg, 'my', i); }),
      en: state.enemy.map(function (cfg, i) { return makeMon(cfg, 'enemy', i); }),
      myActive: 0, enActive: 0,
      turn: 1, log: [], over: false, busy: false,
      awaitingSwitch: false
    };
    $('buildView').classList.add('hidden');
    $('battleView').classList.remove('hidden');
    $('resultView').classList.add('hidden');
    $('step').textContent = '第 2 步 · 战斗';
    renderBattle();
    logLine('对战开始！', 'turn');
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

    var bar = $('skillBar');
    bar.innerHTML = '';
    mm.skills.forEach(function (s, i) {
      var btn = el('button', 'skill-btn');
      btn.innerHTML = '<span class="pp">PP ' + s.ppNow + '/' + s.ppMax + '</span><b>' + s.name + '</b>' +
        '<small>' + s.type + '系 · ' + skillCat(s) + ' · ' + (s.power ? '威力 ' + s.power : '变化') +
        (s.accuracy ? ' · 命中 ' + s.accuracy : '') + '</small>';
      btn.disabled = s.ppNow <= 0 || b.busy || b.awaitingSwitch;
      btn.addEventListener('click', function () { playerAct(i); });
      bar.appendChild(btn);
    });

    var sw = $('switchBar');
    sw.innerHTML = '';
    b.my.forEach(function (m, i) {
      if (i === b.myActive) return;
      var btn = el('button', 'switch-btn', m.name + (m.fainted ? '（倒下）' : ' · ' + m.hp + '/' + m.maxHp));
      btn.disabled = m.fainted || b.busy;
      btn.addEventListener('click', function () { switchTo('my', i, true); });
      sw.appendChild(btn);
    });
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
      '<div class="tags">Lv.' + m.cfg.level + ' · ' + m.element + '系 · ' + m.cfg.nature + '</div>' +
      '<div class="hp-wrap"><div class="hp-line"><span>HP</span><span>' + m.hp + ' / ' + m.maxHp + '</span></div>' +
      '<div class="hp-bar' + (pct < 30 ? ' low' : '') + '"><i style="width:' + pct + '%"></i></div></div>' +
      '<div class="st-line">' + st + buffs + '</div>';
  }

  function logLine(text, cls) {
    var b = state.battle;
    if (!b) return;
    b.log.push({ t: text, c: cls || '' });
    var box = $('log');
    if (!box) return;
    var p = el('p', cls || '');
    p.innerHTML = text;
    box.appendChild(p);
    box.scrollTop = box.scrollHeight;
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
    var crit = Math.random() < 0.0625;
    var dmg = base * tm * stab * (crit ? 1.5 : 1) * rnd(0.85, 1);
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

  function useSkill(user, foe, s) {
    if (s.ppNow <= 0) { logLine(user.name + ' 的技能没有 PP 了。'); return; }
    s.ppNow--;
    var label = '<b>' + user.name + '</b> 使用 <b>' + s.name + '</b>。';

    if (s.category === '变化') {
      var d = s.description || '';
      if (/回复|治疗/.test(d)) {
        var heal = Math.floor(user.maxHp * 0.28);
        user.hp = Math.min(user.maxHp, user.hp + heal);
        logLine(label + ' 回复了 <span class="eff">' + heal + '</span> 点生命。');
      } else {
        applyBuff(user, s);
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
    var dmg = r.dmg;
    if (foe.shield > 0) {
      var absorbed = Math.min(foe.shield, dmg);
      foe.shield -= absorbed;
      dmg -= absorbed;
      if (absorbed > 0) logLine('护盾吸收了 ' + absorbed + ' 点伤害。');
    }
    foe.hp = Math.max(0, foe.hp - dmg);

    var extra = '';
    if (r.type === 2) extra = ' <span class="eff">效果出众！</span>';
    else if (r.type === 0.5) extra = ' <span class="weak">收效甚微…</span>';
    if (r.crit) extra += ' <span class="crit">会心一击！</span>';
    logLine(label + ' 造成 <span class="dmg">' + dmg + '</span> 点伤害。' + extra);
    if (dmg > 0) applyStatus(foe, s);
  }

  function endOfTurn(team) {
    team.forEach(function (m) {
      if (m.fainted) return;
      var tick = 0;
      if (m.status['燃烧']) { tick += Math.floor(m.maxHp / 16); m.status['燃烧']--; if (m.status['燃烧'] <= 0) delete m.status['燃烧']; }
      if (m.status['中毒']) { tick += Math.floor(m.maxHp / 12); m.status['中毒']--; if (m.status['中毒'] <= 0) delete m.status['中毒']; }
      if (m.status['流血']) { tick += Math.floor(m.maxHp / 16); m.status['流血']--; if (m.status['流血'] <= 0) delete m.status['流血']; }
      if (m.status['冰冻']) { m.status['冰冻']--; if (m.status['冰冻'] <= 0) delete m.status['冰冻']; }
      if (tick > 0) {
        m.hp = Math.max(0, m.hp - tick);
        logLine(m.name + ' 受到状态伤害 <span class="dmg">' + tick + '</span>。');
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
      }
    });
    return out;
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

  function finish(win) {
    var b = state.battle;
    b.over = true;
    $('battleView').classList.add('hidden');
    $('resultView').classList.remove('hidden');
    $('step').textContent = '对战结束';
    $('resultTitle').innerHTML = win ? '<span class="win">胜利！</span>' : '<span class="lose">惜败…</span>';
    var left = aliveIdx(b.my).length, eleft = aliveIdx(b.en).length;
    $('resultSub').textContent = '我方剩余 ' + left + ' 只 · 敌方剩余 ' + eleft + ' 只 · 共 ' + b.turn + ' 回合';
  }

  function switchTo(side, idx, manual) {
    var b = state.battle;
    if (side === 'my') {
      logLine('换上 <b>' + b.my[idx].name + '</b>。');
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
    var mySkill = me.skills[skillIdx];
    var enemySkill = chooseAiSkill(foe, me);

    var mySpeed = eff(me, 'speed') * (me.frozenSkip ? 1 : 1);
    var foeSpeed = eff(foe, 'speed');

    var order = mySpeed >= foeSpeed ? [['my', mySkill], ['enemy', enemySkill]] : [['enemy', enemySkill], ['my', mySkill]];
    logLine('—— 第 ' + b.turn + ' 回合 ——', 'turn');

    for (var i = 0; i < order.length; i++) {
      if (b.over) break;
      var who = order[i][0], sk = order[i][1];
      var user = who === 'my' ? b.my[b.myActive] : b.en[b.enActive];
      var target = who === 'my' ? b.en[b.enActive] : b.my[b.myActive];
      if (user.fainted) continue;
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

  function chooseAiSkill(attacker, defender) {
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
    // 一点随机性，避免每回合都一样
    if (Math.random() < 0.15) {
      var alt = pick(attacker.skills.filter(function (s) { return s.ppNow > 0; }));
      if (alt) best = alt;
    }
    return best;
  }

  /* ---------------- 初始化 ---------------- */
  function boot() {
    fetch('/data/content.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        DATA = d;
        renderSlots();
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
        $('enemyRandom').addEventListener('click', function () { randomTeam('enemy'); });
        $('clearAll').addEventListener('click', function () {
          state.my = new Array(6).fill(null);
          state.enemy = new Array(6).fill(null);
          renderSlots();
        });
        $('startBattle').addEventListener('click', startBattle);
        $('giveUp').addEventListener('click', function () {
          state.battle = null;
          $('battleView').classList.add('hidden');
          $('buildView').classList.remove('hidden');
          $('step').textContent = '第 1 步 · 组队';
          renderSlots();
        });
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
