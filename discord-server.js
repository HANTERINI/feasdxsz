const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const UPLOAD_DIR = path.join(__dirname, 'temp_uploads');

// ВСТАВЬ СЮДА СВОЙ DISCORD WEBHOOK URL
const DISCORD_WEBHOOK = 'https://discord.com/api/webhooks/1513431922271846401/i9sFG0VEkFmBvf1mE2CQ1W3W_0dRj4jpGsoRKzxes3kWliswhei-FrBbk5qNtx6WRLfe'; // Например: https://discord.com/api/webhooks/123456789/abcdef...

if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function parseMultipart(data, boundary) {
    const parts = [];
    const boundaryBuffer = Buffer.from('--' + boundary);
    const endBoundaryBuffer = Buffer.from('--' + boundary + '--');
    let start = 0;
    
    while (true) {
        const boundaryIndex = data.indexOf(boundaryBuffer, start);
        if (boundaryIndex === -1) break;
        
        const isEndBoundary = data.indexOf(endBoundaryBuffer, start) === boundaryIndex;
        
        const nextBoundaryIndex = data.indexOf(boundaryBuffer, boundaryIndex + boundaryBuffer.length);
        if (nextBoundaryIndex === -1 && !isEndBoundary) break;
        
        const endIndex = nextBoundaryIndex !== -1 ? nextBoundaryIndex : boundaryIndex + (isEndBoundary ? endBoundaryBuffer.length : boundaryBuffer.length);
        const part = data.slice(boundaryIndex + boundaryBuffer.length, endIndex);
        
        let contentStart = 0;
        if (part.slice(0, 2).toString() === '\r\n') {
            contentStart = 2;
        }
        
        const headerEnd = part.indexOf('\r\n\r\n', contentStart);
        if (headerEnd !== -1) {
            const headers = part.slice(contentStart, headerEnd).toString();
            let content = part.slice(headerEnd + 4);
            
            if (content.slice(-2).toString() === '\r\n') {
                content = content.slice(0, -2);
            }
            
            const nameMatch = headers.match(/name="([^"]+)"/);
            const filenameMatch = headers.match(/filename="([^"]+)"/);
            
            if (nameMatch) {
                parts.push({
                    name: nameMatch[1],
                    filename: filenameMatch ? filenameMatch[1] : null,
                    content: content
                });
            }
        }
        
        if (isEndBoundary || nextBoundaryIndex === -1) break;
        start = nextBoundaryIndex;
    }
    
    return parts;
}

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    
    if (req.method === 'POST' && req.url === '/upload') {
        const contentType = req.headers['content-type'] || '';
        
        if (contentType.includes('multipart/form-data')) {
            let boundary = contentType.split('boundary=')[1];
            if (boundary) {
                boundary = boundary.split(';')[0];
                boundary = boundary.replace(/^["']|["']$/g, '').trim();
            }
            
            const chunks = [];
            req.on('data', chunk => chunks.push(chunk));
            req.on('end', () => {
                const buffer = Buffer.concat(chunks);
                const parts = parseMultipart(buffer, boundary);
                const filePart = parts.find(p => p.name === 'fileToUpload' && p.filename);
                
                if (!filePart) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'No file' }));
                    return;
                }
                
                // Upload to Discord
                if (!DISCORD_WEBHOOK) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Discord webhook not configured. Edit discord-server.js and set DISCORD_WEBHOOK' }));
                    return;
                }
                
                const discordBoundary = '----DiscordBoundary' + Date.now();
                const discordData = [
                    `--${discordBoundary}\r\n`,
                    `Content-Disposition: form-data; name="file"; filename="${filePart.filename}"\r\n`,
                    `Content-Type: application/octet-stream\r\n\r\n`,
                ];
                
                const body = Buffer.concat([
                    Buffer.from(discordData.join('')),
                    filePart.content,
                    Buffer.from(`\r\n--${discordBoundary}--\r\n`)
                ]);
                
                const webhookUrl = new URL(DISCORD_WEBHOOK);
                const discordReq = https.request({
                    hostname: webhookUrl.hostname,
                    path: webhookUrl.pathname,
                    method: 'POST',
                    headers: {
                        'Content-Type': `multipart/form-data; boundary=${discordBoundary}`,
                        'Content-Length': body.length
                    }
                }, discordRes => {
                    let data = '';
                    discordRes.on('data', chunk => data += chunk);
                    discordRes.on('end', () => {
                        try {
                            const json = JSON.parse(data);
                            if (json.attachments && json.attachments.length > 0) {
                                const fileUrl = json.attachments[0].url;
                                res.writeHead(200, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ success: true, url: fileUrl }));
                            } else {
                                res.writeHead(500, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ success: false, error: 'No attachment in response: ' + data }));
                            }
                        } catch (e) {
                            res.writeHead(500, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: false, error: data }));
                        }
                    });
                });
                
                discordReq.on('error', err => {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: err.message }));
                });
                
                discordReq.write(body);
                discordReq.end();
            });
        } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Invalid content type' }));
        }
        return;
    }
    
    // Static files
    let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
    const ext = path.extname(filePath).toLowerCase();
    
    const mimeTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json'
    };
    
    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
        res.end(content);
    });
});

server.listen(PORT, () => {
    console.log(`Сервер запущен: http://localhost:${PORT}`);
    console.log(`НАСТРОЙКА:`);
    console.log(`1. Открой Discord → Настройки канала → Интеграции → Webhook`);
    console.log(`2. Создай webhook, скопируй URL`);
    console.log(`3. Открой файл discord-server.js и вставь URL в DISCORD_WEBHOOK`);
    console.log(`4. Перезапусти сервер`);
    console.log(`5. Открой http://localhost:${PORT} в браузере`);
});
