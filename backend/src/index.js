const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const routes = require('./routes');
const storage = require('./storage');
const { setupSockets, setupCron } = require('./realtime');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use('/api', routes(io));
setupSockets(io);
setupCron(io);

storage.init();
server.listen(3000, () => console.log('API on :3000'));
