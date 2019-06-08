const http = require('http');
const WebSocket = require('ws');

class RpcServer {
    /**
     * @param {Map.<string, function(*)>} methods
     * @param {Map.<string, function(*)>} streams
     * @param {function} [options.hijackWS]
     * @param {string} [options.username]
     * @param {string} [options.password]
     * @param {string} [options.token]
     */
    constructor(methods, streams, options) {
        this.http = http.createServer((req, res) => {
            if (req.method === 'GET') {
                res.writeHead(200);
                res.end('JSON-RPC Server\n');
            } else if (req.method === 'POST') {
                if (this._authenticateHTTP(req, res)) {
                    req.on('data', body.push);
                    req.on('end', async () => {
                        let body;
                        try {
                            body = JSON.parse(Buffer.concat(body).toString());
                        } catch (_) {
                            body = null;
                        }
                        res.writeHead(200);
                        res.end(JSON.stringify(this._onRequest(Buffer.concat(body).toString())));
                        res.end("\r\n");
                    });
                }
            } else {
                res.writeHead(405);
                res.end();
            }
        });
        
        this.http.on('upgrade', async (req, socket, head) => {
            if (!this._authenticateWS(req, socket))
                socket.destroy();
    
            await this._wss.handleUpgrade(req, socket, head, ws => {
                if (this._hijackWS && this._hijackWS(req, socket, head, ws))
                    return;

                ws.on('message', async data => {
                    let body;
                    try {
                        body = JSON.parse(data);
                    } catch (_) {
                        body = null;
                    }

                    // Ignore responses
                    if (body.error || body.result)
                        return;

                    let res = await this._onRequest(body, ws);
                    if (res)
                        ws.send(JSON.stringify(res));
                });
            });
        });

        this._methods = methods;
        this._streams = streams;
        if (options) {
            this._hijackWS = options.hijackWS;
            this._username = options.username;
            this._password = options.password;
            this._token = options.token;
        }

        this._wss = new WebSocket.Server({ noServer: true });
        this._subscriptions = new Map();
    }

    listen(...args) {
        this.http.listen(...args);
    }

    _authenticateHTTP(req, res) {
        if (!this._authenticated(req)) {
            res.writeHead(401, {'WWW-Authenticate': 'Basic realm="Use user-defined username and password to access the JSON-RPC API." charset="UTF-8"'});
            res.end();
            return false;
        }
        return true;
    }

    _authenticateWS(req, sock) {
        if (!this._authenticated(req)) {
            sock.write('HTTP/1.1 401 Unauthorized\r\n' +
                'WWW-Authenticate: Basic realm="Use user-defined username and password to access the JSON-RPC API." charset="UTF-8"\r\n' +
                '\r\n');
            sock.destroy();
            return false;
        }
        return true;
    }

    _authenticated(req) {
        if (this._username) {
            const creds = Buffer.from(`${this._user}:${this._password}`);
            const auth = `Basic ${creds.toString('base64')}`;
            return req.headers.authorization === auth;
        } else if (this._token) {
            return req.headers.authorization === `Bearer ${this._token}`;
        }

        return true;
    }
    
    async _onRequest(body, ws) {
        let single = false;
        single = !(body instanceof Array);
        if (!body || body.length > 100) {
            return {
                'jsonrpc': '2.0',
                'error': {'code': -32600, 'message': 'Invalid Request'},
                'id': null
            };
        }
        if (single) {
            body = [body];
        }
        const result = [];
        for (const msg of body) {
            if (!msg || msg.jsonrpc !== '2.0' || !msg.method) {
                result.push({
                    'jsonrpc': '2.0',
                    'error': {'code': -32600, 'message': 'Invalid Request'},
                    'id': (msg && msg.id) ? msg.id : null
                });
                continue;
            }
            
            const params = msg.params instanceof Array ? msg.params : [msg.params];

            try {
                if (this._methods.has(msg.method)) {
                    const methodRes = await this._methods.get(msg.method)(...params);
                    if (typeof msg.id === 'string' || Number.isInteger(msg.id)) {
                        result.push({'jsonrpc': '2.0', 'result': methodRes, 'id': msg.id});
                    }
                } else if (ws && msg.method == 'subscribe' && params.length >= 1 && this._streams.has(params[0])) {
                    const subscriptionId = uuid();
                    const publisher = RpcServer._createPublisher(ws, subscriptionId);
                    const cancel = this._streams.get(params[0])(publisher, ...params.slice(1));
                    this._subscriptions.set(id, cancel);
                    result.push({
                        'jsonrpc': '2.0',
                        'id': msg.id,
                        'result': id
                    });
                } else if (ws && msg.method == 'unsubscribe' && params.length === 1) {
                    const cancel = this._subscriptions.get(params[0]);
                    if (cancel) {
                        cancel();
                        this._subscriptions.delete(params[0]);
                    }
                    result.push({
                        'jsonrpc': '2.0',
                        'id': msg.id,
                        'result': !!cancel
                    });
                } else {
                    throw { code: -32601, message: 'Method or subscription not found' };
                }
            } catch (e) {
                result.push({
                    'jsonrpc': '2.0',
                    'error': {'code': e.code || 1, 'message': e.message || e.toString()},
                    'id': msg.id
                });
            }
        }
        if (single && result.length === 1) {
            return result[0];
        } else if (!single) {
            return result;
        }
    }

    static _createPublisher(ws, subscriptionId) {
        let nonce = 0;
        return async msg => ws.send(JSON.stringify({
            'jsonrpc': '2.0',
            'id': nonce++,
            'params': {
                'subscription': subscriptionId,
                ...msg,
            }
        }));
    }
}

module.exports = RpcServer;
