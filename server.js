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

// HARDCODED MASTER ADMIN WITH 50+ PERMISSIONS & ULTIMATE SECURITY
const MASTER_ADMIN = {
    id: 'master_admin_root',
    username: 'MasterOwner',
    password: 'TheOwner_Gha@2014',
    role: 'master_admin',
    status: 'active',
    muted: false,
    warnings: [],
    permissions: Array.from({ length: 55 }, (_, i) => `perm_level_${i + 1}`) // 50+ Hardcoded Permissions
};

function loadData(file, defaultVal) {
    try {
        if (fs.existsSync(file)) {
            const data = fs.readFileSync(file, 'utf8');
            return JSON.parse(data);
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

// Ensure database always has the Master Admin embedded
function ensureMasterAccount() {
    const users = loadData(DB_FILE, {});
    users[MASTER_ADMIN.id] = MASTER_ADMIN;
    saveData(DB_FILE, users);
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
    
    res.json({ message: `Account created successfully! ID: ${userId}` });
});

// SIGN IN (Supports Master Admin & Regular Users)
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

    if (!foundUser) return res.status(400).json({ error: 'Account not found' });
    if (foundUser.status === 'banned') return res.status(403).json({ error: 'This account has been banned by an administrator.' });
    if (foundUser.password !== password) return res.status(400).json({ error: 'Incorrect password' });

    if (foundUser.status === 'kicked') {
        foundUser.status = 'active';
        saveData(DB_FILE, users);
    }

    res.json({ 
        message: 'Signed in successfully', 
        username: foundUser.username, 
        userId: foundUser.id, 
        role: foundUser.role,
        muted: foundUser.muted,
        permissionsCount: foundUser.permissions ? foundUser.permissions.length : 0
    });
});

// ADMIN PANEL: View Users and Logs (Protected by Master or Mod Role)
app.post('/api/admin/users', (req, res) => {
    const { userId } = req.body;
    const users = loadData(DB_FILE, {});
    
    if (!users[userId] || (users[userId].role !== 'master_admin' && users[userId].role !== 'moderator')) {
        return res.status(403).json({ error: 'Unauthorized: Admin or Moderator access required' });
    }

    const logs = loadData(LOGS_FILE, []);
    res.json({ users, logs, currentRole: users[userId].role });
});

// MODERATION ACTIONS (Master Admin can do all 10 tools + manage mods; Moderators have restricted privileges)
app.post('/api/admin/moderate', (req, res) => {
    const { adminId, targetUserId, action, message } = req.body;
    const users = loadData(DB_FILE, {});

    if (!users[adminId] || (users[adminId].role !== 'master_admin' && users[adminId].role !== 'moderator')) {
        return res.status(403).json({ error: 'Unauthorized action' });
    }

    const isAdmin = users[adminId].role === 'master_admin';

    // Only Master Admin can promote/demote moderators or delete accounts
    if ((action === 'promote_mod' || action === 'demote_mod' || action === 'delete_account') && !isAdmin) {
        return res.status(403).json({ error: 'Permission denied: Only the Master Admin can modify roles or delete accounts.' });
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
        case 'promote_mod':
            users[targetUserId].role = 'moderator';
            actionResponseText = `Promoted user ${users[targetUserId].username} to Moderator!`;
            break;
        case 'demote_mod':
            users[targetUserId].role = 'user';
            actionResponseText = `Demoted moderator ${users[targetUserId].username} back to regular User.`;
            break;
        case 'reset_password':
            const tempPass = 'reset_' + Math.random().toString(36).substring(2, 8);
            users[targetUserId].password = tempPass;
            actionResponseText = `Password reset to: ${tempPass}`;
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
                userId: adminId,
                action: 'Global Broadcast Sent',
                content: message || 'System Notice'
            });
            saveData(LOGS_FILE, logs);
            return res.json({ message: 'Global broadcast dispatched successfully!' });
        default:
            return res.status(400).json({ error: 'Invalid moderation action tool' });
    }

    saveData(DB_FILE, users);
    res.json({ message: actionResponseText });
});

async function fetchWithRetry(url, options, retries = 3, delay = 1500) {
    for (let i = 0; i < retries; i++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            options.signal = controller.signal;

            const response = await fetch(url, options);
            clearTimeout(timeoutId);
            const data = await response.json();
            
            if (data.error && data.error.code === 503 && i < retries - 1) {
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            return data;
        } catch (err) {
            if (i === retries - 1) throw err;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

// CHAT ENDPOINT WITH WARNING & BAN CHECK
app.post('/api/chat', async (req, res) => {
    try {
        const { prompt, userId } = req.body;
        const users = loadData(DB_FILE, {});
        
        if (userId && users[userId]) {
            const user = users[userId];
            
            if (user.status === 'banned' || user.status === 'kicked' || user.muted) {
                if (user.status === 'banned') return res.status(403).json({ error: 'Your account is banned.' });
                if (user.status === 'kicked') return res.status(403).json({ error: 'You have been temporarily kicked.' });
                if (user.muted) return res.status(403).json({ error: 'Your account is currently muted by an administrator.' });
            }

            if (user.warnings && user.warnings.length > 0) {
                const latestWarning = user.warnings[user.warnings.length - 1];
                user.warnings = []; 
                saveData(DB_FILE, users);
                
                return res.status(200).json({ 
                    warningPopup: true, 
                    message: `⚠️ OFFICIAL WARNING FROM ADMINISTRATOR:\n\n"${latestWarning}"` 
                });
            }
        }

        if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${API_KEY}`;
        const options = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        };

        const data = await fetchWithRetry(url, options);
        if (data.error) return res.status(500).json({ error: data.error.message || 'AI service error' });

        const aiReply = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response from agent.";
        res.json({ reply: aiReply });
    } catch (error) {
        res.status(500).json({ error: 'AI service timed out or failed to respond.' });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
