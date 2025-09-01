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

module.exports = Parser;