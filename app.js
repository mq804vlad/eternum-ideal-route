(async () => {
  'use strict';

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  const $ = id => document.getElementById(id);
  const loadJson = async path => {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Could not load ${path}: ${response.status}`);
    return response.json();
  };
  const [db, translations] = await Promise.all([loadJson('./guide.json?v=f2d9c692ccc6'), loadJson('./translations.json?v=bb84587f5b57')]);
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
  const entryMap = new Map(entries.map(entry => [entry.id, entry]));
  const isOption = block => block?.kind === 'option' || block?.kind === 'reply';
  const isPassed = (entry, profile) => !!profile?.done?.[entry.id] || isOption(entry.blocks[profile?.choices?.[entry.id]]);
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
        <span>${esc(profile.name)} <span class="muted">· ${entries.filter(entry => isPassed(entry, profile)).length} ${t('отмечено', 'marked')}</span></span>
        <button data-switch="${esc(profile.id)}">${profile.id === state.active ? t('Текущий', 'Current') : t('Войти', 'Switch')}</button>
      </div>`).join('');
  }

  function updateProfile() {
    const profile = activeProfile();
    $('profileName').textContent = profile?.name || t('Выбрать профиль', 'Choose a profile');
    $('avatar').textContent = (profile?.name || '?').charAt(0).toUpperCase();
    const passed = entries.filter(entry => isPassed(entry, profile)).length;
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
    for (const button of $('results').querySelectorAll('[data-choice]')) {
      refreshChoice(button);
    }
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

  function refreshChoice(button) {
    const selected = activeProfile()?.choices?.[button.dataset.choice] === Number(button.dataset.option);
    button.setAttribute('aria-pressed', String(selected));
    button.closest('.choice').classList.toggle('picked', selected);
  }

  function makeBlocks(entry) {
    return entry.blocks.map((block, index) => {
      const blockText = language === 'ru' && block.ru ? block.ru : message(block.text);
      const text = linkReferences(blockText).replaceAll('\n', '<br>');
      if (block.kind === 'note') return `<div class="route-note">${text}</div>`;
      const selectable = entry.kind !== 'section' && isOption(block);
      const picked = selectable && activeProfile()?.choices?.[entry.id] === index;
      return `<div class="choice ${block.ideal ? 'ideal' : ''} ${block.kind !== 'option' ? 'route-dialogue' : ''} ${picked ? 'picked' : ''}">
        ${block.ideal ? `<span class="recommend" role="img" aria-label="${t('Рекомендуемый вариант', 'Recommended choice')}">◆</span>` : ''}${text}
        ${block.notes.map(note => `<p class="choice-note">${linkReferences(message(note))}</p>`).join('')}
        ${selectable ? `<button type="button" class="choice-pick" data-choice="${entry.id}" data-option="${index}" aria-pressed="${picked}" aria-label="${t('Выбор', 'Choice')}: ${esc(blockText)}"></button>` : ''}
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
      ${entry.blocks.some(isOption) ? '' : `<div class="cardFooter"><button class="doneBtn ${done ? 'done' : ''}" data-done="${entry.id}" aria-pressed="${done}">${done ? t('✓ Пройдено', '✓ Completed') : t('○ Отметить', '○ Mark done')}</button></div>`}
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
  }

  function jump(target, restore = false) {
    if (!target) return;
    for (let node = target; node && node !== $('results'); node = node.parentElement) {
      if (node.hidden) return;
      if (node.matches('.route-chapter, .route-section')) setOpen(node, true, false);
    }
    target.scrollIntoView({behavior: restore || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
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
    const profile = activeProfile();
    if (!profile) return;
    const choice = event.target.closest('[data-choice]');
    if (choice) {
      const {choice: id, option} = choice.dataset;
      const index = Number(option);
      profile.choices ||= {};
      const wasSelected = profile.choices[id] === index;
      delete profile.choices[id];
      if (!wasSelected) profile.choices[id] = index;
      if (profile.done) delete profile.done[id];
      save();
      for (const button of choice.closest('.card').querySelectorAll('[data-choice]')) refreshChoice(button);
      updateProfile();
      return;
    }
    const button = event.target.closest('[data-done]');
    if (!button) return;
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
  }
  for (const select of document.querySelectorAll('[data-language]')) select.onchange = setLanguage;

  const results = $('results');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const animations = new WeakMap();
  const toolbarBottom = () => document.querySelector('.toolbar').getBoundingClientRect().bottom;

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

  results.addEventListener('click', event => {
    const node = event.target.closest('summary')?.parentElement;
    if (!node?.matches('.route-chapter, .route-section')) return;
    event.preventDefault();
    setOpen(node, !(animations.get(node)?.open ?? node.open));
  });

  const scoresDialog = $('scoresDialog');
  $('scoresButton').onclick = () => {
    const profile = activeProfile();
    if (!profile) return profileModal(true);
    const totals = new Map([...characterIds, 'chang'].map(id => [id, 0]));
    for (const [id, index] of Object.entries(profile.choices || {})) {
      const block = entryMap.get(id)?.blocks[index];
      for (const [character, delta, milestone] of block?.affection || []) {
        if (milestone && !profile.done?.[milestone]) continue;
        totals.set(character, totals.get(character) + delta);
      }
    }
    $('scoresProfile').textContent = profile.name;
    $('scoresList').innerHTML = [...totals].map(([id, total]) => `
      <div class="score-row"><dt style="--c:${color(id)}">${esc(id === 'chang' ? t('Микаэла', 'Michaela') : name(id))}</dt>
      <dd>${total > 0 ? '+' : ''}${total}</dd></div>`).join('');
    scoresDialog.showModal();
  };
  scoresDialog.onclick = event => {
    if (event.target === scoresDialog) scoresDialog.close();
  };

  renderGuide();
  localizeInterface();
  updateProfile();
  applyFilter();
  profileModal(!activeProfile());
  $('section-1.1').open = true;
  const choices = activeProfile()?.choices || {};
  const lastChoice = Object.keys(choices).findLast(id => isOption(entryMap.get(id)?.blocks[choices[id]]));
  const savedTarget = lastChoice && $(`route-${lastChoice}`);
  const linkedTarget = location.hash && $(location.hash.slice(1));
  const navigation = performance.getEntriesByType('navigation')[0]?.type;
  const target = navigation === 'reload' || navigation === 'back_forward'
    ? savedTarget || linkedTarget
    : linkedTarget || savedTarget;
  if (target) requestAnimationFrame(() => jump(target, true));
})().catch(error => {
  console.error(error);
  document.getElementById('profileOverlay').classList.add('hide');
  document.getElementById('counter').textContent = 'Не удалось загрузить гайд / Could not load the guide';
});
