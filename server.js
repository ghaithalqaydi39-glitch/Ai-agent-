const express = require('express');
const cors = require('cors');
const app = express();

app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.AI_API_KEY;

// In-memory user database: { username: password }
const users = {};

// Master owner secret updated to your custom secure key
const OWNER_SECRET = process.env.OWNER_SECRET || 'HiddenPulse-Secret-key';

// Serve index.html directly from the root directory
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// SIGN UP ENDPOINT
app.post('/api/signup', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }
    if (users[username]) {
        return res.status(400).json({ error: 'Username already exists' });
    }

    users[username] = password;
    res.json({ message: 'Account created successfully! You can now sign in.' });
});

// SIGN IN ENDPOINT
app.post('/api/signin', (req, res) => {
    const { username, password } = req.body;
    const storedPassword = users[username];

    if (!storedPassword) {
        return res.status(400).json({ error: 'Account not found' });
    }
    if (storedPassword !== password) {
        return res.status(400).json({ error: 'Incorrect password' });
    }

    res.json({ message: 'Signed in successfully', username });
});

// OWNER ADMIN ENDPOINT (View all usernames and passwords)
app.post('/api/admin/users', (req, res) => {
    const { ownerSecret } = req.body;
    if (ownerSecret !== OWNER_SECRET) {
        return res.status(403).json({ error: 'Unauthorized: Invalid owner secret' });
    }

    // Return the full list of users and passwords
    res.json({ users });
});

// Helper function to retry fetch if Google hits high demand
async function fetchWithRetry(url, options, retries = 3, delay = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            const data = await response.json();
            
            if (data.error && data.error.code === 503 && i < retries - 1) {
                console.warn(`Model busy, retrying in ${delay}ms... (Attempt ${i + 1})`);
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
        const { prompt } = req.body;
        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${API_KEY}`;
        const options = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        };

        const data = await fetchWithRetry(url, options);
        
        if (data.error) {
            console.error('Google API Error:', data.error);
            return res.status(500).json({ error: data.error.message || 'AI service error' });
        }

        const aiReply = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response from agent.";
        res.json({ reply: aiReply });
    } catch (error) {
        console.error('Server Fetch Error:', error);
        res.status(500).json({ error: 'Failed to fetch AI response' });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
