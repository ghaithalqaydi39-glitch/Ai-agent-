const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.AI_API_KEY;
const OWNER_SECRET = process.env.OWNER_SECRET || 'HiddenPulse-Secret-key';

const DB_FILE = path.join(__dirname, 'users.json');
const LOGS_FILE = path.join(__dirname, 'logs.json');

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
    users[userId] = { id: userId, username, password, status: 'active', muted: false, warnings: [] };
    saveData(DB_FILE, users);
    
    res.json({ message: `Account created successfully! ID: ${userId}` });
});

// SIGN IN
app.post('/api/signin', (req, res) => {
    const { username, password } = req.body;
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
    
    if (foundUser.status === 'kicked') {
        foundUser.status = 'active';
        saveData(DB_FILE, users);
    }
    
    if (foundUser.password !== password) return res.status(400).json({ error: 'Incorrect password' });

    res.json({ message: 'Signed in successfully', username: foundUser.username, userId: foundUser.id, muted: foundUser.muted });
});

// OWNER ADMIN: View Users and Logs
app.post('/api/admin/users', (req, res) => {
    const { ownerSecret } = req.body;
    if (ownerSecret !== OWNER_SECRET) return res.status(403).json({ error: 'Unauthorized: Invalid owner secret' });

    const users = loadData(DB_FILE, {});
    const logs = loadData(LOGS_FILE, []);
    res.json({ users, logs });
});

// OWNER ADMIN: 10 Advanced Moderation Tools Handler
app.post('/api/admin/moderate', (req, res) => {
    const { ownerSecret, userId, action, message } = req.body;
    if (ownerSecret !== OWNER_SECRET) return res.status(403).json({ error: 'Unauthorized' });

    const users = loadData(DB_FILE, {});
    if (action !== 'broadcast' && !users[userId]) return res.status(404).json({ error: 'User ID not found' });

    let actionResponseText = '';

    switch (action) {
        case 'warn': 
            users[userId].warnings.push(message || 'Violation of terms');
            actionResponseText = `Warned user ID ${userId}`;
            break;
        case 'kick': 
            users[userId].status = 'kicked';
            actionResponseText = `Kicked user ID ${userId}`;
            break;
        case 'ban': 
            users[userId].status = 'banned';
            actionResponseText = `Banned user ID ${userId}`;
            break;
        case 'unban': 
            users[userId].status = 'active';
            users[userId].warnings = [];
            actionResponseText = `Unbanned and cleared records for user ID ${userId}`;
            break;
        case 'mute': 
            users[userId].muted = true;
            actionResponseText = `Muted user ID ${userId}`;
            break;
        case 'unmute': 
            users[userId].muted = false;
            actionResponseText = `Unmuted user ID ${userId}`;
            break;
        case 'reset_password': 
            const tempPass = 'reset_' + Math.random().toString(36).substring(2, 8);
            users[userId].password = tempPass;
            actionResponseText = `Password reset to: ${tempPass}`;
            break;
        case 'clear_history': 
            actionResponseText = `Triggered chat history wipe for user ID ${userId}`;
            break;
        case 'delete_account': 
            delete users[userId];
            actionResponseText = `Permanently deleted account ID ${userId}`;
            break;
        case 'broadcast': 
            const logs = loadData(LOGS_FILE, []);
            logs.unshift({
                timestamp: new Date().toLocaleString(),
                username: 'SYSTEM BROADCAST',
                userId: 'ALL',
                action: 'Global Broadcast Sent',
                content: message || 'Notice from Owner'
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

// CHAT ENDPOINT WITH IN-CHAT WARNING BANNER
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

            // Check if there are active warnings
            if (user.warnings && user.warnings.length > 0) {
                const latestWarning = user.warnings[user.warnings.length - 1];
                user.warnings = []; // Clear after delivery
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
