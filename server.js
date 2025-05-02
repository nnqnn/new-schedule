const express = require('express');
const sirinium = require('sirinium');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
app.use(cors());

// Путь к файлу кэша
const CACHE_FILE = path.join(__dirname, 'schedule_cache.json');
// Интервал обновления кэша (200 секунд)
const CACHE_UPDATE_INTERVAL = 200 * 1000;

// Объект для хранения кэша в памяти
let scheduleCache = {};
// Время последнего обновления кэша
let lastCacheUpdate = 0;

// Список групп (из вашего примера)
const GROUPS = [
  "К0709-23/1",
  "К0709-23/2",
  "К0709-23/3",
  "К0709-24/1",
  "К0709-24/2",
  "К0109-23",
  "К0609-23",
  "К0409-23",
  "К0711-23",
  "К0611-23",
  "К0411-23",
  "К0709-22",
  "К0609-22",
  "К0409-22",
  "К0109-22",
  "К1609-22/1",
  "К1609-22/2",
  "К0711-22",
  "К0411-22",
  "К0611-22",
  "К0111-22",
  "К0609-24",
  "К0109-24",
  "К0409-24/1",
  "К0409-24/2",
  "К1609-24/1",
  "К1609-24/2"
];

// Функция для получения расписания из API
async function fetchScheduleFromAPI(group, week) {
    const client = new sirinium.Client();
    await client.getInitialData();
    await client.changeWeek(Number(week));
    return await client.getGroupSchedule(group);
}

// Функция для обновления кэша
async function updateCache() {
    try {
        console.log('Обновление кэша расписания...');
        const newCache = {};
        for (const group of GROUPS) {
            try {
                newCache[group] = await fetchScheduleFromAPI(group, 0);
            } catch (error) {
                console.error(`Ошибка при получении расписания для группы ${group}:`, error);
            }
        }

        // Сохраняем кэш в файл
        await fs.writeFile(CACHE_FILE, JSON.stringify(newCache, null, 2));
        scheduleCache = newCache;
        lastCacheUpdate = Date.now();
        console.log('Кэш успешно обновлен');
    } catch (error) {
        console.error('Ошибка при обновлении кэша:', error);
    }
}

// Загружаем кэш при запуске сервера
async function loadCache() {
    try {
        const data = await fs.readFile(CACHE_FILE, 'utf8');
        scheduleCache = JSON.parse(data);
        lastCacheUpdate = Date.now();
        console.log('Кэш загружен из файла');
    } catch (error) {
        console.log('Кэш не найден, создаем новый...');
        await updateCache();
    }
}

// Запускаем периодическое обновление кэша
setInterval(updateCache, CACHE_UPDATE_INTERVAL);

app.get('/api/schedule', async (req, res) => {
    try {
        const { group, week = 0 } = req.query;

        // Если запрашивается текущая неделя (week=0), используем кэш
        if (week === '0') {
            // Если кэш пустой или устарел, обновляем его
            if (Object.keys(scheduleCache).length === 0 || Date.now() - lastCacheUpdate > CACHE_UPDATE_INTERVAL) {
                await updateCache();
            }

            // Проверяем наличие данных для запрошенной группы
            if (scheduleCache[group]) {
                return res.json(scheduleCache[group]);
            } else {
                // Если данных нет в кэше, получаем их из API
                const schedule = await fetchScheduleFromAPI(group, 0);
                scheduleCache[group] = schedule;
                await fs.writeFile(CACHE_FILE, JSON.stringify(scheduleCache, null, 2));
                return res.json(schedule);
            }
        } else {
            // Для других недель получаем данные напрямую из API
            const schedule = await fetchScheduleFromAPI(group, week);
            res.json(schedule);
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Эндпоинт для получения списка групп
app.get('/api/groups', (req, res) => {
    try {
        res.json(GROUPS);
    } catch (error) {
        res.status(500).json({ error: 'Не удалось получить список групп' });
    }
});

app.get('/', (req, res) => {
    res.send('Сервер работает');
});

// Загружаем кэш при запуске сервера
loadCache().then(() => {
    app.listen(3000, '0.0.0.0', () => console.log('Server started on port 3000'));
});