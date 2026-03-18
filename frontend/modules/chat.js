import { state } from './state.js';
import { ui } from './ui.js';

function appendMessageElement(message) {
  const div = document.createElement('div');
  div.className = 'chat-msg';

  const name = document.createElement('span');
  name.className = 'chat-name';
  if (message.team === 'red' || message.team === 'blue') {
    name.classList.add(message.team);
  }
  name.textContent = message.name;

  const text = document.createElement('span');
  text.className = 'chat-text';
  text.textContent = message.text;

  div.appendChild(name);
  div.appendChild(text);
  ui.chatMessages.appendChild(div);
}

export function renderChatHistory() {
  if (!ui.chatMessages) return;
  ui.chatMessages.innerHTML = '';
  for (const message of state.chatMessages) {
    appendMessageElement(message);
  }
  ui.chatMessages.scrollTop = ui.chatMessages.scrollHeight;
}

export function renderChatMessage(message) {
  if (!ui.chatMessages) return;
  appendMessageElement(message);
  ui.chatMessages.scrollTop = ui.chatMessages.scrollHeight;
}
