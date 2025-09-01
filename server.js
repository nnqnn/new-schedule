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
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const { Agent } = require('undici');
        const insecureDispatcher = new Agent({ keepAliveTimeout: 10_000, keepAliveMaxTimeout: 10_000, connect: { family: 4, rejectUnauthorized: false } });
        let response;
        try {
            response = await fetch(this.url, {
                credentials: "same-origin",
                redirect: "follow",
                headers: this.getDefaultHeaders(),
                signal: controller.signal
            });
        } catch (e) {
            response = await fetch(this.url, {
                credentials: "same-origin",
                redirect: "follow",
                headers: this.getDefaultHeaders(),
                dispatcher: insecureDispatcher,
                signal: controller.signal
            });
        } finally {
            clearTimeout(timeout);
        }
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
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
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const { Agent } = require('undici');
        const insecureDispatcher = new Agent({ keepAliveTimeout: 10_000, keepAliveMaxTimeout: 10_000, connect: { family: 4, rejectUnauthorized: false } });
        let data;
        try {
            data = await fetch(this.mainGridUrl, {
                method: "POST",
                credentials: "same-origin",
                headers: { ...this.getDefaultHeaders(), ...this.getHeaders(), Referer: this.url, Origin: this.origin },
                body: JSON.stringify({
                    ...this.getInitialBody(),
                    updates: updates
                }),
                signal: controller.signal
            });
        } catch (e) {
            data = await fetch(this.mainGridUrl, {
                method: "POST",
                credentials: "same-origin",
                headers: { ...this.getDefaultHeaders(), ...this.getHeaders(), Referer: this.url, Origin: this.origin },
                body: JSON.stringify({
                    ...this.getInitialBody(),
                    updates: updates
                }),
                dispatcher: insecureDispatcher,
                signal: controller.signal
            });
        } finally {
            clearTimeout(timeout);
        }
        if (!data.ok) {
            throw new Error(`HTTP ${data.status}`);
        }

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


// Объект для хранения кэша в памяти
let scheduleCache = {};

// Время последнего обновления кэша
let lastCacheUpdate = 0;


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
        for (const teacherId of teacherIds) {
            try {
                newCache[teacherId] = await fetchTeacherScheduleFromAPI(teacherId, 0);
            } catch (error) {
                console.error(`Ошибка при получении расписания для преподавателя ${teacherId}:`, error);
            }
        }
        // Сохраняем кэш в файл
        await fs.writeFile(TEACHERS_CACHE_FILE, JSON.stringify(newCache, null, 2));
        teachersCache = newCache;
        lastCacheUpdate = Date.now();
        console.log('Кэш преподавателей успешно обновлен');
    } catch (error) {
        console.error('Ошибка при обновлении кэша преподавателей:', error);
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


// Запускаем периодическое обновление кэша
setInterval(updateCache, CACHE_UPDATE_INTERVAL);
setInterval(updateTeachersCache, CACHE_UPDATE_INTERVAL);

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
        });
    });
});