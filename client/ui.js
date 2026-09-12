import { state } from './state.js'

export const el = {
  loginScreen: document.getElementById('login-screen'),
  loginError: document.getElementById('login-error'),
  usernameInput: document.getElementById('username-input'),
  app: document.getElementById('app'),
  onlineUsersList: document.getElementById('online-users-list'),
  myChatsList: document.getElementById('my-chats-list'),
  activeTitle: document.getElementById('active-conversation-title'),
  activeMembers: document.getElementById('active-conversation-members'),
  leaveBtn: document.getElementById('leave-conversation-btn'),
  messageHistory: document.getElementById('message-history'),
  messageForm: document.getElementById('message-input-form'),
  messageInput: document.getElementById('message-input'),
};

export function renderLoginError(message) {
  el.loginError.textContent = message || '';
}

export function renderLoggedIn() {
  el.loginScreen.classList.add('is-hidden');
  el.app.classList.remove('is-hidden');
}

export function renderOnlineUsers(users, onlineUsersSet) {
  el.onlineUsersList.innerHTML = '';
  const safeUsers = Array.isArray(users) ? users : [];
  const safeSet = onlineUsersSet instanceof Set ? onlineUsersSet : new Set();
  for (const user of safeUsers) {
    const li = document.createElement('li');
    const isOnline = safeSet.has(user);
    li.innerHTML = `<span class="status-dot ${isOnline ? 'online' : 'offline'}"></span> ${user} ${user === window.state.username ? 'you' : ''}`;
    li.className = 'user-list-item';
    li.dataset.username = user;
    li.addEventListener('click', () => {
        if (user !== state.username) {
            window.send({ type: 'start_dm', targetUsername: user });
        }
    });
    el.onlineUsersList.appendChild(li);
  }
}

export function renderMyChats() {
  el.myChatsList.innerHTML = '';

  for (const [conversationId, convo] of state.conversations) {
    const li = document.createElement('li');
    const unread = window.state.unreadCounts.get(conversationId) || 0;
    const badge = unread > 0 ? `<span class="unread-badge">${unread}</span>` : '';

    let chatName = "Group Chat";

    if (convo.members.length === 2) {
      chatName = convo.members.find(m => m !== state.username) || "Unknown";
    }

    li.innerHTML = `<span>${chatName}</span> ${badge}`
    li.className = conversationId === state.activeConversationId ? 'chat-item active' : 'chat-item';

    li.addEventListener('click', () => window.setActiveConversation(conversationId));
    el.myChatsList.appendChild(li);
  }
}


export function renderActiveConversation() {
  const id = state.activeConversationId;
  if (!id) {
    el.activeTitle.textContent = 'Select chat';
    el.activeMembers.textContent = '';
    el.leaveBtn.classList.add('is-hidden');
    el.messageHistory.innerHTML = '<div class="has-text-centered has-text-grey mt-5">Select a user or chat to start messaging</div>';
    return;
  }

  const convo = state.conversations.get(id);

  if (convo.members.length === 2) {
    el.activeTitle.textContent = convo.members.find(m => m !== state.username) || "Unknown";
  } else {
    el.activeTitle.textContent = "Group Chat";
  }

  el.activeMembers.textContent = `Members: ${convo.members.join(', ')}`;
  el.leaveBtn.classList.remove('is-hidden');

  el.messageHistory.innerHTML = '';
  for (const msg of convo.messages) {
    const div = document.createElement('div');
    div.className = `message ${msg.senderId === state.username ? 'message-sent' : 'message-received'}`;
    const timestamp = msg.createdAt || msg.created_at;
    
    div.innerHTML = `
      <span class="sender">${msg.senderId}</span>
      <span class="time">${new Date(timestamp).toLocaleTimeString()}</span>
      <div class="content"></div>
    `;
    div.querySelector('.content').textContent = msg.content;
    el.messageHistory.appendChild(div);
  }
  el.messageHistory.scrollTop = el.messageHistory.scrollHeight;
}


export function renderAll() {
  renderOnlineUsers();
  renderMyChats();
  renderActiveConversation();
}