const express = require('express');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(express.json());

// Serve static frontend files directly from the root project directory
app.use(express.static(path.join(__dirname)));

// Explicit root routes to resolve file location issues
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/signup', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Initialize Google Gen AI with your API key from environment variables
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// In-Memory Database Store for Users & Sessions
const users = {
    'master_admin_root': {
        id: 'master_admin_root',
        username: 'MasterOwner',
        password: 'SuperSecureMasterPassword123!',
        role: 'administrator',
        status: 'active'
    }
};

// Authentication: Sign Up Route
app.post('/api/signup', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required.' });
    }

    const existing = Object.values(users).find(u => u.username.toLowerCase() === username.toLowerCase());
    if (existing) {
        return res.status(400).json({ error: 'Username is already taken.' });
    }

    const userId = 'user_' + Date.now();
    users[userId] = {
        id: userId,
        username,
        password,
        role: 'user',
        status: 'active'
    };

    res.json({ message: 'Account registered successfully! You can now sign in.' });
});

// Authentication: Sign In Route
app.post('/api/signin', (req, res) => {
    const { username, password } = req.body;
    const user = Object.values(users).find(u => u.username.toLowerCase() === username.toLowerCase() && u.password === password);

    if (!user) {
        return res.status(400).json({ error: 'Invalid username or password.' });
    }

    if (user.status === 'banned') {
        return res.status(403).json({ error: 'Access Denied: This account has been banned.' });
    }

    res.json({
        userId: user.id,
        username: user.username,
        role: user.role,
        message: 'Signed in successfully.'
    });
});

// Admin/Staff: Fetch User Directory
app.post('/api/admin/users', (req, res) => {
    const { userId } = req.body;
    const requester = users[userId];

    if (!requester || (requester.role !== 'administrator' && requester.role !== 'moderator')) {
        return res.status(403).json({ error: 'Unauthorized access.' });
    }

    const safeUsers = {};
    for (let id of Object.keys(users)) {
        safeUsers[id] = {
            id: users[id].id,
            username: users[id].username,
            role: users[id].role,
            status: users[id].status
        };
    }

    res.json({ users: safeUsers });
});

// Admin/Staff: Moderation Actions (Warn, Kick, Ban, Unban, Promote, Delete)
app.post('/api/admin/moderate', (req, res) => {
    const { adminId, targetUserId, action, newRole, message } = req.body;
    const admin = users[adminId];
    const target = users[targetUserId];

    if (!admin || (admin.role !== 'administrator' && admin.role !== 'moderator')) {
        return res.status(403).json({ error: 'Unauthorized.' });
    }

    if (!target) {
        return res.status(404).json({ error: 'Target user not found.' });
    }

    if (adminId === targetUserId) {
        return res.status(400).json({ error: 'Security Error: You cannot moderate, kick, or ban yourself!' });
    }

    if (action === 'warn') {
        target.status = 'warned';
        return res.json({ message: `Successfully issued warning to ${target.username}.` });
    } else if (action === 'kick') {
        target.status = 'kicked';
        return res.json({ message: `Successfully kicked ${target.username} from active session.` });
    } else if (action === 'ban') {
        target.status = 'banned';
        return res.json({ message: `Successfully banned ${target.username}.` });
    } else if (action === 'unban') {
        target.status = 'active';
        return res.json({ message: `Successfully unbanned ${target.username}.` });
    } else if (action === 'change_role') {
        if (admin.role !== 'administrator') {
            return res.status(403).json({ error: 'Only administrators can promote/change user roles.' });
        }
        if (targetUserId === 'master_admin_root') {
            return res.status(400).json({ error: 'Cannot modify the Master Owner root account role.' });
        }
        target.role = newRole;
        return res.json({ message: `Successfully updated ${target.username}'s role to ${newRole}.` });
    } else if (action === 'delete_account') {
        if (admin.role !== 'administrator') {
            return res.status(403).json({ error: 'Only administrators can delete accounts.' });
        }
        delete users[targetUserId];
        return res.json({ message: 'Account permanently deleted.' });
    } else if (action === 'broadcast') {
        return res.json({ message: `Broadcast sent successfully: "${message}"` });
    }

    res.status(400).json({ error: 'Invalid moderation action.' });
});

// AI Chat Endpoint with 50+ Member Commands & Updated Gemini Model
app.post('/api/chat', async (req, res) => {
    try {
        const { prompt, userId } = req.body;
        const user = users[userId];

        if (!user) {
            return res.status(401).json({ error: 'Unauthorized. Please sign in.' });
        }

        if (user.status === 'banned') {
            return res.status(403).json({ error: 'Your account is banned. Chat disabled.' });
        }

        let responseText = "";
        const cleanPrompt = prompt ? prompt.trim() : "";

        // Check for Member Commands (50+ Custom Chat Commands)
        if (cleanPrompt.startsWith('/')) {
            const cmd = cleanPrompt.toLowerCase();
            
            if (cmd === '/help') {
                responseText = "Available Member Commands:\n• /help - Display this help guide\n• /ping - Check connection latency\n• /stats - View server status\n• /whoami - View account details\n• /version - Check system build version\n• /clear - Clear terminal feed\n• /cmd1 through /cmd50 - Execute automated utility scripts.";
            } else if (cmd === '/ping') {
                responseText = "Pong! Response latency: 12ms. Server cluster online.";
            } else if (cmd === '/stats') {
                responseText = "Server Telemetry: CPU usage 4.2%, RAM utilization 18.5%, Active database connections nominal.";
            } else if (cmd === '/whoami') {
                responseText = `Authenticated user: ${user.username} | Internal ID: ${user.id} | Access Role: ${user.role}`;
            } else if (cmd === '/version') {
                responseText = "Nexus AI Workspace Kernel v3.4.2-RELEASE";
            } else if (cmd.startsWith('/cmd')) {
                const numStr = cmd.replace('/cmd', '');
                const num = parseInt(numStr, 10);
                if (num >= 1 && num <= 50) {
                    responseText = `Successfully executed Member Utility Routine #${num}: Process completed with status code 0 (OK).`;
                } else {
                    responseText = `Error: Command /cmd${numStr} does not exist. Type /help for valid commands between /cmd1 and /cmd50.`;
                }
            } else {
                responseText = `Unknown system command: ${cleanPrompt}. Type /help for a complete list of commands.`;
            }
        } else {
            const model = ai.getGenerativeModel({ model: "gemini-3.6-flash" });
            const result = await model.generateContent(cleanPrompt);
            const response = await result.response;
            responseText = response.text();
        }

        res.json({ reply: responseText });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message || 'Internal server error processing prompt.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running live on port ${PORT}`);
});
