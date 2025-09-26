const express = require('express');
const sirinium = require('sirinium');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const utils = require('./utils');
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

// парсер переделанный для учителей

class ourparser {
    constructor(domain, mainGrid) {
        this.url = domain;
        this.mainGridUrl = mainGrid;
        try {
            this.origin = new URL(this.url).origin;
        } catch (e) {
            this.origin = "https://schedule.siriusuniversity.ru";
        }
    }

    async fetchWithRetry(url, options, timeoutMs) {
        const attempts = parseInt(process.env.FETCH_RETRY_ATTEMPTS || '3', 10);
        let currentTimeout = parseInt(timeoutMs || process.env.FETCH_TIMEOUT_MS || '45000', 10);
        const forceInsecure = String(process.env.FETCH_INSECURE_TLS || '').toLowerCase() === '1' || String(process.env.FETCH_INSECURE_TLS || '').toLowerCase() === 'true';
        for (let attempt = 1; attempt <= attempts; attempt++) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), currentTimeout);
            try {
                const { Agent } = require('undici');
                const dispatcher = (!forceInsecure && attempt === 1) ? undefined : new Agent({ keepAliveTimeout: 10_000, keepAliveMaxTimeout: 10_000, connect: { family: 4, rejectUnauthorized: false, hints: 0 } });
                const response = await fetch(url, { ...options, signal: controller.signal, dispatcher });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response;
            } catch (err) {
                if (process.env.DEBUG_FETCH) {
                    const cause = err && err.cause ? err.cause : {};
                    console.error('[server ourparser] fetch attempt failed', {
                        attempt,
                        attempts,
                        url,
                        timeoutMs: currentTimeout,
                        name: err?.name,
                        message: err?.message,
                        code: cause?.code,
                        errno: cause?.errno,
                        syscall: cause?.syscall,
                        host: cause?.host,
                        address: cause?.address,
                        port: cause?.port
                    });
                }
                if (attempt === attempts) throw err;
                await new Promise(r => setTimeout(r, 500 * attempt));
                currentTimeout = Math.floor(currentTimeout * 1.5);
            } finally {
                clearTimeout(timer);
            }
        }
    }

    getDefaultHeaders() {
        return {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
            "Accept": "*/*",
            "Accept-Language": "ru,en;q=0.9",
            "Connection": "keep-alive",
            "Referer": this.url
        };
    }

    async getInitialData() {
        const response = await this.fetchWithRetry(this.url, {
            credentials: "same-origin",
            redirect: "follow",
            headers: this.getDefaultHeaders()
        }, parseInt(process.env.FETCH_TIMEOUT_MS || '45000', 10));
        this.xsrfToken = await utils.getXsrfToken(response);
        this.sessionToken = await utils.getSessionToken(response);


        const body = await response.text();
        const initialData = await utils.parseInitialData(body);
        this.data = initialData;

        this.wireToken = await utils.getWireToken(body);

        await this.emulateResize(1920, 1080); // Redundant, but why not?

        return initialData;
    }

    async getGroupSchedule(group) {
        const data = await this.sendUpdates(
            [utils.getCallMethodUpdateObject("set", [group])]
        );

        return await utils.getArrayOfEvents(data);
    }

    async getTeacherSchedule(teacher){
        const data = await this.sendUpdates(
            [utils.getCallMethodUpdateObject("set", [teacher])]
        );

        return await utils.getArrayOfEvents(data);
    }

    async emulateResize(width, height) {
        const data = await this.sendUpdates([
            utils.getCallMethodUpdateObject("render"),
            utils.getCallMethodUpdateObject("$set", ["width", width]),
            utils.getCallMethodUpdateObject("$set", ["height", height]),
        ]);

        this.data.serverMemo.data.width = data.serverMemo.data.width;
        this.data.serverMemo.data.height = data.serverMemo.data.height;
        this.data.serverMemo.checksum = data.serverMemo.checksum;

        return true;
    }

    async changeWeek(step) {
        const method = step > 0 ? "addWeek" : "minusWeek";
        for (let i = 0; i < Math.abs(step); i++) {
            const data = await this.sendUpdates([utils.getCallMethodUpdateObject(method)]);

            Object.assign(this.data.serverMemo.data, data.serverMemo.data);

            this.data.serverMemo.checksum = data.serverMemo.checksum;
            this.data.serverMemo.htmlHash = data.serverMemo.htmlHash;
        }

        return true;
    }

    async sendUpdates(updates) {
        const data = await this.fetchWithRetry(this.mainGridUrl, {
            method: "POST",
            credentials: "same-origin",
            headers: { ...this.getDefaultHeaders(), ...this.getHeaders(), Referer: this.url, Origin: this.origin },
            body: JSON.stringify({
                ...this.getInitialBody(),
                updates: updates
            })
        }, parseInt(process.env.FETCH_TIMEOUT_MS || '45000', 10));

        return await data.json();
    }

    getInitialBody() {
        return {
            fingerprint: this.data["fingerprint"],
            serverMemo: this.data["serverMemo"]
        };
    }

    getHeaders() {
        return {
            "Cookie": `XSRF-TOKEN=${this.xsrfToken};raspisanie_universitet_sirius_session=${this.sessionToken}`,

            "X-Livewire": "true",
            "X-Csrf-Token": this.wireToken ?? "",

            "Content-Type": "application/json"
        }
    }
}

class Teacher {
    constructor(options = {}) {
        this.options = {
            domain: options.domain ?? "https://schedule.siriusuniversity.ru/teacher",
            url: "https://schedule.siriusuniversity.ru",
        };

        this.parser = new ourparser(this.options.domain, "https://schedule.siriusuniversity.ru/livewire/message/teachers.teacher-main-grid");

    }

    async getSchedule(teacher){

        return await this.parser.getTeacherSchedule(teacher).catch((e) =>{
            throw new Error(e);
        });
    }

    async getInitialData() {
        await this.parser.getInitialData().catch((e) => {
            throw new Error("Can't get inital data: " + e);
        });

        return true;
    }

    async changeWeek(step) {
        if (!Number.isInteger(step) || step === 0) return;

        await this.parser.changeWeek(step).catch((e) => {
            throw new Error("Can't change week: " + e);
        });
    }

}





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