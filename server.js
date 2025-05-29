const express = require('express');
const sirinium = require('sirinium');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const utils = require('./utils');

const app = express();
app.use(cors());

class ourparser {
    constructor(domain, mainGrid) {
        this.url = domain;
        this.mainGridUrl = mainGrid;
    }

    async getInitialData() {
        const response = await fetch(this.url, { credentials: "same-origin" });
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
        const data = await fetch(this.mainGridUrl, {
            method: "POST",
            credentials: "same-origin",
            headers: this.getHeaders(),
            body: JSON.stringify({
                ...this.getInitialBody(),
                updates: updates
            })
        });

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

// Путь к файлу кэша
const CACHE_FILE = path.join(__dirname, 'schedule_cache.json');
// Интервал обновления кэша (200 секунд)
const CACHE_UPDATE_INTERVAL = 200 * 1000;

// Объект для хранения кэша в памяти
let scheduleCache = {};
// Время последнего обновления кэша
let lastCacheUpdate = 0;

// Список преподователей
const TEACHERS = [
    "d62673b2-171e-4b09-9316-b089a6c727c1"// Биккинина Элина Рамилевна
];



// Функция для получения расписания из API
async function fetchScheduleFromAPI(teacher, week) {
    const client = new Teacher();
    await client.getInitialData();
    await client.changeWeek(Number(week));
    return await client.getSchedule(teacher);
}

// Функция для обновления кэша
async function updateCache() {
    try {
        console.log('Обновление кэша расписания...');
        const newCache = {};
        for (const teacher of TEACHERS) {
            try {
                newCache[teacher] = await fetchScheduleFromAPI(teacher, 0);
            } catch (error) {
                console.error(`Ошибка при получении расписания для преподователя с айди ${teacher}:`, error);
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
        const { teacher, week = 0 } = req.query;

        // Если запрашивается текущая неделя (week=0), используем кэш
        if (week === '0') {
            // Если кэш пустой или устарел, обновляем его
            if (Object.keys(scheduleCache).length === 0 || Date.now() - lastCacheUpdate > CACHE_UPDATE_INTERVAL) {
                await updateCache();
            }

            // Проверяем наличие данных для запрошенного айди преподователя
            if (scheduleCache[teacher]) {
                return res.json(scheduleCache[teacher]);
            } else {
                // Если данных нет в кэше, получаем их из API
                const schedule = await fetchScheduleFromAPI(teacher, 0);
                scheduleCache[teacher] = schedule;
                await fs.writeFile(CACHE_FILE, JSON.stringify(scheduleCache, null, 2));
                return res.json(schedule);
            }
        } else {
            // Для других недель получаем данные напрямую из API
            const schedule = await fetchScheduleFromAPI(teacher, week);
            res.json(schedule);
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Эндпоинт для получения списка групп
app.get('/api/teachers', (req, res) => {
    try {
        res.json(TEACHERS);
    } catch (error) {
        res.status(500).json({ error: 'Не удалось получить список преподователей' });
    }
});

app.get('/', (req, res) => {
    res.send('Сервер работает');
});

// Загружаем кэш при запуске сервера
loadCache().then(() => {
    app.listen(3000, '0.0.0.0', () => console.log('Server started on port 3000'));
});