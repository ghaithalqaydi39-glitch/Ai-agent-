const express = require('express');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(express.json());

// Serve static frontend files directly from the root project directory
app.use(express.static(path.join(__dirname)));

// Explicit root routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/signup', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Initialize Google Gen AI with your API key from environment variables using the correct SDK syntax
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// In-Memory Database Stores
const users = {
    'master_admin_root': {
        id: 'master_admin_root',
        username: 'MasterOwner',
        password: 'SuperSecureMasterPassword123!',
        role: 'administrator',
        status: 'active'
    }
};

// Store message history per user ID
const userMessages = {
    'master_admin_root': []
};

// Store audit logs per user ID
const userAuditLogs = {
    'master_admin_root': [
        { timestamp: new Date().toISOString(), action: 'Account initialized as Master Owner.' }
    ]
};

// Helper to log audit events
function logAudit(userId, actionText) {
    if (!userAuditLogs[userId]) {
        userAuditLogs[userId] = [];
    }
    userAuditLogs[userId].unshift({
        timestamp: new Date().toISOString(),
        action: actionText
    });
}

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
    userMessages[userId] = [];
    userAuditLogs[userId] = [
        { timestamp: new Date().toISOString(), action: 'Account registered successfully.' }
    ];

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

    logAudit(user.id, 'User signed into session.');

    res.json({
        userId: user.id,
        username: user.username,
        role: user.role,
        message: 'Signed in successfully.'
    });
});

// User Profile: View & Change Password
app.post('/api/user/password/view', (req, res) => {
    const { userId } = req.body;
    const user = users[userId];
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    res.json({ password: user.password });
});

app.post('/api/user/password/change', (req, res) => {
    const { userId, newPassword } = req.body;
    const user = users[userId];
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });
    if (!newPassword || newPassword.length < 4) {
        return res.status(400).json({ error: 'Password must be at least 4 characters long.' });
    }

    user.password = newPassword;
    logAudit(userId, 'Password was updated by user.');
    res.json({ message: 'Password successfully updated.' });
});

// User Profile: View Messages History
app.post('/api/user/messages', (req, res) => {
    const { userId } = req.body;
    const user = users[userId];
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    res.json({ messages: userMessages[userId] || [] });
});

// User Profile: View Audit Logs
app.post('/api/user/audit-logs', (req, res) => {
    const { userId } = req.body;
    const user = users[userId];
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    res.json({ auditLogs: userAuditLogs[userId] || [] });
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

// Admin/Staff: Moderation Actions
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
        return res.status(400).json({ error: 'Security Error: You cannot moderate yourself!' });
    }

    if (action === 'warn') {
        target.status = 'warned';
        logAudit(targetUserId, `Admin ${admin.username} issued a warning.`);
        return res.json({ message: `Successfully issued warning to ${target.username}.` });
    } else if (action === 'kick') {
        target.status = 'kicked';
        logAudit(targetUserId, `Admin ${admin.username} kicked user.`);
        return res.json({ message: `Successfully kicked ${target.username}.` });
    } else if (action === 'ban') {
        target.status = 'banned';
        logAudit(targetUserId, `Admin ${admin.username} banned user.`);
        return res.json({ message: `Successfully banned ${target.username}.` });
    } else if (action === 'unban') {
        target.status = 'active';
        logAudit(targetUserId, `Admin ${admin.username} unbanned user.`);
        return res.json({ message: `Successfully unbanned ${target.username}.` });
    } else if (action === 'change_role') {
        if (admin.role !== 'administrator') {
            return res.status(403).json({ error: 'Only administrators can change user roles.' });
        }
        target.role = newRole;
        logAudit(targetUserId, `Admin ${admin.username} changed role to ${newRole}.`);
        return res.json({ message: `Successfully updated ${target.username}'s role to ${newRole}.` });
    } else if (action === 'delete_account') {
        if (admin.role !== 'administrator') {
            return res.status(403).json({ error: 'Only administrators can delete accounts.' });
        }
        delete users[targetUserId];
        delete userMessages[targetUserId];
        delete userAuditLogs[targetUserId];
        return res.json({ message: 'Account permanently deleted.' });
    }

    res.status(400).json({ error: 'Invalid moderation action.' });
});

// AI Chat Endpoint with Corrected SDK Call & Audit Logging
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

        // Record user prompt in message history
        if (!userMessages[userId]) userMessages[userId] = [];
        userMessages[userId].push({ sender: 'user', text: cleanPrompt, timestamp: new Date().toISOString() });

        if (cleanPrompt.startsWith('/')) {
            const cmd = cleanPrompt.toLowerCase();
            if (cmd === '/help') {
                responseText = "Available Member Commands:\n• /help - Help guide\n• /ping - Latency check\n• /stats - Server telemetry\n• /whoami - Account details\n• /version - Build version\n• /cmd1 through /cmd50 - Utility automation scripts.";
            } else if (cmd === '/ping') {
                responseText = "Pong! Response latency: 12ms. Server cluster online.";
            } else if (cmd === '/stats') {
                responseText = "Server Telemetry: CPU usage 4.2%, RAM 18.5%, active connections nominal.";
            } else if (cmd === '/whoami') {
                responseText = `Authenticated user: ${user.username} | ID: ${user.id} | Role: ${user.role}`;
            } else if (cmd === '/version') {
                responseText = "Nexus AI Workspace Kernel v3.4.2-RELEASE";
            } else if (cmd.startsWith('/cmd')) {
                const num = parseInt(cmd.replace('/cmd', ''), 10);
                if (num >= 1 && num <= 50) {
                    responseText = `Successfully executed Member Utility Routine #${num}. Status: OK.`;
                } else {
                    responseText = `Error: Command does not exist. Type /help for valid commands.`;
                }
            } else {
                responseText = `Unknown command: ${cleanPrompt}. Type /help for options.`;
            }
        } else {
            // Correct SDK call using ai.models.generateContent
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: cleanPrompt,
            });
            responseText = response.text;
        }

        // Record assistant response in message history
        userMessages[userId].push({ sender: 'assistant', text: responseText, timestamp: new Date().toISOString() });
        logAudit(userId, `Executed prompt/command: "${cleanPrompt.substring(0, 30)}..."`);

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
