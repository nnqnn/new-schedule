document.addEventListener('DOMContentLoaded', () => {
  const group = localStorage.getItem('group');
  const week = localStorage.getItem('week') || '0';

  // При загрузке страницы — если группа уже сохранена, сразу показываем расписание
  if (group) {
    document.getElementById('groupSelect').value = group;
    document.getElementById('mainPage').style.display = 'none';
    document.getElementById('scheduleView').style.display = 'block';
    document.getElementById('groupNameLink').textContent = group;
    loadSchedule(group, week);
  } else {
    document.getElementById('mainPage').style.display = 'block';
    document.getElementById('scheduleView').style.display = 'none';
  }

  // Кнопка "Показать" на главной
  document.getElementById('showScheduleBtn').addEventListener('click', () => {
    const selectedGroup = document.getElementById('groupSelect').value;
    const selectedWeek = document.getElementById('weekSelect').value;
    if (!selectedGroup) return;

    localStorage.setItem('group', selectedGroup);
    localStorage.setItem('week', selectedWeek);

    document.getElementById('mainPage').style.display = 'none';
    document.getElementById('scheduleView').style.display = 'block';
    document.getElementById('groupNameLink').textContent = selectedGroup;

    loadSchedule(selectedGroup, selectedWeek);
  });

  // Клик по названию группы в шапке — вернуться к выбору
  document.getElementById('groupNameLink').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('mainPage').style.display = 'block';
    document.getElementById('scheduleView').style.display = 'none';
    const storedGroup = localStorage.getItem('group');
    if (storedGroup) {
      document.getElementById('groupSelect').value = storedGroup;
    }
  });

  // "Универсальная" кнопка в шапке
  document.getElementById('toggleScheduleBtn').addEventListener('click', () => {
    toggleHeaderView();
  });
});

// Данные для "автоматического" расписания (только week=0)
let currentAutoSchedule = null;
// Полное расписание для переключения (week=0 или нет)
let fullWeekSchedule = null;
// Флаг: true — краткий режим (текущая/следующая пара), false — полный
let currentPartialView = true;

/**
 * Загружаем расписание с API и отображаем.
 * Если week!=0, скрываем универсальную кнопку и показываем всё расписание за эту неделю.
 */
async function loadSchedule(group, week = '0') {
  // Скрыть/показать "универсальную" кнопку в шапке в зависимости от week
  const toggleBtn = document.getElementById('toggleScheduleBtn');
  if (week !== '0') {
    toggleBtn.style.display = 'none';
  } else {
    toggleBtn.style.display = 'inline-block';
  }

  try {
    const response = await fetch(`https://api.eralas.ru/api/schedule?group=${group}&week=${week}`);
    if (!response.ok) throw new Error('Ошибка сети');
    let schedule = await response.json();

    if (week === '0') {
      // Автоматическая логика для текущей недели
      let result = processSchedule(schedule);

      // Если на этой неделе пар нет (result.date === ''), пробуем следующую неделю
      if (result.date === '') {
        const nextResp = await fetch(`https://api.eralas.ru/api/schedule?group=${group}&week=1`);
        if (nextResp.ok) {
          const nextWeekSchedule = await nextResp.json();
          if (nextWeekSchedule.length > 0) {
            // Берём ближайшую дату на следующей неделе и показываем только её
            const map = groupByDate(nextWeekSchedule);
            const sortedDates = Object.keys(map).sort(compareDates);
            const earliestDate = sortedDates[0]; // самая ранняя дата
            result = {
              date: earliestDate,
              pairs: map[earliestDate],
              showAll: true, // флаг, говорящий, что мы выводим все пары на этот день
              allPairsForToday: map[earliestDate]
            };
            fullWeekSchedule = nextWeekSchedule; // сохраняем полное расписание на будущее
          } else {
            // Нет пар даже на следующей неделе
            result = { date: '', pairs: [], showAll: true, allPairsForToday: [] };
          }
        }
      } else {
        // На этой неделе есть пары
        fullWeekSchedule = schedule;
      }

      currentAutoSchedule = result;
      currentPartialView = true;
      renderAutoSchedule(result);

    } else {
      // Любая другая неделя: показываем полное расписание
      fullWeekSchedule = schedule;
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
 * Группировка массива расписания по дате
 */
function groupByDate(scheduleArray) {
  const map = {};
  scheduleArray.forEach(pair => {
    if (!map[pair.date]) {
      map[pair.date] = [];
    }
    map[pair.date].push(pair);
  });
  // Сортируем внутри каждой даты по времени
  Object.keys(map).forEach(dateStr => {
    map[dateStr].sort((a, b) => {
      const [aH, aM] = a.startTime.split(':');
      const [bH, bM] = b.startTime.split(':');
      return (parseInt(aH)*60 + parseInt(aM)) - (parseInt(bH)*60 + parseInt(bM));
    });
  });
  return map;
}

/**
 * Сравнение дат формата "dd.mm.yyyy" для сортировки
 */
function compareDates(a, b) {
  const [da, ma, ya] = a.split('.');
  const [db, mb, yb] = b.split('.');
  return new Date(`${ya}-${ma}-${da}`) - new Date(`${yb}-${mb}-${db}`);
}

/**
 * Обработка расписания текущей недели (week=0):
 * определяем, есть ли пары сегодня, текущая/следующая пара, либо ищем ближайший день
 */
function processSchedule(schedule) {
  const mskNow = getMskNow();
  const mapByDate = groupByDate(schedule);

  const todayStr = formatDate(mskNow);

  // Если на сегодня нет пар
  if (!mapByDate[todayStr]) {
    // Ищем ближайший день в будущем
    return getNextDayPairs(mapByDate, todayStr);
  }

  // На сегодня есть пары
  const pairsToday = mapByDate[todayStr];
  const firstPairStart = new Date(`${todayStr.split('.').reverse().join('-')}T${pairsToday[0].startTime}`);
  const lastPairEnd = new Date(`${todayStr.split('.').reverse().join('-')}T${pairsToday[pairsToday.length - 1].endTime}`);

  // Если ещё не началась первая пара
  if (mskNow < firstPairStart) {
    return {
      date: todayStr,
      pairs: pairsToday,
      showAll: false,
      allPairsForToday: pairsToday
    };
  }

  // Если уже закончились все пары
  if (mskNow > lastPairEnd) {
    return getNextDayPairs(mapByDate, todayStr);
  }

  // Иначе ищем текущие и следующие
  const currentPairs = pairsToday.filter(p => {
    const start = new Date(`${todayStr.split('.').reverse().join('-')}T${p.startTime}`);
    const end = new Date(`${todayStr.split('.').reverse().join('-')}T${p.endTime}`);
    return start <= mskNow && end > mskNow;
  });
  const upcoming = pairsToday.filter(p => {
    const start = new Date(`${todayStr.split('.').reverse().join('-')}T${p.startTime}`);
    return start > mskNow;
  });

  if (currentPairs.length > 0) {
    if (upcoming.length > 0) {
      // Текущая + следующая
      const earliestUpcoming = new Date(`${todayStr.split('.').reverse().join('-')}T${upcoming[0].startTime}`);
      const nextPairs = upcoming.filter(p => {
        const st = new Date(`${todayStr.split('.').reverse().join('-')}T${p.startTime}`);
        return st.getTime() === earliestUpcoming.getTime();
      });
      return {
        date: todayStr,
        currentPairs,
        nextPairs,
        showBoth: true,
        allPairsForToday: pairsToday
      };
    } else {
      // Только текущая пара, без следующей
      return {
        date: todayStr,
        currentPairs,
        showCurrentOnly: true,
        allPairsForToday: pairsToday
      };
    }
  } else {
    // Нет текущей, но есть будущие
    if (upcoming.length > 0) {
      const earliestUpcoming = new Date(`${todayStr.split('.').reverse().join('-')}T${upcoming[0].startTime}`);
      const nextPairs = upcoming.filter(p => {
        const st = new Date(`${todayStr.split('.').reverse().join('-')}T${p.startTime}`);
        return st.getTime() === earliestUpcoming.getTime();
      });
      return {
        date: todayStr,
        nextPairs,
        showNextPair: true,
        allPairsForToday: pairsToday
      };
    } else {
      return getNextDayPairs(mapByDate, todayStr);
    }
  }
}

function parseDate(dateStr) {
  const [day, month, year] = dateStr.split('.').map(Number);
  return new Date(year, month - 1, day); // JS считает месяцы с 0
}

/**
 * Ищем ближайший день в будущем (после todayStr) среди mapByDate
 */
function getNextDayPairs(mapByDate, todayStr) {
  const allDates = Object.keys(mapByDate).sort((a, b) => parseDate(a) - parseDate(b));
  const todayDate = parseDate(todayStr);

  for (const dt of allDates) {
    if (parseDate(dt) > todayDate) {
      return {
        date: dt,
        pairs: mapByDate[dt],
        showAll: true,
        allPairsForToday: mapByDate[dt]
      };
    }
  }
  return { date: '', pairs: [], showAll: true, allPairsForToday: [] };
}

/**
 * Рендер "автоматического" расписания (текущая/следующая пара или один ближайший день)
 */
function renderAutoSchedule(result) {
  const container = document.getElementById('scheduleContainer');
  const dateContainer = document.getElementById('dateContainer');
  container.innerHTML = '';
  document.body.classList.remove('current-pair', 'next-pair');

  if (result.date === '') {
    // Вообще нет пар
    dateContainer.textContent = 'Нет пар';
    return;
  }

  if (result.showAll) {
    // Пары на один день (либо если сегодня ещё не началось — showAll=false)
    dateContainer.textContent = `Пары на ${result.date}`;
    result.pairs.forEach(pair => container.appendChild(createPairCard(pair)));

  } else if (result.showBoth) {
    // Текущая + следующая
    const currentHeader = document.createElement('div');
    currentHeader.textContent = "Текущая пара:";
    currentHeader.classList.add("schedule-heading");
    container.appendChild(currentHeader);

    result.currentPairs.forEach(pair => container.appendChild(createPairCard(pair)));

    const nextHeader = document.createElement('div');
    nextHeader.textContent = "Следующая пара:";
    nextHeader.classList.add("schedule-heading");
    container.appendChild(nextHeader);

    result.nextPairs.forEach(pair => container.appendChild(createPairCard(pair)));

  } else if (result.showCurrentOnly) {
    // Только текущая
    dateContainer.textContent = "Текущая пара:";
    document.body.classList.add('current-pair');
    result.currentPairs.forEach(pair => container.appendChild(createPairCard(pair)));

  } else if (result.showNextPair) {
    // Только следующая
    dateContainer.textContent = "Следующая пара:";
    document.body.classList.add('next-pair');
    result.nextPairs.forEach(pair => container.appendChild(createPairCard(pair)));

  } else {
    // fallback — все пары на день
    dateContainer.textContent = `Пары на ${result.date}`;
    result.pairs.forEach(pair => container.appendChild(createPairCard(pair)));
  }

  // Проверяем, нужно ли показывать кнопку-переключатель (только если сегодня или если пар не все)
  let toggleNeeded = (result.date !== getTodayStr());
  if (result.date === getTodayStr()) {
    // Если сегодня, проверяем, не все ли пары показаны
    const renderedCount = (result.showBoth)
      ? (result.currentPairs.length + result.nextPairs.length)
      : (result.showCurrentOnly
         ? result.currentPairs.length
         : (result.showNextPair ? result.nextPairs.length : result.pairs.length));

    if (result.allPairsForToday && (result.allPairsForToday.length > renderedCount)) {
      toggleNeeded = true;
    }
  }

  if (toggleNeeded) {
    const toggleBtn = document.createElement('button');
    if (result.date === getTodayStr()) {
      // Сегодня
      if (currentPartialView) {
        toggleBtn.textContent = "Показать все пары на сегодня";
      } else {
        toggleBtn.textContent = "Показать короткое расписание";
      }
    } else {
      // Не сегодня (ближайший день может быть и на следующей неделе)
      if (currentPartialView) {
        toggleBtn.textContent = "Показать расписание на неделю";
      } else {
        toggleBtn.textContent = "Вернуться к краткому виду";
      }
    }

    toggleBtn.style.margin = "20px auto";
    toggleBtn.style.display = "block";

    toggleBtn.addEventListener('click', () => {
      toggleView(toggleBtn);
    });
    container.appendChild(toggleBtn);
  }
}

/**
 * Переключение между "кратким" и "полным" режимом (только если week=0)
 */
function toggleView(button) {
  const todayStr = getTodayStr();

  if (!currentAutoSchedule) return;
  if (localStorage.getItem('week') !== '0') {
    // На всякий случай проверяем — если неделя не 0, не даём переключать
    return;
  }

  if (currentPartialView) {
    // Переход к "полной" версии
    if (currentAutoSchedule.date === todayStr) {
      // Все пары на сегодня
      renderAllPairsForDate(todayStr, currentAutoSchedule.allPairsForToday);
    } else {
      // Расписание на всю (текущую) неделю
      renderFullWeek(fullWeekSchedule);
    }
    currentPartialView = false;

  } else {
    // Возврат к "короткому" виду
    renderAutoSchedule(currentAutoSchedule);
    currentPartialView = true;
  }
  updateHeaderButtonText();
}

/**
 * Кнопка в шапке: аналогично переключаемся
 */
function toggleHeaderView() {
  if (!currentAutoSchedule) return;
  if (localStorage.getItem('week') !== '0') {
    return; // Если выбрана не текущая неделя, кнопка скрыта и клик не должен ничего делать
  }

  const todayStr = getTodayStr();
  if (currentPartialView) {
    // Переход к полному
    if (currentAutoSchedule.date === todayStr) {
      renderAllPairsForDate(todayStr, currentAutoSchedule.allPairsForToday);
    } else {
      renderFullWeek(fullWeekSchedule);
    }
    currentPartialView = false;
  } else {
    // Возврат к краткому
    renderAutoSchedule(currentAutoSchedule);
    currentPartialView = true;
  }
  updateHeaderButtonText();
}

/**
 * Обновляем текст кнопки в шапке в зависимости от текущего состояния
 */
function updateHeaderButtonText() {
  const btn = document.getElementById('toggleScheduleBtn');
  // Если неделя != 0, кнопка скрыта
  if (localStorage.getItem('week') !== '0') {
    btn.style.display = 'none';
    return;
  }

  if (!currentAutoSchedule) {
    btn.textContent = "Показать расписание на неделю";
    return;
  }

  const todayStr = getTodayStr();
  if (currentAutoSchedule.date === todayStr) {
    if (currentPartialView) {
      btn.textContent = "Показать все пары на сегодня";
    } else {
      btn.textContent = "Показать короткое расписание";
    }
  } else {
    if (currentPartialView) {
      btn.textContent = "Показать расписание на неделю";
    } else {
      btn.textContent = "Вернуться к краткому виду";
    }
  }
}

/**
 * Рендер всех пар на выбранный день (полный режим для сегодня)
 */
function renderAllPairsForDate(date, pairs) {
  const container = document.getElementById('scheduleContainer');
  const dateContainer = document.getElementById('dateContainer');
  container.innerHTML = '';
  dateContainer.textContent = `Все пары на ${date}`;
  document.body.classList.remove('current-pair', 'next-pair');

  pairs.forEach(pair => container.appendChild(createPairCard(pair)));

  const toggleBtn = document.createElement('button');
  toggleBtn.textContent = "Показать короткое расписание";
  toggleBtn.style.margin = "20px auto";
  toggleBtn.style.display = "block";

  toggleBtn.addEventListener('click', () => {
    renderAutoSchedule(currentAutoSchedule);
    currentPartialView = true;
    updateHeaderButtonText();
  });
  container.appendChild(toggleBtn);
}

/**
 * Рендер полного расписания недели (для week!=0 или при переключении)
 */
function renderFullWeek(schedule) {
  const container = document.getElementById('scheduleContainer');
  const dateContainer = document.getElementById('dateContainer');
  container.innerHTML = '';
  document.body.classList.remove('current-pair', 'next-pair');

  if (!schedule || schedule.length === 0) {
    container.innerHTML = '<div class="card">Нет пар на эту неделю</div>';
    dateContainer.textContent = '';
    return;
  }

  const map = groupByDate(schedule);
  const sortedDates = Object.keys(map).sort(compareDates);

  dateContainer.textContent = 'Расписание на выбранную неделю';

  sortedDates.forEach(dateStr => {
    const dayHeader = document.createElement('h3');
    dayHeader.textContent = dateStr;
    container.appendChild(dayHeader);

    map[dateStr].forEach(pair => {
      const card = createPairCard(pair);
      container.appendChild(card);
    });
  });

  // Если всё же у нас week=0 (хотя обычно не должно быть) — добавим кнопку возврата
  if (localStorage.getItem('week') === '0') {
    const toggleBtn = document.createElement('button');
    toggleBtn.textContent = "Вернуться к краткому виду";
    toggleBtn.style.margin = "20px auto";
    toggleBtn.style.display = "block";

    toggleBtn.addEventListener('click', () => {
      renderAutoSchedule(currentAutoSchedule);
      currentPartialView = true;
      updateHeaderButtonText();
    });
    container.appendChild(toggleBtn);
  }
}

/**
 * Создаём карточку пары с учётом градиента и порядкового номера
 */
function createPairCard(pair) {
  const card = document.createElement('div');
  card.className = 'card';

  if (pair.groupType === "Внеучебное мероприятие") {
    card.classList.add("non-academic");
  }

  card.style.backgroundImage = getGradient(pair.color);

  const order = getPairOrder(pair);
  let orderHTML = '';
  if (order !== null) {
    orderHTML = `<span class="order">${order}</span>`;
  }

  const teachers = pair.teachers
    ? Object.values(pair.teachers).map(t => t.fio).join(', ')
    : 'Преподаватель не указан';

  card.innerHTML = `
    <div class="card-header">
      ${orderHTML}<span class="time">${pair.startTime} - ${pair.endTime}</span>
    </div>
    <div class="discipline">${pair.discipline}</div>
    <div class="details">
      <div>
        <div class="badge">${pair.groupType}</div>
        <div class="teacher">${teachers}</div>
      </div>
      <div>${pair.classroom || ''}</div>
    </div>
  `;
  return card;
}

/**
 * Фон-градиент (более тёмный) в зависимости от pair.color
 */
function getGradient(color) {
  if (color === 'sky') {
    return "linear-gradient(135deg, #6d8ecc, #4d6ecf)";
  } else if (color === 'teal') {
    return "linear-gradient(135deg, #5ead97, #4b9d7b)";
  } else if (color === 'none') {
    return "#444";
  }
  return "#444";
}

/**
 * Определяем порядковый номер пары по фиксированным слотам
 */
function getPairOrder(pair) {
  const slots = [
    { order: 1, start: "09:00", end: "10:30" },
    { order: 2, start: "10:45", end: "12:15" },
    { order: 3, start: "13:15", end: "14:45" },
    { order: 4, start: "15:00", end: "16:30" },
    { order: 5, start: "16:45", end: "18:15" },
    { order: 6, start: "18:30", end: "20:00" }
  ];

  const pairStart = timeToMinutes(pair.startTime);
  const pairEnd = timeToMinutes(pair.endTime);

  for (const slot of slots) {
    const slotStart = timeToMinutes(slot.start);
    const slotEnd = timeToMinutes(slot.end);
    if (pairStart >= slotStart && pairEnd <= slotEnd) {
      return slot.order;
    }
  }
  return null;
}

/** Преобразуем строку "HH:MM" в минуты */
function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

/** Получаем текущее время по МСК */
function getMskNow() {
  const now = new Date();
  return new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
}

/** Форматируем дату Date в dd.mm.yyyy */
function formatDate(dateObj) {
  const d = dateObj.getDate().toString().padStart(2, '0');
  const m = (dateObj.getMonth() + 1).toString().padStart(2, '0');
  const y = dateObj.getFullYear();
  return `${d}.${m}.${y}`;
}

/** Возвращаем "dd.mm.yyyy" для текущего дня по МСК */
function getTodayStr() {
  return formatDate(getMskNow());
}
