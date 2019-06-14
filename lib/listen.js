const http = require('http');
const WebSocket = require('ws');

const Caller = require('./caller');
const TransportWs = require('./transport_ws');

class RpcListen {
    /**
     * @param {Caller} [options.onCaller]
     * @param {string} [options.username]
     * @param {string} [options.password]
     * @param {string} [options.token]
     * @param {boolean} [options.noHttp]
     * @param {boolean} [options.noWebSocket]
     */
    constructor(callee, options) {
        this._callee = callee;

        const _options = options || {};
        this._onCaller = _options.onCaller;
        this._username = _options.username;
        this._password = _options.password;
        this._token = _options.token;

        this.http = http.createServer((req, res) => {
            if (_options.noHttp) {
                res.writeHead(400);
                res.end('JSON-RPC Server\n');
                return;
            }

            if (req.method === 'GET') {
                res.writeHead(200);
                res.end('JSON-RPC Server\n');
            } else if (req.method === 'POST') {
                if (!this._authenticateHTTP(req, res))
                    return;
                
                const bufs = [];
                req.on('data', x => bufs.push(x));
                req.on('end', async () => {
                    let body;
                    try {
                        body = JSON.parse(Buffer.concat(bufs).toString());
                    } catch (_) {
                        body = null;
                    }
                    res.writeHead(200);
                    res.end(JSON.stringify(await callee.onRequest(body)));
                    res.end("\r\n");
                });
            } else {
                res.writeHead(405);
                res.end();
            }
        });

        if (!_options.noWebSocket)
            this._setupWs();
    }

    _setupWs() {
        this._wss = new WebSocket.Server({ noServer: true });

        this.http.on('upgrade', async (req, socket, head) => {
            if (!this._authenticateWS(req, socket))
                return;
    
            await this._wss.handleUpgrade(req, socket, head, ws => {
                const transport = new TransportWs(ws); 
                transport.run(this.callee);
                const caller = new Caller(transport);

                if (this._onCaller)
                    this._onCaller(caller);

                ws.on('message', async data => {
                    let body;
                    try {
                        body = JSON.parse(data);
                    } catch (_) {
                        return;
                    }

                    // Ignore responses
                    if (!body || body.error || body.result)
                        return;

                    this._callee.onRequest(body, caller)
                        .then(res => res && ws.send(JSON.stringify(res)))
                        .catch(console.error);
                });
            });
        });
    }

    listen(...args) {
        this.http.listen(...args);
    }

    close(...args) {
        this.http.close(...args);
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
    
}

module.exports = RpcListen;
