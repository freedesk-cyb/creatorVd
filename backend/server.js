const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { generateVideo } = require('./videoGenerator');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Logger to see requests in Railway logs
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Store statuses in memory (use Redis or DB for production)
const tasks = {};

app.post('/api/generate', async (req, res) => {
    const { text, voice } = req.body;
    
    if (!text) {
        return res.status(400).json({ error: 'Text is required' });
    }

    const taskId = uuidv4();
    tasks[taskId] = { status: 'starting', progress: 0, videoUrl: null, error: null };

    // Start background process
    generateVideo(text, voice, taskId, (status, progress) => {
        tasks[taskId].status = status;
        tasks[taskId].progress = progress;
    }).then(videoUrl => {
        tasks[taskId].status = 'completed';
        tasks[taskId].progress = 100;
        tasks[taskId].videoUrl = videoUrl;
    }).catch(err => {
        tasks[taskId].status = 'failed';
        tasks[taskId].error = err.message;
    });

    res.json({ taskId });
});

app.get('/api/status/:id', (req, res) => {
    const task = tasks[req.params.id];
    if (!task) {
        return res.status(404).json({ error: 'Task not found' });
    }
    res.json(task);
});

// Catch-all for undefined routes
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
