const express = require('express');
const cors = require('cors');
const app = express();

app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.AI_API_KEY; // Pulls your API key securely from Render

// Serve index.html directly from the root directory (no folders)
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

app.post('/api/chat', async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        // Updated to use the current Gemini 3.8 Flash model endpoint
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });

        const data = await response.json();
        
        // Log data to Render console if Google returns an error object
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
