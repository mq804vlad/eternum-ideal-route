(async () => {
  'use strict';

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  const $ = id => document.getElementById(id);
  const loadJson = async path => {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Could not load ${path}: ${response.status}`);
    return response.json();
  };
  let language = 'ru';
  try {
    if (localStorage.getItem('eternum-route-language') === 'en') language = 'en';
  } catch {}
  const t = (ru, en) => language === 'ru' ? ru : en;

  const wakeButton = $('wakeButton');
  const wakeStatus = $('wakeStatus');
  const wakeKey = 'eternum-route-keep-screen-on';
  let keepScreenOn = false;
  let wakeLock;
  let wakeRequestPending = false;
  let wakeStatusTimer;

  try {
    keepScreenOn = localStorage.getItem(wakeKey) === 'true';
  } catch {}

  function renderWakeLock() {
    const title = t('Не гасить экран', 'Keep screen on');
    wakeButton.setAttribute('aria-label', title);
    const active = !!wakeLock && !wakeLock.released;
    wakeButton.title = keepScreenOn && !active
      ? t('Не гасить экран: ожидание разрешения браузера', 'Keep screen on: waiting for browser permission')
      : title;
    wakeButton.setAttribute('aria-pressed', String(keepScreenOn));
    wakeButton.dataset.wakeActive = String(active);
  }

  function reportWakeStatus(text) {
    clearTimeout(wakeStatusTimer);
    wakeStatus.textContent = text;
    wakeStatusTimer = setTimeout(() => { wakeStatus.textContent = ''; }, 4000);
  }

  async function requestWakeLock(interactive = false) {
    if (!navigator.wakeLock || !keepScreenOn || document.visibilityState !== 'visible' || wakeRequestPending || (wakeLock && !wakeLock.released)) return;
    wakeRequestPending = true;
    try {
      const lock = await navigator.wakeLock.request('screen');
      if (!keepScreenOn || document.visibilityState !== 'visible') {
        await lock.release();
        return;
      }
      wakeLock = lock;
      lock.addEventListener('release', () => {
        if (wakeLock === lock) wakeLock = undefined;
        renderWakeLock();
      }, {once: true});
      renderWakeLock();
      if (interactive) reportWakeStatus(t('Экран останется включённым', 'Screen will stay on'));
    } catch {
      if (interactive && keepScreenOn) reportWakeStatus(t('Браузер пока не удерживает экран включённым', 'The browser is not keeping the screen on yet'));
    } finally {
      wakeRequestPending = false;
    }
  }

  wakeButton.onclick = () => {
    if (!keepScreenOn && !navigator.wakeLock) {
      reportWakeStatus(t('Этот браузер не поддерживает режим', 'This browser does not support keeping the screen on'));
      return;
    }
    keepScreenOn = !keepScreenOn;
    try { localStorage.setItem(wakeKey, String(keepScreenOn)); } catch {}
    if (keepScreenOn) {
      renderWakeLock();
      requestWakeLock(true);
      return;
    }
    const lock = wakeLock;
    wakeLock = undefined;
    renderWakeLock();
    lock?.release().catch(() => {});
    reportWakeStatus(t('Режим выключен', 'Keep screen on is off'));
  };

  document.addEventListener('visibilitychange', () => requestWakeLock());
  window.addEventListener('pageshow', () => requestWakeLock());

  function retryWakeLockOnInteraction(event) {
    if (event.isTrusted && !wakeButton.contains(event.target)) requestWakeLock(true);
  }

  document.addEventListener('click', retryWakeLockOnInteraction, true);
  document.addEventListener('keydown', retryWakeLockOnInteraction, true);
  renderWakeLock();
  requestWakeLock();

  const [db, translations] = await Promise.all([loadJson('./guide.json?v=5b43edd0ac35'), loadJson('./translations.json?v=bb84587f5b57')]);
  const message = text => translations.messages[text]?.[language === 'ru' ? 1 : 0] ?? text;
  const chapterTitle = chapter => t(chapter.title, translations.chapters[chapter.number - 1]);
  const storageKey = 'eternum-route-progress-v1';
  const characterIds = ['annie', 'nancy', 'penny', 'dalia', 'luna', 'alex', 'nova', 'calypso'];
  const selection = new Set();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const color = id => db.characters[id][1];
  const name = id => t(db.characters[id][0], translations.characters[id]);
  const entries = db.entries.filter(entry => entry.kind !== 'section');
  const entryMap = new Map(entries.map(entry => [entry.id, entry]));
  const isOption = block => block?.kind === 'option' || block?.kind === 'reply';
  const chatChoiceKey = (id, turn) => `${id}:${turn + 1}`;
  const choiceKeyForOption = (entry, index) => entry.multiple ? `${entry.id}:${index}` : entry.id;
  const entryIdForChoice = key => key.split(':', 1)[0];
  const isPassed = entry => entry.chat
    ? entry.chat.every(({replies}, turn) => replies.includes(progress.choices[chatChoiceKey(entry.id, turn)]))
    : !!progress.done[entry.id] || entry.blocks.some((block, index) =>
      isOption(block) && progress.choices[choiceKeyForOption(entry, index)] === index);
  const displayedIds = new Set(db.entries.map(entry => entry.id));
  const chapters = db.chapters.map((title, index) => ({
    title,
    number: index + 1,
    sections: new Map()
  }));

  const progress = loadProgress();
  progress.choices = Object.fromEntries(Object.entries(progress.choices).flatMap(([key, index]) => {
    const entry = entryMap.get(key);
    let updatedKey;
    if (entry?.chat) {
      const turn = entry.chat.findIndex(({replies}) => replies.includes(index));
      if (turn === -1) return isOption(entry.blocks[index]) ? [[key, index]] : [];
      updatedKey = chatChoiceKey(key, turn);
    } else if (entry?.multiple) {
      if (!isOption(entry.blocks[index])) return [];
      updatedKey = choiceKeyForOption(entry, index);
    } else {
      return [[key, index]];
    }
    return Object.hasOwn(progress.choices, updatedKey) ? [] : [[updatedKey, index]];
  }));

  function loadProgress() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (saved) return {done: saved.done || {}, choices: saved.choices || {}, scoreChecks: saved.scoreChecks || {}};
      const legacy = JSON.parse(localStorage.getItem('eternum-route-profiles-v3'));
      if (Array.isArray(legacy?.profiles) && legacy.profiles.length) {
        const previous = legacy.profiles.find(profile => profile.id === legacy.active) || legacy.profiles[0];
        const migrated = {done: previous.done || {}, choices: previous.choices || {}, scoreChecks: {}};
        try { localStorage.setItem(storageKey, JSON.stringify(migrated)); } catch {}
        return migrated;
      }
    } catch {}
    return {done: {}, choices: {}, scoreChecks: {}};
  }

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
      localStorage.setItem(storageKey, JSON.stringify(progress));
    } catch {
      alert(t('Браузер запретил сохранять прогресс.', 'The browser blocked saving your progress.'));
    }
  }

  function updateProgress() {
    const passed = entries.filter(isPassed).length;
    const percent = passed / entries.length * 100;
    $('counter').textContent = `${passed} / ${entries.length} ${t('пройдено', 'completed')}`;
    $('percent').textContent = `${Math.round(percent)}%`;
    $('progressFill').style.width = `${percent}%`;
  }
  function doneLabel(entry, done) {
    const label = entry.completionLabel ? t(...entry.completionLabel) : (done ? t('Пройдено', 'Completed') : t('Отметить', 'Mark done'));
    return `${done ? '✓' : '○'} ${label}`;
  }

  function updateDoneButton(button, done) {
    button.textContent = doneLabel(entryMap.get(button.dataset.done), done);
    button.classList.toggle('done', done);
    button.setAttribute('aria-pressed', String(done));
  }

  function linkReferences(text) {
    return esc(text).replace(/\b\d+\.\d+(?:\.\d+)?\b/g, id =>
      displayedIds.has(id) ? `<a class="route-ref" href="#route-${id}" data-route-ref="${id}">${id}</a>` : id
    );
  }

  function refreshChoice(button) {
    const selected = progress.choices[button.dataset.choice] === Number(button.dataset.option);
    if (button.type === 'checkbox') button.checked = selected;
    else button.setAttribute('aria-pressed', String(selected));
    button.closest('.choice').classList.toggle('picked', selected);
  }

  const entryTitle = entry => language === 'ru' && entry.ruTitle ? entry.ruTitle : message(entry.title || entry.id);

  function makeBlocks(entry) {
    if (entry.chat) return makeChat(entry);
    return entry.blocks.map((block, index) => makeBlock(entry, block, index, choiceKeyForOption(entry, index))).join('');
  }

  const scoreName = character => character === 'chang' ? t('Микаэла', 'Michaela') : name(character);
  const formatPoints = affection => affection.map(([character, delta]) =>
    `${scoreName(character)} ${delta > 0 ? '+' : '−'}${Math.abs(delta)}`).join(' · ');

  function makeBlock(entry, block, index, choiceKey) {
    const blockText = t(block.ru, block.en) || message(block.text);
    const text = linkReferences(blockText).replaceAll('\n', '<br>');
    if (block.kind === 'note') return `<div class="route-note">${text}</div>`;
    const selectable = entry.kind !== 'section' && isOption(block);
    const picked = selectable && progress.choices[choiceKey] === index;
    const label = `${t('Выбор', 'Choice')}: ${esc(blockText)}`;
    const attributes = `data-choice="${choiceKey}" data-option="${index}" aria-label="${label}"`;
    const checkboxId = `choice-${entry.id}-${index}`;
    return `<div class="choice ${entry.multiple && selectable ? 'multi-choice' : ''} ${block.ideal ? 'ideal' : ''} ${block.kind !== 'option' ? 'route-dialogue' : ''} ${picked ? 'picked' : ''}">
      ${block.ideal ? `<span class="recommend" role="img" aria-label="${t('Рекомендуемый вариант', 'Recommended choice')}">◆</span>` : ''}${text}
      ${block.notes.map((note, noteIndex) => {
        const localizedNote = language === 'ru' ? block.ruNotes?.[noteIndex] ?? message(note) : message(note);
        return `<p class="choice-note">${linkReferences(localizedNote).replaceAll('\n', '<br>')}</p>`;
      }).join('')}
      ${entry.chat && block.affection ? `<p class="choice-note chat-reward">${esc(formatPoints(block.affection))}</p>` : ''}
      ${selectable && (entry.multiple
        ? `<label class="choice-toggle" for="${checkboxId}"></label>
           <input type="checkbox" class="choice-check" id="${checkboxId}" ${attributes} ${picked ? 'checked' : ''}>`
        : `<button type="button" class="choice-pick" ${attributes} aria-pressed="${picked}"></button>`) || ''}
    </div>`;
  }

  function makeChat(entry) {
    const character = entry.characters[0];
    const speaker = character === 'chang' ? t('Чанг', 'Chang') : name(character);
    const context = entry.chatContext ? t(...entry.chatContext) : character === 'chang'
      ? ''
      : t(`Чат доступен, если ветка персонажа «${speaker}» активна.`, `This chat is available if ${speaker}’s route is active.`);
    const note = index => makeBlock(entry, entry.blocks[index], index);
    const before = entry.chatNotes?.map(note).join('') ??
      (context ? `<div class="route-note">${linkReferences(context)}</div>` : '');
    const previous = progress.choices[entry.id];
    const savedReply = isOption(entry.blocks[previous]) ? `<div class="chat-turn" data-saved-chat-reply>
      <div class="chat-replies"><span class="chat-label">${t('Ранее отмеченный ответ', 'Previously marked reply')}</span>
        ${makeBlock(entry, entry.blocks[previous], previous, entry.id)}
      </div>
    </div>` : '';
    return before + entry.chat.map((step, turn) => {
      const key = chatChoiceKey(entry.id, turn);
      const label = step.speaker ? t(...step.speaker) : speaker;
      const incoming = index => `<div class="chat-message"><span class="chat-label">${esc(label)}</span>${makeBlock(entry, entry.blocks[index], index, key)}</div>`;
      const replyLabel = step.replies.length === 1
        ? t('Твой ответ', 'Your reply')
        : t('Твой ответ · любой из вариантов', 'Your reply · pick any option');
      return `<div class="chat-turn">
        ${step.note === undefined ? '' : note(step.note)}
        ${incoming(step.message)}
        <div class="chat-replies"><span class="chat-label">${replyLabel}</span>
          ${step.replies.map(index => makeBlock(entry, entry.blocks[index], index, key)).join('')}
        </div>
        ${step.followup === undefined ? '' : incoming(step.followup)}
      </div>`;
    }).join('') + savedReply + (entry.chatAfter?.map(note).join('') ?? '');
  }

  function makeScoreChecks(entry) {
    return (entry.scoreChecks || []).map(check => {
      const key = `${entry.id}:${check.id}`;
      const points = formatPoints(check.affection);
      return `<label class="score-check">
        <input type="checkbox" data-score-check="${key}" ${progress.scoreChecks[key] ? 'checked' : ''}>
        <span>${esc(t(...check.label))} <strong>${esc(points)}</strong></span>
      </label>`;
    }).join('');
  }

  function makeCard(entry) {
    const colors = entry.characters.map(color);
    const stripe = colors.length ? `linear-gradient(90deg,${colors.map((c,i) => `${c} ${i*100/colors.length}% ${100*(i+1)/colors.length}%`).join(',')})` : 'linear-gradient(90deg,#2d506e,#4da4be)';
    const done = !!progress.done[entry.id];
    return `<article class="card ${colors.length ? 'hascolor' : ''}" style="--stripe:${stripe};--neon:${colors[0] || '#5d9dff'}" id="route-${entry.id}">
      <div class="cardHeader"><span class="code">${entry.id}</span><span class="cardMeta">PDF · ${t('стр.', 'p.')} ${entry.page}</span></div>
      <h4 class="cardTitle">${esc(entryTitle(entry))}</h4>
      ${entry.characters.length ? `<div class="pills">${entry.characters.map(id => `<span class="pill" style="--c:${color(id)}">${esc(name(id))}</span>`).join('')}</div>` : ''}
      ${makeBlocks(entry)}
      ${makeScoreChecks(entry)}
      ${entry.blocks.some(isOption) ? '' : `<div class="cardFooter"><button class="doneBtn ${done ? 'done' : ''}" data-done="${entry.id}" aria-pressed="${done}">${esc(doneLabel(entry, done))}</button></div>`}
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
        const heading = section.heading ?? (first?.id === section.id && (!first.blocks.length || section.entries.length > 1) ? first : null);
        return `<details class="route-section" id="section-${section.id}">
          <summary><h3>${section.id}${heading ? ` · ${esc(entryTitle(heading))}` : ''}</h3></summary>
          <div class="section-body">
            ${section.heading ? `<div class="section-context" id="route-${section.id}">${makeBlocks(section.heading)}${makeScoreChecks(section.heading)}</div>` : ''}
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
    const choice = event.target.closest('[data-choice]');
    if (choice) {
      const {choice: id, option} = choice.dataset;
      const index = Number(option);
      const wasSelected = progress.choices[id] === index;
      delete progress.choices[id];
      const entryId = entryIdForChoice(id);
      const card = choice.closest('.card');
      const savedReply = card.querySelector('[data-saved-chat-reply]');
      if (savedReply && (id === entryId || !wasSelected)) {
        delete progress.choices[entryId];
        savedReply.remove();
      }
      if (!wasSelected) progress.choices[id] = index;
      delete progress.done[entryId];
      save();
      for (const button of card.querySelectorAll('[data-choice]')) refreshChoice(button);
      updateProgress();
      return;
    }
    const scoreCheck = event.target.closest('[data-score-check]');
    if (scoreCheck) {
      const key = scoreCheck.dataset.scoreCheck;
      if (scoreCheck.checked) progress.scoreChecks[key] = true;
      else delete progress.scoreChecks[key];
      save();
      return;
    }
    const button = event.target.closest('[data-done]');
    if (!button) return;
    const id = button.dataset.done;
    progress.done[id] = !progress.done[id];
    save();
    updateDoneButton(button, progress.done[id]);
    updateProgress();
  };

  $('exportProgress').onclick = () => {
    const blob = new Blob([JSON.stringify(progress, null, 2)], {type: 'application/json'});
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'eternum-progress.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 500);
  };

  function localizeInterface() {
    renderWakeLock();
    document.documentElement.lang = language;
    for (const element of document.querySelectorAll('[data-en]')) {
      element.textContent = t(element.dataset.ru, element.dataset.en);
    }
    for (const element of document.querySelectorAll('[data-en-label]')) {
      element.setAttribute('aria-label', t(element.dataset.ruLabel, element.dataset.enLabel));
    }
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
    updateProgress();
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

  function relationshipTotals() {
    const totals = new Map([...characterIds, 'chang'].map(id => [id, 0]));

    function addPoints(affection = []) {
      for (const [character, delta, milestone, prerequisite] of affection) {
        if (milestone && !progress.done[milestone]) continue;
        if (prerequisite && progress.choices[prerequisite[0]] !== prerequisite[1]) continue;
        totals.set(character, totals.get(character) + delta);
      }
    }

    for (const [id, index] of Object.entries(progress.choices)) {
      const block = entryMap.get(entryIdForChoice(id))?.blocks[index];
      addPoints(block?.affection);
    }
    for (const entry of db.entries) {
      if (progress.done[entry.id]) addPoints(entry.completionAffection);
      for (const check of entry.scoreChecks || []) {
        if (progress.scoreChecks[`${entry.id}:${check.id}`]) addPoints(check.affection);
      }
    }
    return totals;
  }

  const scoresDialog = $('scoresDialog');
  $('scoresButton').onclick = () => {
    const totals = relationshipTotals();
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
  updateProgress();
  applyFilter();
  $('section-1.1').open = true;
  const choices = progress.choices;
  const lastChoice = Object.keys(choices).findLast(id => isOption(entryMap.get(entryIdForChoice(id))?.blocks[choices[id]]));
  const savedTarget = lastChoice && $(`route-${entryIdForChoice(lastChoice)}`);
  const linkedTarget = location.hash && $(location.hash.slice(1));
  const navigation = performance.getEntriesByType('navigation')[0]?.type;
  const target = navigation === 'reload' || navigation === 'back_forward'
    ? savedTarget || linkedTarget
    : linkedTarget || savedTarget;
  if (target) requestAnimationFrame(() => jump(target, true));
})().catch(error => {
  console.error(error);
  document.getElementById('counter').textContent = 'Не удалось загрузить гайд / Could not load the guide';
});
