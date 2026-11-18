'use strict';

const express = require('express');
const path = require('path');

const app = express();
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use(express.static(path.join(__dirname, 'public')));

const port = Number(process.env.PORT || 3030);
const host = process.env.HOST || '127.0.0.1';
app.listen(port, host, () => console.log('射氣球 http://' + host + ':' + port));
