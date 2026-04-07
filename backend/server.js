// server.js
const express = require('express');
const cors    = require('cors');
require('dotenv').config();

const app = express();

// ← Allow your frontend domain
app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://your-frontend.vercel.app'   // update this later
  ],
  credentials: true
}));

app.use(express.json());

// Routes
app.use('/api/auth', require('./routes/auth'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});