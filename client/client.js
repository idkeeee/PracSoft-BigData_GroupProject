import { state, removeConversation } from './state.js';
import { el, renderLoginError, renderAll } from './ui.js';
import { connect, send, setActiveConversation, handleServerMessage } from './network.js';

window.state = state;
window.send = send;
window.setActiveConversation = setActiveConversation

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