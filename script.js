document.addEventListener('DOMContentLoaded', () => {
  // Применяем сохранённую тему из куки (если есть)
  const savedTheme = getCookie('theme');
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  if (savedTheme === 'dark') {
    document.body.classList.add('dark-theme');
    themeToggleBtn.textContent = 'Светлая тема';
  } else {
    document.body.classList.remove('dark-theme');
    themeToggleBtn.textContent = 'Темная тема';
  }

  const group = getCookie('group');
  const week = getCookie('week') || 0;

  // Если в куках уже есть группа, сразу показываем расписание
  if (group) {
    document.getElementById('mainPage').style.display = 'none';
    document.getElementById('scheduleView').style.display = 'block';
    document.getElementById('groupNameLink').textContent = group;
    loadSchedule(group, week);
  } else {
    document.getElementById('mainPage').style.display = 'block';
    document.getElementById('scheduleView').style.display = 'none';
  }

  // Обработчик кнопки "Показать"
  document.getElementById('showScheduleBtn').addEventListener('click', () => {
    const selectedGroup = document.getElementById('groupSelect').value;
    const selectedWeek = document.getElementById('weekSelect').value;
    if (!selectedGroup) return;
    setCookie('group', selectedGroup, 30);
    setCookie('week', selectedWeek, 30);
    document.getElementById('mainPage').style.display = 'none';
    document.getElementById('scheduleView').style.display = 'block';
    document.getElementById('groupNameLink').textContent = selectedGroup;
    loadSchedule(selectedGroup, selectedWeek);
  });

  // Возврат на главную по клику на название группы
  document.getElementById('groupNameLink').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('mainPage').style.display = 'block';
    document.getElementById('scheduleView').style.display = 'none';
  });

  // Переключение темы с сохранением в куки
  themeToggleBtn.addEventListener('click', () => {
    document.body.classList.toggle('dark-theme');
    if (document.body.classList.contains('dark-theme')) {
      themeToggleBtn.textContent = 'Светлая тема';
      setCookie('theme', 'dark', 30);
    } else {
      themeToggleBtn.textContent = 'Темная тема';
      setCookie('theme', 'light', 30);
    }
  });
});

/**
 * Функция загрузки расписания с API
 * Если week = 0 – используется автоматическая логика, иначе выводится полное расписание недели
 */
async function loadSchedule(group, week = 0) {
  try {
    const response = await fetch(`https://api.eralas.ru/api/schedule?group=${group}&week=${week}`);
    if (!response.ok) throw new Error('Ошибка сети');
    const schedule = await response.json();
    if (week == 0) {
      const result = processSchedule(schedule);
      renderAutoSchedule(result);
    } else {
      renderFullWeek(schedule);
    }
  } catch (error) {
    console.error('Ошибка:', error);
    document.getElementById('scheduleContainer').innerHTML = `
      <div class="card error">
        Не удалось загрузить расписание: ${error.message}
      </div>`;
  }
}

/**
 * Автоматическая логика формирования расписания:
 * - Если до начала первой пары – показываем все пары на сегодня.
 * - Если текущая пара идет – возвращаем и currentPairs, и nextPairs (если есть).
 * - Если нет текущей пары, но есть предстоящая – возвращаем nextPairs.
 * - Если все пары закончились – переходим к следующему дню.
 */
function processSchedule(schedule) {
  const now = new Date();
  const mskNow = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
  const mapByDate = {};

  schedule.forEach(pair => {
    const [d, m, y] = pair.date.split('.');
    const startDateStr = `${y}-${m}-${d}T${pair.startTime}`;
    const endDateStr = `${y}-${m}-${d}T${pair.endTime}`;
    const start = new Date(startDateStr);
    const end = new Date(endDateStr);
    if (!mapByDate[pair.date]) {
      mapByDate[pair.date] = [];
    }
    mapByDate[pair.date].push({ ...pair, startDate: start, endDate: end });
  });

  Object.keys(mapByDate).forEach(date => {
    mapByDate[date].sort((a, b) => a.startDate - b.startDate);
  });

  const day = mskNow.getDate().toString().padStart(2, '0');
  const month = (mskNow.getMonth() + 1).toString().padStart(2, '0');
  const year = mskNow.getFullYear();
  const todayStr = `${day}.${month}.${year}`;

  function getNextDayPairs() {
    const allDates = Object.keys(mapByDate).sort((a, b) => {
      const [da, ma, ya] = a.split('.');
      const [db, mb, yb] = b.split('.');
      return new Date(`${ya}-${ma}-${da}`) - new Date(`${yb}-${mb}-${db}`);
    });
    for (const dt of allDates) {
      if (dt > todayStr) {
        return { date: dt, pairs: mapByDate[dt], showAll: true, allPairsForToday: mapByDate[dt] };
      }
    }
    return { date: '', pairs: [], showAll: true, allPairsForToday: [] };
  }

  if (!mapByDate[todayStr]) {
    return getNextDayPairs();
  }

  const pairsToday = mapByDate[todayStr];
  const firstPairStart = pairsToday[0].startDate;
  const lastPairEnd = pairsToday[pairsToday.length - 1].endDate;

  if (mskNow < firstPairStart) {
    return { date: todayStr, pairs: pairsToday, showAll: true, allPairsForToday: pairsToday };
  }
  if (mskNow > lastPairEnd) {
    return getNextDayPairs();
  }

  const currentPairs = pairsToday.filter(p => p.startDate <= mskNow && p.endDate > mskNow);
  const upcoming = pairsToday.filter(p => p.startDate > mskNow);

  if (currentPairs.length > 0) {
    if (upcoming.length > 0) {
      const earliestUpcoming = upcoming[0].startDate;
      const nextPairs = upcoming.filter(p => p.startDate.getTime() === earliestUpcoming.getTime());
      return { date: todayStr, currentPairs, nextPairs, showBoth: true, allPairsForToday: pairsToday };
    } else {
      return { date: todayStr, currentPairs, showCurrentOnly: true, allPairsForToday: pairsToday };
    }
  } else {
    if (upcoming.length > 0) {
      const earliestUpcoming = upcoming[0].startDate;
      const nextPairs = upcoming.filter(p => p.startDate.getTime() === earliestUpcoming.getTime());
      return { date: todayStr, nextPairs, showNextPair: true, allPairsForToday: pairsToday };
    } else {
      return getNextDayPairs();
    }
  }
}

/**
 * Рендер автоматического расписания:
 * - Если найден флаг showAll – показываем все пары дня.
 * - Если showBoth – выводим секцию "Текущая пара:" и секцию "Следующая пара:".
 * - Если только текущая или только следующая – выводим соответствующую секцию.
 * При этом классы current-pair и next-pair добавляются через classList, чтобы не затрагивать dark-theme.
 */
function renderAutoSchedule(result) {
  const container = document.getElementById('scheduleContainer');
  const dateContainer = document.getElementById('dateContainer');
  container.innerHTML = '';

  // Удаляем только специфичные классы расписания, не трогая тему
  document.body.classList.remove('current-pair', 'next-pair');

  if (result.showAll) {
    if (dateContainer) {
      dateContainer.textContent = `Пары на ${result.date}`;
    }
    result.pairs.forEach(pair => container.appendChild(createPairCard(pair)));
  } else if (result.showBoth) {
    // Секция текущей пары
    const currentHeader = document.createElement('div');
    currentHeader.textContent = "Текущая пара:";
    currentHeader.classList.add("schedule-heading");
    container.appendChild(currentHeader);
    result.currentPairs.forEach(pair => container.appendChild(createPairCard(pair)));
    // Секция следующей пары
    const nextHeader = document.createElement('div');
    nextHeader.textContent = "Следующая пара:";
    nextHeader.classList.add("schedule-heading");
    container.appendChild(nextHeader);
    result.nextPairs.forEach(pair => container.appendChild(createPairCard(pair)));
    // Если нужно – кнопка для показа всех пар на сегодня
    if (result.allPairsForToday.length > (result.currentPairs.length + result.nextPairs.length)) {
      const showAllBtn = document.createElement('button');
      showAllBtn.textContent = "Показать остальные пары на сегодня";
      showAllBtn.addEventListener('click', () => renderAllPairsForDate(result.date, result.allPairsForToday));
      container.appendChild(showAllBtn);
    }
  } else if (result.showCurrentOnly) {
    if (dateContainer) {
      dateContainer.textContent = "Текущая пара:";
    }
    document.body.classList.add('current-pair');
    result.currentPairs.forEach(pair => container.appendChild(createPairCard(pair)));
    if (result.allPairsForToday.length > result.currentPairs.length) {
      const showAllBtn = document.createElement('button');
      showAllBtn.textContent = "Показать остальные пары на сегодня";
      showAllBtn.addEventListener('click', () => renderAllPairsForDate(result.date, result.allPairsForToday));
      container.appendChild(showAllBtn);
    }
  } else if (result.showNextPair) {
    if (dateContainer) {
      dateContainer.textContent = "Следующая пара:";
    }
    document.body.classList.add('next-pair');
    result.nextPairs.forEach(pair => container.appendChild(createPairCard(pair)));
    if (result.allPairsForToday.length > result.nextPairs.length) {
      const showAllBtn = document.createElement('button');
      showAllBtn.textContent = "Показать остальные пары на сегодня";
      showAllBtn.addEventListener('click', () => renderAllPairsForDate(result.date, result.allPairsForToday));
      container.appendChild(showAllBtn);
    }
  } else {
    if (dateContainer) {
      dateContainer.textContent = `Пары на ${result.date}`;
    }
    result.pairs.forEach(pair => container.appendChild(createPairCard(pair)));
  }
}

/**
 * Функция для показа всех пар на выбранный день
 */
function renderAllPairsForDate(date, pairs) {
  const container = document.getElementById('scheduleContainer');
  const dateContainer = document.getElementById('dateContainer');
  container.innerHTML = '';
  if (dateContainer) {
    dateContainer.textContent = `Все пары на ${date}`;
  }
  document.body.classList.remove('current-pair', 'next-pair');
  pairs.forEach(pair => container.appendChild(createPairCard(pair)));
}

/**
 * Рендер полного расписания недели (если week != 0)
 */
function renderFullWeek(schedule) {
  const container = document.getElementById('scheduleContainer');
  const dateContainer = document.getElementById('dateContainer');
  container.innerHTML = '';
  document.body.classList.remove('current-pair', 'next-pair');
  if (schedule.length === 0) {
    container.innerHTML = '<div class="card">Нет пар на эту неделю</div>';
    if (dateContainer) dateContainer.textContent = '';
    return;
  }
  const mapByDate = {};
  schedule.forEach(pair => {
    if (!mapByDate[pair.date]) {
      mapByDate[pair.date] = [];
    }
    mapByDate[pair.date].push(pair);
  });
  const sortedDates = Object.keys(mapByDate).sort((a, b) => {
    const [da, ma, ya] = a.split('.');
    const [db, mb, yb] = b.split('.');
    return new Date(`${ya}-${ma}-${da}`) - new Date(`${yb}-${mb}-${db}`);
  });
  dateContainer.textContent = 'Расписание на выбранную неделю';
  sortedDates.forEach(dateStr => {
    const dayPairs = mapByDate[dateStr];
    dayPairs.sort((a, b) => {
      const [aH, aM] = a.startTime.split(':');
      const [bH, bM] = b.startTime.split(':');
      return (parseInt(aH) * 60 + parseInt(aM)) - (parseInt(bH) * 60 + parseInt(bM));
    });
    const dayHeader = document.createElement('h3');
    dayHeader.textContent = dateStr;
    container.appendChild(dayHeader);
    dayPairs.forEach(pair => {
      const card = createPairCard(pair);
      container.appendChild(card);
    });
  });
}

/**
 * Создаёт карточку для одной пары
 */
function createPairCard(pair) {
  const card = document.createElement('div');
  card.className = 'card';
  card.style.backgroundColor = getColor(pair.color);
  const teachers = pair.teachers
    ? Object.values(pair.teachers).map(t => t.fio).join(', ')
    : 'Преподаватель не указан';
  card.innerHTML = `
    <div class="card-header">
      <span class="time">${pair.startTime} - ${pair.endTime}</span>
    </div>
    <div class="discipline">${pair.discipline}</div>
    <div class="details">
      <div>
        <div class="badge">${pair.groupType}</div>
        <div class="teacher">${teachers}</div>
      </div>
      <div>${pair.classroom}</div>
    </div>
  `;
  return card;
}

/**
 * Возвращает цвет для карточки в зависимости от pair.color
 */
function getColor(color) {
  return {
    'sky':  '#e0f2fe',
    'teal': '#ecfdf5',
    'none': '#fff'
  }[color] || '#fff';
}

/**
 * Устанавливает куки
 */
function setCookie(name, value, days) {
  const date = new Date();
  date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
  document.cookie = `${name}=${value};expires=${date.toUTCString()};path=/`;
}

/**
 * Получает значение куки
 */
function getCookie(name) {
  const match = document.cookie.split('; ').find(row => row.startsWith(name + '='));
  return match ? match.split('=')[1] : null;
}
