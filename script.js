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
        // Запрос к серверу за расписанием
        // Либо https://109.172.94.255 либо localhost. Надо проверить
        const response = await fetch(`http://82.117.87.58:3000/api/schedule?group=${group}`);
        if (!response.ok) throw new Error('Ошибка сети');
        
        const schedule = await response.json();
        renderSchedule(processSchedule(schedule));
    } catch (error) {
        console.error('Ошибка:', error);
        document.getElementById('scheduleContainer').innerHTML = `
            <div class="card error">
                Не удалось загрузить расписание: ${error.message}
            </div>
        `;
    }
}

function processSchedule(schedule) {
    const now = new Date();
    const mskNow = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
    
    // Преобразование дат и фильтрация прошедших пар
    const validPairs = schedule
        .map(pair => ({
            ...pair,
            dateTime: new Date(pair.date.split('.').reverse().join('-') + 'T' + pair.startTime)
        }))
        .filter(pair => pair.dateTime >= mskNow)
        .sort((a, b) => a.dateTime - b.dateTime);

    // Группировка по дням
    const days = {};
    validPairs.forEach(pair => {
        const dateKey = pair.date;
        if (!days[dateKey]) days[dateKey] = [];
        days[dateKey].push(pair);
    });

    // Находим ближайший день с парами
    const nearestDay = Object.keys(days).find(date => {
        const [d, m, y] = date.split('.');
        return new Date(`${y}-${m}-${d}T00:00:00+03:00`) >= mskNow;
    });
    
    return days[nearestDay] || [];
}

function renderSchedule(pairs) {
    const container = document.getElementById('scheduleContainer');
    container.innerHTML = '';

    if (pairs.length === 0) {
        container.innerHTML = '<div class="card">Нет пар</div>';
        return;
    }

    pairs.forEach(pair => {
        const card = document.createElement('div');
        card.className = 'card';
        card.style.backgroundColor = getColor(pair.color);
        
        // Получаем список преподавателей
        const teachers = pair.teachers 
            ? Object.values(pair.teachers).map(t => t.fio).join(', ') 
            : 'Преподаватель не указан';

            card.innerHTML = `
            <div class="card-header">
                <span class="day">${pair.dayWeek}</span>
                <span class="time">${pair.startTime} - ${pair.endTime}</span>
            </div>
            <div class="discipline">${pair.discipline}</div>
            <div class="details">
                <div>
                    <div class="badge">${pair.groupType}</div>
                    <div class="teacher">${teachers}</div>
                </div>
                <div>
                    <div>${pair.classroom}</div>
                </div>
            </div>
        `;
                
        container.appendChild(card);
    });
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