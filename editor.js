/* 奥灵宠图鉴 · 作者编辑台
 * 数据模型与 /data/content.json 完全一致；图片上传后存进浏览器 IndexedDB，
 * 发布时用 GitHub Token 直接提交到仓库，由 GitHub Pages 自动上线。
 */
(() => {
  'use strict';

  const LS = {
    pass: 'dex:pass',
    draft: 'dex:draft',
    preview: 'dex:preview',
    gh: 'dex:gh',
    published: 'dex:published'
  };

  const S = {
    content: null,
    remote: null,
    selected: null,
    files: new Map(),   // path -> Blob（待发布的新图）
    urls: new Map(),    // path -> objectURL
    dirty: false
  };

  const $ = (id) => document.getElementById(id);

  /* ---------------- 小工具 ---------------- */
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k === 'html') n.innerHTML = v;
        else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k in n && typeof v !== 'string') n[k] = v;
        else n.setAttribute(k, v);
      }
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      n.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
    }
    return n;
  }

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const iso = () => new Date().toISOString();

  let toastTimer = 0;
  function toast(msg, isErr) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'ed-toast' + (isErr ? ' err' : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, isErr ? 6000 : 3200);
  }

  function setStatus(text, kind) {
    $('statusText').textContent = text;
    const dot = $('statusDot');
    dot.className = 'ed-dot' + (kind ? ' ' + kind : '');
  }

  function markDirty() {
    S.dirty = true;
    setStatus('有未保存的改动', 'dirty');
  }

  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function bytesToBase64(bytes) {
    let out = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(out);
  }

  /* ---------------- IndexedDB：待发布的图片 ---------------- */
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('dex-editor', 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('files')) req.result.createObjectStore('files');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbAll() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const out = [];
      const tx = db.transaction('files', 'readonly');
      const cur = tx.objectStore('files').openCursor();
      cur.onsuccess = (e) => {
        const c = e.target.result;
        if (!c) { resolve(out); return; }
        out.push([c.key, c.value]);
        c.continue();
      };
      cur.onerror = () => reject(cur.error);
    });
  }

  async function dbPut(key, blob) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').put(blob, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function dbDel(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /* ---------------- 密码门 ---------------- */
  function gateFirstRun() { return !localStorage.getItem(LS.pass); }

  function showGate() {
    $('app').hidden = true;
    $('gate').hidden = false;
    const first = gateFirstRun();
    $('gateTip').textContent = first
      ? '第一次使用：给编辑台设置一个访问密码（只在这台设备上生效，用来挡住误入的访客）。'
      : '只有作者本人可以修改图鉴内容。请输入访问密码。';
    $('gateLabel').textContent = first ? '设置访问密码' : '访问密码';
    $('gatePass2Wrap').hidden = !first;
    $('gateSubmit').textContent = first ? '设置并进入' : '进入编辑台';
    $('gatePass').value = '';
    $('gatePass2').value = '';
    setTimeout(() => $('gatePass').focus(), 50);
  }

  async function onGateSubmit(ev) {
    ev.preventDefault();
    const pass = $('gatePass').value.trim();
    if (pass.length < 4) { toast('密码至少 4 位', true); return; }
    if (gateFirstRun()) {
      if (pass !== $('gatePass2').value.trim()) { toast('两次输入不一致', true); return; }
      localStorage.setItem(LS.pass, await sha256(pass));
      toast('密码已设置，请记牢');
      start();
      return;
    }
    if (await sha256(pass) === localStorage.getItem(LS.pass)) {
      start();
    } else {
      toast('密码不对', true);
      $('gatePass').value = '';
      $('gatePass').focus();
    }
  }

  /* ---------------- 载入数据 ---------------- */
  function imagePath(key) {
    if (!key) return '';
    return S.content.images[key] || S.base.images[key] || '';
  }

  function resolveSrc(key) {
    const p = imagePath(key);
    if (!p) return '';
    return S.urls.get(p) || p;
  }

  async function load() {
    const res = await fetch('/data/content.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('无法读取 content.json（HTTP ' + res.status + '）');
    S.remote = await res.json();
    let draft = null;
    try { draft = JSON.parse(localStorage.getItem(LS.draft) || 'null'); } catch (e) { draft = null; }
    S.content = draft && draft.creatures ? draft : clone(S.remote);

    for (const [path, blob] of await dbAll()) {
      S.files.set(path, blob);
      try { S.urls.set(path, URL.createObjectURL(blob)); } catch (e) {}
    }

    if (draft) {
      setStatus('已恢复本地草稿', 'dirty');
      S.dirty = true;
    } else {
      setStatus('已载入线上数据');
    }
  }

  /* ---------------- 左栏 ---------------- */
  function renderList() {
    const q = $('search').value.trim().toLowerCase();
    const box = $('list');
    box.textContent = '';
    const items = S.content.creatures.slice().sort((a, b) => a.dexNo - b.dexNo);
    let shown = 0;
    for (const c of items) {
      if (q && !((c.name || '').toLowerCase().includes(q) || (c.family || '').toLowerCase().includes(q))) continue;
      shown++;
      const src = resolveSrc(c.imageKey);
      const item = el('button', {
        class: 'ed-item',
        type: 'button',
        'aria-current': String(S.selected === c.id),
        onclick: () => select(c.id)
      },
        src ? el('img', { src, alt: '', loading: 'lazy' }) : el('div', { class: 'no' }, '—'),
        el('div', { class: 'no' }, String(c.dexNo).padStart(2, '0')),
        el('div', {},
          el('div', { class: 'nm' }, c.name || '(未命名)'),
          el('div', { class: 'sub' }, [c.element, c.stage, c.form].filter(Boolean).join(' · '))
        )
      );
      box.appendChild(item);
    }
    if (!shown) box.appendChild(el('div', { class: 'ed-empty' }, '没有匹配的灵宠'));
  }

  function select(id) {
    S.selected = id;
    renderList();
    renderPane();
  }

  function current() {
    return S.content.creatures.find((c) => c.id === S.selected) || null;
  }

  /* ---------------- 表单构件 ---------------- */
  function field(label, control, wide) {
    return el('label', { class: 'ed-field' + (wide ? ' wide' : '') }, el('span', {}, label), control);
  }

  function textInput(value, oninput, attrs) {
    const inp = el('input', Object.assign({ type: 'text', value: value == null ? '' : String(value) }, attrs || {}));
    inp.addEventListener('input', () => oninput(inp.value));
    return inp;
  }

  function numInput(value, oninput) {
    const inp = el('input', { type: 'number', value: value == null ? 0 : String(value), step: '1' });
    inp.addEventListener('input', () => oninput(inp.value === '' ? 0 : Number(inp.value)));
    return inp;
  }

  function areaInput(value, oninput) {
    const t = el('textarea', {});
    t.value = value == null ? '' : String(value);
    t.addEventListener('input', () => oninput(t.value));
    return t;
  }

  function listInput(value, opts, oninput) {
    const id = 'dl-' + Math.random().toString(36).slice(2, 8);
    const inp = el('input', { type: 'text', value: value == null ? '' : String(value), list: id });
    inp.addEventListener('input', () => oninput(inp.value));
    const dl = el('datalist', { id }, opts.map((o) => el('option', { value: o })));
    return el('div', {}, inp, dl);
  }

  function uniq(key) {
    return [...new Set(S.content.creatures.map((c) => c[key]).filter(Boolean))];
  }

  /* ---------------- 右栏 ---------------- */
  function renderPane() {
    const pane = $('pane');
    pane.textContent = '';
    const c = current();
    if (!c) {
      pane.appendChild(el('div', { class: 'ed-empty' }, '从左侧选择一只灵宠开始编辑'));
      return;
    }

    const touch = () => { markDirty(); };

    /* 基础信息 */
    const base = el('section', { class: 'ed-card' },
      el('h2', {}, '基础信息', el('span', { class: 'hint' }, '图鉴编号需唯一')),
      el('div', { class: 'ed-card-body' },
        el('div', { class: 'ed-grid' },
          field('图鉴编号', numInput(c.dexNo, (v) => { c.dexNo = v; touch(); renderList(); })),
          field('名称', textInput(c.name, (v) => { c.name = v; touch(); renderList(); })),
          field('属性', listInput(c.element, uniq('element'), (v) => { c.element = v; touch(); renderList(); })),
          field('阶段', listInput(c.stage, uniq('stage'), (v) => { c.stage = v; touch(); renderList(); })),
          field('形态', listInput(c.form, uniq('form'), (v) => { c.form = v; touch(); renderList(); })),
          field('种类', listInput(c.species, uniq('species'), (v) => { c.species = v; touch(); })),
          field('家族', listInput(c.family, uniq('family'), (v) => { c.family = v; touch(); renderList(); }))
        )
      )
    );
    pane.appendChild(base);

    /* 图像 */
    pane.appendChild(el('section', { class: 'ed-card' },
      el('h2', {}, '图像', el('span', { class: 'hint' }, 'PNG / WebP 透明背景效果最好')),
      el('div', { class: 'ed-card-body' },
        el('div', { class: 'ed-image-row' },
          imageSlot(c, 'imageKey', '立绘（详情页大图）'),
          imageSlot(c, 'portraitKey', '头像（首页 / 列表小图）')
        )
      )
    ));

    /* 蛋形态 */
    pane.appendChild(el('section', { class: 'ed-card' },
      el('h2', {}, '蛋形态', el('span', { class: 'hint' }, '详情页会单独开一块卡片')),
      el('div', { class: 'ed-card-body' },
        el('div', { class: 'ed-image-row' },
          imageSlot(c, 'eggKey', '蛋形态配图（可留空）')
        ),
        el('div', { class: 'ed-grid', style: 'margin-top:14px' },
          field('蛋形态说明', areaInput(c.eggNote, (v) => { c.eggNote = v; touch(); }), true)
        )
      )
    ));

    /* 文案 */
    pane.appendChild(el('section', { class: 'ed-card' },
      el('h2', {}, '图鉴文案'),
      el('div', { class: 'ed-card-body' },
        el('div', { class: 'ed-grid' },
          field('图鉴描述', areaInput(c.description, (v) => { c.description = v; touch(); }), true),
          field('进化条件', areaInput(c.evolutionCondition, (v) => { c.evolutionCondition = v; touch(); }), true),
          field('捕捉地点', textInput(c.captureLocation, (v) => { c.captureLocation = v; touch(); })),
          field('孵化条件', areaInput(c.hatchCondition, (v) => { c.hatchCondition = v; touch(); })),
          field('博士批注（详情页斜体小字）', areaInput(c.note, (v) => { c.note = v; touch(); }), true)
        )
      )
    ));

    /* 数值 */
    const stats = ['hp', 'speed', 'spAttack', 'spDefense', 'attack', 'defense', 'arenaRate', 'exploreRate'];
    const statLabels = {
      hp: '体力 HP', speed: '速度', spAttack: '特攻', spDefense: '特防',
      attack: '攻击', defense: '防御', arenaRate: '竞技场出现率', exploreRate: '探索出现率'
    };
    pane.appendChild(el('section', { class: 'ed-card' },
      el('h2', {}, '种族值与出现率'),
      el('div', { class: 'ed-card-body' },
        el('div', { class: 'ed-grid' }, stats.map((k) => field(statLabels[k], numInput(c[k], (v) => { c[k] = v; touch(); }))))
      )
    ));

    /* 技能 */
    const skillsBox = el('div', { class: 'ed-rows' });
    const drawSkills = () => {
      skillsBox.textContent = '';
      const list = S.content.skills[c.id] || (S.content.skills[c.id] = []);
      list.forEach((s, i) => {
        const row = el('div', { class: 'ed-row' },
          el('div', { class: 'slot' }, String(s.slot || i + 1)),
          textInput(s.name, (v) => { s.name = v; touch(); }, { placeholder: '技能名' }),
          numInput(s.pp, (v) => { s.pp = v; touch(); }),
          areaInput(s.description, (v) => { s.description = v; touch(); }, { placeholder: '技能效果' }),
          el('button', {
            class: 'del', type: 'button', title: '删除这条技能',
            onclick: async () => { list.splice(i, 1); renumber(list); touch(); drawSkills(); }
          }, '×')
        );
        skillsBox.appendChild(row);
      });
      if (!list.length) skillsBox.appendChild(el('p', { class: 'ed-hint-inline' }, '还没有技能。'));
    };
    drawSkills();
    pane.appendChild(el('section', { class: 'ed-card' },
      el('h2', {}, '技能', el('span', { class: 'hint' }, '详情页按顺序显示')),
      el('div', { class: 'ed-card-body' },
        skillsBox,
        el('div', { style: 'margin-top:12px' },
          el('button', {
            class: 'ed-btn small', type: 'button',
            onclick: () => {
              const list = S.content.skills[c.id] || (S.content.skills[c.id] = []);
              list.push({ slot: list.length + 1, name: '', pp: 10, description: '' });
              touch(); drawSkills();
            }
          }, '＋ 添加技能')
        )
      )
    ));

    /* 特性 */
    const traitsBox = el('div', { class: 'ed-rows' });
    const drawTraits = () => {
      traitsBox.textContent = '';
      const list = S.content.traits[c.id] || (S.content.traits[c.id] = []);
      list.forEach((t, i) => {
        const row = el('div', { class: 'ed-row trait' },
          el('div', { class: 'slot' }, String(t.slot || i + 1)),
          textInput(t.name, (v) => { t.name = v; touch(); }, { placeholder: '特性名' }),
          areaInput(t.description, (v) => { t.description = v; touch(); }, { placeholder: '特性效果' }),
          el('button', {
            class: 'del', type: 'button', title: '删除这条特性',
            onclick: () => { list.splice(i, 1); renumber(list); touch(); drawTraits(); }
          }, '×')
        );
        traitsBox.appendChild(row);
      });
      if (!list.length) traitsBox.appendChild(el('p', { class: 'ed-hint-inline' }, '还没有特性。'));
    };
    drawTraits();
    pane.appendChild(el('section', { class: 'ed-card' },
      el('h2', {}, '特性', el('span', { class: 'hint' }, '同家族通用')),
      el('div', { class: 'ed-card-body' },
        traitsBox,
        el('div', { style: 'margin-top:12px' },
          el('button', {
            class: 'ed-btn small', type: 'button',
            onclick: () => {
              const list = S.content.traits[c.id] || (S.content.traits[c.id] = []);
              list.push({ slot: list.length + 1, family: c.family || '', name: '', description: '' });
              touch(); drawTraits();
            }
          }, '＋ 添加特性')
        )
      )
    ));

    /* 进化链 */
    const evoBox = el('div', { class: 'ed-chips' });
    const drawEvo = () => {
      evoBox.textContent = '';
      const ids = S.content.evolution[c.id] || (S.content.evolution[c.id] = []);
      ids.forEach((cid, i) => {
        const t = S.content.creatures.find((x) => x.id === cid);
        const src = t ? resolveSrc(t.imageKey) : '';
        evoBox.appendChild(el('span', { class: 'ed-chip' },
          src ? el('img', { src, alt: '' }) : null,
          (t ? t.name : '已删除 #' + cid) + '',
          el('button', {
            type: 'button', title: '移出进化链',
            onclick: () => { ids.splice(i, 1); touch(); drawEvo(); }
          }, '×')
        ));
      });
      const candidates = S.content.creatures.slice().sort((a, b) => a.dexNo - b.dexNo)
        .filter((x) => !ids.includes(x.id));
      const sel = el('select', { style: 'width:auto;min-width:150px' },
        el('option', { value: '' }, '＋ 加入进化链…'),
        candidates.map((x) => el('option', { value: String(x.id) }, String(x.dexNo).padStart(2, '0') + ' ' + x.name))
      );
      sel.addEventListener('change', () => {
        if (!sel.value) return;
        ids.push(Number(sel.value));
        touch(); drawEvo();
      });
      evoBox.appendChild(sel);
    };
    drawEvo();
    pane.appendChild(el('section', { class: 'ed-card' },
      el('h2', {}, '进化链', el('span', { class: 'hint' }, '按一阶 → 三阶排列')),
      el('div', { class: 'ed-card-body' }, evoBox)
    ));

    /* 危险区 */
    pane.appendChild(el('section', { class: 'ed-card danger' },
      el('h2', {}, '删除'),
      el('div', { class: 'ed-card-body' },
        el('button', {
          class: 'ed-btn warn small', type: 'button',
          onclick: () => {
            if (!confirm('确定删除「' + (c.name || '未命名') + '」？该操作在发布后对所有人生效。')) return;
            const i = S.content.creatures.findIndex((x) => x.id === c.id);
            if (i >= 0) S.content.creatures.splice(i, 1);
            delete S.content.skills[c.id];
            delete S.content.traits[c.id];
            delete S.content.evolution[c.id];
            for (const k in S.content.evolution) {
              S.content.evolution[k] = S.content.evolution[k].filter((id) => id !== c.id);
            }
            S.selected = S.content.creatures[0] ? S.content.creatures[0].id : null;
            touch(); renderList(); renderPane();
          }
        }, '删除这只灵宠')
      )
    ));
  }

  function renumber(list) {
    list.forEach((x, i) => { x.slot = i + 1; });
  }

  function imageSlot(c, key, label) {
    const path = imagePath(c[key]);
    const src = resolveSrc(c[key]);
    const pending = path && S.files.has(path);
    const thumb = el('div', { class: 'thumb' },
      src ? el('img', { src, alt: '' }) : el('div', { class: 'empty' }, '尚未设置')
    );
    const slot = el('div', { class: 'ed-image-slot' },
      el('div', { style: 'font-size:11px;font-weight:800;color:#405466;letter-spacing:.08em;margin-bottom:6px' }, label),
      thumb,
      el('div', { class: 'path' }, (path || '（空）') + (pending ? ' · 待发布' : '')),
      el('div', { class: 'row' },
        el('button', {
          class: 'ed-btn small', type: 'button',
          onclick: () => pickImage(c, key)
        }, c[key] ? '替换图片' : '上传图片'),
        c[key] ? el('button', {
          class: 'ed-btn small', type: 'button',
          onclick: () => { c[key] = null; markDirty(); renderPane(); renderList(); }
        }, '清空') : null
      )
    );
    return slot;
  }

  function pickImage(c, key) {
    const picker = $('filePicker');
    picker.value = '';
    picker.onchange = async () => {
      const file = picker.files && picker.files[0];
      if (!file) return;
      if (!/^image\//.test(file.type)) { toast('请选择图片文件', true); return; }
      const ext = (file.name.match(/\.(png|webp|jpg|jpeg|gif|svg)$/i) || [, 'png'])[1].toLowerCase();
      const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
      const rand = Math.random().toString(36).slice(2, 7);
      const imageKey = 'uploads/' + stamp + '-' + rand + '.' + ext;
      const path = '/media/' + imageKey;
      await dbPut(path, file);
      S.files.set(path, file);
      try { S.urls.set(path, URL.createObjectURL(file)); } catch (e) {}
      S.content.images[imageKey] = path;
      c[key] = imageKey;
      markDirty();
      renderPane();
      renderList();
      toast('图片已加入待发布队列');
    };
    picker.click();
  }

  /* ---------------- 保存 / 导入导出 ---------------- */
  function saveDraft(silent) {
    S.content.updatedAt = iso();
    localStorage.setItem(LS.draft, JSON.stringify(S.content));
    localStorage.setItem(LS.preview, '1');
    S.dirty = false;
    setStatus('草稿已保存（图鉴页可直接预览）');
    if (!silent) toast('已保存草稿，打开图鉴页就能看到效果');
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(S.content, null, 2)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: 'aoling-dex-content-' + iso().slice(0, 10) + '.json' });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  function importJson() {
    const inp = el('input', { type: 'file', accept: '.json,application/json' });
    inp.addEventListener('change', async () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      try {
        const j = JSON.parse(await f.text());
        if (!j.creatures || !j.images) throw new Error('不是本图鉴的备份文件');
        if (!confirm('导入会用备份覆盖当前内容（图片附件需重新上传），确定继续？')) return;
        S.content = j;
        S.selected = j.creatures[0] ? j.creatures[0].id : null;
        markDirty(); renderList(); renderPane();
        toast('已导入备份，记得保存草稿');
      } catch (e) {
        toast('导入失败：' + e.message, true);
      }
    });
    inp.click();
  }

  /* ---------------- 发布 ---------------- */
  function ghConfig() {
    try { return JSON.parse(localStorage.getItem(LS.gh) || 'null'); } catch (e) { return null; }
  }

  async function ghApi(cfg, path, opts) {
    opts = opts || {};
    const res = await fetch('https://api.github.com/repos/' + cfg.owner + '/' + cfg.repo + path, {
      method: opts.method || 'GET',
      headers: {
        Authorization: 'Bearer ' + cfg.token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {})
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) {}
    if (!res.ok) {
      const raw = (json && json.message) || text.slice(0, 160);
      const HINTS = {
        401: 'Token 无效或已过期，或者粘贴时带了空格 —— 去「设置」里重新粘贴',
        403: 'Token 权限不够 —— 需要 Contents: Read and write',
        404: '仓库 / 分支不存在 —— 检查用户名、仓库名、分支有没有拼错；也确认这枚 Token 勾选了这个仓库',
        409: '分支或文件冲突，过 30 秒再试一次',
        422: '写入被拒绝 —— 通常是 Token 没有 Contents 写权限'
      };
      const err = new Error(res.status + ' ' + raw + (HINTS[res.status] ? '\n→ ' + HINTS[res.status] : ''));
      err.status = res.status;
      throw err;
    }
    return json;
  }

  async function putFile(cfg, path, base64, message, log) {
    let sha = null;
    try {
      const cur = await ghApi(cfg, '/contents/' + path + '?ref=' + encodeURIComponent(cfg.branch || 'main'));
      sha = cur.sha;
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    await ghApi(cfg, '/contents/' + path, {
      method: 'PUT',
      body: { message, content: base64, branch: cfg.branch || 'main', ...(sha ? { sha } : {}) }
    });
    log('✓ ' + path);
  }

  function validate() {
    const seen = new Map();
    for (const c of S.content.creatures) {
      if (!c.name || !String(c.name).trim()) return '有灵宠没有填名称（编号 ' + c.dexNo + '）';
      if (seen.has(c.dexNo)) return '图鉴编号 ' + c.dexNo + ' 重复（' + seen.get(c.dexNo) + ' 与 ' + c.name + '）';
      seen.set(c.dexNo, c.name);
    }
    return null;
  }

  async function publish(cfg, log) {
    const bad = validate();
    if (bad) throw new Error(bad);

    log('目标仓库：' + cfg.owner + '/' + cfg.repo + ' @ ' + (cfg.branch || 'main'));
    const info = await ghApi(cfg, '');
    if (info && info.permissions && info.permissions.push === false) {
      throw new Error('这枚 Token 对这个仓库只有读权限，不能写入 —— 把 Contents 权限改成 Read and write');
    }
    log('仓库可写：' + (info.full_name || cfg.owner + '/' + cfg.repo));

    const published = new Set(JSON.parse(localStorage.getItem(LS.published) || '[]'));
    const pending = [...S.files.entries()].filter(([p]) => !published.has(p));
    log('待上传图片：' + pending.length + ' 张');

    for (const [path, blob] of pending) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      log('↑ ' + path + ' (' + Math.round(bytes.length / 1024) + ' KB)');
      await putFile(cfg, path.slice(1), bytesToBase64(bytes), '更新图鉴图片 ' + path, log);
      published.add(path);
      localStorage.setItem(LS.published, JSON.stringify([...published]));
    }

    S.content.updatedAt = iso();
    log('↑ data/content.json');
    const text = JSON.stringify(S.content, null, 2) + '\n';
    await putFile(cfg, 'data/content.json', bytesToBase64(new TextEncoder().encode(text)), '更新图鉴内容 ' + iso(), log);

    localStorage.setItem(LS.draft, text);
    localStorage.setItem(LS.preview, '1');
    S.dirty = false;
    setStatus('已发布');
  }

  function openModal(content) {
    $('modalCard').textContent = '';
    for (const node of content) $('modalCard').appendChild(node);
    $('modal').hidden = false;
  }
  function closeModal() { $('modal').hidden = true; }

  function settingsBody(cfg, onDone) {
    const state = Object.assign({ owner: '', repo: '', branch: 'main', token: '' }, cfg || {});
    const mk = (label, key, type, placeholder) => {
      const inp = el('input', { type: type || 'text', value: state[key], placeholder: placeholder || '' });
      inp.addEventListener('input', () => { state[key] = inp.value.trim(); });
      return el('label', { class: 'ed-field', style: 'margin-bottom:12px' }, el('span', {}, label), inp);
    };
    return [
      el('h2', {}, '发布设置'),
      el('p', { class: 'sub' },
        '填写存放这个网页的 GitHub 仓库，以及一枚只有你知道的访问令牌（Fine-grained token，权限只需 Contents: Read and write）。',
        el('br'),
        '令牌只保存在这台设备的浏览器里，不会写进网页代码，别人翻源码也看不到。'
      ),
      mk('GitHub 用户名 / 组织名', 'owner', 'text', '例如 yourname'),
      mk('仓库名', 'repo', 'text', '例如 yourname.github.io'),
      mk('分支', 'branch', 'text', 'main'),
      mk('访问令牌 (token)', 'token', 'password', 'github_pat_...'),
      el('p', { class: 'ed-hint-inline' },
        '点「测试连接并保存」会先读一次仓库：能读到、且 Token 有写权限，才算设置成功。'
      ),
      el('p', { class: 'ed-log', id: 'settingsErr', hidden: true }),
      el('div', { class: 'ed-modal-actions' },
        el('button', { class: 'ed-btn', type: 'button', onclick: closeModal }, '取消'),
        el('button', {
          class: 'ed-btn primary', type: 'button',
          onclick: async (ev) => {
            const b = ev.currentTarget;
            if (!state.owner || !state.repo || !state.token) { toast('三项都要填', true); return; }
            const old = b.textContent;
            b.disabled = true;
            b.textContent = '检查中…';
            const box = document.getElementById('settingsErr');
            if (box) box.hidden = true;
            try {
              const info = await ghApi(state, '');
              if (!info || !info.full_name) throw new Error('读不到仓库信息');
              if (info.permissions && info.permissions.push === false) {
                throw new Error('这枚 Token 只能读、不能写：把 Contents 权限改成 Read and write 再生成');
              }
              localStorage.setItem(LS.gh, JSON.stringify(state));
              closeModal();
              toast('连接正常：' + info.full_name + '（默认分支 ' + info.default_branch + '）');
              if (info.default_branch && state.branch && info.default_branch !== state.branch) {
                toast('注意：仓库默认分支是 ' + info.default_branch + '，你填的是 ' + state.branch, true);
              }
              if (onDone) onDone();
            } catch (e) {
              if (box) { box.hidden = false; box.textContent = e.message; }
              toast('设置没通过：' + e.message.split('\n')[0], true);
            } finally {
              b.disabled = false;
              b.textContent = old;
            }
          }
        }, '测试连接并保存')
      )
    ];
  }

  function openFamilies() {
    if (!S.content) return;
    S.content.familyNotes = S.content.familyNotes || {};
    const fams = [...new Set(S.content.creatures.map((c) => c.family).filter(Boolean))].sort();
    const rows = fams.map((f) => {
      const ta = el('textarea', {});
      ta.value = S.content.familyNotes[f] || '';
      ta.addEventListener('input', () => {
        S.content.familyNotes[f] = ta.value;
        markDirty();
      });
      return el('label', { class: 'ed-field', style: 'margin-bottom:10px' },
        el('span', {}, f), ta);
    });
    openModal([
      el('h2', {}, '家族简介'),
      el('p', { class: 'sub' }, '每个家族一句介绍，会显示在首页「按家族查看」的家族标题下面。改完记得保存草稿并发布。'),
      el('div', { style: 'max-height:52vh;overflow:auto;padding-right:6px' }, rows),
      el('div', { class: 'ed-modal-actions' },
        el('button', { class: 'ed-btn primary', type: 'button', onclick: closeModal }, '完成')
      )
    ]);
  }

  function openSettings(after) {
    openModal(settingsBody(ghConfig(), after));
  }

  function openPublish() {
    const cfg = ghConfig();
    if (!cfg || !cfg.token) {
      openModal(settingsBody(null, () => openPublish()));
      return;
    }
    const logBox = el('div', { class: 'ed-log' }, '准备发布…\n');
    const log = (line) => { logBox.textContent += line + '\n'; logBox.scrollTop = logBox.scrollHeight; };
    const btn = el('button', { class: 'ed-btn primary', type: 'button' }, '开始发布');

    openModal([
      el('h2', {}, '发布到线上'),
      el('p', { class: 'sub' },
        '将把当前内容与待上传图片提交到 ' + cfg.owner + '/' + cfg.repo + '（分支 ' + (cfg.branch || 'main') + '）。',
        el('br'), 'GitHub Pages 通常 1–2 分钟自动更新；离线缓存会在访客下一次联网打开时刷新。'
      ),
      btn,
      logBox,
      el('div', { class: 'ed-modal-actions' },
        el('button', { class: 'ed-btn', type: 'button', onclick: () => openSettings(() => openPublish()) }, '检查发布设置'),
        el('button', { class: 'ed-btn', type: 'button', onclick: closeModal }, '关闭')
      )
    ]);

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = '发布中…';
      logBox.textContent = '';
      try {
        await publish(cfg, log);
        log('\n完成。线上地址：https://' + cfg.owner + '.github.io/' + (cfg.repo.toLowerCase() === (cfg.owner + '.github.io').toLowerCase() ? '' : cfg.repo + '/'));
        toast('发布成功');
        btn.textContent = '再次发布';
      } catch (e) {
        log('\n✗ 失败：' + e.message);
        toast('发布失败：' + e.message, true);
        btn.textContent = '重试';
      } finally {
        btn.disabled = false;
      }
    });
  }

  /* ---------------- 启动 ---------------- */
  async function start() {
    $('gate').hidden = true;
    $('app').hidden = false;
    try {
      await load();
    } catch (e) {
      setStatus('载入失败', 'off');
      toast('载入失败：' + e.message, true);
      return;
    }
    renderList();
    if (S.content.creatures.length) select(S.content.creatures.slice().sort((a, b) => a.dexNo - b.dexNo)[0].id);
  }

  function newCreature() {
    const maxDex = S.content.creatures.reduce((m, c) => Math.max(m, c.dexNo || 0), 0);
    let maxId = 1;
    for (const c of S.content.creatures) if (typeof c.id === 'number' && c.id > maxId) maxId = c.id;
    const c = {
      id: maxId + 1,
      dexNo: maxDex + 1,
      name: '',
      element: '火',
      stage: '一阶',
      form: '普通',
      species: '神秘',
      family: '',
      imageKey: null,
      portraitKey: null,
      description: '',
      evolutionCondition: '',
      captureLocation: '',
      hatchCondition: '',
      arenaRate: 0,
      exploreRate: 0,
      hp: 0, speed: 0, spAttack: 0, spDefense: 0, attack: 0, defense: 0,
      createdAt: iso(),
      updatedAt: iso()
    };
    S.content.creatures.push(c);
    S.content.skills[c.id] = [];
    S.content.traits[c.id] = [];
    S.content.evolution[c.id] = [c.id];
    markDirty();
    renderList();
    select(c.id);
    toast('已新建，填好名称记得保存');
  }

  function bind() {
    $('gateForm').addEventListener('submit', onGateSubmit);
    $('search').addEventListener('input', renderList);
    $('btnSave').addEventListener('click', () => saveDraft());
    $('btnExport').addEventListener('click', exportJson);
    $('btnImport').addEventListener('click', importJson);
    $('btnSettings').addEventListener('click', () => openSettings());
    $('btnFamilies').addEventListener('click', openFamilies);
    $('btnPublish').addEventListener('click', openPublish);
    $('btnNew').addEventListener('click', newCreature);
    $('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
    window.addEventListener('beforeunload', (e) => {
      if (S.dirty) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  bind();
  showGate();
})();
