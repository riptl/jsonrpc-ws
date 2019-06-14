#!/usr/bin/env node

// TODO Test auth

const rpc = require('./index');

async function testHttpOnly() {
    console.log("Testing HTTP only mode");
    
    // Simple echo server
    const methods = new Map();
    methods.set('echo', msg => msg);
    const callee = new rpc.Callee(methods);
    const listen = new rpc.RpcListen(callee, {
        noWebSocket: true,
    });
    listen.listen(39392);

    console.log(" [*] Started server");

    // Simple client
    const client = new rpc.RpcConnect("http://localhost:39392");
    // TODO Check if really HTTP

    console.log(" [*] Connected");

    // Request echo
    const echoRes = await client.execute('echo', 'hi');
    if (echoRes != 'hi') {
        console.error(` [!] Got wrong response: ${echoRes}`);
        process.exit(1);
    }
    console.log(" [*] Got echo response");

    listen.close();

    console.log(" [+] It works");
}

async function testWsConnect() {
    console.log("Testing WS connect requests");
    
    // Echo server + streaming
    const methods = new Map();
    methods.set('echo', msg => msg);

    const streams = new Map();
    streams.set('echo', publish => {
        const hook = setInterval(() => publish("tick"), 100);
        return () => clearInterval(hook);
    })

    const callee = new rpc.Callee(methods, streams);
    const listen = new rpc.RpcListen(callee, {
        noHttp: true,
    });
    listen.listen(39392);

    console.log(" [*] Started server");

    // WS client
    const client = new rpc.RpcConnect("ws://localhost:39392");
    
    console.log(" [*] Connected");

    // Request echo
    const echoRes = await client.execute('echo', 'hi');
    if (echoRes != 'hi') {
        console.error(` [!] Got wrong response: ${echoRes}`);
        process.exit(1);
    }
    console.log(" [*] Got echo response");

    // Request stream
    let active = true;
    const subscription = await client.subscribe(() => {
        if (!active)
            throw new Error("Receiving messages although closed");
    }, 'echo');
    console.log(" [*] Subscribed to echo stream");

    await new Promise(resolve => setTimeout(resolve, 1000));

    subscription.close();
    active = false;
    console.log(" [*] Closed stream");

    listen.close();

    await new Promise(resolve => setTimeout(resolve, 150));

    console.log(" [+] It works");
}

async function testWsReverse() {
    console.log("Testing WS reverse requests");

    let listen;

    await new Promise(async resolve => {
        // noop server
        const listenCallee = new rpc.Callee(new Map(), null);
        listen = new rpc.RpcListen(listenCallee, {
            onCaller: async caller => {
                console.log(" [*] Reverse connected");
                let res;
                try {
                    res = await caller.execute('test');
                } catch (e) {
                    console.error(e);
                    process.exit(1);
                }
                if (res != 420) {
                    console.error(" [!] Unexpected response from reverse request");
                    process.exit(1);
                }
                console.log(" [*] Got test response");
                resolve();
            },
            noHttp: true,
        });
        listen.listen(39392);

        console.log(" [*] Started server");

        // WS client
        const methods = new Map();
        methods.set('test', () => 420);
        const streams = new Map();
        const callee = new rpc.Callee(methods, streams);
        const client = new rpc.RpcConnect("ws://localhost:39392", callee);
        await client.listen();

        console.log(" [*] Connected");
    });

    listen.close();

    console.log(" [+] It works");
}

async function runTests() {
    try {
        //await testHttpOnly();
        //await testWsConnect();
        await testWsReverse();
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
    process.exit(0);
}

runTests();

