const state = {
  username: null,
  onlineUsers: [],
  conversations: new Map(),
  activeConversationId: null,
};

function addOrUpdateConversation(conversationId, { members, messages }) {
  const existing = state.conversations.get(conversationId) || { members: [], messages: [] };
  state.conversations.set(conversationId, {
    members: members !== undefined ? members : existing.members,
    messages: messages !== undefined ? messages : existing.messages,
  });
}

function appendMessage(conversationId, message) {
  const convo = state.conversations.get(conversationId);
  if (!convo) return;
  convo.messages.push(message);
}

function removeConversation(conversationId) {
  state.conversations.delete(conversationId);
  if (state.activeConversationId === conversationId) {
    state.activeConversationId = null;
  }
}


const el = {
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

function renderLoginError(message) {
  el.loginError.textContent = message || '';
}

function renderLoggedIn() {
  el.loginScreen.classList.add('is-hidden');
  el.app.classList.remove('is-hidden');
}

function renderOnlineUsers() {
  el.onlineUsersList.innerHTML = '';
  for (const user of state.onlineUsers) {
    const li = document.createElement('li');
    li.textContent = user === state.username ? `${user} (you)` : user;
    el.onlineUsersList.appendChild(li);
  }
}

function renderConversationTabs() {
  el.conversationTabs.innerHTML = '';
  for (const [conversationId] of state.conversations) {
    const li = document.createElement('li');
    li.textContent = conversationId;
    li.className = conversationId === state.activeConversationId ? 'tab active' : 'tab';
    li.addEventListener('click', () => setActiveConversation(conversationId));
    el.conversationTabs.appendChild(li);
  }
}

function renderActiveConversation() {
  const id = state.activeConversationId;
  if (!id) {
    el.activeTitle.textContent = 'No conversation selected';
    el.activeMembers.textContent = '';
    el.leaveBtn.classList.add('is-hidden');
    el.messageHistory.innerHTML = '';
    return;
  }

  const convo = state.conversations.get(id);
  el.activeTitle.textContent = `Conversation ${id}`;
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

function renderAll() {
  renderOnlineUsers();
  renderConversationTabs();
  renderActiveConversation();
}


let ws = null;

function connect(username) {
  ws = new WebSocket(`ws://${window.location.host}`);

  ws.addEventListener('open', () => {
    send({ type: 'register', username });
  });

  ws.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);
    handleServerMessage(data);
  });

  ws.addEventListener('close', () => {
    renderLoginError('Disconnected from server.');
    el.app.classList.add('is-hidden');
    el.loginScreen.classList.remove('is-hidden');
  });

  ws.addEventListener('error', () => {
    renderLoginError('Connection error.');
  });
}

function send(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function handleServerMessage(data) {
  switch (data.type) {
    case 'registered':
      state.username = data.username;
      renderLoggedIn();
      renderAll();
      break;

    case 'error':
      if (!state.username) {
        renderLoginError(data.message);
      } else {
        alert(data.message);
      }
      break;

    case 'user_list':
      state.onlineUsers = data.users;
      renderOnlineUsers();
      break;
    
    case 'my_conversations':
      // Automatically join all past conversations to load their history
      for (const conversationId of data.conversationIds) {
        send({ type: 'join_conversation', conversationId });
      }
      break;

    case 'conversation_created':
      addOrUpdateConversation(data.conversationId, { members: [state.username], messages: [] });
      setActiveConversation(data.conversationId);
      break;

    case 'conversation_joined':
      addOrUpdateConversation(data.conversationId, {
        members: data.members,
        messages: data.history,
      });
      setActiveConversation(data.conversationId);
      break;

    case 'member_update':
      addOrUpdateConversation(data.conversationId, { members: data.members });
      renderConversationTabs();
      renderActiveConversation();
      break;

    case 'new_message':
      appendMessage(data.conversationId, data);
      if (data.conversationId === state.activeConversationId) {
        renderActiveConversation();
      }
      break;

    default:
      console.warn('Unhandled message type from server:', data.type);
  }
}

function setActiveConversation(conversationId) {
  state.activeConversationId = conversationId;
  renderConversationTabs();
  renderActiveConversation();
}


document.getElementById('connect-btn').addEventListener('click', () => {
  const username = el.usernameInput.value.trim();
  if (!username) {
    renderLoginError('Please enter a username.');
    return;
  }
  renderLoginError('');
  connect(username);
});

document.getElementById('new-conversation-btn').addEventListener('click', () => {
  send({ type: 'create_conversation' });
});

document.getElementById('join-conversation-btn').addEventListener('click', () => {
  const conversationId = el.joinInput.value.trim();
  if (!conversationId) return;
  send({ type: 'join_conversation', conversationId });
  el.joinInput.value = '';
});

el.leaveBtn.addEventListener('click', () => {
  const id = state.activeConversationId;
  if (!id) return;
  send({ type: 'leave_conversation', conversationId: id });
  removeConversation(id);
  renderConversationTabs();
  renderActiveConversation();
});

el.messageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const content = el.messageInput.value.trim();
  const conversationId = state.activeConversationId;
  if (!content || !conversationId) return;
  send({ type: 'send_message', conversationId, content });
  el.messageInput.value = '';
});