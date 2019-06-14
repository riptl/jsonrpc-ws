const uuid = require('uuid/v4');

class Callee {

    constructor(methods, streams) {
        this._methods = methods;
        this._streams = streams;
        this._subscriptions = new Map();
    }

    async onRequest(body, caller) {
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
                const res = await this._handleCall(msg.id, msg.method, params, caller);
                result.push(res);
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

    async _handleCall(id, method, params, caller) {
        if (caller && this._streams) {
            if (method == 'subscribe') {
                if (params.length < 1 || !this._streams.has(params[0]))
                    throw { code: -32601, message: 'Subscription not found' };
                const subscriptionId = uuid();
                const publisher = Callee._wrapSubscription(caller, subscriptionId);
                const cancel = this._streams.get(params[0])(publisher, ...params.slice(1));
                this._subscriptions.set(subscriptionId, cancel);
                return {
                    'jsonrpc': '2.0',
                    'id': id,
                    'result': subscriptionId
                };
            } else if (method == 'unsubscribe') {
                if (params.length !== 1)
                    throw { code: -32601, message: 'unsubscribe called incorrectly' };
                const cancel = this._subscriptions.get(params[0]);
                if (cancel) {
                    cancel();
                    this._subscriptions.delete(params[0]);
                }
                return {
                    'jsonrpc': '2.0',
                    'id': id,
                    'result': !!cancel
                };
            }
        }

        if (this._methods.has(method)) {
            const methodRes = await this._methods.get(method)(...params);
            if (typeof id === 'string' || Number.isInteger(id)) {
                return {'jsonrpc': '2.0', 'result': methodRes, 'id': id};
            } else {
                throw { code: -32601, message: 'Invalid ID' };
            }
        }

        throw { code: -32601, message: 'Method or stream not found' };
    }

    static _wrapSubscription(caller, subscriptionId) {
        return async msg => caller.execute('subscription', {
            'subscription': subscriptionId,
            'result': msg,
        });
    }
}

module.exports = Callee;
