// server.js
const express = require('express');
const cors    = require('cors');
require('dotenv').config();

const app = express();

// ← Allow your frontend domain
app.use(cors({
  origin: [
    'https://dwms-frontend.onrender.com',
    'http://localhost:3000',
    'http://localhost:5000',
    'http://127.0.0.1:5500',
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json());

// Routes
app.use('/api/auth', require('./routes/auth'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});