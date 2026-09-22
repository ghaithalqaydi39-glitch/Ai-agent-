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

// Persistent storage file path
const DB_FILE = path.join(__dirname, 'users.json');

// Load users from disk or initialize empty database
function loadUsers() {
    try {
        if (fs.existsSync(DB_FILE)) {
            const data = fs.readFileSync(DB_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (err) {
        console.error('Error reading users database:', err);
    }
    return {};
}

// Save users to disk
function saveUsers(usersData) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(usersData, null, 2), 'utf8');
    } catch (err) {
        console.error('Error writing users database:', err);
    }
}

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// SIGN UP
app.post('/api/signup', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
    
    const users = loadUsers();
    if (users[username]) return res.status(400).json({ error: 'Username already exists' });

    users[username] = { password, status: 'active', warnings: [] };
    saveUsers(users);
    
    res.json({ message: 'Account created successfully! You can now sign in.' });
});

// SIGN IN
app.post('/api/signin', (req, res) => {
    const { username, password } = req.body;
    const users = loadUsers();
    const user = users[username];

    if (!user) return res.status(400).json({ error: 'Account not found' });
    if (user.status === 'banned') return res.status(403).json({ error: 'This account has been banned by an administrator.' });
    
    if (user.status === 'kicked') {
        user.status = 'active';
        saveUsers(users);
    }
    
    if (user.password !== password) return res.status(400).json({ error: 'Incorrect password' });

    res.json({ message: 'Signed in successfully', username });
});

// OWNER ADMIN: View Users
app.post('/api/admin/users', (req, res) => {
    const { ownerSecret } = req.body;
    if (ownerSecret !== OWNER_SECRET) return res.status(403).json({ error: 'Unauthorized: Invalid owner secret' });

    const users = loadUsers();
    const simplifiedUsers = {};
    for (let u in users) {
        simplifiedUsers[u] = {
            password: users[u].password,
            status: users[u].status,
            warnings: users[u].warnings
        };
    }
    res.json({ users: simplifiedUsers });
});

// OWNER ADMIN: Moderate User
app.post('/api/admin/moderate', (req, res) => {
    const { ownerSecret, username, action, message } = req.body;
    if (ownerSecret !== OWNER_SECRET) return res.status(403).json({ error: 'Unauthorized' });

    const users = loadUsers();
    if (!users[username]) return res.status(404).json({ error: 'User not found' });

    if (action === 'warn') {
        users[username].warnings.push(message || 'Violation of terms');
    } else if (action === 'kick') {
        users[username].status = 'kicked';
    } else if (action === 'ban') {
        users[username].status = 'banned';
    } else if (action === 'unban') {
        users[username].status = 'active';
        users[username].warnings = [];
    } else {
        return res.status(400).json({ error: 'Invalid moderation action' });
    }

    saveUsers(users);
    res.json({ message: `Successfully applied ${action} to ${username}` });
});

// Helper function to retry fetch
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

// CHAT ENDPOINT
app.post('/api/chat', async (req, res) => {
    try {
        const { prompt, username } = req.body;
        const users = loadUsers();
        
        if (username && users[username]) {
            if (users[username].status === 'banned') return res.status(403).json({ error: 'Your account is banned.' });
            if (users[username].status === 'kicked') return res.status(403).json({ error: 'You have been temporarily kicked.' });
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
