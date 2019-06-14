const EventEmitter = require('events');

// TODO close()

class TransportWs {

    constructor(ws) {
        // Send function
        this._send = msg => ws.send(JSON.stringify(msg));
        // Incoming response stream
        this._incoming = new EventEmitter();

        ws.on('close', () => {
            this._wsCaller = null;
            this._incoming.emit('close');
            this._incoming.removeAllListeners();
            this._incoming = null;
        });
        this._ws = ws;
    }

    run(callee, caller) {
        this._ws.on('message', async body => {
            let msg;
            try {
                msg = JSON.parse(body);
            } catch (e) {
                // Ignore invalid incoming messages
                return;
            }

            if (msg["method"]) {
                if (msg["method"] == 'subscription') {
                    // Incoming subscription request
                    // TODO Merge with callee?
                    if (!(msg["params"] instanceof Array)
                        || !msg["params"][0]
                        || msg["params"][0].subscription !== 'string')
                        return;
                    this._incoming.emit('publish', msg["params"][0].subscription, msg);
                } else if (callee) {
                    // Incoming request
                    callee.onRequest(msg, caller)
                        .then(res => this._ws.send(JSON.stringify(res)))
                        .catch(console.trace);
                }
            } else if (msg["error"] || msg["result"]) {
                // Incoming response
                this._incoming.emit('message', msg);
            }
        });
    }

    get send() {
        return this._send;
    }

    get incoming() {
        return this._incoming;
    }

    get alive() {
        return !!this._incoming;
    }

}

module.exports = TransportWs;
