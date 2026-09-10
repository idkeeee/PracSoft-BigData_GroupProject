const supabase = require('./db');

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

async function handleRegister(ws, data) {
    const username = (data.username || '').trim();
    if (!username) {
        sendError(ws, 'Username cannot be empty.');
        return;
    }
    if (clients.has(username)) {
        const oldClient = clients.get(username);
        send(oldClient.ws, { type: 'error', message: 'You have been logged in from another device.'});
        oldClient.ws.close();
        clients.delete(username);
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
    clients.set(username, 
        { ws: ws, id: userData.id, lastMessageTime: 0 }); 
    
    send(ws, { type: 'registered', username });

    const { data: memberships, error: memberError} = await supabase
        .from('conversation_members')
        .select('conversation_id')
        .eq('user_id', userData.id)
    if (!memberError && memberships && memberships.length > 0) {
        const conversationIds = memberships.map(m => m.conversation_id);
        send(ws, { type: 'my_conversations', conversationIds });
    }

    const { data: allUsersData } = await supabase
        .from('users')
        .select('username');
    
    if (allUsersData) {
        const allUsernames = allUsersData.map(u => u.username);
        send(ws, { type: 'full_user_list', users: allUsernames });
    }

    broadcastUserList();
}

async function handleCreateConversation(ws) {
    if (!requireRegistered(ws)) return;

    const clientData = clients.get(ws.username);

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

    await supabase
        .from('conversation_members')
        .insert([{ conversation_id: conversationId, user_id: clientData.id }]);
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

    const clientData = clients.get(ws.username);

    await supabase
        .from('conversation_members')
        .upsert(
            [{ conversation_id: conversationId, user_id: clientData.id }],
            { onConflict: 'conversation_id, user_id' }
        );

    conversations.get(conversationId).add(ws.username);

    const { data: history, error } = await supabase
        .from('messages')
        .select('content, created_at, users!sender_id (username)')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

    if (error) {
        console.error('Supabase error fetching history:', error);
        sendError(ws, 'Failed to load conversation history.');
        return;
    }

    const formattedHistory = history.map(msg => ({
        senderId: msg.users ? msg.users.username : 'Unknown',
        content: msg.content,
        created_at: msg.created_at
    }));

    send(ws, {
        type: 'conversation_joined',
        conversationId,
        members: Array.from(conversations.get(conversationId)),
        history: formattedHistory,
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

    const clientData = clients.get(ws.username);
    const now = Date.now();

    if (now - clientData.lastMessageTime < 500) {
        sendError(ws, 'You are sending messages too quickly. Please slow down.');
        return;
    }

    clientData.lastMessageTime = now;

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

async function handleStartDM(ws, data) {
    if (!requireRegistered(ws)) return;
    const { targetUsername } = data;
    
    if (!targetUsername || targetUsername === ws.username) {
        sendError(ws, 'Invalid target user.');
        return;
    }

    const targetClient = clients.get(targetUsername)
    if (!targetClient) {
        sendError(ws, 'User is currently offline.');
        return;
    }

    const currentUserData = clients.get(ws.username);

    const { data: conversationsList, error } = await supabase
        .from('conversations')
        .select(`
            id,
            conversation_members (user_id)
        `);
    
    if (error) {
        console.error('Supabase error finding DM:', error);
        sendError(ws, 'Failed to find or create conversation.');
        return;
    }

    let existingConversationId = null;

    for (const convo of conversationsList) {
        const memberIds = convo.conversation_members.map(m => m.user_id);
        if (memberIds.length === 2 && 
            memberIds.includes(currentUserData.id) && 
            memberIds.includes(targetClient.id)) {
            existingConversationId = convo.id;
            break;
        }
    }

    if (existingConversationId) {
        conversations.set(existingConversationId, new Set([ws.username, targetUsername]));
        send(ws, {
            type: 'conversation_joined', 
            conversationId: existingConversationId,
            members: [ws.username, targetUsername],
            history: [] 
        });
        broadcastMemberUpdate(existingConversationId);
    } else {
        const { data: newRow, error: createError } = await supabase
            .from('conversations')
            .insert([{}])
            .select()
            .single();
        
        if (createError) {
            console.error('Supabase error creating DM:', createError);
            sendError(ws, 'Failed to create conversation.');
            return;
        }

         const newConvoId = newRow.id;
        await supabase
            .from('conversation_members')
            .insert([
                { conversation_id: newConvoId, user_id: currentUserData.id },
                { conversation_id: newConvoId, user_id: targetClient.id }
            ]);

        conversations.set(newConvoId, new Set([ws.username, targetUsername]));
        send(ws, { 
            type: 'conversation_joined', 
            conversationId: newConvoId,
            members: [ws.username, targetUsername],
            history: [] 
        });
        broadcastMemberUpdate(newConvoId);
    }
}

module.exports = {
    clients,
    conversations,
    send,
    sendError,
    broadcastUserList,
    broadcastMemberUpdate,
    requireRegistered,
    handleRegister,
    handleCreateConversation,
    handleJoinConversation,
    handleLeaveConversation,
    handleSendMessage,
    handleStartDM
};