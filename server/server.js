require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);
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

    ws.on('message', async (message) => {
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
            const { data: savedMessage, error } = await supabase
                .from('messages')
                .inser([
                    {
                        conversation_id: data.conversation_id,
                        sender_id: username,
                        content: data.message
                    }
                ])
                .select();
            
            if (error) {
                console.error('Database error:', error);
                ws.send(JSON.stringify({ type: 'error', message: 'Failed to save message' }));
                return;
            }

            const recipient = clients.get(data.to);
            if (recipient) {
                recipient.send(JSON.stringify({
                    type: 'message',
                    from: username,
                    message: data.message,
                    timestamp: savedMessage[0].created_at
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