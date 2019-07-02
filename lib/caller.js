class Caller {

    constructor(transport) {
        this._requestId = 0;
        this._transport = transport;
    }

    execute(method, ...params) {
        if (!this._transport.incoming) {
            throw new Error("Transport died");
        }
        return new Promise((resolve, reject) => {
            const id = ++this._requestId;
            let timeoutHandle, abortFn;

            const incoming = this._transport.incoming;

            const listener = msg => {
                if (!msg.id) {
                    reject(new Error("Invalid response"));
                } else if (msg.id == id) {
                    if (msg.error)
                        reject(msg.error)
                    else
                        resolve(msg.result);
                    incoming.removeListener('message', listener);
                } else {
                    return;
                }
                clearTimeout(timeoutHandle);
                incoming.removeListener('close', abortFn);
                incoming.removeListener('failure', abortFn);
            }
            abortFn = e => {
                incoming.removeListener('message', listener);
                if (e)
                    reject(e);
                else
                    reject(new Error("aborted"))
            }

            incoming.on('message', listener);
            incoming.once('failure', abortFn);
            incoming.once('close', abortFn);
            timeoutHandle = setTimeout(abortFn, 10000);

            this._transport.send({
                'jsonrpc': '2.0',
                'id': id,
                'method': method,
                'params': params,
            });
        });
    }

    async subscribe(cb, method, ...params) {
        if (!this._transport.incoming) {
            throw new Error("Transport died");
        }

        const incoming = this._transport.incoming;

        // Send subscribe request
        let subId = await this.execute('subscribe', method, ...params);
        if (typeof subId !== 'string')
            throw new Error("Got no subscription ID");

        // Listen for incoming requests
        const listener = (incomingSubId, result) => {
            if (subId != incomingSubId)
                return;
            cb(result);
        }
        incoming.on('publish', listener);
        incoming.once('close', incomingSubId => {
            if (subId != incomingSubId)
                return;
            incoming.off('publish', listener);
        });

        return {
            id: subId,
            close: async () => {
                incoming.removeListener('publish', listener);
                await this.execute('unsubscribe', subId);
            }
        };
    }

}

module.exports = Caller;
