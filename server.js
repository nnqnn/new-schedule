const express = require('express');
const sirinium = require('sirinium');
const cors = require('cors');

const app = express();
app.use(cors());

app.get('/api/schedule', async (req, res) => {
    try {
        const { group, week = 0 } = req.query;
        const client = new sirinium.Client();
        await client.getInitialData();
        await client.changeWeek(Number(week));
        const schedule = await client.getGroupSchedule(group);
        res.json(schedule);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(3000, () => console.log('Server started on port 3000'));