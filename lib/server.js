const http = require('http');
const WebSocket = require('ws');

class RpcServer {
    /**
     * @param {number} listenPort
     * @param {Map.<string, function(*)>} methods
     * @param {function} [options.hijackWS]
     */
    constructor(listenPort, methods, options) {
        this.http = http.createServer((req, res) => {
            if (req.method === 'GET') {
                res.writeHead(200);
                res.end('JSON-RPC Server\n');
            } else if (req.method === 'POST') {
                if (JsonRpcServer._authenticate(req, res, config.username, config.password, /*raw*/ false)) {
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
            if (!JsonRpcServer._authenticate(req, null, config.username, config.password, /*raw*/ true))
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
        })

        this.http.listen(listenPort);

        /** @type {Map.<string, function(*)>} */
        this._methods = methods;

        this._wss = new WebSocket.Server({ noServer: true });

        this._hijackWS = options.hijackWS;
    }

    /**
     * @param req
     * @param {http.ServerResponse|net.Socket} res
     * @param {?string} username
     * @param {?string} password
     * @param {boolean} raw
     * @returns {boolean}
     * @private
     */
    static _authenticate(req, res, username, password, raw) {
        if (username && password && req.headers.authorization !== `Basic ${btoa(`${username}:${password}`)}`) {
            if (!raw) {
                res.writeHead(401, {'WWW-Authenticate': 'Basic realm="Use user-defined username and password to access the JSON-RPC API." charset="UTF-8"'});
                res.end();
            } else {
                res.write('HTTP/1.1 401 Unauthorized\r\n' +
                    'WWW-Authenticate: Basic realm="Use user-defined username and password to access the JSON-RPC API." charset="UTF-8"\r\n' +
                    '\r\n');
                res.destroy();
            }
            return false;
        }
        return true;
    }
    
    async _onRequest(body) {
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
                } else {
                    throw { code: -32601, message: 'Method not found', stack: 'Unknown method called' };
                }
            } catch (e) {
                Nimiq.Log.w(JsonRpcServer, e.stack);
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
}

module.exports = RpcServer;
