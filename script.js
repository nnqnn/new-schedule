document.addEventListener('DOMContentLoaded', async () => {
    const group = getCookie('group');
    const dialog = document.getElementById('groupDialog');

    if (!group) {
        dialog.showModal();
        dialog.querySelector('form').addEventListener('submit', () => {
            const groupInput = document.getElementById('groupInput').value;
            setCookie('group', groupInput, 30);
            loadSchedule(groupInput);
        });
    } else {
        loadSchedule(group);
    }
});

async function loadSchedule(group) {
    try {
        const response = await fetch(`https://api.eralas.ru/api/schedule?group=${group}`);
        if (!response.ok) throw new Error('Ошибка сети');

        const schedule = await response.json();
        const result = processSchedule(schedule);
        renderSchedule(result);
    } catch (error) {
        console.error('Ошибка:', error);
        document.getElementById('scheduleContainer').innerHTML = `
            <div class="card error">
                Не удалось загрузить расписание: ${error.message}
            </div>
        `;
    }
}

/**
 * Группирует пары по датам и определяет, какие показывать:
 * - Если на сегодня ещё не начались пары, показываем все пары на сегодня.
 * - Если текущее время между парами, показываем следующую пару (если несколько с одинаковым временем — все их).
 * - Если пара уже закончилась, переходим к следующему дню.
 */
function processSchedule(schedule) {
    const now = new Date();
    // Для отладки используем 'Asia/Tokyo'; для реального времени можно заменить на 'Europe/Moscow'
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

    // Формируем строку сегодняшней даты (dd.mm.yyyy)
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
                return { date: dt, pairs: mapByDate[dt], showNextPair: false };
            }
        }
        return { date: '', pairs: [], showNextPair: false };
    }

    // Если на сегодня пар нет, переходим к следующему дню
    if (!mapByDate[todayStr]) {
        return getNextDayPairs();
    }

    const pairsToday = mapByDate[todayStr];
    const firstPairStart = pairsToday[0].startDate;
    const lastPairEnd = pairsToday[pairsToday.length - 1].endDate;

    // Если текущее время до начала первой пары – показываем все пары на сегодня
    if (mskNow < firstPairStart) {
        return { date: todayStr, pairs: pairsToday, showNextPair: false };
    }

    // Если текущее время после последней пары – переходим к следующему дню
    if (mskNow > lastPairEnd) {
        return getNextDayPairs();
    }

    // Если время между парами – показываем следующую пару (если одновременно стартует несколько, то все их)
    const upcoming = pairsToday.filter(p => p.startDate > mskNow);
    if (upcoming.length > 0) {
        const earliestStart = upcoming[0].startDate;
        const sameTimePairs = upcoming.filter(p => p.startDate.getTime() === earliestStart.getTime());
        return { date: todayStr, pairs: sameTimePairs, showNextPair: true };
    } else {
        return getNextDayPairs();
    }
}

/**
 * Рендерит расписание:
 * - Если showNextPair = true, выводит заголовок «Следующая пара:» и карточки для всех пар с одинаковым временем начала.
 * - Иначе – выводит заголовок «Пары на [дата]» и все пары выбранного дня.
 */
function renderSchedule({ date, pairs, showNextPair }) {
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
        if (dateContainer) {
            dateContainer.textContent = "Следующая пара:";
        }
        document.body.className = 'next-pair';
        pairs.forEach(nextPair => {
            const card = document.createElement('div');
            card.className = 'card';
            card.style.backgroundColor = getColor(nextPair.color);

            const teachers = nextPair.teachers
                ? Object.values(nextPair.teachers).map(t => t.fio).join(', ')
                : 'Преподаватель не указан';

            card.innerHTML = `
                <div class="discipline">${nextPair.discipline}</div>
                <div class="time">${nextPair.startTime} - ${nextPair.endTime}</div>
                <div class="details">
                    <div>
                        <div class="badge">${nextPair.groupType}</div>
                        <div class="teacher">${teachers}</div>
                    </div>
                    <div>${nextPair.classroom}</div>
                </div>
            `;
            container.appendChild(card);
        });
    } else {
        if (dateContainer) {
            dateContainer.textContent = `Пары на ${date}`;
        }
        document.body.className = '';
        pairs.forEach(pair => {
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
            container.appendChild(card);
        });
    }
}

function getColor(color) {
    return {
        'sky': '#e0f2fe',
        'teal': '#ecfdf5',
        'none': '#fff'
    }[color] || '#fff';
}

function setCookie(name, value, days) {
    const date = new Date();
    date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
    document.cookie = `${name}=${value};expires=${date.toUTCString()};path=/`;
}

function getCookie(name) {
    return document.cookie
        .split('; ')
        .find(row => row.startsWith(`${name}=`))
        ?.split('=')[1];
}
