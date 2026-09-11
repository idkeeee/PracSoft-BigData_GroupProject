import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

import {
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
} from '../supabase_config.js';

import {
    state,
    addOrUpdateConversation,
    appendMessage,
    removeConversation,
    incrementUnread,
    clearUnread
} from './state.js';

import {
    renderLoginError,
    renderLoggedIn,
    renderOnlineUsers,
    renderConversationTabs,
    renderActiveConversation,
    renderAll
} from './ui.js';


const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
);

let currentUserId = null;

let messageChannel = null;
let membershipChannel = null;
let presenceChannel = null;


// --------------------------------------------------
// LOGIN / CONNECTION
// --------------------------------------------------

export async function connect(username) {
    try {
        renderLoginError('');

        // Get existing anonymous login if browser already has one
        let {
            data: { session }
        } = await supabase.auth.getSession();

        // Otherwise create anonymous Supabase Auth account
        if (!session) {
            const { data, error } =
                await supabase.auth.signInAnonymously();

            if (error) throw error;

            session = data.session;
        }

        const authUserId = session.user.id;

        // Does this browser already own a public.users profile?
        let { data: profile, error: profileError } =
            await supabase
                .from('users')
                .select('id, username, auth_id')
                .eq('auth_id', authUserId)
                .maybeSingle();

        if (profileError) throw profileError;

        // No profile yet
        if (!profile) {

            // Check whether username is already taken
            const { data: existingUser, error: existingError } =
                await supabase
                    .from('users')
                    .select('id, username')
                    .eq('username', username)
                    .maybeSingle();

            if (existingError) throw existingError;

            if (existingUser) {
                renderLoginError(
                    'That username already exists. Choose another username.'
                );
                return;
            }

            // auth_id is automatically filled by the DB default we created
            const { data: newProfile, error: insertError } =
                await supabase
                    .from('users')
                    .insert({
                        username: username
                    })
                    .select('id, username, auth_id')
                    .single();

            if (insertError) throw insertError;

            profile = newProfile;
        }

        currentUserId = profile.id;
        state.username = profile.username;

        renderLoggedIn();

        await loadAllUsers();
        await loadMyConversations();

        setupRealtime();
        await setupPresence();

        renderAll();

    } catch (error) {
        console.error(error);
        renderLoginError(
            error.message || 'Failed to connect to Supabase.'
        );
    }
}


// --------------------------------------------------
// SEND COMMANDS
// Keeps your existing client.js mostly unchanged
// --------------------------------------------------

export async function send(payload) {
    try {
        switch (payload.type) {

            case 'create_conversation':
                await createConversation();
                break;

            case 'join_conversation':
                await joinConversation(payload.conversationId);
                break;

            case 'leave_conversation':
                await leaveConversation(payload.conversationId);
                break;

            case 'send_message':
                await sendMessage(
                    payload.conversationId,
                    payload.content
                );
                break;

            case 'start_dm':
                await startDM(payload.targetUsername);
                break;

            default:
                console.warn(
                    'Unknown local command:',
                    payload.type
                );
        }

    } catch (error) {
        console.error(error);
        alert(error.message || 'Something went wrong.');
    }
}


// --------------------------------------------------
// USERS
// --------------------------------------------------

async function loadAllUsers() {
    const { data, error } =
        await supabase
            .from('users')
            .select('username')
            .order('username');

    if (error) throw error;

    window.allUsers =
        (data || []).map(user => user.username);

    renderOnlineUsers(
        window.allUsers,
        state.onlineUsers
    );
}


// --------------------------------------------------
// CONVERSATIONS
// --------------------------------------------------

async function loadMyConversations() {
    const { data, error } =
        await supabase
            .from('conversation_members')
            .select('conversation_id')
            .eq('user_id', currentUserId);

    if (error) throw error;

    const ids =
        (data || []).map(row => row.conversation_id);

    // Remove conversations we're no longer part of
    for (const id of [...state.conversations.keys()]) {
        if (!ids.includes(id)) {
            removeConversation(id);
        }
    }

    for (const id of ids) {
        await loadConversation(id);
    }

    renderConversationTabs();
    renderActiveConversation();
}


async function loadConversation(conversationId) {

    // Load members
    const { data: memberRows, error: memberError } =
        await supabase
            .from('conversation_members')
            .select(`
                user_id,
                users!user_id (
                    username
                )
            `)
            .eq('conversation_id', conversationId);

    if (memberError) throw memberError;

    const members =
        (memberRows || [])
            .map(row => row.users?.username)
            .filter(Boolean);


    // Load message history
    const { data: messages, error: messageError } =
        await supabase
            .from('messages')
            .select(`
                id,
                content,
                created_at,
                sender_id,
                users!sender_id (
                    username
                )
            `)
            .eq('conversation_id', conversationId)
            .order('created_at', {
                ascending: true
            });

    if (messageError) throw messageError;

    const formattedMessages =
        (messages || []).map(message => ({
            id: message.id,
            senderId:
                message.users?.username || 'Unknown',
            sender_id: message.sender_id,
            content: message.content,
            created_at: message.created_at
        }));

    addOrUpdateConversation(
        conversationId,
        {
            members,
            messages: formattedMessages
        }
    );
}


async function createConversation() {

    const { data: conversation, error } =
        await supabase
            .from('conversations')
            .insert({})
            .select('id')
            .single();

    if (error) throw error;

    const conversationId = conversation.id;

    const { error: memberError } =
        await supabase
            .from('conversation_members')
            .insert({
                conversation_id: conversationId,
                user_id: currentUserId
            });

    if (memberError) throw memberError;

    await loadConversation(conversationId);

    setActiveConversation(conversationId);
}


async function joinConversation(conversationId) {

    if (!conversationId) return;

    const { error } =
        await supabase
            .from('conversation_members')
            .upsert(
                {
                    conversation_id: conversationId,
                    user_id: currentUserId
                },
                {
                    onConflict:
                        'conversation_id,user_id'
                }
            );

    if (error) throw error;

    await loadConversation(conversationId);

    setActiveConversation(conversationId);
}


async function leaveConversation(conversationId) {

    if (!conversationId) return;

    const { error } =
        await supabase
            .from('conversation_members')
            .delete()
            .eq(
                'conversation_id',
                conversationId
            )
            .eq(
                'user_id',
                currentUserId
            );

    if (error) throw error;

    removeConversation(conversationId);

    renderConversationTabs();
    renderActiveConversation();
}


// --------------------------------------------------
// MESSAGES
// --------------------------------------------------

async function sendMessage(conversationId, content) {

    const cleanMessage = content.trim();

    if (!cleanMessage) return;

    if (cleanMessage.length > 512) {
        alert(
            'Message cannot be longer than 512 characters.'
        );
        return;
    }

    const { error } =
        await supabase
            .from('messages')
            .insert({
                conversation_id: conversationId,
                sender_id: currentUserId,
                content: cleanMessage
            });

    if (error) throw error;

    // We do NOT manually append here.
    // Supabase Realtime will send the new message back.
}


// --------------------------------------------------
// DIRECT MESSAGES
// --------------------------------------------------

async function startDM(targetUsername) {

    if (
        !targetUsername ||
        targetUsername === state.username
    ) {
        return;
    }

    const { data: target, error: targetError } =
        await supabase
            .from('users')
            .select('id, username')
            .eq('username', targetUsername)
            .single();

    if (targetError) throw targetError;


    // Conversations current user belongs to
    const { data: myMemberships, error } =
        await supabase
            .from('conversation_members')
            .select('conversation_id')
            .eq('user_id', currentUserId);

    if (error) throw error;


    // Look for an existing conversation containing
    // exactly these two users.
    for (const membership of myMemberships || []) {

        const conversationId =
            membership.conversation_id;

        const { data: members } =
            await supabase
                .from('conversation_members')
                .select('user_id')
                .eq(
                    'conversation_id',
                    conversationId
                );

        if (
            members?.length === 2 &&
            members.some(
                member =>
                    member.user_id === target.id
            )
        ) {
            await loadConversation(
                conversationId
            );

            setActiveConversation(
                conversationId
            );

            return;
        }
    }


    // No existing DM -> make one
    const { data: conversation, error: createError } =
        await supabase
            .from('conversations')
            .insert({})
            .select('id')
            .single();

    if (createError) throw createError;


    const conversationId =
        conversation.id;


    const { error: memberError } =
        await supabase
            .from('conversation_members')
            .insert([
                {
                    conversation_id: conversationId,
                    user_id: currentUserId
                },
                {
                    conversation_id: conversationId,
                    user_id: target.id
                }
            ]);

    if (memberError) throw memberError;

    await loadConversation(conversationId);

    setActiveConversation(conversationId);
}


// --------------------------------------------------
// REALTIME
// --------------------------------------------------

function setupRealtime() {

    if (messageChannel) {
        supabase.removeChannel(messageChannel);
    }

    if (membershipChannel) {
        supabase.removeChannel(membershipChannel);
    }


    // New messages
    messageChannel =
        supabase
            .channel('messages-realtime')
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'messages'
                },
                async payload => {

                    const row = payload.new;

                    // Ignore messages for conversations
                    // we do not currently know about
                    if (
                        !state.conversations.has(
                            row.conversation_id
                        )
                    ) {
                        return;
                    }

                    const { data: sender } =
                        await supabase
                            .from('users')
                            .select('username')
                            .eq(
                                'id',
                                row.sender_id
                            )
                            .single();

                    const message = {
                        id: row.id,
                        conversationId:
                            row.conversation_id,
                        senderId:
                            sender?.username ||
                            'Unknown',
                        sender_id:
                            row.sender_id,
                        content:
                            row.content,
                        created_at:
                            row.created_at
                    };

                    appendMessage(
                        row.conversation_id,
                        message
                    );

                    if (
                        row.conversation_id ===
                        state.activeConversationId
                    ) {
                        clearUnread(
                            row.conversation_id
                        );

                        renderActiveConversation();
                    } else {
                        incrementUnread(
                            row.conversation_id
                        );

                        renderConversationTabs();
                    }
                }
            )
            .subscribe();


    // User added/removed from a conversation
    membershipChannel =
        supabase
            .channel('memberships-realtime')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'conversation_members'
                },
                async () => {
                    await loadMyConversations();
                }
            )
            .subscribe();
}


// --------------------------------------------------
// ONLINE USERS - SUPABASE PRESENCE
// --------------------------------------------------

async function setupPresence() {

    presenceChannel =
        supabase.channel(
            'online-users',
            {
                config: {
                    presence: {
                        key: currentUserId
                    }
                }
            }
        );


    presenceChannel.on(
        'presence',
        {
            event: 'sync'
        },
        () => {

            const presenceState =
                presenceChannel.presenceState();

            const onlineNames = [];

            for (
                const entries
                of Object.values(presenceState)
            ) {
                for (const entry of entries) {
                    if (entry.username) {
                        onlineNames.push(
                            entry.username
                        );
                    }
                }
            }

            state.onlineUsers =
                new Set(onlineNames);


            // Include newly-online users in the list
            const combined =
                new Set([
                    ...(window.allUsers || []),
                    ...onlineNames
                ]);

            window.allUsers =
                [...combined];


            renderOnlineUsers(
                window.allUsers,
                state.onlineUsers
            );
        }
    );


    presenceChannel.subscribe(
        async status => {

            if (status === 'SUBSCRIBED') {

                await presenceChannel.track({
                    username: state.username,
                    online_at:
                        new Date().toISOString()
                });
            }
        }
    );
}


// --------------------------------------------------
// UI
// --------------------------------------------------

export function setActiveConversation(
    conversationId
) {
    state.activeConversationId =
        conversationId;

    clearUnread(conversationId);

    renderConversationTabs();
    renderActiveConversation();
}


// Kept only so your existing import doesn't break.
export function handleServerMessage() {}