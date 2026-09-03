let ws;
let currentUsername;

document.getElementById('connect-btn').addEventListener('click', connectToServer);
document.getElementById('send-btn').addEventListener('click', sendMessage);

function connectToServer() {
    const username = document.getElementById('username-input').value;
    const serverAddress = document.getElementById('server-input').value;
    
    if (!username) {
        alert('Please enter a username');
        return;
    }

    const wsUrl = `ws://${serverAddress}`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        currentUsername = username;
        ws.send(JSON.stringify({ type: 'register', username: username }));
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleMessage(data);
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        alert('Connection failed');
    };

    ws.onclose = () => {
        alert('Disconnected from server');
        location.reload();
    };
}

function handleMessage(data) {
    switch(data.type) {
        case 'registered':
            document.getElementById('login-screen').style.display = 'none';
            document.getElementById('chat-screen').style.display = 'flex';
            break;
        case 'error':
            alert(data.message);
            break;
        case 'userList':
            updateUserList(data.users);
            break;
        case 'message':
            displayMessage(data.from, data.message, data.timestamp);
            break;
    }
}

function sendMessage() {
    const input = document.getElementById('message-input');
    const message = input.value;
    
    if (message && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'message',
            to: 'broadcast', // or specific username
            message: message
        }));
        input.value = '';
    }
}

function updateUserList(users) {
    const list = document.getElementById('user-list');
    list.innerHTML = '';
    users.forEach(username => {
        const li = document.createElement('li');
        li.textContent = username;
        list.appendChild(li);
    });
}

function displayMessage(from, message, timestamp) {
    const messagesDiv = document.getElementById('messages');
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message';
    msgDiv.innerHTML = `<strong>${from}</strong>: ${message}`;
    messagesDiv.appendChild(msgDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}