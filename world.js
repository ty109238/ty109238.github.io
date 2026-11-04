/* 状态 / 环境图鉴 */
(function () {
  'use strict';
  var DATA = null;
  var kind = document.body.getAttribute('data-kind');
  var ELEM_ICON = { 火: 'fire', 水: 'water', 草: 'grass', 冰: 'ice', 土: 'rock', 钢: 'steel', 风: 'wind', 光: 'light', 暗: 'dark', 雷: 'thunder' };

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function card(opts) {
    var c = el('article', 'w-card ' + (opts.tone || ''));
    var head = '<div class="w-head">' +
      (opts.icon ? '<img src="/media/ui/' + opts.icon + '" alt="">' : '') +
      '<h3>' + opts.name + '</h3>' +
      (opts.tag ? '<span class="w-tag">' + opts.tag + '</span>' : '') +
      '</div>';
    c.innerHTML = head +
      (opts.sub ? '<div class="w-sub">' + opts.sub + '</div>' : '') +
      '<p class="w-effect">' + opts.effect + '</p>' +
      (opts.value ? '<p class="w-value"><b>数值</b> ' + opts.value + '</p>' : '') +
      (opts.rule ? '<p class="w-rule"><b>交互</b> ' + opts.rule + '</p>' : '');
    return c;
  }

  function renderStatus() {
    document.getElementById('intro').textContent =
      '战斗中会出现的全部 ' + DATA.statuses.length + ' 种状态：17 种图标全部配备数值说明与交互规则。负面状态每回合结算，持续回合数到期后自动解除。';
    var grid = document.getElementById('grid');
    DATA.statuses.forEach(function (s) {
      grid.appendChild(card({
        name: s.name,
        icon: (s.icon || 'status-guard') + '.webp',
        tag: s.kind === 'debuff' ? '负面' : '增益',
        tone: s.kind === 'debuff' ? 'bad' : 'good',
        effect: s.effect,
        value: s.value,
        rule: s.rule,
        sub: s.summary,
      }));
    });
    document.getElementById('count').textContent = '共 ' + DATA.statuses.length + ' 种状态';
  }

  function renderEnv() {
    document.getElementById('intro').textContent =
      '天气每回合可能变化；场地决定整个战场的规则。天气 + 场地 = 环境，环境会叠加一层更强的效果（共 ' +
      DATA.environments.length + ' 种组合）。';
    var grid = document.getElementById('grid');

    var wTitle = el('h2', 'w-section', '天气（' + DATA.weathers.length + '）');
    grid.appendChild(wTitle);
    DATA.weathers.forEach(function (w) {
      grid.appendChild(card({
        name: w.name,
        icon: w.icon ? w.icon + '.webp' : 'elem-' + (ELEM_ICON[w.element] || 'fire') + '.webp',
        tag: w.element + '系',
        tone: 'weather',
        effect: w.effect,
      }));
    });

    var tTitle = el('h2', 'w-section', '场地（' + DATA.terrains.length + '）');
    grid.appendChild(tTitle);
    DATA.terrains.forEach(function (t) {
      grid.appendChild(card({
        name: t.name,
        icon: t.icon ? t.icon + '.webp' : 'elem-' + (ELEM_ICON[t.element] || 'fire') + '.webp',
        tag: t.element + '系',
        tone: 'terrain',
        effect: t.effect,
      }));
    });

    var eTitle = el('h2', 'w-section', '环境组合（' + DATA.environments.length + '）');
    grid.appendChild(eTitle);
    DATA.environments.forEach(function (e) {
      var c = el('article', 'w-card env');
      c.innerHTML =
        '<div class="w-head">' + (e.icon ? '<img src="/media/ui/' + e.icon + '.webp" alt="">' : '') +
        '<h3>' + e.name + '</h3><span class="w-tag env-tag">环境</span></div>' +
        '<div class="w-combo"><span class="c-weather">' + e.weather + '</span><b>＋</b><span class="c-terrain">' + e.terrain + '</span></div>' +
        '<p class="w-effect">' + e.effect + '</p>';
      grid.appendChild(c);
    });

    document.getElementById('count').textContent =
      '天气 ' + DATA.weathers.length + ' · 场地 ' + DATA.terrains.length + ' · 环境 ' + DATA.environments.length;
  }

  function boot() {
    fetch('/world.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        DATA = d;
        if (kind === 'env') renderEnv(); else renderStatus();
      })
      .catch(function (e) {
        document.querySelector('.w-wrap').innerHTML = '<p style="color:#b3153f">加载失败：' + e.message + '</p>';
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
