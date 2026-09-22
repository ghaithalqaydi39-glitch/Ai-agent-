const express = require('express');
const cors = require('cors');
const app = express();

app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.AI_API_KEY;

// Serve index.html directly from the root directory
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
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

app.post('/api/chat', async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        // Updated to use the correct gemini-2.5-flash endpoint
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;
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
