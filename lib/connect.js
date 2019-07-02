const axios = require('axios');
const EventEmitter = require('events');
const WebSocket = require('ws');

const Caller = require('./caller');
const TransportWs = require('./transport_ws');

class RpcConnect {

    /**
     * @param {string} url
     * @param {Callee} [callee]
     * @param {string} [options.user]
     * @param {string} [options.password]
     * @param {string} [options.token]
     */
    constructor(url, callee, options) {
        options = options || {};

        this._url = url;
        this._callee = callee;

        this._user = options.user;
        this._password = options.password;
        this._token = options.token;

        this._wsCaller = null;
        this._wsUnsupported = false;
        this._wsRequired = false;
        this._http = axios.create({
            baseURL: url,
        });
    }

    get host() {
        return this._host;
    }

    get _wsAvailable() {
        return this._wsCaller && this._wsCaller._transport.alive;
    }

    async execute(method, ...params) {
        if (this._wsAvailable) {
            // WebSocket available
            return await this._wsCaller.execute(method, ...params);
        } else {
            // WebSocket might be available
            if (!this._wsUnsupported && !this._wsAvailable) {
                await this._upgradeWs();
                if (this._wsAvailable) {
                    return this._wsCaller.execute(method, params);
                } else {
                    this._wsUnsupported = true;
                }
            }
            // WebSocket not available
            return await this._executeHttp(method, ...params);
        }
    }

    async subscribe(cb, method, ...params) {
        // Requires a bidirectional connection
        await this._upgradeWs();
        if (!this._wsAvailable)
            throw new Error(`Client does not support subscriptions.`);

        return this._wsCaller.subscribe(cb, method, ...params);
    }

    async listen() {
        // Requires a bidirectional connection
        await this._upgradeWs();
        if (!this._wsAvailable)
            throw new Error(`Client does not support listen.`);
    }

    _authHeader() {
        if (this._user && this._password) {
            const creds = Buffer.from(`${this._user}:${this._password}`);
            return `Basic ${creds.toString('base64')}`;
        } else if (this._token) {
            return `Bearer ${this._token}`;
        }
    }

    async _executeHttp(method, ...params) {
        const headers = {};
        if (this._user && this._password) {
            const creds = Buffer.from(`${this._user}:${this._password}`);
            headers['Authorization'] = `Basic ${creds.toString('base64')}`;
        } else if (this._token) {
            headers['Authorization'] = `Bearer ${this._token}`;
        }

        const incoming = new EventEmitter();
        const send = async reqMsg => {
            try {
                const res = await this._http({
                    method: 'post',
                    url: '/',
                    headers: headers,
                    data: reqMsg,
                });
                if (res.status !== 200)
                    throw new Error(`Request Failed. ` +
                        res.statusText ? `${res.statusText} - ` : '' +
                        `Status Code: ${res.status}`);
                incoming.emit('message', res.data);
            } catch (e) {
                incoming.emit('failure', e);
            } finally {
                incoming.emit('close');
            }
        };
        
        const httpCaller = new Caller({send, incoming});
        return await httpCaller.execute(method, ...params);
    }

    async _upgradeWs() {
        let transport;
        try {
            transport = await this._connectWs();
        } catch (_) {
            return;
        }
        this._wsCaller = new Caller(transport);
    }

    _connectWs() {
        return new Promise((resolve, reject) => {
            const headers = {};
            const authHeader = this._authHeader();
            if (authHeader)
                headers['Authorization'] = authHeader;

            // Try to upgrade to WS
            try {
                const ws = new WebSocket(this._url, { headers: headers });
                const transport = new TransportWs(ws); 
                ws.once('open', () => {
                    transport.run(this._callee, this._wsCaller);
                    resolve(transport);
                });
                ws.once('error', e => reject(e));
            } catch (e) {
                reject(e);
            }
        });
    }

}

module.exports = RpcConnect;
