const axios = require('axios');
const EventEmitter = require('events');
const WebSocket = require('ws');

class RpcClient {

    /**
     * @param {string} url
     * @param {string} [options.user]
     * @param {string} [options.password]
     * @param {string} [options.token]
     */
    constructor(url, options) {
        options = options || {};

        this._url = new URL(url);
        let defaultPort;
        switch (this._url.protocol) {
          case 'http:', 'ws:':
            this._tls = false;
            defaultPort = 80;
            break;
          case 'https:', 'wss:':
            this._tls = true;
            defaultPort = 443;
            break;
          default:
            throw new Error(`Unsupported protocol: ${this._url.protocol}`);
        }
        this._host = this._url.host;
        this._user = options.user;
        this._password = options.password;
        this._token = options.token;
        this._requestId = 0;
        this._ws = null;
        this._wsUnsupported = false;
        this._http = axios.create({
            baseURL: this.httpURL,
        })
    }

    get host() {
        return this._host;
    }

    get httpURL() {
        return `${this._tls ? 'https' : 'http'}://${this.host}/`;
    }

    get wsURL() {
        return `${this._tls ? 'wss' : 'ws'}://${this.host}/`;
    }

    get _wsAvailable() {
        return this._ws && this._ws.readyState === WebSocket.OPEN;
    }

    execute(method, ...params) {
        this._requestId++;
        if (this._wsAvailable)
            return this._executeWs(this._requestId, method, ...params);
        else
            return this._executeHttp(this._requestId, method, ...params);
    }

    async subscribe(subscriptionName, ...params) {
        await this._tryUpgradeWs();
        if (!this._wsAvailable)
            throw new Error(`Request Failed. Client does not support subscriptions.`);

        // Send subscribe request
        let subId = await this._executeWs(++requestId, 'subscribe', subscriptionName, ...params);

        // Listen for incoming requests
        const currentWs = this._ws;
        const subscription = new EventEmitter();
        const onMessage = body => {
            let msg;
            try {
                msg = JSON.parse(body);
            } catch (e) {
                console.warn(`Invalid request received: ${e}`);
                return;
            }
            if (msg["result"] || msg["error"])
                return; // Ignore responses
            if (msg["method"] != 'subscription')
                return;
            if (!msg["params"])
                return;
            if (msg["params"].subscription != subId)
                return;

            subscription.emit('message', msg["params"].result);
        };
        const onClose = manual => {
            currentWs.removeListener('message', onMessage);
            currentWs.removeListener('close', onClose);
            subscription.emit('close');
            if (manual) {
                this._executeWs(++requestId, 'unsubscribe', subscriptionName);
            }
        }
        subscription.stop = () => onClose(manual);
        currentWs.addListener('message', onMessage);
        currentWs.addListener('close', onClose);

        return subscription;
    }

    async _executeHttp(requestId, method, ...params) {
        const headers = {};
        if (this._user && this._password) {
            const creds = Buffer.from(`${this._user}:${this._password}`);
            headers['Authorization'] = `Basic ${creds.toString('base64')}`;
        } else if (this._token) {
            headers['Authorization'] = `Bearer ${this._token}`;
        }

        if (!this._wsUnsupported && !this._wsAvailable) {
            if (await this._tryUpgradeWs(headers)) {
                // Upgraded to WebSocket
                return await this._executeWs(requestId, method, ...params);
            } else {
                this._wsUnsupported = true;
            }
        }

        // No WebSocket support, fallback to HTTP
        const res = await this._http({
            method: 'post',
            url: '/',
            headers: headers,
            data: this._buildRequest(requestId, method, ...params),
        });

        if (res.status === 401)
            throw new Error(`Request Failed: Authentication Required. Status Code: ${res.status}`);
        if (res.status !== 200)
            throw new Error(`Request Failed. ` +
                res.statusText ? `${res.statusText} - ` : '' +
                `Status Code: ${res.status}`);

        if (res.data.error)
            throw res.data.error;

        if (!res.data.result)
            throw new Error(`Request Failed. Invalid Response.`);

        return res.data.result;
    }

    _executeWs(requestId, method, ...params) {
        return new Promise((resolve, reject) => {
            // Send request
            try {
                const body = JSON.stringify({
                    'jsonrpc': '2.0',
                    'id': requestId,
                    'method': method,
                    'params': params,
                });
                this._ws.send(body, { binary: false });
            } catch (e) {
                reject(e);
                return;
            }
            this._getWsResponse(requestId).then(resolve, reject);
        });
    }

    _tryUpgradeWs(headers) {
        if (this._ws && this._ws.readyState !== WebSocket.CLOSED)
            return;
        return new Promise(resolve => {
            // Try to upgrade to WS
            try {
                this._ws = new WebSocket(this.wsURL, { headers: headers });
                this._ws.once('open', () => resolve(true));
                this._ws.once('error', () => resolve(false));
            } catch (e) {
                resolve(false);
            }
        })
    }

    _getWsResponse(requestId) {
        // Scan incoming messages for response
        const currentWs = this._ws;
        return new Promise((resolve, reject) => {
            const listener = body => {
                let msg;
                try {
                    msg = JSON.parse(body);
                } catch (e) {
                    // Ignore invalid incoming messages
                    return;
                }

                if (msg["method"])
                    return; // Ignore requests
                if (msg["id"] != requestId)
                    return;

                if (msg["error"])
                    reject(msg["error"])
                else
                    resolve(msg["result"]);
                currentWs.removeListener('message', listener);
            };
            currentWs.addListener('message', listener);
        });
    }

    _buildRequest(id, method, ...params) {
        return {
            jsonrpc: '2.0',
            id: id,
            method: method,
            params: params,
        };
    }

}

module.exports = RpcClient;
