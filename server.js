const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.AI_API_KEY;

const DB_FILE = path.join(__dirname, 'users.json');
const LOGS_FILE = path.join(__dirname, 'logs.json');

const MASTER_ADMIN = {
    id: 'master_admin_root',
    username: 'MasterOwner',
    password: 'SuperSecureMasterPassword123!',
    role: 'administrator',
    status: 'active',
    muted: false,
    warnings: []
};

function loadData(file, defaultVal) {
    try {
        if (fs.existsSync(file)) {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        }
    } catch (err) {
        console.error(`Error reading ${file}:`, err);
    }
    return defaultVal;
}

function saveData(file, data) {
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
        console.error(`Error writing ${file}:`, err);
    }
}

function ensureMasterAccount() {
    const users = loadData(DB_FILE, {});
    if (!users[MASTER_ADMIN.id]) {
        users[MASTER_ADMIN.id] = MASTER_ADMIN;
        saveData(DB_FILE, users);
    }
}
ensureMasterAccount();

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// SIGN UP
app.post('/api/signup', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
    
    const users = loadData(DB_FILE, {});
    for (let id in users) {
        if (users[id].username === username) {
            return res.status(400).json({ error: 'Username already exists' });
        }
    }

    const userId = 'usr_' + Date.now() + Math.random().toString(36).substring(2, 6);
    users[userId] = { id: userId, username, password, role: 'user', status: 'active', muted: false, warnings: [] };
    saveData(DB_FILE, users);
    
    res.json({ message: `Account created successfully via signup/servicename.onrender.com!` });
});

// SIGN IN
app.post('/api/signin', (req, res) => {
    const { username, password } = req.body;
    ensureMasterAccount();
    const users = loadData(DB_FILE, {});
    
    let foundUser = null;
    for (let id in users) {
        if (users[id].username === username) {
            foundUser = users[id];
            break;
        }
    }

    if (!foundUser) return res.status(400).json({ error: 'Account not found. Please sign up first.' });
    if (foundUser.status === 'banned') return res.status(403).json({ error: 'This account has been banned.' });
    if (foundUser.password !== password) return res.status(400).json({ error: 'Incorrect password' });

    res.json({ 
        message: 'Signed in successfully', 
        username: foundUser.username, 
        userId: foundUser.id, 
        role: foundUser.role,
        muted: foundUser.muted
    });
});

// ADMIN PANEL DATA
app.post('/api/admin/users', (req, res) => {
    const { userId } = req.body;
    const users = loadData(DB_FILE, {});
    
    if (!users[userId] || (users[userId].role !== 'administrator' && users[userId].role !== 'moderator')) {
        return res.status(403).json({ error: 'Unauthorized: Admin or Moderator access required' });
    }

    const logs = loadData(LOGS_FILE, []);
    res.json({ users, logs, currentRole: users[userId].role });
});

// MODERATION ACTIONS & ROLE UPDATES
app.post('/api/admin/moderate', (req, res) => {
    const { adminId, targetUserId, action, message, newRole } = req.body;
    const users = loadData(DB_FILE, {});

    if (!users[adminId] || (users[adminId].role !== 'administrator' && users[adminId].role !== 'moderator')) {
        return res.status(403).json({ error: 'Unauthorized action' });
    }

    const isAdmin = users[adminId].role === 'administrator';

    if ((action === 'change_role' || action === 'delete_account') && !isAdmin) {
        return res.status(403).json({ error: 'Permission denied: Only administrators can modify roles or delete accounts.' });
    }

    if (action !== 'broadcast' && !users[targetUserId]) return res.status(404).json({ error: 'Target user ID not found' });

    let actionResponseText = '';

    switch (action) {
        case 'warn':
            users[targetUserId].warnings.push(message || 'Violation of terms');
            actionResponseText = `Warned user ID ${targetUserId}`;
            break;
        case 'kick':
            users[targetUserId].status = 'kicked';
            actionResponseText = `Kicked user ID ${targetUserId}`;
            break;
        case 'ban':
            users[targetUserId].status = 'banned';
            actionResponseText = `Banned user ID ${targetUserId}`;
            break;
        case 'unban':
            users[targetUserId].status = 'active';
            users[targetUserId].warnings = [];
            actionResponseText = `Unbanned user ID ${targetUserId}`;
            break;
        case 'mute':
            users[targetUserId].muted = true;
            actionResponseText = `Muted user ID ${targetUserId}`;
            break;
        case 'unmute':
            users[targetUserId].muted = false;
            actionResponseText = `Unmuted user ID ${targetUserId}`;
            break;
        case 'change_role':
            if (targetUserId === MASTER_ADMIN.id) return res.status(400).json({ error: 'Cannot change Master Admin role' });
            if (!['user', 'moderator', 'administrator'].includes(newRole)) return res.status(400).json({ error: 'Invalid role selection' });
            users[targetUserId].role = newRole;
            actionResponseText = `Updated user ${users[targetUserId].username}'s role to ${newRole}!`;
            break;
        case 'delete_account':
            if (targetUserId === MASTER_ADMIN.id) return res.status(400).json({ error: 'Cannot delete Master Admin' });
            delete users[targetUserId];
            actionResponseText = `Permanently deleted account ID ${targetUserId}`;
            break;
        case 'broadcast':
            const logs = loadData(LOGS_FILE, []);
            logs.unshift({
                timestamp: new Date().toLocaleString(),
                username: users[adminId].username,
                action: 'Global Broadcast Sent',
                content: message || 'System Notice'
            });
            saveData(LOGS_FILE, logs);
            return res.json({ message: 'Global broadcast dispatched successfully!' });
        default:
            return res.status(400).json({ error: 'Invalid action' });
    }

    saveData(DB_FILE, users);
    res.json({ message: actionResponseText });
});

// CHAT ENDPOINT WITH SIGNUP CHECK
app.post('/api/chat', async (req, res) => {
    try {
        const { prompt, userId } = req.body;
        const users = loadData(DB_FILE, {});
        
        if (!userId || !users[userId]) {
            return res.status(401).json({ error: 'Access Denied: You must sign up via signup/servicename.onrender.com to use the AI chat.' });
        }

        const user = users[userId];
        if (user.status === 'banned' || user.status === 'kicked' || user.muted) {
            return res.status(403).json({ error: 'Your account is restricted or banned from using the AI.' });
        }

        if (user.warnings && user.warnings.length > 0) {
            const latestWarning = user.warnings[user.warnings.length - 1];
            user.warnings = []; 
            saveData(DB_FILE, users);
            return res.status(200).json({ warningPopup: true, message: `⚠️ WARNING:\n\n"${latestWarning}"` });
        }

        if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });

        const data = await response.json();
        if (data.error) return res.status(500).json({ error: data.error.message || 'AI service error' });

        const aiReply = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response generated.";
        res.json({ reply: aiReply });
    } catch (error) {
        res.status(500).json({ error: 'AI service timed out or failed to respond.' });
    }
});

app.listen(PORT, () => console.log(`🚀 Server running dynamically on port ${PORT}`));
