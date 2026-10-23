(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  const state = {
    user: null, tasks: [], view: 'all', status: 'all', search: '', sort: 'newest',
    authMode: 'login', busy: false, pending: new Set()
  };

  const DEFAULT_CATEGORIES = ['Личное', 'Работа', 'Учёба', 'Идеи', 'Покупки', 'Другое'];
  const PRIORITY_LABELS = { high: 'Важно', medium: 'Обычно', low: 'Не срочно' };
  const CATEGORY_CLASSES = { 'Работа': 'work', 'Учёба': 'study', 'Идеи': 'ideas', 'Покупки': 'shopping', 'Другое': 'other' };
  const CATEGORY_DOTS = { 'Работа': 'cat-work', 'Учёба': 'cat-study', 'Идеи': 'cat-ideas', 'Покупки': 'cat-shopping' };
  const VIEW_TITLES = { all: 'Все задачи', today: 'На сегодня', upcoming: 'Предстоящие', completed: 'Выполненные задачи' };
  const pad = n => String(n).padStart(2, '0');
  const localDate = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

  async function request(path, options = {}) {
    const res = await fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    let data;
    try { data = await res.json(); } catch { throw new Error('Неожиданный ответ сервера.'); }
    if (!res.ok) throw new Error(data.error || 'Ошибка запроса.');
    return data;
  }

  function toast(message, isError = false) {
    const host = $('#toastContainer');
    const item = document.createElement('div');
    item.className = `toast${isError ? ' error' : ''}`;
    item.innerHTML = `${icon(isError ? 'close' : 'check-circle')}<span>${escapeHtml(message)}</span>`;
    host.append(item);
    window.setTimeout(() => {
      item.classList.add('dismiss');
      window.setTimeout(() => item.remove(), 250);
    }, 3600);
  }

  function showAuth() {
    $('#loading').classList.add('hidden');
    $('#appScreen').classList.add('hidden');
    $('#authScreen').classList.remove('hidden');
    $('#loginInput').focus();
  }

  function showApp() {
    $('#loading').classList.add('hidden');
    $('#authScreen').classList.add('hidden');
    $('#appScreen').classList.remove('hidden');
    $('#sidebarUsername').textContent = `@${state.user.login}`;
    $('#userAvatar').textContent = state.user.login[0].toUpperCase();
    $('#topbarAvatar').textContent = state.user.login[0].toUpperCase();
    updateDateHeader();
    render();
  }

  function updateDateHeader() {
    const date = new Date();
    const s = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
    $('#dateEyebrow').textContent = `СЕГОДНЯ // ${s.toLocaleUpperCase('ru-RU')}`;
  }

  function setAuthMode(mode) {
    state.authMode = mode;
    $$('.auth-tab').forEach(btn => {
      const active = btn.dataset.auth === mode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    $('#authTitle').innerHTML = mode === 'login' ? 'С возвращением<span class="title-period">.</span>' : 'Начнём с чистого листа<span class="title-period">.</span>';
    $('#authSubtitle').textContent = mode === 'login' ? 'Войди в аккаунт и продолжи двигаться к целям.' : 'Придумай логин. Твоё пространство будет готово сразу.';
    $('#authSubmit').innerHTML = mode === 'login' ? `Войти в пространство ${icon('arrow-right')}` : `Создать аккаунт ${icon('arrow-right')}`;
    $('#authError').classList.add('hidden');
    $('#loginInput').focus();
  }

  async function onAuthSubmit(e) {
    e.preventDefault();
    if (state.busy) return;
    const login = $('#loginInput').value.trim().toLowerCase();
    const errorBox = $('#authError');
    errorBox.classList.add('hidden');
    if (!/^[\p{L}\p{N}_-]{3,24}$/u.test(login)) {
      errorBox.textContent = 'Логин должен содержать от 3 до 24 букв, цифр, _ или - без пробелов.';
      errorBox.classList.remove('hidden'); return;
    }
    state.busy = true;
    $('#authSubmit').disabled = true;
    try {
      const result = await request('/api/auth', { method: 'POST', body: JSON.stringify({ action: state.authMode, login }) });
      state.user = result.user;
      state.view = 'all'; state.status = 'all'; state.search = '';
      $('#searchInput').value = '';
      try { await loadTasks(); } catch (loadError) { state.tasks = []; toast(loadError.message, true); }
      showApp();
      toast(state.authMode === 'register' ? 'Пространство создано. Поехали! ✦' : 'Рады видеть тебя снова! ✦');
    } catch (e2) {
      errorBox.textContent = e2.message;
      errorBox.classList.remove('hidden');
    } finally {
      state.busy = false;
      $('#authSubmit').disabled = false;
    }
  }

  async function loadTasks() {
    const result = await request('/api/tasks');
    state.tasks = Array.isArray(result.tasks) ? result.tasks : [];
    if (state.user) render();
  }

  function isTaskForView(task) {
    const today = localDate();
    if (state.view === 'today') return !task.completed && task.dueDate && task.dueDate <= today;
    if (state.view === 'upcoming') return !task.completed && task.dueDate && task.dueDate > today;
    if (state.view === 'completed') return task.completed;
    if (state.view.startsWith('category:')) return task.category === state.view.slice(9);
    return true;
  }

  function filteredTasks() {
    let result = state.tasks.filter(task => isTaskForView(task));
    if (state.status === 'active') result = result.filter(t => !t.completed);
    if (state.status === 'done') result = result.filter(t => t.completed);
    if (state.search) {
      const q = state.search.toLocaleLowerCase('ru-RU');
      result = result.filter(t => [t.title, t.notes, t.category].some(s => String(s || '').toLocaleLowerCase('ru-RU').includes(q)));
    }
    const priority = { high: 0, medium: 1, low: 2 };
    result.sort((a, b) => {
      if (state.sort === 'oldest') return a.createdAt.localeCompare(b.createdAt);
      if (state.sort === 'priority') return (priority[a.priority] ?? 1) - (priority[b.priority] ?? 1) || b.createdAt.localeCompare(a.createdAt);
      if (state.sort === 'due') return (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || b.createdAt.localeCompare(a.createdAt);
      return b.createdAt.localeCompare(a.createdAt);
    });
    return result;
  }

  function dateLabel(iso) {
    if (!iso) return '';
    const today = localDate();
    if (iso === today) return 'Сегодня';
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    if (iso === localDate(tomorrow)) return 'Завтра';
    const [year, month, day] = iso.split('-').map(Number);
    const d = new Date(year, month - 1, day);
    return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(d);
  }

  function categoryClass(category) {
    return CATEGORY_CLASSES[category] || (category === 'Личное' ? '' : 'other');
  }

  function taskHtml(task) {
    const done = task.completed;
    const dueClass = !done && task.dueDate && task.dueDate < localDate() ? 'overdue' : '';
    const cls = categoryClass(task.category);
    return `<article class="task-item priority-${escapeHtml(task.priority)}${done ? ' is-done' : ''}" data-id="${escapeHtml(task.id)}">
      <button class="task-checkbox" type="button" data-toggle="${escapeHtml(task.id)}" aria-label="${done ? 'Вернуть задачу в работу' : 'Отметить задачу выполненной'}" aria-pressed="${done}">${icon('check')}</button>
      <div class="task-body">
        <div class="task-title-line"><span class="task-title">${escapeHtml(task.title)}</span>
        <div class="task-actions"><button type="button" class="task-action" data-edit="${escapeHtml(task.id)}" title="Редактировать" aria-label="Редактировать ${escapeHtml(task.title)}">${icon('edit')}</button></div></div>
        ${task.notes ? `<p class="task-description">${escapeHtml(task.notes)}</p>` : ''}
        <div class="task-meta"><span class="task-tag ${cls}"><span class="cat-dot ${CATEGORY_DOTS[task.category] || ''}"></span>${escapeHtml(task.category)}</span>
          ${task.dueDate ? `<span class="task-due ${dueClass}">${icon('calendar')}${escapeHtml(dateLabel(task.dueDate))}</span>` : ''}
          ${task.priority !== 'medium' ? `<span class="task-priority ${task.priority}">${icon('flag')}${PRIORITY_LABELS[task.priority] || 'Приоритет'}</span>` : ''}
        </div>
      </div></article>`;
  }

  function emptyHtml() {
    const emptyAll = state.tasks.length === 0;
    const searched = Boolean(state.search);
    const heading = emptyAll ? 'Чистый лист. Большие планы.' : searched ? 'Ничего не найдено' : state.view === 'completed' ? 'Победы ещё впереди' : 'Здесь пока пусто';
    const detail = emptyAll ? 'Добавь свою первую задачу выше. Всё большое начинается с первого шага.' : searched ? 'Попробуй изменить поисковый запрос или фильтр.' : state.view === 'today' ? 'На сегодня нет срочных задач. Можно немного выдохнуть.' : 'Здесь появятся задачи, соответствующие выбранному разделу.';
    return `<div class="empty-state"><div class="empty-orbit">${icon(emptyAll ? 'rocket' : 'sparkles')}</div><h3>${heading}</h3><p>${detail}</p>${emptyAll ? `<button class="btn-primary empty-action" data-focus-add>${icon('plus')} Создать первую задачу</button>` : ''}</div>`;
  }

  function render() {
    if (!state.user) return;
    const all = state.tasks;
    const active = all.filter(t => !t.completed).length;
    const done = all.length - active;
    const progress = all.length ? Math.round(done / all.length * 100) : 0;
    const today = localDate();
    const planned = all.filter(t => !t.completed && t.dueDate === today).length;
    const todayTotal = all.filter(t => !t.completed && t.dueDate && t.dueDate <= today).length;
    const completedToday = all.filter(t => t.completed && t.completedAt && localDate(new Date(t.completedAt)) === today).length;
    $('#statActive').textContent = active;
    $('#statDone').textContent = done;
    $('#statProgress').innerHTML = `${progress}<span>%</span>`;
    $('#statProgressBar').style.width = `${progress}%`;
    $('#allCount').textContent = all.length;
    $('#todayCount').textContent = todayTotal;
    $('#doneCount').textContent = done;
    $('#focusRing').style.background = `conic-gradient(#66ded8 ${progress}%, #34314e ${progress}%)`;
    $('#focusPercent').textContent = `${progress}%`;
    $('#plannedToday').textContent = planned;
    $('#completedToday').textContent = completedToday;
    $('#focusTitle').textContent = progress === 100 && all.length ? 'Миссия выполнена. Браво!' : done ? 'Ты уже на пути к цели' : 'Каждый шаг имеет значение';
    $('#focusHint').textContent = progress === 100 && all.length ? 'Ты справился со всеми задачами. Самое время придумать новые цели!' : done ? 'Продолжай в том же духе — твой прогресс заметен.' : 'Добавь задачу и начни превращать планы в результат.';
    $$('.nav-item[data-view]').forEach(el => el.classList.toggle('active', state.view === el.dataset.view));
    renderCategories();
    const list = filteredTasks();
    const sectionTitle = state.view.startsWith('category:') ? state.view.slice(9) : VIEW_TITLES[state.view];
    $('#breadcrumbCurrent').textContent = sectionTitle || 'Обзор задач';
    $('#listHeading').innerHTML = `${escapeHtml(sectionTitle || 'Все задачи')} <span id="listCount" class="list-badge">${list.length}</span>`;
    $('#taskList').innerHTML = list.length ? list.map(taskHtml).join('') : emptyHtml();
    $$('.filter-tab').forEach(el => el.classList.toggle('active', state.status === el.dataset.status));
  }

  function renderCategories() {
    const existing = new Set(DEFAULT_CATEGORIES);
    state.tasks.forEach(t => { if (t.category) existing.add(t.category); });
    $('#categoryNav').innerHTML = [...existing].map(category => {
      const count = state.tasks.filter(t => t.category === category && !t.completed).length;
      const current = state.view === `category:${category}`;
      return `<button class="category-item ${current ? 'active' : ''}" data-category="${escapeHtml(category)}"><span class="cat-dot ${CATEGORY_DOTS[category] || ''}"></span><span>${escapeHtml(category)}</span><span class="category-count">${count}</span></button>`;
    }).join('');
  }

  function switchView(view) {
    state.view = view;
    state.status = view === 'completed' ? 'done' : 'all';
    render();
    closeSidebar();
  }

  async function addTask(e) {
    e.preventDefault();
    if (state.busy) return;
    const title = $('#quickTitle').value.trim();
    if (!title) return toast('Напиши название задачи.', true);
    state.busy = true; $('#quickSubmit').disabled = true;
    try {
      const result = await request('/api/tasks', { method: 'POST', body: JSON.stringify({
        title, category: $('#quickCategory').value, priority: $('#quickPriority').value,
        dueDate: $('#quickDate').value
      }) });
      state.tasks.unshift(result.task);
      $('#quickTitle').value = '';
      $('#quickDate').value = '';
      $('#datePlaceholder').textContent = 'Без срока';
      $('#quickTitle').focus();
      state.view = 'all'; state.status = 'all';
      render(); toast('Новая задача добавлена ✦');
    } catch (err) { toast(err.message, true); }
    finally { state.busy = false; $('#quickSubmit').disabled = false; }
  }

  async function toggleTask(id) {
    if (state.pending.has(id)) return;
    const task = state.tasks.find(t => t.id === id);
    if (!task) return;
    state.pending.add(id);
    try {
      const result = await request('/api/tasks', { method: 'PATCH', body: JSON.stringify({ id, completed: !task.completed }) });
      state.tasks = state.tasks.map(t => t.id === id ? result.task : t);
      render();
      toast(result.task.completed ? 'Отлично! Ещё одна победа ✓' : 'Задача снова в работе.');
    } catch (err) { toast(err.message, true); }
    finally { state.pending.delete(id); }
  }

  function openEdit(id) {
    const task = state.tasks.find(t => t.id === id);
    if (!task) return;
    $('#editId').value = task.id;
    $('#editTitle').value = task.title;
    $('#editNotes').value = task.notes || '';
    $('#editCategory').value = task.category || 'Личное';
    $('#editPriority').value = task.priority || 'medium';
    $('#editDate').value = task.dueDate || '';
    $('#modalOverlay').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    $('#editTitle').focus();
  }
  function closeEdit() {
    $('#modalOverlay').classList.add('hidden');
    document.body.style.overflow = '';
  }
  async function saveEdit(e) {
    e.preventDefault();
    if (state.busy) return;
    const id = $('#editId').value;
    const title = $('#editTitle').value.trim();
    const category = $('#editCategory').value.trim() || 'Личное';
    if (!title) return toast('Напиши название задачи.', true);
    state.busy = true; $('#saveEdit').disabled = true;
    try {
      const result = await request('/api/tasks', { method: 'PATCH', body: JSON.stringify({
        id, title, category, notes: $('#editNotes').value, priority: $('#editPriority').value, dueDate: $('#editDate').value
      }) });
      state.tasks = state.tasks.map(t => t.id === id ? result.task : t);
      closeEdit(); render(); toast('Изменения сохранены ✦');
    } catch (err) { toast(err.message, true); }
    finally { state.busy = false; $('#saveEdit').disabled = false; }
  }
  async function removeTask() {
    const id = $('#editId').value;
    if (!window.confirm('Удалить задачу без возможности восстановления?')) return;
    if (state.busy) return;
    state.busy = true; $('#deleteTaskBtn').disabled = true;
    try {
      await request('/api/tasks', { method: 'DELETE', body: JSON.stringify({ id }) });
      state.tasks = state.tasks.filter(t => t.id !== id);
      closeEdit(); render(); toast('Задача удалена.');
    } catch (err) { toast(err.message, true); }
    finally { state.busy = false; $('#deleteTaskBtn').disabled = false; }
  }

  function closeSidebar() {
    $('#sidebar').classList.remove('open');
    $('#mobileScrim').classList.add('hidden');
  }

  async function logout() {
    try { await request('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'logout' }) }); }
    catch (err) { toast(err.message, true); return; }
    state.user = null; state.tasks = [];
    closeSidebar();
    $('#loginInput').value = '';
    setAuthMode('login');
    showAuth();
  }

  function bind() {
    $('#authForm').addEventListener('submit', onAuthSubmit);
    $$('.auth-tab').forEach(btn => btn.addEventListener('click', () => setAuthMode(btn.dataset.auth)));
    $('#quickForm').addEventListener('submit', addTask);
    $('.chip-date').addEventListener('click', e => {
      if (e.target !== $('#quickDate') && typeof $('#quickDate').showPicker === 'function') {
        try { $('#quickDate').showPicker(); } catch {}
      }
    });
    $('#quickDate').addEventListener('change', e => {
      $('#datePlaceholder').textContent = e.target.value ? dateLabel(e.target.value) : 'Без срока';
    });
    $('#searchInput').addEventListener('input', e => { state.search = e.target.value.trim(); render(); });
    $('#sortSelect').addEventListener('change', e => { state.sort = e.target.value; render(); });
    $('#filterTabs').addEventListener('click', e => {
      const btn = e.target.closest('[data-status]');
      if (btn) { state.status = btn.dataset.status; render(); }
    });
    $$('.nav-item[data-view]').forEach(el => el.addEventListener('click', () => switchView(el.dataset.view)));
    $('#categoryNav').addEventListener('click', e => {
      const btn = e.target.closest('[data-category]');
      if (btn) switchView(`category:${btn.dataset.category}`);
    });
    $('#taskList').addEventListener('click', e => {
      const toggle = e.target.closest('[data-toggle]');
      const edit = e.target.closest('[data-edit]');
      if (toggle) toggleTask(toggle.dataset.toggle);
      else if (edit) openEdit(edit.dataset.edit);
      else if (e.target.closest('[data-focus-add]')) $('#quickTitle').focus();
    });
    $('#editForm').addEventListener('submit', saveEdit);
    $('#deleteTaskBtn').addEventListener('click', removeTask);
    $('#closeModal').addEventListener('click', closeEdit);
    $('#cancelEdit').addEventListener('click', closeEdit);
    $('#modalOverlay').addEventListener('click', e => { if (e.target === $('#modalOverlay')) closeEdit(); });
    $('#logoutBtn').addEventListener('click', logout);
    $('#openSidebar').addEventListener('click', () => { $('#sidebar').classList.add('open'); $('#mobileScrim').classList.remove('hidden'); });
    $('#closeSidebar').addEventListener('click', closeSidebar);
    $('#mobileScrim').addEventListener('click', closeSidebar);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { closeEdit(); closeSidebar(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && state.user) {
        e.preventDefault(); $('#searchInput').focus();
      }
    });
  }

  async function init() {
    bind();
    try {
      const result = await request('/api/me');
      if (!result.user) { showAuth(); return; }
      state.user = result.user;
      try { await loadTasks(); } catch (loadError) { state.tasks = []; toast(loadError.message, true); }
      showApp();
    } catch (e) {
      showAuth();
      if (!e.message.includes('Неожиданный')) toast(e.message, true);
    }
  }
  init();
})();
