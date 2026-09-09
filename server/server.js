require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, '../client')));

// Map to track active clients and their database UUIDs
const clients = new Map(); 
const conversations = new Map();

function send(ws, payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
    }
}

function sendError(ws, message) {
    send(ws, { type: 'error', message });
}

function broadcastUserList() {
    const users = Array.from(clients.keys());
    const payload = JSON.stringify({ type: 'user_list', users });
    for (const clientData of clients.values()) {
        if (clientData.ws.readyState === WebSocket.OPEN) {
            clientData.ws.send(payload);
        }
    }
}

function broadcastMemberUpdate(conversationId) {
    const members = Array.from(conversations.get(conversationId) || []);
    const payload = { type: 'member_update', conversationId, members };
    for (const username of members) {
        send(clients.get(username).ws, payload);
    }
}

function requireRegistered(ws) {
    if (!ws.username) {
        sendError(ws, 'You must register a username before doing that.');
        return false;
    }
    return true;
}

wss.on('connection', (ws) => {
    console.log('New client connected');
    ws.username = null;

    ws.on('message', async (raw) => {
        let data;
        try {
            data = JSON.parse(raw);
        } catch (err) {
            sendError(ws, 'Malformed message (not valid JSON).');
            return;
        }

        try {
            switch (data.type) {
                case 'register':
                    await handleRegister(ws, data);
                    break;
                case 'create_conversation':
                    await handleCreateConversation(ws);
                    break;
                case 'join_conversation':
                    await handleJoinConversation(ws, data);
                    break;
                case 'leave_conversation':
                    handleLeaveConversation(ws, data);
                    break;
                case 'send_message':
                    await handleSendMessage(ws, data);
                    break;
                case 'fetch_history':
                    await handleFetchHistory(ws, data);
                    break;
                default:
                    sendError(ws, `Unknown message type: ${data.type}`);
            }
        } catch (err) {
            console.error('Handler error:', err);
            sendError(ws, 'Server error processing your request.');
        }
    });

    ws.on('close', () => {
        if (ws.username) {
            clients.delete(ws.username);
            for (const [conversationId, members] of conversations.entries()) {
                if (members.delete(ws.username)) {
                    broadcastMemberUpdate(conversationId);
                }
            }
            broadcastUserList();
            console.log(`${ws.username} disconnected`);
        }
    });
});

async function handleRegister(ws, data) {
    const username = (data.username || '').trim();
    if (!username) {
        sendError(ws, 'Username cannot be empty.');
        return;
    }
    if (clients.has(username)) {
        sendError(ws, 'Username taken.');
        return;
    }

    // Check if user exists in Supabase
    let { data: userData, error: userError } = await supabase
        .from('users')
        .select('id')
        .eq('username', username)
        .single();

    // Create user if they do not exist
    if (userError && userError.code === 'PGRST116') {
        const { data: newUser, error: insertError } = await supabase
            .from('users')
            .insert([{ username: username }])
            .select()
            .single();

        if (insertError) throw insertError;
        userData = newUser;
    }

    ws.username = username;
    // Store both the WebSocket and the database UUID
    clients.set(username, { ws: ws, id: userData.id }); 
    
    send(ws, { type: 'registered', username });
    broadcastUserList();
}

async function handleCreateConversation(ws) {
    if (!requireRegistered(ws)) return;

    const { data: row, error } = await supabase
        .from('conversations')
        .insert([{}])
        .select()
        .single();

    if (error) {
        console.error('Supabase error creating conversation:', error);
        sendError(ws, 'Failed to create conversation.');
        return;
    }

    const conversationId = row.id;
    conversations.set(conversationId, new Set([ws.username]));
    send(ws, { type: 'conversation_created', conversationId });
}

async function handleJoinConversation(ws, data) {
    if (!requireRegistered(ws)) return;
    const { conversationId } = data;
    
    if (!conversationId) {
        sendError(ws, 'join_conversation requires a conversationId.');
        return;
    }

    if (!conversations.has(conversationId)) {
        conversations.set(conversationId, new Set());
    }
    conversations.get(conversationId).add(ws.username);

    const { data: history, error } = await supabase
        .from('messages')
        .select('content, created_at, users (username)')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

    if (error) {
        console.error('Supabase error fetching history:', error);
        sendError(ws, 'Failed to load conversation history.');
        return;
    }

    send(ws, {
        type: 'conversation_joined',
        conversationId,
        members: Array.from(conversations.get(conversationId)),
        history,
    });

    broadcastMemberUpdate(conversationId);
}

function handleLeaveConversation(ws, data) {
    if (!requireRegistered(ws)) return;
    const { conversationId } = data;
    const members = conversations.get(conversationId);
    if (members) {
        members.delete(ws.username);
        broadcastMemberUpdate(conversationId);
    }
}

async function handleSendMessage(ws, data) {
    if (!requireRegistered(ws)) return;
    const { conversationId, content } = data;

    // Input validation
    if (!conversationId || !content) {
        sendError(ws, 'send_message requires conversationId and content.');
        return;
    }
    if (typeof content !== 'string') {
        sendError(ws, 'Invalid message format.');
        return;
    }
    const cleanMessage = content.trim();
    if (cleanMessage.length === 0) {
        sendError(ws, 'Message cannot be empty.');
        return;
    }
    if (cleanMessage.length > 512) {
        sendError(ws, 'Message exceeds 512 character limit.');
        return;
    }

    const members = conversations.get(conversationId);
    if (!members || !members.has(ws.username)) {
        sendError(ws, 'You are not a member of that conversation.');
        return;
    }

    const senderData = clients.get(ws.username);

    // Save to database using the user's UUID
    const { data: saved, error } = await supabase
        .from('messages')
        .insert([
            {
                conversation_id: conversationId,
                sender_id: senderData.id, 
                content: cleanMessage,
            },
        ])
        .select()
        .single();

    if (error) {
        console.error('Supabase error saving message:', error);
        sendError(ws, 'Failed to save message.');
        return;
    }

    const payload = {
        type: 'new_message',
        conversationId,
        senderId: ws.username,
        content: cleanMessage,
        createdAt: saved.created_at,
    };
    
    for (const username of members) {
        send(clients.get(username).ws, payload);
    }
}

async function handleFetchHistory(ws, data) {
    if (!requireRegistered(ws)) return;
    const { conversationId } = data;

    // Use default conversation if none is provided
    const targetConversation = conversationId || '10bd6650-3ae5-4a44-803e-c16c80ca4611';

    const { data: history, error } = await supabase
        .from('messages')
        .select('content, created_at, users (username)')
        .eq('conversation_id', targetConversation)
        .order('created_at', { ascending: true })
        .limit(50);
    
    if (error) {
        console.error('History fetch error:', error);
        sendError(ws, 'Failed to load history.');
        return;
    }

    const formattedHistory = history.map(msg => ({
        type: 'message',
        from: msg.users.username,
        message: msg.content,
        timestamp: msg.created_at,
        isHistory: true
    }));

    send(ws, { 
        type: 'history', 
        messages: formattedHistory 
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});