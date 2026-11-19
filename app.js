(async () => {
  'use strict';

  const $ = id => document.getElementById(id);
  const loadJson = async path => {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Could not load ${path}: ${response.status}`);
    return response.json();
  };
  const [db, translations] = await Promise.all([loadJson('./guide.json'), loadJson('./translations.json')]);
  let language = 'ru';
  try {
    if (localStorage.getItem('eternum-route-language') === 'en') language = 'en';
  } catch {}
  const t = (ru, en) => language === 'ru' ? ru : en;
  const message = text => translations.messages[text]?.[language === 'ru' ? 1 : 0] ?? text;
  const chapterTitle = chapter => t(chapter.title, translations.chapters[chapter.number - 1]);
  const storageKey = 'eternum-route-profiles-v3';
  const characterIds = ['annie', 'nancy', 'penny', 'dalia', 'luna', 'alex', 'nova', 'calypso'];
  const selection = new Set();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const color = id => db.characters[id][1];
  const name = id => t(db.characters[id][0], translations.characters[id]);
  const activeProfile = () => state.profiles.find(profile => profile.id === state.active);
  const entries = db.entries.filter(entry => entry.kind !== 'section');
  const displayedIds = new Set(db.entries.map(entry => entry.id));
  const chapters = db.chapters.map((title, index) => ({
    title,
    number: index + 1,
    sections: new Map()
  }));

  let state = {profiles: [], active: null};
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (Array.isArray(saved?.profiles)) state = saved;
  } catch {}

  for (const entry of db.entries) {
    const chapter = chapters[entry.chapter - 1];
    const sectionId = entry.id.split('.').slice(0, 2).join('.');
    if (!chapter.sections.has(sectionId)) chapter.sections.set(sectionId, {id: sectionId, entries: []});
    const section = chapter.sections.get(sectionId);
    if (entry.kind === 'section') section.heading = entry;
    else section.entries.push(entry);
  }

  function save() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      alert(t('Браузер запретил сохранять прогресс.', 'The browser blocked saving your progress.'));
    }
  }

  function profileModal(open) {
    $('profileOverlay').classList.toggle('hide', !open);
    $('closeProfiles').disabled = !activeProfile();
    if (!open) return;
    $('profileList').innerHTML = state.profiles.map(profile => `
      <div class="profileRow">
        <span>${esc(profile.name)} <span class="muted">· ${Object.values(profile.done || {}).filter(Boolean).length} ${t('отмечено', 'marked')}</span></span>
        <button data-switch="${esc(profile.id)}">${profile.id === state.active ? t('Текущий', 'Current') : t('Войти', 'Switch')}</button>
      </div>`).join('');
  }

  function updateProfile() {
    const profile = activeProfile();
    $('profileName').textContent = profile?.name || t('Выбрать профиль', 'Choose a profile');
    $('avatar').textContent = (profile?.name || '?').charAt(0).toUpperCase();
    const done = profile?.done || {};
    const passed = entries.filter(entry => done[entry.id]).length;
    const percent = passed / entries.length * 100;
    $('counter').textContent = `${passed} / ${entries.length} ${t('пройдено', 'completed')}`;
    $('percent').textContent = `${Math.round(percent)}%`;
    $('progressFill').style.width = `${percent}%`;
  }

  function setProfile(id) {
    state.active = id;
    save();
    profileModal(false);
    updateProfile();
    scheduleAuto();
    for (const button of $('results').querySelectorAll('[data-done]')) {
      updateDoneButton(button, !!activeProfile()?.done?.[button.dataset.done]);
    }
  }

  function updateDoneButton(button, done) {
    button.textContent = done ? t('✓ Пройдено', '✓ Completed') : t('○ Отметить', '○ Mark done');
    button.classList.toggle('done', done);
    button.setAttribute('aria-pressed', String(done));
  }

  function linkReferences(text) {
    return esc(text).replace(/\b\d+\.\d+(?:\.\d+)?\b/g, id =>
      displayedIds.has(id) ? `<a class="route-ref" href="#route-${id}" data-route-ref="${id}">${id}</a>` : id
    );
  }

  function makeBlocks(entry) {
    return entry.blocks.map(block => {
      const text = linkReferences(message(block.text)).replaceAll('\n', '<br>');
      if (block.kind === 'note') return `<div class="route-note">${text}</div>`;
      return `<div class="choice ${block.ideal ? 'ideal' : ''} ${block.kind === 'dialogue' ? 'route-dialogue' : ''}">
        ${block.ideal ? `<span class="recommend">◆ ${t('ИДЕАЛ', 'IDEAL')}</span>` : ''}${text}
        ${block.notes.map(note => `<p class="choice-note">${linkReferences(message(note))}</p>`).join('')}
      </div>`;
    }).join('');
  }

  function makeCard(entry) {
    const colors = entry.characters.map(color);
    const stripe = colors.length ? `linear-gradient(90deg,${colors.map((c,i) => `${c} ${i*100/colors.length}% ${100*(i+1)/colors.length}%`).join(',')})` : 'linear-gradient(90deg,#2d506e,#4da4be)';
    const done = !!activeProfile()?.done?.[entry.id];
    return `<article class="card ${colors.length ? 'hascolor' : ''}" style="--stripe:${stripe};--neon:${colors[0] || '#5d9dff'}" id="route-${entry.id}">
      <div class="cardHeader"><span class="code">${entry.id}</span><span class="cardMeta">PDF · ${t('стр.', 'p.')} ${entry.page}</span></div>
      <h4 class="cardTitle">${esc(message(entry.title || entry.id))}</h4>
      ${entry.characters.length ? `<div class="pills">${entry.characters.map(id => `<span class="pill" style="--c:${color(id)}">${esc(name(id))}</span>`).join('')}</div>` : ''}
      ${makeBlocks(entry)}
      <div class="cardFooter"><button class="doneBtn ${done ? 'done' : ''}" data-done="${entry.id}" aria-pressed="${done}">${done ? t('✓ Пройдено', '✓ Completed') : t('○ Отметить', '○ Mark done')}</button></div>
    </article>`;
  }

  let chapterNodes;

  function renderGuide() {
  $('results').innerHTML = chapters.map(chapter => `
    <details class="route-chapter" id="chapter-${chapter.number}" ${chapter.number === 1 ? 'open' : ''}>
      <summary><h2>0.${chapter.number} · ${esc(chapterTitle(chapter))}</h2></summary>
      <div class="chapter-body">
      ${[...chapter.sections.values()].map(section => {
        const first = section.entries[0];
        const heading = section.heading ?? (first?.id === section.id && !first.blocks.length ? first : null);
        return `<details class="route-section" id="section-${section.id}">
          <summary><h3>${section.id}${heading ? ` · ${esc(message(heading.title))}` : ''}</h3></summary>
          <div class="section-body">
            ${section.heading ? `<div class="section-context" id="route-${section.id}">${makeBlocks(section.heading)}</div>` : ''}
            ${section.entries.map(makeCard).join('')}
          </div>
        </details>`;
      }).join('')}
      </div>
    </details>`).join('');

  $('tabs').innerHTML = chapters.map(chapter => `<a href="#chapter-${chapter.number}" data-chapter="${chapter.number}" aria-label="${t('Глава', 'Chapter')} 0.${chapter.number} · ${esc(chapterTitle(chapter))}">0.${chapter.number}</a>`).join('');
  $('characterOptions').innerHTML = characterIds.map(id => `
    <label><input type="checkbox" value="${id}" ${selection.has(id) ? 'checked' : ''}><span style="--c:${color(id)}">${esc(name(id))}</span></label>`).join('');

  chapterNodes = chapters.map(chapter => {
    const node = $(`chapter-${chapter.number}`);
    const sections = [...chapter.sections.values()].map(section => ({
      node: $(`section-${section.id}`),
      heading: section.heading,
      cards: section.entries.map(entry => ({entry, node: $(`route-${entry.id}`)}))
    }));
    return {node, sections, link: $('tabs').querySelector(`[data-chapter="${chapter.number}"]`)};
  });
  }

  function applyFilter() {
    const matches = entry => !selection.size || entry?.characters.some(id => selection.has(id));
    let visible = 0;
    for (const chapter of chapterNodes) {
      let chapterVisible = false;
      for (const section of chapter.sections) {
        let sectionVisible = matches(section.heading);
        for (const card of section.cards) {
          const show = matches(card.entry);
          card.node.hidden = !show;
          sectionVisible ||= show;
          visible += Number(show);
        }
        section.node.hidden = !sectionVisible;
        chapterVisible ||= sectionVisible;
      }
      chapter.node.hidden = !chapterVisible;
      chapter.link.hidden = !chapterVisible;
    }
    $('filterLabel').textContent = selection.size ? [...selection].map(name).join(', ') : t('Все девушки', 'All girls');
    $('matchCount').textContent = selection.size ? `${t('Показано решений', 'Entries shown')}: ${visible}` : '';
    $('emptyFilter').hidden = chapterNodes.some(chapter => !chapter.node.hidden);
    scheduleAuto();
  }

  function jump(target) {
    if (!target) return;
    for (let node = target; node && node !== $('results'); node = node.parentElement) {
      if (node.hidden) return;
      if (node.matches('.route-chapter, .route-section')) setOpen(node, true, false);
    }
    suspendAuto();
    currentSectionId = target.closest('.route-section')?.id;
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(scheduleAuto, 580);
    target.scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
  }

  const filter = $('characterFilter');
  filter.addEventListener('change', event => {
    const checkbox = event.target.closest('input[type="checkbox"]');
    if (!checkbox) return;
    if (checkbox.checked) selection.add(checkbox.value);
    else selection.delete(checkbox.value);
    applyFilter();
  });
  $('clearFilter').onclick = () => {
    selection.clear();
    for (const checkbox of filter.querySelectorAll('input')) checkbox.checked = false;
    applyFilter();
  };
  document.addEventListener('click', event => {
    if (!filter.contains(event.target)) filter.open = false;
  });
  filter.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    filter.open = false;
    filter.querySelector('summary').focus();
  });

  $('tabs').onclick = event => {
    const link = event.target.closest('[data-chapter]');
    if (!link) return;
    event.preventDefault();
    history.replaceState(null, '', link.hash);
    jump($(link.hash.slice(1)));
  };
  $('results').onclick = event => {
    const reference = event.target.closest('[data-route-ref]');
    if (reference) {
      event.preventDefault();
      const target = $(`route-${reference.dataset.routeRef}`);
      if (target?.closest('[hidden]')) $('clearFilter').click();
      history.replaceState(null, '', reference.hash);
      jump(target);
      return;
    }
    const button = event.target.closest('[data-done]');
    const profile = activeProfile();
    if (!button || !profile) return;
    profile.done ||= {};
    const id = button.dataset.done;
    profile.done[id] = !profile.done[id];
    save();
    updateDoneButton(button, profile.done[id]);
    updateProfile();
  };

  $('profileBtn').onclick = () => profileModal(true);
  $('closeProfiles').onclick = () => {
    profileModal(false);
    scheduleAuto();
  };
  $('profileList').onclick = event => {
    const button = event.target.closest('[data-switch]');
    if (button) setProfile(button.dataset.switch);
  };
  $('profileForm').onsubmit = event => {
    event.preventDefault();
    const profileName = $('newName').value.trim();
    if (!profileName) return;
    const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    state.profiles.push({id, name: profileName, done: {}});
    $('newName').value = '';
    setProfile(id);
  };
  $('exportProgress').onclick = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], {type: 'application/json'});
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'eternum-progress.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 500);
  };

  function localizeInterface() {
    document.documentElement.lang = language;
    for (const element of document.querySelectorAll('[data-en]')) {
      element.textContent = t(element.dataset.ru, element.dataset.en);
    }
    for (const element of document.querySelectorAll('[data-en-label]')) {
      element.setAttribute('aria-label', t(element.dataset.ruLabel, element.dataset.enLabel));
    }
    $('newName').placeholder = t('Имя профиля, например MQ804', 'Profile name, e.g. MQ804');
    for (const select of document.querySelectorAll('[data-language]')) select.value = language;
    updateAutoLabel();
  }

  function setLanguage(event) {
    const openIds = [...$('results').querySelectorAll('details[open]')].map(node => node.id);
    const anchor = [...$('results').querySelectorAll('summary, .card')].find(node => {
      const rect = node.getBoundingClientRect();
      return rect.bottom > toolbarBottom() && rect.top < innerHeight;
    });
    const anchorId = anchor?.id || anchor?.parentElement.id;
    const offset = anchor?.getBoundingClientRect().top;
    language = event.target.value;
    try { localStorage.setItem('eternum-route-language', language); } catch {}
    localizeInterface();
    renderGuide();
    for (const id of openIds) $(id).open = true;
    $('chapter-1').open = openIds.includes('chapter-1');
    updateProfile();
    profileModal(!$('profileOverlay').classList.contains('hide'));
    applyFilter();
    if (anchorId && $(anchorId)) window.scrollBy(0, $(anchorId).getBoundingClientRect().top - offset);
    scheduleAuto();
  }
  for (const select of document.querySelectorAll('[data-language]')) select.onchange = setLanguage;

  const results = $('results');
  const autoControl = $('autoAccordion');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const animations = new WeakMap();
  const toolbarBottom = () => document.querySelector('.toolbar').getBoundingClientRect().bottom;
  let autoEnabled = false;
  let autoFrame = 0;
  let autoSuspendedUntil = 0;
  try {
    autoEnabled = localStorage.getItem('eternum-route-auto') === 'on';
  } catch {}

  function updateAutoLabel() {
    const text = autoEnabled
      ? t('Автораскрытие включено', 'Auto-expand on')
      : t('Автораскрытие выключено', 'Auto-expand off');
    autoControl.checked = autoEnabled;
    autoControl.setAttribute('aria-label', text);
    autoControl.parentElement.title = text;
  }

  function suspendAuto() {
    autoSuspendedUntil = performance.now() + (reducedMotion.matches ? 100 : 550);
  }

  function setOpen(node, open, animate = true) {
    const running = animations.get(node);
    if (running?.open === open && animate || !running && node.open === open) return;
    const from = animate && !reducedMotion.matches ? node.getBoundingClientRect().height : 0;
    if (running) {
      running.animation.cancel();
      animations.delete(node);
    }
    if (!animate || reducedMotion.matches) {
      node.open = open;
      return;
    }
    node.open = true;
    const to = open ? node.offsetHeight : node.firstElementChild.offsetHeight + 2;
    if (Math.abs(from - to) < 2) {
      node.open = open;
      return;
    }
    const animation = node.animate(
      [{height: `${from}px`, overflow: 'clip'}, {height: `${to}px`, overflow: 'clip'}],
      {duration: 210, easing: 'cubic-bezier(.25,.8,.25,1)'}
    );
    animations.set(node, {animation, open});
    animation.onfinish = () => {
      node.open = open;
      animations.delete(node);
    };
  }

  const preloadDistance = 200;
  let currentSectionId;
  let scrollDirection = 1;
  let lastScrollY = scrollY;
  let resumeTimer;

  function pin(node, offset) {
    const adjustment = node.getBoundingClientRect().top - offset;
    if (Math.abs(adjustment) > 1) window.scrollBy(0, adjustment);
    lastScrollY = scrollY;
  }

  function showSection(item) {
    setOpen(item.chapter, true, false);
    setOpen(item.node, true, false);
  }

  function keepSections(visible, anchor, offset) {
    const sections = new Set(visible.map(item => item.node));
    const activeChapters = new Set(visible.map(item => item.chapter));
    for (const chapter of chapterNodes) {
      for (const section of chapter.sections) {
        if (!sections.has(section.node)) setOpen(section.node, false, false);
      }
      if (!activeChapters.has(chapter.node)) setOpen(chapter.node, false, false);
    }
    pin(anchor, offset);
  }

  function updateAuto() {
    autoFrame = 0;
    if (!autoEnabled || performance.now() < autoSuspendedUntil || !$('profileOverlay').classList.contains('hide')) return;
    const top = Math.max(0, toolbarBottom());
    const bottom = innerHeight;
    if (top >= bottom || results.getBoundingClientRect().top > bottom + preloadDistance) return;

    const items = chapterNodes.flatMap(chapter => chapter.node.hidden ? [] : chapter.sections
      .filter(section => !section.node.hidden)
      .map(section => ({chapter: chapter.node, node: section.node})));
    const bounds = item => (item.chapter.open ? item.node : item.chapter).getBoundingClientRect();
    let index = items.findIndex(item => item.node.id === currentSectionId);
    if (index < 0) {
      index = items.findIndex(item => bounds(item).bottom >= top);
      if (index < 0 || bounds(items[index]).top > bottom + preloadDistance) return;
      const initial = items[index];
      const offset = bounds(initial).top;
      const anchor = initial.chapter.open ? initial.node : initial.chapter;
      showSection(initial);
      currentSectionId = initial.node.id;
      keepSections([initial], anchor, offset);
      return;
    }

    const current = items[index];
    const next = items[index + scrollDirection];
    if (!next) return;
    const rect = current.node.getBoundingClientRect();
    const forward = scrollDirection > 0;
    const nearby = forward ? rect.bottom <= bottom + preloadDistance : rect.top >= top - preloadDistance;
    if (!nearby) return;

    const nextWasOpen = next.chapter.open && next.node.open;
    const offset = rect.top;
    showSection(next);
    if (!forward && !nextWasOpen) pin(current.node, offset);

    const currentBounds = current.node.getBoundingClientRect();
    const passed = forward ? currentBounds.bottom <= top : currentBounds.top >= bottom;
    if (!passed) {
      keepSections([current, next], current.node, currentBounds.top);
      return;
    }

    currentSectionId = next.node.id;
    const nextBounds = next.node.getBoundingClientRect();
    const overshot = nextBounds.bottom <= top || nextBounds.top < top - 120 || (!nextWasOpen && nextBounds.top < top);
    const anchorAt = forward && overshot ? top + 8 : nextBounds.top;
    keepSections([next], next.node, anchorAt);
  }

  function scheduleAuto() {
    if (autoEnabled && !autoFrame) autoFrame = requestAnimationFrame(updateAuto);
  }

  autoControl.addEventListener('change', () => {
    autoEnabled = autoControl.checked;
    autoSuspendedUntil = 0;
    currentSectionId = undefined;
    lastScrollY = scrollY;
    try { localStorage.setItem('eternum-route-auto', autoEnabled ? 'on' : 'off'); } catch {}
    updateAutoLabel();
    scheduleAuto();
  });

  results.addEventListener('click', event => {
    const summary = event.target.closest('summary');
    const node = summary?.parentElement;
    if (!node?.matches('.route-chapter, .route-section')) return;
    event.preventDefault();
    suspendAuto();
    const open = !(animations.get(node)?.open ?? node.open);
    setOpen(node, open);
    currentSectionId = open && node.matches('.route-section') ? node.id : undefined;
  });

  window.addEventListener('scroll', () => {
    if (scrollY !== lastScrollY) scrollDirection = scrollY > lastScrollY ? 1 : -1;
    lastScrollY = scrollY;
    scheduleAuto();
  }, {passive: true});
  window.addEventListener('resize', scheduleAuto);

  renderGuide();
  localizeInterface();
  updateProfile();
  applyFilter();
  profileModal(!activeProfile());
  $('section-1.1').open = true;
  scheduleAuto();
  if (location.hash) requestAnimationFrame(() => jump($(location.hash.slice(1))));
})().catch(error => {
  console.error(error);
  document.getElementById('profileOverlay').classList.add('hide');
  document.getElementById('counter').textContent = 'Не удалось загрузить гайд / Could not load the guide';
});
