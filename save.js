(function () {
  'use strict';
  var KEYS = ['dex:books', 'dex:usage', 'dex:team', 'dex:battle'];
  function $(id) { return document.getElementById(id); }

  function snapshot() {
    var o = { v: 1, at: new Date().toISOString(), data: {} };
    KEYS.forEach(function (k) {
      try { var raw = localStorage.getItem(k); if (raw) o.data[k] = JSON.parse(raw); } catch (e) {}
    });
    return o;
  }

  function encode(obj) {
    try { return btoa(unescape(encodeURIComponent(JSON.stringify(obj)))); } catch (e) { return ''; }
  }
  function decode(txt) {
    try { return JSON.parse(decodeURIComponent(escape(atob(txt.trim())))); } catch (e) { return null; }
  }

  function refreshStat() {
    var books = 0, usage = 0;
    try { books = JSON.parse(localStorage.getItem('dex:books') || '[]').length; } catch (e) {}
    try { usage = Object.keys(JSON.parse(localStorage.getItem('dex:usage') || '{}')).length; } catch (e) {}
    $('stat').textContent = '技能书 ' + books + ' 本 · 有熟练度的灵宠 ' + usage + ' 只';
  }

  function boot() {
    refreshStat();

    $('gen').addEventListener('click', function () {
      var code = encode(snapshot());
      $('out').value = code;
      $('stat').textContent = '已生成存档码（' + Math.round(code.length / 1024 * 10) / 10 + ' KB）';
    });

    $('copy').addEventListener('click', function () {
      var t = $('out');
      if (!t.value) return;
      t.select();
      try { document.execCommand('copy'); $('stat').textContent = '已复制到剪贴板'; } catch (e) { $('stat').textContent = '请手动复制'; }
    });

    $('dl').addEventListener('click', function () {
      var blob = new Blob([JSON.stringify(snapshot(), null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'aoling-save-' + Date.now() + '.json';
      a.click();
    });

    $('pick').addEventListener('click', function () { $('file').click(); });
    $('file').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try {
          var obj = JSON.parse(String(r.result));
          apply(obj);
        } catch (err) { $('stat').textContent = '文件解析失败'; }
      };
      r.readAsText(f);
    });

    $('imp').addEventListener('click', function () {
      var txt = $('in').value.trim();
      if (!txt) { $('stat').textContent = '先粘贴存档码'; return; }
      if (txt.charAt(0) === '{') {
        try { apply(JSON.parse(txt)); } catch (e) { $('stat').textContent = 'JSON 解析失败'; }
        return;
      }
      var obj = decode(txt);
      if (!obj) { $('stat').textContent = '存档码无效'; return; }
      apply(obj);
    });

    $('reset').addEventListener('click', function () {
      if (!confirm('确定清空全部本地进度吗？技能书、熟练度、战绩、队伍都会被删除。')) return;
      KEYS.forEach(function (k) { localStorage.removeItem(k); });
      refreshStat();
      $('out').value = '';
      $('stat').textContent = '已清空';
    });
  }

  function apply(obj) {
    if (!obj || !obj.data) { $('stat').textContent = '存档格式不对'; return; }
    var n = 0;
    Object.keys(obj.data).forEach(function (k) {
      if (KEYS.indexOf(k) < 0) return;
      localStorage.setItem(k, JSON.stringify(obj.data[k]));
      n++;
    });
    refreshStat();
    $('stat').textContent = '导入成功（' + n + ' 项）';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
