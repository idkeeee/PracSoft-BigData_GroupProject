import { state, removeConversation } from './state.js';
import { el, renderLoginError, renderAll, renderGroupModal } from './ui.js';
import { connect, send, setActiveConversation } from './network.js';

window.state = state;
window.send = send;
window.setActiveConversation = setActiveConversation;

document.getElementById('connect-btn').addEventListener('click', () => {
  const username = el.usernameInput.value.trim();
  if (!username) {
    renderLoginError('Please enter a username.');
    return;
  }
  renderLoginError('');
  connect(username);
});

// ✅ OPEN MODAL: Add 'is-active'
document.getElementById('new-group-chat-btn').addEventListener('click', () => {
  renderGroupModal(window.allUsers || []);
  el.groupModal.classList.add('is-active');
});

// ✅ CLOSE MODAL: Remove 'is-active'
document.getElementById('close-modal-btn').addEventListener('click', () => {
  el.groupModal.classList.remove('is-active');
});

document.getElementById('cancel-modal-btn').addEventListener('click', () => {
  el.groupModal.classList.remove('is-active');
});

document.getElementById('modal-background').addEventListener('click', () => {
  el.groupModal.classList.remove('is-active');
});

// ✅ CREATE GROUP & CLOSE MODAL
document.getElementById('confirm-group-btn').addEventListener('click', () => {
  const checkboxes = el.groupMemberList.querySelectorAll('input[type="checkbox"]:checked');
  const selectedUsers = Array.from(checkboxes).map(cb => cb.value);
  
  if (selectedUsers.length === 0) {
    alert('Please select at least one member.');
    return;
  }

  // Send request to create group with selected users
  send({ type: 'create_group', members: selectedUsers });
  
  // Close the modal by removing 'is-active'
  el.groupModal.classList.remove('is-active');
});

el.leaveBtn.addEventListener('click', () => {
  const id = state.activeConversationId;
  if (!id) return;
  send({ type: 'leave_conversation', conversationId: id });
  removeConversation(id);
  renderAll();
});

el.messageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const content = el.messageInput.value.trim();
  const conversationId = state.activeConversationId;
  if (!content || !conversationId) return;
  send({ type: 'send_message', conversationId, content });
  el.messageInput.value = '';
});