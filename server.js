const express = require('express');
const cors = require('cors');
const app = express();

app.use(express.json());
app.use(cors());
app.use(express.static('public')); // Serves your index.html and frontend assets

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.AI_API_KEY; // Pulls your API key securely from Render

app.post('/api/chat', async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        // Example using the Gemini API endpoint
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });

        const data = await response.json();
        const aiReply = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response from agent.";
        
        res.json({ reply: aiReply });
    } catch (error) {
        console.error('API Error:', error);
        res.status(500).json({ error: 'Failed to fetch AI response' });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
