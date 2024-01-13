import express from 'express';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {createClient} from "redis";
import {Server} from "socket.io";
import {createAdapter} from "@socket.io/redis-streams-adapter";

const redisClient = createClient({url: "redis://localhost:6379"});
await redisClient.connect();


const app = express();
const server = createServer(app);
const io = new Server(server, {
    adapter: createAdapter(redisClient)
});

const __dirname = dirname(fileURLToPath(import.meta.url));

app.get('/', (req, res) => {
    res.sendFile(join(__dirname, 'index.html'));
});

app.get('/beep.m4a', (req, res) => {
    res.sendFile(join(__dirname, 'beep.m4a'));
});

io.on('connection', (socket) => {
    socket.broadcast.emit('hi');
});

io.on('connection', (socket) => {
    sendProductQuantities()
    socket.on('product-scanned', (msg) => {
        let msgParsed = JSON.parse(msg);
        console.log('New product received:', msg)
        emitProductProgress(msgParsed.productId)
    })
    socket.on('track-new-product', (msg) => {
        let msgParsed = JSON.parse(msg);
        console.log('New tracking request received:', msg)
        let productId = msgParsed.productId;
        redisClient.hSet(
            generateProductKey(productId, 'data'),
            'requiredQuantity',
            msgParsed.quantity
        )
        redisClient.hSet(
            generateProductKey(productId, 'data'),
            'date',
            Date.now()
        )
        sendProductQuantities()

    })
});

let generateProductKey = (productId, prefix) => {
    return `${prefix}-product-${productId}`
}

let emitProductProgress = async (productId) => {
    let quantityKey = generateProductKey(productId, 'quantity');
    let dataKey = generateProductKey(productId, 'data');
    let currentQuantity = parseInt(await redisClient.get(quantityKey))
    let requiredQuantity = await redisClient.hGet(dataKey, 'requiredQuantity')
    if(requiredQuantity !== null) {
        redisClient.incr(generateProductKey(productId, 'quantity'))
    }
    requiredQuantity = parseInt(requiredQuantity)
    if(currentQuantity >= requiredQuantity || Number.isNaN(requiredQuantity)) {
        redisClient.del(quantityKey)
        redisClient.del(dataKey)
    }
    sendProductQuantities()
}

let sendProductQuantities = () => {
    redisClient.keys('quantity-*').then((quantityKeys) => {


        Promise.all(quantityKeys.map(k => redisClient.get(k))).then(async (e) => {
            let msgObj = {};

            for (const index in quantityKeys) {
                let productId = quantityKeys[index].split('-').pop();
                let requiredQuantity = await redisClient.hGet(generateProductKey(productId, 'data'), 'requiredQuantity')
                if (requiredQuantity != null) {
                    msgObj[productId] = {quantity: parseInt(e[index]), requiredQuantity: parseInt(requiredQuantity)}
                }
            }


            io.emit('products-state', JSON.stringify(msgObj))
        })
    })
}

let availablePorts = [2053, 2083, 2087, 2096, 8443]
let currentPortIndex = 0;

let startListening = (port) => {
    server.listen(port, '0.0.0.0', 511, () => {
        console.log(`Trying to run server at http://0.0.0.0:${port}`);
    }).once('error', () => {
        currentPortIndex++;
        console.log(`Failed to listen on ${port}, trying +1 port`)
        startListening(availablePorts[currentPortIndex])
    })
}

startListening(availablePorts[currentPortIndex])




