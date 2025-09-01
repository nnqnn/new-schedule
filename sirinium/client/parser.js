const utils = require("./utils");
const { Agent } = require('undici');

class Parser {
    constructor(domain, mainGrid) {
        this.url = domain;
        this.mainGridUrl = mainGrid ?? `${this.url}/livewire/message/main-grid`;
        try {
            this.origin = new URL(this.url).origin;
        } catch (e) {
            this.origin = "https://schedule.siriusuniversity.ru";
        }
    }

    async fetchWithRetry(url, options, timeoutMs) {
        const attempts = parseInt(process.env.FETCH_RETRY_ATTEMPTS || '3', 10);
        let currentTimeout = parseInt(timeoutMs || process.env.FETCH_TIMEOUT_MS || '45000', 10);
        for (let attempt = 1; attempt <= attempts; attempt++) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), currentTimeout);
            try {
                const dispatcher = attempt === 1 ? undefined : new Agent({ keepAliveTimeout: 10_000, keepAliveMaxTimeout: 10_000, connect: { family: 4, rejectUnauthorized: false, hints: 0 } });
                const response = await fetch(url, { ...options, signal: controller.signal, dispatcher });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response;
            } catch (err) {
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

module.exports = Parser;