export const el = {
  loginScreen: document.getElementById('login-screen'),
  loginError: document.getElementById('login-error'),
  usernameInput: document.getElementById('username-input'),
  app: document.getElementById('app'),
  onlineUsersList: document.getElementById('online-users-list'),
  conversationTabs: document.getElementById('conversation-tabs'),
  activeTitle: document.getElementById('active-conversation-title'),
  activeMembers: document.getElementById('active-conversation-members'),
  leaveBtn: document.getElementById('leave-conversation-btn'),
  messageHistory: document.getElementById('message-history'),
  messageForm: document.getElementById('message-input-form'),
  messageInput: document.getElementById('message-input'),
  joinInput: document.getElementById('join-conversation-input'),
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
        if (user !== window.state.username) {
            window.send({ type: 'start_dm', targetUsername: user });
        }
    });
    el.onlineUsersList.appendChild(li);
  }
}

export function renderConversationTabs() {
  el.conversationTabs.innerHTML = '';
  for (const [conversationId, convo] of window.state.conversations) {
    const li = document.createElement('li');
    const unread = window.state.unreadCounts.get(conversationId) || 0;
    const badge = unread > 0 ? `<span class="unread-badge">${unread}</span>` : '';
    
    li.innerHTML = `Conversation ${conversationId.substring(0, 8)}... ${badge}`;
    li.className = conversationId === window.state.activeConversationId ? 'tab active' : 'tab';
    li.addEventListener('click', () => window.setActiveConversation(conversationId));
    el.conversationTabs.appendChild(li);
  }
}

export function renderActiveConversation() {
  const id = window.state.activeConversationId;
  if (!id) {
    el.activeTitle.textContent = 'No conversation selected';
    el.activeMembers.textContent = '';
    el.leaveBtn.classList.add('is-hidden');
    el.messageHistory.innerHTML = '';
    return;
  }

  const convo = window.state.conversations.get(id)
  el.activeTitle.textContent = `Conversation ${id.substring(0, 8)}...`;
  el.activeMembers.textContent = `Members: ${convo.members.join(', ')}`;
  el.leaveBtn.classList.remove('is-hidden');

  el.messageHistory.innerHTML = '';
  for (const msg of convo.messages) {
    const div = document.createElement('div');
    div.className = 'message';
    const sender = msg.senderId || msg.sender_id;
    const timestamp = msg.createdAt || msg.created_at;
    div.innerHTML = `<span class="sender">${sender}</span>
                      <span class="time">${new Date(timestamp).toLocaleTimeString()}</span>
                      <div class="content"></div>`;
    div.querySelector('.content').textContent = msg.content;
    el.messageHistory.appendChild(div);
  }
  el.messageHistory.scrollTop = el.messageHistory.scrollHeight;
}

export function renderAll() {
  renderOnlineUsers();
  renderConversationTabs();
  renderActiveConversation();
}