document.addEventListener('DOMContentLoaded', () => {
    const group = getCookie('group');
    const week = getCookie('week') || 0;
  
    // Если в куках уже есть группа, сразу показываем расписание
    if (group) {
      // Прячем "главную страницу" с выбором
      document.getElementById('mainPage').style.display = 'none';
      document.getElementById('scheduleView').style.display = 'block';
  
      // Отображаем название группы в левом верхнем углу
      document.getElementById('groupNameLink').textContent = group;
  
      // Загружаем расписание
      loadSchedule(group, week);
    } else {
      // Иначе показываем блок выбора группы/недели
      document.getElementById('mainPage').style.display = 'block';
      document.getElementById('scheduleView').style.display = 'none';
    }
  
    // Кнопка "Показать" – сохраняет выбор и загружает расписание
    document.getElementById('showScheduleBtn').addEventListener('click', () => {
      const selectedGroup = document.getElementById('groupSelect').value;
      const selectedWeek = document.getElementById('weekSelect').value;
  
      if (!selectedGroup) return; // если не выбрана группа, ничего не делаем
  
      // Сохраняем в куки
      setCookie('group', selectedGroup, 30);
      setCookie('week', selectedWeek, 30);
  
      // Прячем форму выбора, показываем расписание
      document.getElementById('mainPage').style.display = 'none';
      document.getElementById('scheduleView').style.display = 'block';
      document.getElementById('groupNameLink').textContent = selectedGroup;
  
      // Загружаем расписание
      loadSchedule(selectedGroup, selectedWeek);
    });
  
    // При клике на название группы (в левом верхнем углу) возвращаемся на "главную"
    document.getElementById('groupNameLink').addEventListener('click', (e) => {
      e.preventDefault();
      // Показываем снова блок выбора
      document.getElementById('mainPage').style.display = 'block';
      document.getElementById('scheduleView').style.display = 'none';
    });
  });
  
  /**
   * Функция загрузки расписания с API
   * Если week = 0, используется "автоматическая" логика (следующая пара и т.д.)
   * Иначе выводится полная неделя
   */
  async function loadSchedule(group, week = 0) {
    try {
      const response = await fetch(`https://api.eralas.ru/api/schedule?group=${group}&week=${week}`);
      if (!response.ok) throw new Error('Ошибка сети');
  
      const schedule = await response.json();
  
      if (week == 0) {
        // "Автоматическая" логика
        const result = processSchedule(schedule);
        renderAutoSchedule(result);
      } else {
        // Выводим полное расписание за выбранную неделю
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
   * Автоматическая логика:
   * - Если на сегодня ещё не начались пары, показываем все пары на сегодня.
   * - Если текущее время между парами, показываем следующую пару (если одновременно стартует несколько – все).
   * - Если пары на сегодня закончились, переходим к следующему дню, показываем все пары того дня.
   */
  function processSchedule(schedule) {
    const now = new Date();
    // Для боевого режима: 'Europe/Moscow'. Для теста/отладки можно менять.
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
      mapByDate[pair.date].push({
        ...pair,
        startDate: start,
        endDate: end
      });
    });
  
    // Сортируем пары каждого дня по времени начала
    Object.keys(mapByDate).forEach(date => {
      mapByDate[date].sort((a, b) => a.startDate - b.startDate);
    });
  
    // Текущая дата в формате dd.mm.yyyy
    const day = mskNow.getDate().toString().padStart(2, '0');
    const month = (mskNow.getMonth() + 1).toString().padStart(2, '0');
    const year = mskNow.getFullYear();
    const todayStr = `${day}.${month}.${year}`;
  
    // Функция для поиска следующего дня, у которого есть пары
    function getNextDayPairs() {
      const allDates = Object.keys(mapByDate).sort((a, b) => {
        const [da, ma, ya] = a.split('.');
        const [db, mb, yb] = b.split('.');
        return new Date(`${ya}-${ma}-${da}`) - new Date(`${yb}-${mb}-${db}`);
      });
  
      for (const dt of allDates) {
        if (dt > todayStr) {
          return { 
            date: dt, 
            pairs: mapByDate[dt], 
            showNextPair: false, 
            allPairsForToday: mapByDate[dt] 
          };
        }
      }
      // Если нет будущих дат, вернём пустое
      return { date: '', pairs: [], showNextPair: false, allPairsForToday: [] };
    }
  
    // Если на сегодня нет пар, сразу смотрим следующий день
    if (!mapByDate[todayStr]) {
      return getNextDayPairs();
    }
  
    const pairsToday = mapByDate[todayStr];
    const firstPairStart = pairsToday[0].startDate;
    const lastPairEnd = pairsToday[pairsToday.length - 1].endDate;
  
    // Если текущее время до первой пары, показываем все пары сегодня
    if (mskNow < firstPairStart) {
      return { 
        date: todayStr, 
        pairs: pairsToday, 
        showNextPair: false, 
        allPairsForToday: pairsToday 
      };
    }
  
    // Если уже после последней пары, переходим к следующему дню
    if (mskNow > lastPairEnd) {
      return getNextDayPairs();
    }
  
    // Иначе смотрим, какие пары ещё не начались (следующие)
    const upcoming = pairsToday.filter(p => p.startDate > mskNow);
    if (upcoming.length > 0) {
      // Следующая пара (или несколько, если совпадают по времени)
      const earliestStart = upcoming[0].startDate;
      const sameTimePairs = upcoming.filter(p => p.startDate.getTime() === earliestStart.getTime());
      return { 
        date: todayStr, 
        pairs: sameTimePairs, 
        showNextPair: true, 
        allPairsForToday: pairsToday 
      };
    } else {
      // На всякий случай, если нет "upcoming", смотрим следующий день
      return getNextDayPairs();
    }
  }
  
  /**
   * Рендер "автоматического" расписания
   * - Либо "Следующая пара" (и, при необходимости, кнопка "Показать остальные пары")
   * - Либо все пары на день
   */
  function renderAutoSchedule({ date, pairs, showNextPair, allPairsForToday }) {
    const container = document.getElementById('scheduleContainer');
    const dateContainer = document.getElementById('dateContainer');
    container.innerHTML = '';
  
    if (pairs.length === 0) {
      container.innerHTML = '<div class="card">Нет пар</div>';
      if (dateContainer) {
        dateContainer.textContent = '';
      }
      return;
    }
  
    if (showNextPair) {
      // Показ следующей пары (или нескольких, если стартуют в одно время)
      if (dateContainer) {
        dateContainer.textContent = "Следующая пара:";
      }
      document.body.className = 'next-pair';
  
      pairs.forEach(nextPair => {
        const card = createPairCard(nextPair);
        container.appendChild(card);
      });
  
      // Если ровно одна пара, показываем кнопку "Показать остальные пары на сегодня"
      if (pairs.length === 1) {
        const showAllBtn = document.createElement('button');
        showAllBtn.textContent = "Показать остальные пары на сегодня";
        showAllBtn.addEventListener('click', () => {
          renderAllPairsForDate(date, allPairsForToday);
        });
        container.appendChild(showAllBtn);
      }
  
    } else {
      // Показ всех пар на день
      if (dateContainer) {
        dateContainer.textContent = `Пары на ${date}`;
      }
      document.body.className = '';
  
      pairs.forEach(pair => {
        const card = createPairCard(pair);
        container.appendChild(card);
      });
    }
  }
  
  /**
   * При нажатии на кнопку "Показать остальные пары" выводим все пары на текущий день
   */
  function renderAllPairsForDate(date, pairs) {
    const container = document.getElementById('scheduleContainer');
    const dateContainer = document.getElementById('dateContainer');
    container.innerHTML = '';
  
    if (dateContainer) {
      dateContainer.textContent = `Все пары на ${date}`;
    }
    document.body.className = '';
  
    pairs.forEach(pair => {
      const card = createPairCard(pair);
      container.appendChild(card);
    });
  }
  
  /**
   * Рендер полной недели (если week != 0)
   */
  function renderFullWeek(schedule) {
    const container = document.getElementById('scheduleContainer');
    const dateContainer = document.getElementById('dateContainer');
    container.innerHTML = '';
    document.body.className = '';
  
    if (schedule.length === 0) {
      container.innerHTML = '<div class="card">Нет пар на эту неделю</div>';
      if (dateContainer) {
        dateContainer.textContent = '';
      }
      return;
    }
  
    // Группируем пары по датам
    const mapByDate = {};
    schedule.forEach(pair => {
      if (!mapByDate[pair.date]) {
        mapByDate[pair.date] = [];
      }
      mapByDate[pair.date].push(pair);
    });
  
    // Сортируем даты
    const sortedDates = Object.keys(mapByDate).sort((a, b) => {
      const [da, ma, ya] = a.split('.');
      const [db, mb, yb] = b.split('.');
      return new Date(`${ya}-${ma}-${da}`) - new Date(`${yb}-${mb}-${db}`);
    });
  
    // Заголовок
    dateContainer.textContent = 'Расписание на выбранную неделю';
  
    // Выводим каждый день недели
    sortedDates.forEach(dateStr => {
      const dayPairs = mapByDate[dateStr];
  
      // Сортируем пары внутри дня по времени
      dayPairs.sort((a, b) => {
        const [aH, aM] = a.startTime.split(':');
        const [bH, bM] = b.startTime.split(':');
        return (parseInt(aH) * 60 + parseInt(aM)) - (parseInt(bH) * 60 + parseInt(bM));
      });
  
      // Заголовок дня
      const dayHeader = document.createElement('h3');
      dayHeader.textContent = dateStr;
      container.appendChild(dayHeader);
  
      // Карточки пар
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
   * Подбирает цвет фона карточки в зависимости от значения pair.color
   */
  function getColor(color) {
    return {
      'sky':  '#e0f2fe',
      'teal': '#ecfdf5',
      'none': '#fff'
    }[color] || '#fff';
  }
  
  /**
   * Установка cookie
   */
  function setCookie(name, value, days) {
    const date = new Date();
    date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
    document.cookie = `${name}=${value};expires=${date.toUTCString()};path=/`;
  }
  
  /**
   * Получение cookie
   */
  function getCookie(name) {
    const match = document.cookie
      .split('; ')
      .find(row => row.startsWith(name + '='));
    return match ? match.split('=')[1] : null;
  }
    