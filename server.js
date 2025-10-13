const express = require('express');
const sirinium = require('sirinium');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const utils = require('./utils');
const calendar = require('./calendar');
const Teacher = require('./teacher');
const { setGlobalDispatcher, ProxyAgent, Agent } = require('undici');

// Глобальная настройка undici: форсируем IPv4 и поддерживаем HTTP(S)_PROXY
try {
    const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.http_proxy || process.env.https_proxy;
    if (proxyUrl) {
        setGlobalDispatcher(new ProxyAgent(proxyUrl));
    } else {
        setGlobalDispatcher(new Agent({ keepAliveTimeout: 10_000, keepAliveMaxTimeout: 10_000, connect: { family: 4, hints: 0 } }));
    }
} catch (_) {}

const app = express();
app.use(cors());
app.use(express.static(__dirname));

// Путь к файлу кэша
const CACHE_FILE = path.join(__dirname, 'schedule_cache.json');
const TEACHERS_CACHE_FILE = path.join(__dirname, 'teachers_cache.json');
// Интервал обновления кэша (200 секунд)
const CACHE_UPDATE_INTERVAL = 200 * 1000;
// Дополнительная задержка при неудачном обновлении (5 минут)
const FAILURE_BACKOFF_MS = parseInt(process.env.CACHE_FAILURE_BACKOFF_MS || '300000', 10);
// Директория для файлового кэша по группам
const GROUP_CACHE_DIR = path.join(__dirname, 'groups_cache');


// Объект для хранения кэша в памяти
let scheduleCache = {};

// Время последнего обновления кэша
let lastCacheUpdate = 0;

// Безопасное имя файла на основе идентификатора группы
function sanitizeFileName(name) {
    return String(name).replace(/[^a-zA-Z0-9\u0400-\u04FF._-]/g, '_');
}

// Функция для получения расписания из API
async function fetchScheduleFromAPI(group, week) {
    const client = new sirinium.Client();
    await client.getInitialData();
    await client.changeWeek(Number(week));
    return await client.getGroupSchedule(group);
}


let GROUPS = [];
let TEACHERS = [];

// Загружаем группы и преподавателей из файлов
async function loadGroupsAndTeachers() {
    try {
        const groupsData = await fs.readFile(path.join(__dirname, 'static', 'groups.json'), 'utf8');
        GROUPS = JSON.parse(groupsData);
    } catch (e) {
        console.error('Не удалось загрузить группы:', e);
        GROUPS = [];
    }
    try {
        const teachersData = await fs.readFile(path.join(__dirname, 'static', 'teachers.json'), 'utf8');
        TEACHERS = JSON.parse(teachersData);
    } catch (e) {
        console.error('Не удалось загрузить преподавателей:', e);
        TEACHERS = [];
    }
}

// Функция для обновления кэша
async function updateCache() {
    try {
        console.log('Обновление кэша расписания...');
        const newCache = {};

        // Инициализируем один клиент и переиспользуем его для всех групп
        let client;
        try {
            client = new sirinium.Client();
            await client.getInitialData();
            await client.changeWeek(0);
        } catch (e) {
            console.error('Не удалось инициализировать клиент для групп:', e);
            return false; // провал обновления
        }

        const delayMs = parseInt(process.env.BATCH_DELAY_MS || '120000', 10);
        let failed = false;
        for (const group of GROUPS) {
            try {
                newCache[group] = await client.getGroupSchedule(group);
            } catch (error) {
                const cause = error && error.cause ? error.cause : {};
                console.error(`Ошибка при получении расписания для группы ${group}:`, {
                    name: error?.name,
                    message: error?.message,
                    code: cause?.code,
                    errno: cause?.errno,
                    syscall: cause?.syscall,
                    host: cause?.host,
                    address: cause?.address,
                    port: cause?.port
                });
                // При ошибке прерываем цикл и возвращаемся к существующему кэшу
                failed = true;
                break;
            }
            if (delayMs > 0) {
                await new Promise(r => setTimeout(r, delayMs));
            }
        }

        if (failed) {
            console.warn('Обновление кэша прервано. Существующий кэш сохранён без изменений.');
            return false; // провал обновления
        }

        // Убеждаемся, что директория для файлового кэша существует
        try { await fs.mkdir(GROUP_CACHE_DIR, { recursive: true }); } catch (_) {}

        // Записываем файловый кэш по группам
        for (const [group, data] of Object.entries(newCache)) {
            const filePath = path.join(GROUP_CACHE_DIR, `${sanitizeFileName(group)}.json`);
            try {
                await fs.writeFile(filePath, JSON.stringify(data, null, 2));
            } catch (e) {
                console.error('Не удалось записать файл кэша для группы', group, e?.message);
            }
        }

        // Сохраняем общий кэш в файл и в память (только если цикл завершился успешно)
        await fs.writeFile(CACHE_FILE, JSON.stringify(newCache, null, 2));
        scheduleCache = newCache;
        lastCacheUpdate = Date.now();
        console.log('Кэш успешно обновлен');
        return true; // успех
    } catch (error) {
        console.error('Ошибка при обновлении кэша:', error);
        return false;
    }
}

// Функция для получения расписания учителя из API
async function fetchTeacherScheduleFromAPI(teacher, week) {
    const client = new Teacher();
    await client.getInitialData();
    await client.changeWeek(Number(week));
    return await client.getSchedule(teacher);
}

// Функция для обновления кэша учителей
let teachersCache = {};
async function updateTeachersCache() {
    try {
        console.log('Обновление кэша преподавателей...');
        const newCache = {};
        const teacherIds = TEACHERS && typeof TEACHERS === 'object' && !Array.isArray(TEACHERS) ? Object.keys(TEACHERS) : TEACHERS;

        // Один клиент для всех преподавателей
        let client;
        try {
            client = new Teacher();
            await client.getInitialData();
            await client.changeWeek(0);
        } catch (e) {
            console.error('Не удалось инициализировать клиент для преподавателей:', e);
            return false; // провал обновления
        }

        const delayMs = parseInt(process.env.BATCH_DELAY_MS || '120000', 10);
        let failed = false;
        for (const teacherId of teacherIds) {
            try {
                newCache[teacherId] = await client.getSchedule(teacherId);
            } catch (error) {
                const cause = error && error.cause ? error.cause : {};
                console.error(`Ошибка при получении расписания для преподавателя ${teacherId}:`, {
                    name: error?.name,
                    message: error?.message,
                    code: cause?.code,
                    errno: cause?.errno,
                    syscall: cause?.syscall,
                    host: cause?.host,
                    address: cause?.address,
                    port: cause?.port
                });
                failed = true;
                break;
            }
            if (delayMs > 0) {
                await new Promise(r => setTimeout(r, delayMs));
            }
        }
        if (failed) {
            console.warn('Обновление кэша преподавателей прервано. Существующий кэш сохранён без изменений.');
            return false; // провал обновления
        }

        // Сохраняем кэш в файл
        await fs.writeFile(TEACHERS_CACHE_FILE, JSON.stringify(newCache, null, 2));
        teachersCache = newCache;
        lastCacheUpdate = Date.now();
        console.log('Кэш преподавателей успешно обновлен');
        return true; // успех
    } catch (error) {
        console.error('Ошибка при обновлении кэша преподавателей:', error);
        return false;
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

// Загружаем кэш учителей при запуске сервера
async function loadTeachersCache() {
    try {
        const data = await fs.readFile(TEACHERS_CACHE_FILE, 'utf8');
        teachersCache = JSON.parse(data);
        lastCacheUpdate = Date.now();
        console.log('Кэш преподавателей загружен из файла');
    } catch (error) {
        console.log('Кэш преподавателей не найден, создаем новый...');
        await updateTeachersCache();
    }
}


// Планировщик с бэкоффом: после провала увеличиваем задержку на 5 минут
async function scheduleGroupUpdate() {
    const ok = await updateCache();
    const delay = ok ? CACHE_UPDATE_INTERVAL : (CACHE_UPDATE_INTERVAL + FAILURE_BACKOFF_MS);
    setTimeout(scheduleGroupUpdate, delay);
}

async function scheduleTeacherUpdate() {
    const ok = await updateTeachersCache();
    const delay = ok ? CACHE_UPDATE_INTERVAL : (CACHE_UPDATE_INTERVAL + FAILURE_BACKOFF_MS);
    setTimeout(scheduleTeacherUpdate, delay);
}

app.get('/api/schedule', async (req, res) => {
    try {
        const { group, week = 0 } = req.query;

        // Если запрашивается текущая неделя (week=0), предпочтительно читаем из файлового кэша
        if (week === '0') {
            try {
                const filePath = path.join(GROUP_CACHE_DIR, `${sanitizeFileName(group)}.json`);
                const content = await fs.readFile(filePath, 'utf8');
                return res.json(JSON.parse(content));
            } catch (_) {
                // файла нет или не читается — fallback ниже
            }
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
                // Пишем также файловый кэш для группы на будущее
                try {
                    await fs.mkdir(GROUP_CACHE_DIR, { recursive: true });
                    const filePath = path.join(GROUP_CACHE_DIR, `${sanitizeFileName(group)}.json`);
                    await fs.writeFile(filePath, JSON.stringify(schedule, null, 2));
                } catch (e) {
                    console.error('Не удалось записать файл кэша группы после прямого запроса:', e?.message);
                }
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
        res.sendFile(path.join(__dirname, 'static', 'groups.json'));
    } catch (error) {
        res.status(500).json({ error: 'Не удалось получить список групп' });
    }
});

// эндпоинт для получения преподавателей
app.get('/api/teachers', (req, res) => {
    try {
        res.sendFile(path.join(__dirname, 'static', 'teachers.json'));
    } catch (error) {
        res.status(500).json({ error: 'Не удалось получить список преподавателей' });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});


// эндоинт для расписания учителей
app.get('/api/teacherschedule', async (req, res) => {
    try {
        const { id, week = 0 } = req.query;

        // Если запрашивается текущая неделя (week=0), используем кэш
        if (week === '0') {
            // Если кэш пустой или устарел, обновляем его
            if (Object.keys(teachersCache).length === 0 || Date.now() - lastCacheUpdate > CACHE_UPDATE_INTERVAL) {
                await updateTeachersCache();
            }

            // Проверяем наличие данных для запрошенного учителя
            if (teachersCache[id]) {
                return res.json(teachersCache[id]);
            } else {
                // Если данных нет в кэше, получаем их из API
                const schedule = await fetchTeacherScheduleFromAPI(id, 0);
                teachersCache[id] = schedule;
                await fs.writeFile(TEACHERS_CACHE_FILE, JSON.stringify(teachersCache, null, 2));
                return res.json(schedule);
            }
        } else {
            // Для других недель получаем данные напрямую из API
            const schedule = await fetchTeacherScheduleFromAPI(id, week);
            res.json(schedule);
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Эндпоинт для получения календаря группы в формате iCalendar (текущая + следующая недели)
app.get('/calendar/group', async (req, res) => {
    try {
        let { group } = req.query;
        
        if (!group) {
            return res.status(400).json({ error: 'Параметр group обязателен' });
        }

        // Декодируем группу на случай если она закодирована в URL
        group = decodeURIComponent(group);

        const icsCalendar = await calendar.getGroupCalendar(group);

        res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="schedule-${encodeURIComponent(group)}.ics"`);
        res.send(icsCalendar);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// Эндпоинт для получения календаря преподавателя в формате iCalendar (текущая + следующая недели)
app.get('/calendar/teacher', async (req, res) => {
    try {
        let { id } = req.query;
        
        if (!id) {
            return res.status(400).json({ error: 'Параметр id обязателен' });
        }

        // Декодируем id на случай если он закодирован в URL
        id = decodeURIComponent(id);

        const icsCalendar = await calendar.getTeacherCalendar(id);

        res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="schedule-teacher-${encodeURIComponent(id)}.ics"`);
        res.send(icsCalendar);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});



// Загружаем группы, преподавателей и кэш при запуске сервера
loadGroupsAndTeachers().then(() => {
    loadCache().then(() => {
        loadTeachersCache().then(() => {
            app.listen(3000, '0.0.0.0', () => console.log('Server started on port 3000'));
            // Запускаем планировщики
            scheduleGroupUpdate();
            scheduleTeacherUpdate();
        });
    });
});