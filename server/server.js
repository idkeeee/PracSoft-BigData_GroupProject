const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path')

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, '../client')));

// Still use JavaScript to map clients. NOT YET SUPABASE CONNECTED for any schemas
const clients = new Map();

wss.on('connection', (ws) => {
    console.log('New client connected');

    let username = null;

    ws.on('message', (message) => {
        const data = JSON.parse(message);

        if (data.type === 'register') {
            if (clients.has(data.username)) {
                ws.send(JSON.stringify({ type: 'error', message: 'Username taken'}));
            } else {
                username = data.username;
                clients.set(username, ws);
                ws.send(JSON.stringify({ type: 'registered', username: username}));
                broadcastUserList();
            }
        }

        if (data.type === 'message') {
            const recipient = clients.get(data.to);
            if (recipient) {
                recipient.send(JSON.stringify({
                    type: 'message',
                    from: username,
                    message: data.message,
                    timestamp: new Date().toISOString()
                }));
            }
        }
    });

    ws.on('close', () => {
        if (username) {
            clients.delete(username);
            broadcastUserList();
        }
        console.log('Client disconnected');
    });
})

function broadcastUserList() {
    const userList = Array.from(clients.keys());
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'userList', users: userList }));
        }
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});