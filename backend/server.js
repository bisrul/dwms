const express = require('express');
const cors    = require('cors');
require('dotenv').config();

const app = express();

app.use(cors({
  origin: [
    'https://dwms-frontend.onrender.com',
    'http://localhost:3000',
    'http://localhost:5000',
    'http://127.0.0.1:5500',
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

app.use(express.json());
app.use(express.static('../frontend'));

app.use('/api/auth',      require('./routes/auth'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/pipelines', require('./routes/pipelines'));
app.use('/api/schema',    require('./routes/schema'));
app.use('/api/query',     require('./routes/query'));
app.use('/api/users',     require('./routes/users'));
app.use('/api/etl',       require('./routes/etl'));
app.use('/api/youtube',   require('./routes/youtube'));

app.get('/', (req, res) => {
  res.json({ message: 'DWMS API is running!' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  const { initScheduler } = require('./scheduler');
  await initScheduler();
});
